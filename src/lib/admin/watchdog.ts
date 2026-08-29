import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTelegram } from "@/lib/admin/track";
import { getCronHeartbeats, pingAiProviders } from "@/lib/admin/health";
import { checkExternalDeps } from "@/lib/admin/deps";
import { estimateCost } from "@/lib/admin/ai-cost";
import { getFlywheelGates, TOKEN_SPENDING_GATES } from "@/lib/admin/gates";
import { selectAllRows } from "@/lib/supabase/paginate";
import { CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";

/**
 * Alert watchdog — the platform's autonomous monitor. Runs every cron tick
 * (~5 min) and pages the operator on Telegram for anything worth knowing,
 * across security, money, infra and business. Persistent per-alert dedup
 * (admin_kv) keeps it from repeating. Best-effort: never throws into the cron.
 *
 * Thresholds are env-overridable; the defaults suit a small/launch platform.
 */
const ERROR_SPIKE  = Number(process.env.ALERT_ERROR_SPIKE   ?? 10);  // errors / 10min
const SEC_FLOOD    = Number(process.env.ALERT_SEC_FLOOD     ?? 5);   // high-sev / 10min
const AI_BUDGET    = Number(process.env.ALERT_AI_BUDGET_USD ?? 20);  // $ / 24h → alert only
const AI_KILL      = Number(process.env.ALERT_AI_KILL_USD   ?? 30);  // $ / 24h → auto-pause tournament (0 = off)
const LARGE_OP     = Number(process.env.ALERT_LARGE_OP_USD  ?? 5000);// $ single op
/**
 * ⚠️ CRON QUE NÃO ESTÁ AQUI MORRE EM SILÊNCIO.
 *
 * O `dca` bate heartbeat desde 24/08 e o RUNBOOK já dizia ">20 min" — mas a
 * linha nunca existiu aqui, então o watchdog nunca ia acusar. Documento
 * afirmando o que o código não faz é o mesmo defeito que as auditorias de
 * 23–24/08 acharam dez vezes no produto; desta vez estava na operação.
 *
 * 20 min = quatro passadas perdidas numa cadência de 5. Mais folgado que o
 * autopilot (12) de propósito: um ciclo de DCA atrasado alguns minutos não
 * muda nada, e alarme que toca à toa é alarme que se aprende a ignorar.
 */
const CRON_STALE_MIN: Record<string, number> = { autopilot: 12, backtest: 75, radar: 5, dca: 20 };

/** Persistent dedup: returns true (and stamps) only if `key` hasn't fired
 *  within `windowMs`. Survives across cron invocations/instances via admin_kv. */
async function dedupOk(key: string, windowMs: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return true;
  const k = `alertdedup:${key}`;
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", k).maybeSingle();
    if (data?.value) {
      const last = Date.parse(data.value);
      if (Number.isFinite(last) && Date.now() - last < windowMs) return false;
    }
    await db.from("admin_kv").upsert({ key: k, value: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "key" });
    return true;
  } catch { return true; }
}


export async function runAlertWatchdog(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const now = Date.now();
  const ago10m = new Date(now - 600_000).toISOString();
  const ago24h = new Date(now - 86_400_000).toISOString();

  try {
    const [errs, secs, aiRows, largeOps, heartbeats] = await Promise.all([
      // leitura-limitada: janelas de 10 minutos e de 24h para os LIMIARES do
      // watchdog. Se alguma delas passar de 1.000 linhas, o limiar já disparou
      // muitas vezes antes — a conta exata deixou de importar.
      db.from("platform_events").select("created_at").eq("event_type", "error").gte("created_at", ago10m),
      db.from("platform_events").select("metadata").eq("event_type", "security").gte("created_at", ago10m),
      db.from("platform_events").select("metadata").eq("event_type", "zion_analysis").gte("created_at", ago24h),
      db.from("operations").select("pair, volume_usd, wallet_address").gte("created_at", ago10m).gt("volume_usd", LARGE_OP),
      getCronHeartbeats(),
    ]);

    // 1. Error spike
    const errCount = (errs.data ?? []).length;
    if (errCount >= ERROR_SPIKE && await dedupOk("error_spike", 1_800_000)) {
      notifyTelegram(`🐛 <b>Error spike</b> — ${errCount} errors in the last 10 min.`);
    }

    // 2. Security flood
    const highSec = (secs.data ?? []).filter((r) => (r.metadata as { severity?: string } | null)?.severity === "high").length;
    if (highSec >= SEC_FLOOD && await dedupOk("sec_flood", 1_800_000)) {
      notifyTelegram(`🔴 <b>Security flood</b> — ${highSec} high-severity events in 10 min. Possible attack.`);
    }

    // 3. Stale crons
    for (const [name, mins] of Object.entries(CRON_STALE_MIN)) {
      const last = heartbeats[name];
      const stale = !last || (now - Date.parse(last)) / 60_000 > mins;
      if (stale && await dedupOk(`stale_${name}`, 3_600_000)) {
        notifyTelegram(`⏰ <b>Cron stalled</b> — "${name}" hasn't run ${last ? `since ${new Date(last).toLocaleString()}` : "(never seen)"}.`);
      }
    }

    // 4. AI cost over budget
    let aiCost = 0;
    for (const r of aiRows.data ?? []) {
      aiCost += estimateCost((r.metadata ?? {}) as Parameters<typeof estimateCost>[0]);
    }
    if (aiCost > AI_BUDGET && await dedupOk("ai_budget", 86_400_000)) {
      notifyTelegram(`💸 <b>AI cost</b> in 24h is $${aiCost.toFixed(2)} — over the $${AI_BUDGET} budget.`);
    }
    // Budget cap with AUTO-KILL (P2.12). O alerta acima é aviso; ISTO é o
    // circuito que corta o gasto de verdade quando um laço em fuga aparece
    // entre duas conferências do operador.
    //
    // ⚠ CORREÇÃO 30/07 — O DISJUNTOR ESTAVA DESARMADO NA PRÁTICA.
    //
    // Ele pausava SÓ `pause_tournament`. Quando o torneio foi pausado por
    // decisão de custo, o disjuntor passou a disparar contra uma chave que já
    // estava desligada: acionava, mandava o alerta e NÃO cortava gasto nenhum.
    // Pior, as mesas que gastam token hoje — MÍMIR e a VÖLVA — nasceram depois
    // dele e nunca estiveram na lista.
    //
    // Agora ele desliga TODOS os consumidores de token conhecidos e só avisa
    // sobre os que realmente mudou de estado — senão o alerta viraria ruído
    // diário sobre gates que já estavam fechados.
    //
    // ⚠ SEGUNDA CORREÇÃO 01/08 — A LISTA AINDA ESTAVA INCOMPLETA.
    //
    // Mesmo depois do conserto de 30/07 ela era digitada à mão aqui, e faltavam
    // `pause_agent_a`, `pause_radar` e `pause_sniper` — três mesas que gastam
    // token. Faltava também o maior gastador de todos: o `/api/zion` do
    // USUÁRIO, que nem gate tinha. O disjuntor podia pausar sete mesas internas
    // e o gasto seguir correndo pela porta da frente.
    //
    // A lista agora é DERIVADA de `GATE_SPENDS_TOKENS`, que mora ao lado da
    // definição dos gates. Mesa nova sem classificação não compila.
    if (AI_KILL > 0 && aiCost > AI_KILL) {
      const spenders: string[] = TOKEN_SPENDING_GATES;
      const { data: gates } = await db.from("admin_kv").select("key, value").in("key", spenders);
      const already = new Set((gates ?? []).filter((g) => g.value === "true").map((g) => g.key));
      const toKill = spenders.filter((k) => !already.has(k));
      if (toKill.length > 0) {
        await db.from("admin_kv").upsert(
          toKill.map((key) => ({ key, value: "true", updated_at: new Date().toISOString() })),
          { onConflict: "key" },
        );
        notifyTelegram(
          `🛑 <b>AI budget KILL</b> — 24h em $${aiCost.toFixed(2)}, acima do teto de $${AI_KILL}. `
          + `PAUSADO: ${toKill.join(", ")}. Religue em AI Controls quando quiser.`,
        );
      }
    }

    // 5. Large operations
    const ops = largeOps.data ?? [];
    if (ops.length > 0 && await dedupOk("large_op", 900_000)) {
      const top = ops.reduce((m, o) => (Number(o.volume_usd) > Number(m.volume_usd) ? o : m), ops[0]);
      notifyTelegram(`🐋 <b>Large operation</b> — ${ops.length} trade(s) over $${LARGE_OP} in 10 min. Top: ${top.pair ?? "?"} $${Math.round(Number(top.volume_usd)).toLocaleString()}.`);
    }

    // 6. DEPENDÊNCIAS EXTERNAS — o caminho do dinheiro (29/07).
    //
    // Antes aqui só havia dois pings genéricos (Binance, CoinGecko), e nenhum
    // deles tocava no que EXECUTA swap. Foi assim que a Jupiter desligar o
    // `quote-api.jup.ag` passou dias invisível: o código estava perfeito, o
    // host é que tinha morrido — e nada no repositório poderia denunciar isso.
    //
    // Agora cada dependência é exercitada com chamada REAL e o alerta diz O QUE
    // QUEBRA, não só o nome. Às 3 da manhã "GeckoTerminal down" não ajuda;
    // "FREYJA e ULLR pararam de operar" manda agir.
    const external = await checkExternalDeps();
    for (const d of external) {
      if (d.ok) continue;
      // Cosmética não acorda ninguém — alarme que toca à toa vira alarme que
      // ninguém olha, e aí o alarme de verdade também é ignorado.
      if (d.impact === "cosmetic") continue;
      // Geobloqueio (451) é condição PERMANENTE da região do deploy, não
      // evento. Alertar seria mandar a mesma mensagem para sempre.
      if (d.geoBlocked) continue;
      // Crítico repete a cada 30min; degradado a cada 6h.
      const window = d.impact === "critical" ? 1_800_000 : 21_600_000;
      if (await dedupOk(`dep_${d.id}`, window)) {
        const icon = d.impact === "critical" ? "🔴" : "🟡";
        notifyTelegram(
          `${icon} <b>${d.name} fora do ar</b>${d.note ? ` — ${d.note}` : ""}\n` +
          `<b>O que quebra:</b> ${d.breaks}`,
        );
      }
    }
    // The rest of the Ferrari's model stack (DeepSeek / Kimi / Mistral / Grok /
    // …) — alert per provider so a dead model doesn't silently skew the A/B.
    // BUT: only when the stack is actually in use. If the operator paused the
    // whole backtest or the tournament, a dead/absent direct-provider key is
    // expected, not an incident — pinging + alerting it would just be spam
    // (the exact Grok/Kimi flood the CEO saw). Dedup widened to 6h so even an
    // active-but-broken key pages at most a few times a day, not every 30 min.
    const gates = await getFlywheelGates();
    const stackInUse = !gates.pause_backtest && !gates.pause_tournament;
    if (stackInUse) {
      for (const p of await pingAiProviders()) {
        if (!p.ok && await dedupOk(`dep_ai_${p.name}`, 21_600_000)) {
          notifyTelegram(`🤖 <b>AI model down</b> — ${p.name} not responding${p.note ? ` (${p.note})` : ""}.`);
        }
      }
    }

    // 7. Daily digest (once / 24h)
    if (await dedupOk("daily_digest", 86_400_000)) {
      await sendDailyDigest();
    }
  } catch { /* watchdog must never break the cron */ }
}

// Round-trip execution cost netted out of expectancy — mirrors backtest.ts /
// the admin panel so the digest shows the SAME net edge, not a rosier gross.
const DIGEST_COST_PCT = CUSTO_IDA_E_VOLTA_PCT;
const DIGEST_MIN_SAMPLE = Number(process.env.BACKTEST_MIN_SAMPLE ?? 100);

type SuggRow = { status: string; outcome_pct: number | null; source: string | null };

/** Per-agent flywheel leaderboard (self_scan / tournament / radar), formatted
 *  for Telegram: decided count, win-rate and NET expectancy per source, worst
 *  agents flagged so the CEO reads the tournament from his pocket. Sub-sample
 *  agents (<MIN_SAMPLE decided) carry a ⚠ so a lucky small streak isn't read
 *  as skill. Paginated — the ledger is past 1000 rows (A1). */
async function flywheelDigestBlock(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<string> {
  const rows = await selectAllRows<SuggRow>((from, to) =>
    db.from("zion_suggestions")
      .select("status, outcome_pct, source")
      .is("archived_at", null) // live round only (docs/PLANO-ARQUIVO-RODADAS.md)
      .order("created_at", { ascending: true }).range(from, to));
  if (rows.length === 0) return "";

  type Agg = { decided: number; wins: number; resolved: number; sum: number };
  const by = new Map<string, Agg>();
  for (const r of rows) {
    const src = (r.source ?? "—").replace(/_scan$/, "");
    const a = by.get(src) ?? { decided: 0, wins: 0, resolved: 0, sum: 0 };
    const win  = r.status === "win"  || r.status === "hit_target";
    const loss = r.status === "loss" || r.status === "hit_stop";
    if (r.status !== "open") { a.resolved++; a.sum += Number(r.outcome_pct) || 0; }
    if (win)  { a.decided++; a.wins++; }
    else if (loss) a.decided++;
    by.set(src, a);
  }

  const lines = [...by.entries()]
    .filter(([, a]) => a.resolved > 0)
    .map(([src, a]) => ({
      src,
      decided: a.decided,
      win: a.decided > 0 ? Math.round((a.wins / a.decided) * 100) : 0,
      net: a.sum / a.resolved - DIGEST_COST_PCT,
    }))
    .sort((x, y) => y.net - x.net)
    .map((l) =>
      ` ${l.net >= 0 ? "🟢" : "🔴"} ${l.src}: ${l.decided}d · ${l.win}% · ` +
      `${l.net >= 0 ? "+" : ""}${l.net.toFixed(2)}%${l.decided < DIGEST_MIN_SAMPLE ? " ⚠" : ""}`);
  if (lines.length === 0) return "";

  const gates = await getFlywheelGates();
  const state = gates.pause_backtest ? "⏸ pausado" : "▶ rodando";
  return `\n🏁 <b>Flywheel</b> ${state} — agente: decididos·win·líq.\n${lines.join("\n")}\n<i>⚠ = abaixo de ${DIGEST_MIN_SAMPLE} decididos (sub-amostra)</i>`;
}

/**
 * Placar das carteiras de papel para o digest — patrimônio e taxa de acerto.
 *
 * ⚠️⚠️ AS DUAS METADES DESTA LINHA VINHAM DE ERAS DIFERENTES (29/08).
 *
 * O patrimônio saía de `realized_pnl_usd` e a taxa de acerto de `wins/losses`,
 * as duas colunas da MESMA linha de `paper_accounts` — e elas descrevem
 * períodos distintos:
 *
 *   · `repairWallets` (22/08 01:10, registrado em `admin_kv`) realinhou
 *     `realized_pnl_usd` ao valor calculado da RODADA VIVA...
 *   · ...e não tocou em `wins`/`losses`, que seguem com o total de ANTES do
 *     arquivamento.
 *
 * O estrago é silencioso e mede pontos inteiros. Em 29/08:
 *
 *     Mistral   coluna 44/38 → 54%     livro vivo 30/12 → 71%
 *     SKAÐI     coluna 74/60 → 55%     livro vivo 32/23 → 58%
 *     Arbiter2  coluna  1/0  → 100%    livro vivo  0/0  → não opera desde 03/08
 *
 * O Mistral aparecia dezessete pontos PIOR do que é, e uma mesa parada há quase
 * um mês aparecia com 100% de acerto por causa de uma única vitória órfã.
 *
 * ⚠️ E A CORREÇÃO NÃO É APAGAR A CONTA. `admin/api/paper/route.ts` já raciocinou
 * isto em 13/08 e concluiu certo: a conta guarda a história anterior ao
 * arquivamento, o livro guarda o que ainda está sendo medido, e recalcular a
 * conta a partir do livro inventaria um passado que não houve.
 *
 * O que se conserta aqui é a MISTURA: se o patrimônio é da rodada viva, o
 * acerto tem de ser da rodada viva também. As colunas seguem intactas para
 * quem quiser a vida inteira — o painel PAPER mostra as duas.
 *
 * ⚠️ E QUANDO AS DUAS DISCORDAM, A LINHA DIZ (`≠`). Trocar uma fonte pela outra
 * em silêncio esconderia que existe divergência — que é a informação que fez
 * este conserto acontecer.
 */
async function paperDigestBlock(db: NonNullable<ReturnType<typeof getSupabaseAdmin>>): Promise<string> {
  const { data: accts } = await db.from("paper_accounts").select("id, label, starting_usd, realized_pnl_usd, wins, losses");
  if (!accts?.length) return "";

  // ⚠️ PAGINADO e filtrado por `archived_at is null`: é a rodada VIVA, a mesma
  // janela de que o `realized_pnl_usd` reparado fala. `.limit()` aqui devolveria
  // as primeiras mil linhas sem aviso — a cicatriz de 03/08 em `reconcile.ts`.
  const fechadas = await selectAllRows<{ account_id: string; exit_reason: string | null }>(
    (from, to) => db.from("paper_positions").select("account_id, exit_reason")
      .eq("status", "closed").is("archived_at", null)
      .order("id", { ascending: true }).range(from, to));

  const vivo = new Map<string, { w: number; l: number }>();
  for (const f of fechadas) {
    const k = String(f.account_id);
    const v = vivo.get(k) ?? { w: 0, l: 0 };
    // ⚠️ `expired` não entra: não é vitória nem derrota, é ausência de veredito.
    if (f.exit_reason === "target") v.w++;
    else if (f.exit_reason === "stop") v.l++;
    vivo.set(k, v);
  }

  const rows = accts
    .map((a) => {
      const start = Number(a.starting_usd), pnl = Number(a.realized_pnl_usd);
      const v = vivo.get(String(a.id)) ?? { w: 0, l: 0 };
      const decidedVivo = v.w + v.l;
      const decidedConta = Number(a.wins) + Number(a.losses);
      const winVivo  = decidedVivo  > 0 ? Math.round((v.w / decidedVivo) * 100) : null;
      const winConta = decidedConta > 0 ? Math.round((Number(a.wins) / decidedConta) * 100) : null;
      return {
        label: a.label, equity: start + pnl,
        ret: start > 0 ? (pnl / start) * 100 : 0,
        decidedVivo, winVivo,
        // A conta e o livro discordam? A linha marca, em vez de escolher calado.
        divergente: winConta != null && winVivo != null && winConta !== winVivo,
      };
    })
    // ⚠️ O FILTRO PASSA A SER DO LIVRO VIVO. Antes era `wins+losses > 0`, e por
    // isso mesas sem NENHUMA posição viva — Arbiter 2.0, Sniper, os Oráculos —
    // entravam no placar com o contador órfão de uma rodada arquivada.
    .sort((x, y) => y.equity - x.equity);

  const vivas = rows.filter((r) => r.decidedVivo > 0);
  /**
   * ⚠️ AS QUE SAÍRAM DO PLACAR SÃO CONTADAS, NÃO SOMEM (invariante nº 33).
   *
   * Onze mesas — Arbiter 2.0, Sniper, os Oráculos, Claude (self) — têm contador
   * na conta e ZERO decisões no livro vivo: o placar delas era resquício de
   * rodada arquivada. Tirá-las é certo; tirá-las em silêncio faria "a mesa
   * sumiu do digest" e "a mesa nunca existiu" terem a mesma cara.
   */
  const arquivadas = rows.filter((r) => r.decidedVivo === 0);
  if (vivas.length === 0) return "";

  const line = vivas.map((r) =>
    ` ${r.ret >= 0 ? "🟢" : "🔴"} ${r.label}: $${Math.round(r.equity).toLocaleString()} `
    + `(${r.ret >= 0 ? "+" : ""}${r.ret.toFixed(1)}% · ${r.winVivo}%`
    // ⚠️ MESMA MARCA DE SUB-AMOSTRA DO FLYWHEEL. 67% em 3 decisões e 62% em 117
    // não são a mesma afirmação, e sem a marca a tela apresenta as duas igual.
    + `${r.decidedVivo < DIGEST_MIN_SAMPLE ? " ⚠" : ""}${r.divergente ? " ≠" : ""})`).join("\n");

  const notas: string[] = [];
  if (vivas.some((r) => r.decidedVivo < DIGEST_MIN_SAMPLE)) {
    notas.push(`<i>⚠ = abaixo de ${DIGEST_MIN_SAMPLE} decididos na rodada viva</i>`);
  }
  if (vivas.some((r) => r.divergente)) {
    notas.push("<i>≠ = a conta (vida inteira) discorda do livro vivo — ver painel PAPER</i>");
  }
  if (arquivadas.length > 0) {
    notas.push(`<i>${arquivadas.length} mesa(s) fora: contador na conta, nenhuma decisão na rodada viva</i>`);
  }
  return `\n📈 <b>Paper · Gate.io</b> (patrimônio · retorno · win da RODADA VIVA)\n${line}`
    + (notas.length ? `\n${notas.join("\n")}` : "");
}

async function sendDailyDigest(): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const ago24h = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: users }, { count: active24h }, { data: ops }, { data: sess }, { data: positions }, flywheel, paper] = await Promise.all([
    db.from("users").select("*", { count: "exact", head: true }),
    db.from("users").select("*", { count: "exact", head: true }).gte("last_seen_at", ago24h),
    db.from("operations").select("volume_usd, pnl_usd, created_at"),
    db.from("autopilot_sessions").select("pnl_today, is_active"),
    db.from("autopilot_positions").select("cost_usd").neq("status", "closed"),
    flywheelDigestBlock(db),
    paperDigestBlock(db),
  ]);

  let vol24 = 0, pnlAll = 0;
  for (const o of ops ?? []) { pnlAll += Number(o.pnl_usd) || 0; if (o.created_at >= ago24h) vol24 += Number(o.volume_usd) || 0; }
  let apPnl = 0, apActive = 0;
  for (const s of sess ?? []) { apPnl += Number(s.pnl_today) || 0; if (s.is_active) apActive++; }
  let exposure = 0;
  for (const p of positions ?? []) exposure += Number(p.cost_usd) || 0;
  const m = (n: number) => `$${Math.round(n).toLocaleString()}`;

  notifyTelegram(
    `☀️ <b>Z-SWAP daily digest</b>\n` +
    `👥 Users: ${users ?? 0} (${active24h ?? 0} active 24h)\n` +
    `📊 Volume 24h: ${m(vol24)}\n` +
    `💰 Realized P&L (all): ${pnlAll >= 0 ? "+" : ""}${m(pnlAll)}\n` +
    `🤖 Autopilot: ${apActive} active · today ${apPnl >= 0 ? "+" : ""}${m(apPnl)} · exposure ${m(exposure)}` +
    flywheel + paper,
  );
}
