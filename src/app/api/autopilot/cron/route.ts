import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import {
  listRunnableSessions, credenciaisDaSessao, patchSession, recordRuns, utcDayKey,
  type OrigemCredencial,
  tryLockSession, releaseLock,
} from "@/lib/autopilot/sessions";
import { reservaDaVagaDiaria, type VagaDiaria } from "@/lib/autopilot/reserva-de-vaga";
import { runAutopilotCexScan, formatRegimeContext } from "@/lib/autopilot/scan";
import { mapCardToCexIntents } from "@/lib/zion/card-mapping";
import { fetchCexBalance, fetchCexOrderStatus } from "@/lib/cex/server";
import { executarOrdemCex } from "@/lib/cex/execucao/executor";
import { reconciliarPendentes } from "@/lib/cex/execucao/reconciliador";
import { reconciliarConta } from "@/lib/cex/execucao/reconciliar-conta";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getCexSpotPrices, type CexSpotPrice } from "@/lib/api/cex-spot";
import { getMarketIndicators } from "@/lib/api/market-indicators";
import { avaliarDecisaoDeEstrategia } from "@/lib/autopilot/politica";
import { certificadoVivo } from "@/lib/autopilot/certificado";
import { decidirPelaAutorizacao, precisaRevalidar } from "@/lib/autopilot/tier-da-sessao";
import {
  avaliarAutorizacaoDaSessaoParaExecucao, entradaAutorizadaNaSessao,
} from "@/lib/autopilot/autorizacao-de-execucao";
import { getTierForWallet } from "@/lib/tier/check";
import { tierSatisfies, FEATURE_TIER } from "@/lib/tier/types";
import { checkRealNotional } from "@/lib/autopilot/price-guard";
import { quantoPodeVender, oQueSobrou } from "@/lib/autopilot/venda-limitada";
import { logOperation, notifyTelegram } from "@/lib/admin/track";
import { setCronHeartbeat } from "@/lib/admin/health";
import { runAlertWatchdog } from "@/lib/admin/watchdog";
import { lerLiberacao, lerPilotos, decidirAutomacao } from "@/lib/autopilot/liberacao";
import {
  getOpenServerPositions, recordServerEntry, markServerExitArmed,
  closeServerPosition, reopenServerPosition, applySessionPnl, reduzirServerPosition,
} from "@/lib/autopilot/positions-server";
import type { AutopilotSessionRow, AutopilotRunRow, AutopilotPositionRow } from "@/lib/supabase/types";
import type { CexId, CexCredentials, CexOrder } from "@/lib/cex/types";
import { recordEvent } from "@/lib/admin/track";
import { taxaEmUsd } from "@/lib/cex/taxa";
import { credenciaisDoIntentParaRecovery } from "@/lib/cex/conexoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/autopilot/cron — the background-autopilot worker.
 *
 * Hit by a GitHub Actions schedule (see .github/workflows/autopilot-cron.yml)
 * every few minutes. Authenticated with a bearer == CRON_SECRET. For each
 * active, non-expired session it:
 *   1. rolls the daily counters over at UTC midnight,
 *   2. honors the daily loss-stop freeze,
 *   3. reads live balance → recomputes a bounded per-trade cap,
 *   4. runs a ZION scan,
 *   5. fires the resulting SPOT orders (futures/margin are scan-only in
 *      background — autonomous leverage unattended is too dangerous),
 *   6. records every outcome to autopilot_runs and updates counters.
 *
 * It NEVER throws to the caller — one bad session can't abort the batch.
 */

// Same risk→% mapping the in-browser UI uses to size trades off live balance.
const RISK_PCT: Record<string, number> = {
  conservador: 0.20,
  moderado:    0.40,
  agressivo:   0.65,
};
const MAX_ORDERS_PER_RUN = 4;

// Server-side total open-exposure cap per risk mode (mirrors the browser
// presets in store/autopilot.ts). The cron never lets the sum of open
// position cost exceed this (A4 server side).
const RISK_EXPOSURE_USD: Record<string, number> = { conservador: 75, moderado: 200, agressivo: 400 };

type RunRowT = Partial<AutopilotRunRow> & { wallet_address: string; exchange_id: string; status: string };


/**
 * P&L realizado de uma VENDA preenchida, contra o custo médio da posição.
 *
 * ⚠️⚠️ DEVOLVE O AVISO EM VEZ DE GRAVÁ-LO — e a mudança tem motivo (24/08).
 *
 * Esta função é cálculo puro e gravava um evento no meio. Misturar as duas
 * coisas obrigava a escolha ruim: ou ela virava `async` e o `await` subia por
 * toda a cadeia, ou o registro ficava sem `await` — e ficou, com o comentário
 * "o P&L não pode ficar refém do registro".
 *
 * ⚠️ AQUELE MOTIVO ERA FALSO. `recordEvent` NUNCA lança: engole o erro com
 * `.catch()` lá dentro. Aguardar não podia deixar o P&L refém de nada.
 *
 * E o que se perdia é justamente o aviso de que o P&L sai OTIMISTA e o stop
 * de perda afrouxa — a única pista de que o número na tela está errado A FAVOR
 * DA CASA. Agora o aviso volta como dado, e quem chama (que já é async) grava.
 */
function realizedFromSell(order: CexOrder, pos: AutopilotPositionRow): {
  realized: number | null;
  aviso: { moeda: string; valor: number } | null;
} {
  const vazio = { realized: null, aviso: null } as const;
  const filledQty = Number(order.filled ?? 0);
  if (!(filledQty > 0)) return vazio;
  const proceeds = Number(order.cost) > 0 ? Number(order.cost) : filledQty * Number(order.average ?? 0);
  if (!(proceeds > 0)) return vazio;
  const avgCost = Number(pos.base_amount) > 0 ? Number(pos.cost_usd) / Number(pos.base_amount) : 0;
  if (!(avgCost > 0)) return vazio;
  const costRemoved = avgCost * filledQty;
  const taxa = taxaEmUsd(order, proceeds, filledQty, String(pos.pair ?? ""));
  const realized = proceeds - costRemoved - taxa.usd;
  return {
    realized: Number.isFinite(realized) ? realized : null,
    aviso: taxa.naoPrecificada
      ? { moeda: taxa.naoPrecificada.moeda, valor: taxa.naoPrecificada.valor }
      : null,
  };
}

/**
 * Grava o aviso de taxa não precificada. ⚠️ AGUARDADO: na Vercel a função
 * congela depois da resposta, e este é o registro de que o P&L saiu otimista.
 */
async function avisarTaxaNaoPrecificada(pair: unknown, aviso: { moeda: string; valor: number }) {
  await recordEvent("autopilot_taxa_nao_precificada", { meta: {
    pair, moeda: aviso.moeda, valor: aviso.valor,
    why: "taxa em moeda que não é stable nem a base do par — subtraída como ZERO, "
      + "então o P&L realizado sai OTIMISTA e o stop de perda afrouxa",
  } });
}

/**
 * Settle exits armed on a PRIOR run (A5): poll each exit_armed position's
 * order; a filled exit realizes P&L (fed atomically to the loss-stop) and
 * closes the position; a canceled/expired one reopens so a later scan can
 * re-arm. Returns the run-log rows and the total realized delta.
 */
async function settleArmedExits(
  s: AutopilotSessionRow, creds: CexCredentials, exchange: CexId, today: string,
): Promise<{ rows: RunRowT[]; realizedDelta: number; livroLegivel: boolean }> {
  const rows: RunRowT[] = [];
  let realizedDelta = 0;
  /**
   * ⚠️⚠️ A133 — livro ilegível não é "nenhuma saída armada".
   *
   * Antes isto era `(await getOpenServerPositions(s.id)).filter(...)`, e um
   * erro de banco chegava como `[]`: a passada seguia adiante como se não
   * houvesse saída viva nenhuma. O `livroLegivel` sobe para quem chama, que
   * fecha a sessão para ENTRADAS novas — liquidar o que já está lá fora é
   * recovery e pode esperar a próxima passada; comprar mais, não.
   */
  const leitura = await getOpenServerPositions(s.id);
  if (!leitura.ok) {
    await recordEvent("autopilot_livro_ilegivel", { wallet: s.wallet_address, meta: {
      severity: "high", session: s.id, etapa: "settle", porque: leitura.porque,
      why: "nao deu para ler autopilot_positions. Nenhuma saida armada foi liquidada "
        + "nesta passada, e a sessao NAO abre entrada nova com inventario desconhecido.",
    } });
    return { rows, realizedDelta, livroLegivel: false };
  }
  const armed = leitura.posicoes.filter((p) => p.status === "exit_armed" && p.exit_order_id);
  for (const pos of armed) {
    try {
      const order = await fetchCexOrderStatus(exchange, creds, pos.exit_order_id!, pos.pair);
      const st = order.status?.toLowerCase() ?? "";
      if (st === "closed" || st === "filled") {
        const { realized, aviso } = realizedFromSell(order, pos);
        if (aviso) await avisarTaxaNaoPrecificada(pos.pair, aviso);
        if (realized !== null) {
          realizedDelta += realized;
          await exigirGravacao(
            await applySessionPnl(s.id, realized, today),
            "P&L realizado NAO contabilizado — o stop de perda diaria nao viu esta perda e pode nao puxar o freio hoje",
            { session: s.id, base: pos.base, realized });
        }
        /**
         * ⚠⚠ IDEM AQUI (A14): uma ordem limitada pode fechar PARCIALMENTE
         * preenchida, e apagar a linha deixaria o resto órfão para sempre.
         *
         * ⚠️⚠️ ACHADO A81. A linha dizia:
         *
         *     const vendido = Number(order.filled) > 0 ? ... : Number(pos.base_amount);
         *
         * e o comentário chamava isso de "o seguro quando a corretora não diz
         * quanto saiu". Não é seguro: é AFIRMAR execução sem evidência. Uma
         * ordem marcada `closed` com `filled` ausente apagava a posição
         * inteira, e o resto ficava na conta do cliente sem ninguém saber.
         *
         * Agora, sem evidência de fill, NADA é liquidado — a posição segue
         * armada e a passada seguinte pergunta de novo.
         */
        const vendido = Number(order.filled);
        if (!(vendido > 0)) {
          rows.push({ session_id: s.id, wallet_address: s.wallet_address,
            exchange_id: s.exchange_id, symbol: pos.pair, side: "sell",
            order_type: "limit", status: "skipped", order_id: pos.exit_order_id,
            reason: "venue diz fechada e nao informa quanto saiu — posicao MANTIDA ate haver evidencia" });
          continue;
        }
        const sobra = oQueSobrou(Number(pos.base_amount), Number(pos.cost_usd || 0), vendido);
        if (sobra.fecha) {
          await exigirGravacao(
            await closeServerPosition(s.id, pos.base),
            "posicao NAO removida apos sair — o teto de exposicao conta capital que nao esta mais la, e o ramo de venda pode tentar vender de novo",
            { session: s.id, base: pos.base });
        } else {
          await exigirGravacao(
            await reduzirServerPosition(s.id, pos.base, sobra.baseRestante, sobra.custoRestante),
            "saida PARCIAL nao gravada — o banco segue dizendo que a bolsa inteira esta la, e a passada seguinte tenta vender de novo o que ja saiu",
            { session: s.id, base: pos.base, resta: sobra.baseRestante });
        }
        logOperation({ walletAddress: s.wallet_address, kind: "autopilot_cex", chain: s.exchange_id, pair: pos.pair, side: "sell", volumeUsd: sobra.custoRemovido || null, pnlUsd: realized, status: "settled", route: "cron", ref: `${exchange}:${pos.exit_order_id}` });
        rows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: pos.pair, side: "sell", order_type: "limit", status: "settled", order_id: pos.exit_order_id, notional_usd: realized ?? null, reason: realized !== null ? `exit settled, realized $${realized.toFixed(2)}${sobra.fecha ? "" : `, ${sobra.baseRestante} still held`}` : "exit settled" });
      } else if (st === "canceled" || st === "cancelled" || st === "expired") {
        /**
         * ⚠️⚠️ ACHADO A101 — CANCELAMENTO DEPOIS DE PREENCHIMENTO PARCIAL.
         *
         * Isto reabria a posição INTEIRA, sempre. Uma saída limitada que
         * vendeu 4 de 10 e depois foi cancelada voltava ao livro como se os 10
         * ainda estivessem lá: o bot passava a acreditar que tem uma bolsa que
         * já não tem, o teto de exposição contava capital inexistente, e a
         * passada seguinte tentava vender de novo o que já saiu.
         *
         * O que já executou é FATO IMUTÁVEL. Só o remanescente volta.
         */
        const jaVendido = Number(order.filled);
        if (jaVendido > 0) {
          const { realized, aviso } = realizedFromSell(order, pos);
          if (aviso) await avisarTaxaNaoPrecificada(pos.pair, aviso);
          if (realized !== null) {
            realizedDelta += realized;
            await exigirGravacao(
              await applySessionPnl(s.id, realized, today),
              "P&L da saida parcial cancelada NAO contabilizado — o stop de perda nao viu esta perda",
              { session: s.id, base: pos.base, realized });
          }
          const sobra = oQueSobrou(Number(pos.base_amount), Number(pos.cost_usd || 0), jaVendido);
          if (sobra.fecha) {
            await exigirGravacao(
              await closeServerPosition(s.id, pos.base),
              "posicao NAO removida apos saida parcial cancelada que zerou a bolsa",
              { session: s.id, base: pos.base });
          } else {
            await exigirGravacao(
              await reduzirServerPosition(s.id, pos.base, sobra.baseRestante, sobra.custoRestante),
              "remanescente NAO gravado — o livro segue dizendo que a bolsa inteira esta la",
              { session: s.id, base: pos.base, resta: sobra.baseRestante });
            await exigirGravacao(
              await reopenServerPosition(s.id, pos.base),
              "remanescente nao reaberto — fica exit_armed apontando para ordem morta",
              { session: s.id, base: pos.base });
          }
          rows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: pos.pair, side: "sell", status: "settled", order_id: pos.exit_order_id, notional_usd: realized ?? null, reason: `cancelada com ${jaVendido} ja vendido — so o remanescente reabre` });
        } else {
          await exigirGravacao(
            await reopenServerPosition(s.id, pos.base),
            "posicao NAO reaberta — fica exit_armed apontando para ordem morta, e o bot nunca mais sai deste trade",
            { session: s.id, base: pos.base });
          rows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: pos.pair, side: "sell", status: "skipped", order_id: pos.exit_order_id, reason: "armed exit canceled/expired sem preenchimento — reaberta inteira" });
        }
      }
      // still open → leave it armed for the next run
    } catch { /* transient — retry next run */ }
  }
  return { rows, realizedDelta, livroLegivel: true };
}

/** Compact "held=… entry=… now=… unrealized=…" context so ZION proposes exits. */
function buildPositionsContext(positions: AutopilotPositionRow[], refPrices: Map<string, CexSpotPrice>): string {
  const open = positions.filter((p) => p.status !== "closed");
  if (open.length === 0) return "";
  return open.map((p) => {
    const now = refPrices.get(p.base.toUpperCase())?.priceUsd ?? null;
    const entry = Number(p.entry_price);
    const unreal = now && entry > 0 ? ((now - entry) / entry) * 100 : null;
    const armed = p.status === "exit_armed" ? "yes" : "no";
    return `  - ${p.pair} | held=${Number(p.base_amount)} | entry=$${entry} | now=${now != null ? `$${now}` : "n/a"}`
      + `${unreal != null ? ` | unrealized=${unreal >= 0 ? "+" : ""}${unreal.toFixed(2)}%` : ""}`
      + ` | exit_armed=${armed}${p.entry_label ? ` | reason='${String(p.entry_label).slice(0, 60)}'` : ""}`;
  }).join("\n");
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/**
 * ⚠️ TODA ESCRITA DE ESTADO DE POSIÇÃO PASSA POR AQUI (25/08).
 *
 * As quatro (`markServerExitArmed`, `reopenServerPosition`,
 * `closeServerPosition`, `applySessionPnl`) devolviam `void` e ninguém
 * conferia. Cada falha tem consequência PRÓPRIA e nenhuma delas aparece na
 * tela — por isso o alerta carrega a consequência, não só o nome da função.
 *
 * É a mesma classe do `engine.ts:492`: o cliente do Supabase RESOLVE com
 * `{ error }` em vez de lançar.
 */
async function exigirGravacao(
  r: { ok: true } | { ok: false; erro: string },
  consequencia: string,
  meta: Record<string, unknown>,
): Promise<boolean> {
  if (r.ok) return true;
  await recordEvent("autopilot_registro_perdido", { meta: { why: consequencia, erro: r.erro, ...meta } });
  notifyTelegram(`🔴 <b>Autopilot — registro perdido</b>\n${consequencia}\n${JSON.stringify(meta).slice(0, 300)}`);
  return false;
}

/**
 * ⚠️ AS OITO CHAMADAS DE TELEMETRIA — e o nome existe para dizer isso.
 *
 * `last_scan_at` e `last_error` não decidem nada: uma recusa aqui envelhece a
 * tela e o painel do admin, e só. Interromper a passada por causa delas seria
 * trocar um defeito barato por um caro.
 *
 * ⚠⚠ MAS NÃO PODE SER MUDA. `last_scan_at` parado é exatamente o sintoma que
 * o watchdog lê como "cron morto" — e ele não pode acusar isso sem a causa
 * gravada ao lado, ou a investigação começa no lugar errado. O `dedupKey` do
 * `recordEvent` segura o volume numa queda de banco prolongada.
 */
async function telemetria(
  id: string,
  patch: Parameters<typeof patchSession>[1],
): Promise<void> {
  const r = await patchSession(id, patch);
  if (r.ok) return;
  await recordEvent("autopilot_telemetria_nao_gravou", { meta: { severity: "low",
    session: id, erro: r.erro,
    why: "last_scan_at/last_error ficaram para tras. O watchdog pode ler isto como "
      + "'cron parado' \u2014 a passada em si seguiu normal.",
  } });
}

/**
 * Carimba o plano revalidado na sessão (achado A111).
 *
 * ⚠️ NÃO É TELEMETRIA, e por isso não usa `telemetria()`. É um fato de
 * AUTORIZAÇÃO: se ele não gravar, a sessão revalida de novo na passada seguinte
 * (custo) e, persistindo, o prazo duro fecha as ENTRADAS sozinho. A direção da
 * falha é fechada — mas ela não pode ser muda, senão "o provedor está fora" e
 * "o banco está recusando a escrita" ficam idênticos.
 */
async function carimbarPlano(id: string, tier: string | null, quandoIso: string): Promise<void> {
  const r = await patchSession(id, { tier_snapshot: tier, tier_checked_at: quandoIso });
  if (r.ok) return;
  await recordEvent("autopilot_carimbo_de_plano_nao_gravou", { meta: { severity: "med",
    session: id, tier, erro: r.erro,
    why: "o plano foi revalidado e o carimbo nao gravou. A sessao revalida de novo "
      + "na proxima passada; persistindo, o prazo duro fecha as ENTRADAS.",
  } });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  await setCronHeartbeat("autopilot");

  let todas: AutopilotSessionRow[];
  try {
    todas = await listRunnableSessions();
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "session_query_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  /**
   * ⚠️ TRAVA DE LIBERAÇÃO (Fase 7.2) — este worker era o ÚNICO caminho de
   * dinheiro sem kill-switch. Dezessete mesas internas, que gastam só o nosso
   * token, tinham gate cada uma; a automação que compra na corretora do
   * cliente não tinha nenhum.
   *
   * ⚠️ FILTRA, não retorna cedo. Fechada ao público, a automação ainda roda
   * para as carteiras PILOTO (o dono, e as autorizadas no painel) — é assim que
   * se testa com dinheiro real antes de abrir. Um `return` aqui mataria o teste
   * junto com o público.
   *
   * ⚠️ E UMA IDA AO BANCO SÓ, para as N sessões: `decidirAutomacao` é decisão
   * pura, então o estado é lido uma vez e julgado por carteira. Chamar
   * `podeAutomatizar` dentro do laço faria a trava custar uma consulta por
   * cliente, a cada cinco minutos.
   */
  const [liberacao, pilotos] = await Promise.all([lerLiberacao(), lerPilotos()]);
  const sessions: AutopilotSessionRow[] = [];
  const barradas: Array<{ s: AutopilotSessionRow; causa: string }> = [];
  for (const s of todas) {
    const v = decidirAutomacao(s.wallet_address, liberacao, pilotos);
    if (v.permitido) sessions.push(s);
    else barradas.push({ s, causa: v.causa });
  }

  /**
   * ⚠️ FECHADO NÃO PODE SER SILENCIOSO (invariante nº 7). Sem esta linha o
   * cliente veria "ativo" na tela e nada acontecendo, sem explicação nenhuma.
   * O heartbeat já foi batido lá em cima — de propósito, senão o watchdog
   * acusaria "cron parado" e a causa real ficaria atrás de um alarme errado.
   */
  await recordRuns(barradas.map(({ s, causa }) => ({
    session_id:     s.id,
    wallet_address: s.wallet_address,
    exchange_id:    s.exchange_id,
    status:         "skipped",
    reason:         `automação de CEX fechada (${causa})`,
  })));

  const summary: Array<{ exchange: string; wallet: string; fired: number; skipped: string }> = [];
  /**
   * ⚠️ O CONTADOR DA ORIGEM DA CREDENCIAL (era o medidor da virada T2→T3).
   *
   * T3 concluído (A115): a segunda cópia do segredo saiu da tabela (migration
   * 0056) e não existe mais caminho `sessao` — `credenciaisDaSessao` só
   * devolve `cofre` ou LANÇA. O contador fica porque `erro` continua sendo um
   * estado próprio: sem ele, uma sessão que falhou ao decifrar sumiria da
   * conta, e "tudo pelo cofre" ficaria indistinguível de "as leituras nem
   * aconteceram" — a invariante nº 33 que ele sempre existiu para proteger.
   */
  const origens = { cofre: 0, sessao: 0, erro: 0 };

  for (const s of sessions) {
    // A2: acquire the per-session lock so a still-running prior cron pass can't
    // double-process this session. TTL (3min) auto-releases a crashed/timed-out
    // run well before the next scheduled tick (every ~5min).
    const locked = await tryLockSession(s.id, 3 * 60_000);
    if (!locked) {
      summary.push({ exchange: s.exchange_id, wallet: `${s.wallet_address.slice(0, 6)}…`, fired: 0, skipped: "locked (already running)" });
      continue;
    }
    try {
      const result = await processSession(s);
      if (result.origem) origens[result.origem] += 1; else origens.erro += 1;
      summary.push({
        exchange: s.exchange_id,
        wallet: `${s.wallet_address.slice(0, 6)}…`,
        fired: result.fired,
        skipped: result.note,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      origens.erro += 1;
      // Telemetria: recusa aqui só envelhece a tela, então não interrompe nada.
      // Mas fica REGISTRADA — `last_scan_at` parado é o sintoma que o watchdog
      // usa para dizer "cron morto", e ele não pode acusar sem a causa ao lado.
      await telemetria(s.id, { last_error: msg.slice(0, 300), last_scan_at: new Date().toISOString() });
      summary.push({ exchange: s.exchange_id, wallet: `${s.wallet_address.slice(0, 6)}…`, fired: 0, skipped: `error: ${msg.slice(0, 80)}` });
    } finally {
      await releaseLock(s.id);
    }
  }

  /**
   * ⚠️ SÓ GRAVA QUANDO HOUVE SESSÃO. Um evento por passada com tudo em zero
   * inundaria o `platform_events` a cada 5 minutos e afogaria o sinal que ele
   * existe para dar.
   */
  if (sessions.length > 0) {
    await recordEvent("cofre_origem_credencial", { meta: {
      ...origens,
      why: "T3 concluído (A115): a segunda cópia do segredo foi removida; `sessao` é estruturalmente impossível e deve ser sempre 0",
    } });
  }

  /**
   * ⚠️⚠️⚠️ O RECUPERADOR — INVARIANTE 7, achado A105, Cenário C do briefing.
   *
   * Todo intent não-terminal é perguntado à corretora: `SUBMITTING` de um
   * processo que morreu em voo, `UNKNOWN` de um timeout, `PARTIALLY_FILLED`
   * que ainda pode crescer. Sem isto, o modelo durável das fases 1 a 4 seria a
   * peça certa DESLIGADA — a família de defeito que esta auditoria mais
   * encontrou, cometida por mim dentro do conserto dela.
   *
   * ⚠️ PENDURADO NESTE CRON, não em rota nova. Criar rota nova exige um passo
   * FORA do repositório — alguém abrir o cron-job.org e agendar — e o achado
   * A03 desta casa é exatamente uma rota que ficou escrita, testada e nunca
   * agendada. Este cron já roda de 5 em 5 minutos.
   *
   * ⚠️ MELHOR-ESFORÇO: a reconciliação NÃO envia ordem nenhuma. Ela lê e
   * registra. Uma falha aqui não pode derrubar a passada que opera.
   *
   * ⚠️ E LEITURA FALHADA É BARULHENTA: "nenhum pendente" e "não consegui
   * olhar" não podem ler igual — a regra nº 33 desta casa.
   */
  let reconciliados = 0;
  try {
    const dbRec = getSupabaseAdmin();
    if (dbRec) {
      const r = await reconciliarPendentes({
        db: dbRec,
        /**
         * ⚠️⚠️ A127: recovery automático só existe quando o PRÓPRIO intent
         * snapshotou `conexao_id`. `session_id` é mutável (rearm C1→C2) e não
         * é identidade histórica. Legacy session-only fica inelegível e não
         * acumula tentativa/quarentena automática.
         */
        elegivel: (intent) => Boolean(intent.conexao_id),
        credenciais: async (intent) =>
          credenciaisDoIntentParaRecovery(dbRec, intent),
      });
      reconciliados = r.olhados;
      if (r.leituraFalhou) {
        await recordEvent("reconciliacao_leitura_falhou", { meta: { severity: "high",
          why: "nao deu para listar intents pendentes. 'nenhum pendente' e 'nao consegui "
            + "olhar' sao coisas diferentes, e ordens em duvida ficam sem reconciliar.",
        } });
      }
      const emQuarentena = r.resultados.filter((x) => x.desfecho === "quarentena");
      if (emQuarentena.length > 0) {
        await recordEvent("intents_em_quarentena", { meta: { severity: "high",
          quantos: emQuarentena.length,
          ids: emQuarentena.map((x) => x.intentId).slice(0, 10),
          why: "intents que a reconciliacao nao resolveu sozinha, ou conta com atividade "
            + "externa nao atribuivel (ACCOUNT_DRIFT). Pedem mao humana.",
        } });
      }
    }
  } catch (e) {
    await recordEvent("reconciliacao_falhou", { meta: { severity: "med",
      erro: (e as Error)?.message?.slice(0, 200) ?? "erro",
    } });
  }

  // Platform-wide watchdog — error/security spikes, stale crons, AI budget,
  // large ops, dependency health, daily digest. Runs every tick (~5 min).
  await runAlertWatchdog();

  return NextResponse.json({ ok: true, processed: sessions.length,
    blocked: barradas.length, reconciliados, summary });
}

interface ProcessResult { fired: number; note: string; origem?: OrigemCredencial }

async function processSession(s: AutopilotSessionRow): Promise<ProcessResult> {
  const nowIso = new Date().toISOString();
  const today = utcDayKey();
  const wasFrozen = s.frozen_until_day === today;
  /**
   * ⚠️⚠️ A ORDEM JA EXISTE NA CORRETORA — o registro e que falhou.
   * (auditoria do autopilot, 23/08)
   *
   * Nao da para desfazer. Entao o objetivo nao e impedir, e NAO PERDER O
   * FATO: alerta alto, com par e id da ordem, para alguem reconciliar a mao.
   *
   * ⚠️ A linha do run continua dizendo FIRED, porque ela DISPAROU. Marcar
   * como erro seria trocar uma mentira por outra: o operador leria
   * "errored" e concluiria que nada saiu da conta dele.
   */
  const avisarRegistroPerdido = (assunto: string, detalhe: Record<string, unknown>) => {
    notifyTelegram(
      `🔴 <b>AUTOPILOT: ordem executada e NAO registrada</b>\n` +
      `${assunto}\n${JSON.stringify(detalhe).slice(0, 300)}`,
      { dedupKey: `autopilot:registro:${s.id}`, meta: { kind: "autopilot_registro_perdido", sessionId: s.id, ...detalhe } },
    );
  };

  const alertIfNewlyFrozen = () => {
    if (!wasFrozen) {
      notifyTelegram(`📉 <b>Autopilot frozen</b> — daily loss-stop hit.\nwallet ${s.wallet_address.slice(0, 8)}… · ${s.exchange_id}`, { dedupKey: `freeze:${s.id}` });
    }
  };

  // ── 1. Daily rollover ──
  let tradesToday = s.trades_today;
  let frozenUntil = s.frozen_until_day;
  let pnlToday    = s.pnl_today;
  if (s.last_reset_day !== today) {
    tradesToday = 0;
    pnlToday    = 0;
    frozenUntil = frozenUntil === today ? frozenUntil : null;
    /**
     * ⚠⚠ A ÚNICA DAS NOVE `patchSession` QUE DECIDE DINHEIRO — e a que ficou
     * para este PR quando o A11 entrou.
     *
     * O contador foi zerado ACIMA, na memória, e `remainingTrades` sai de
     * `max_trades_per_day - tradesToday` (linha ~496) — do valor LOCAL. Se esta
     * gravação for recusada, `last_reset_day` continua em ontem: a passada
     * seguinte vê "é outro dia" de novo, zera de novo na memória, e o limite
     * diário que o usuário configurou vira limite POR PASSADA — a cada 5
     * minutos, até 288 cotas diárias num dia.
     *
     * O mesmo vale para `pnl_today`: o stop de perda local passa a enxergar só
     * o prejuízo DESTA passada.
     *
     * FALHA FECHADO: sem virada gravada, esta sessão não negocia. É a mesma
     * decisão do `contadorConfiavel` mais abaixo — perder a conta do dia
     * interrompe a passada — só que aqui na origem do contador.
     */
    const virou = await patchSession(s.id, { trades_today: 0, pnl_today: 0, last_reset_day: today, frozen_until_day: frozenUntil });
    if (!virou.ok) {
      await recordEvent("autopilot_virada_do_dia_nao_gravou", { wallet: s.wallet_address, meta: { severity: "high",
        session: s.id, dia: today, erro: virou.erro,
        why: "o contador diario foi zerado na memoria e NAO no banco. Sem falhar fechado, "
          + "toda passada zeraria de novo e o limite diario viraria limite por passada.",
      } });
      return { origem: undefined, fired: 0, note: "daily rollover not persisted — session skipped" };
    }
  }

  /**
   * ── 2. A credencial — COFRE SÓ (T3 do cofre, A115) ──
   *
   * `creds_cipher` não existe mais: ou a sessão tem elo com `cex_conexoes` e
   * o cofre responde, ou `credenciaisDaSessao` LANÇA e a passada desta
   * sessão falha fechado. Não há fallback para uma segunda cópia — é isso
   * que faz revogar no cofre revogar de verdade.
   */
  const { creds, origem } = await credenciaisDaSessao(s);
  const exchange = s.exchange_id as CexId;

  // ── 3. Settle exits armed on a prior run (A5). A filled exit realizes P&L
  //      (fed atomically to the loss-stop) and can trip the freeze. ──
  const runRows: RunRowT[] = [];
  let livroLegivelNoSettle = true;
  try {
    const settle = await settleArmedExits(s, creds, exchange, today);
    runRows.push(...settle.rows);
    pnlToday += settle.realizedDelta;
    livroLegivelNoSettle = settle.livroLegivel;
    if (pnlToday <= -s.daily_loss_stop_usd) frozenUntil = today;
  } catch {
    /**
     * ⚠️ A133: exceção aqui também é livro em dúvida. O `catch` existia para
     * não derrubar a passada — mas "não derrubar" não pode virar "seguir
     * comprando". A leitura do §7 abaixo confirma ou nega, e esta linha
     * garante que uma exceção não passe por leitura bem-sucedida.
     */
    livroLegivelNoSettle = false;
  }

  // ── 4. Freeze / cap gates (AFTER settling — a settle can trip the freeze) ──
  /**
   * ⚠️⚠️ A MESMA DECISÃO QUE O NAVEGADOR USA — achado A130, §34/§35.
   *
   * Estes dois `if` eram a política de autorização do CRON, escrita aqui; o
   * canal do navegador não tinha nenhuma. Duas superfícies do MESMO produto
   * com semânticas diferentes é a família do A113, e o conserto não podia ser
   * escrever uma segunda cópia da regra na rota.
   *
   * ⚠️ O ESTADO É NORMALIZADO AQUI, não lido da linha: `frozenUntil` e
   * `tradesToday` já passaram pela virada do dia desta passada. É por isso que
   * o helper recebe valores em vez de ler sozinho — senão "os dois chamam a
   * mesma função" viraria "os dois chamam com estados diferentes".
   *
   * ⚠️ `is_active`/`expires_at` já foram garantidos por `listRunnableSessions`;
   * conferi-los de novo aqui é defesa em profundidade, não mudança.
   */
  const sessaoAutoriza = avaliarAutorizacaoDaSessaoParaExecucao({
    ativa: s.is_active,
    expiraEm: s.expires_at,
    congeladaAte: frozenUntil,
    tradesHoje: tradesToday,
    maxTradesPorDia: s.max_trades_per_day,
    maxTradeUsd: s.max_trade_usd,
    conexaoId: s.conexao_id,
    // ⚠️ Lido aqui, decidido em `entradaAutorizadaNaSessao` — e SÓ sobre
    // entradas. Ver o gate de compra na seção 5b.
    emQuarentena: Boolean(s.quarentena_em),
  });
  if (!sessaoAutoriza.ok) {
    if (sessaoAutoriza.motivo === "sessao_congelada") alertIfNewlyFrozen();
    if (runRows.length) await recordRuns(runRows);
    await telemetria(s.id, { last_scan_at: nowIso, last_error: null });
    /**
     * ⚠️ As duas notas históricas são preservadas ao pé da letra — elas são
     * lidas por painel e por teste, e trocá-las seria mudar o observável por
     * causa de uma refatoração.
     */
    const nota = sessaoAutoriza.motivo === "sessao_congelada" ? "frozen (daily loss-stop)"
               : sessaoAutoriza.motivo === "limite_diario"    ? "daily trade cap reached"
               : `sessao nao autorizada: ${sessaoAutoriza.motivo}`;
    return { origem, fired: 0, note: nota };
  }

  // ── 5. Read live balance ──
  let totalUsd = 0;
  let balanceContext = "";
  try {
    const { balances, totalUsd: tu } = await fetchCexBalance(exchange, creds, true);
    totalUsd = tu;
    const nonZero = balances
      .filter((b) => b.total > 0)
      .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
      .slice(0, 10);
    const parts = nonZero
      .map((b) => `${b.asset}: ${b.total}${b.usdValue ? ` (~$${b.usdValue.toFixed(2)})` : ""}`)
      .join(", ");
    balanceContext = `total: $${totalUsd.toFixed(2)} | ${parts}`;
  } catch (e) {
    if (runRows.length) await recordRuns(runRows);
    await telemetria(s.id, { last_scan_at: nowIso, last_error: `balance read failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) });
    return { origem, fired: 0, note: "balance read failed" };
  }

  /**
   * ── 5b. A CONTA AINDA FECHA? — achado A103, INDEPENDENTE de intents. ──
   *
   * ⚠️⚠️ A reconciliação por intent (`reconciliarPendentes`, fim da passada) só
   * roda quando há ordem em dúvida. Um saque do cliente ou uma venda manual no
   * app da corretora não geram intent — e deixariam o bot decidindo sobre um
   * inventário que já não existe. Aqui a conta é conferida TODA passada: o
   * saldo TOTAL real (free + used) tem de sustentar o inventário de
   * `autopilot_positions`. Exit armado pela própria Z-SWAP explica `used`;
   * total íntegro com trava não explicada é `bloqueio_nao_explicado`, não
   * deriva.
   *
   * CONDUTA FAIL-CLOSED, e só sobre ENTRADAS:
   *   · deriva confirmada → a sessão entra em QUARENTENA (ela grava
   *     `quarentena_em`/`quarentena_motivo`) — zero BUY autônomo até mão humana;
   *   · bloqueio não explicado → entradas bloqueadas e evento
   *     `account_external_activity`, SEM quarentena: o inventário existe, o
   *     que não tem dono é a trava sobre ele;
   *   · leitura falhou → não se conclui "sem drift": entradas bloqueadas até
   *     haver leitura confiável;
   *   · SAÍDAS/redução NUNCA são presas — quarentena não pode trancar o cliente
   *     numa posição. O gate mora no ramo de COMPRA, depois do de venda.
   */
  let entradasLiberadas = true;
  /**
   * ⚠️ A MESMA FUNÇÃO QUE O NAVEGADOR USA — achado da revisão adversarial.
   *
   * Era `if (s.quarentena_em)` escrito aqui, e só aqui: a `/api/cex/order`
   * seguia comprando com a sessão em quarentena. O veredito virou
   * `entradaAutorizadaNaSessao`, chamado pelos dois canais; o CONSERTO da
   * deriva (a reconciliação abaixo) continua sendo só do cron, que é quem tem
   * a passada de 5 minutos para isso.
   */
  if (!entradaAutorizadaNaSessao({ emQuarentena: Boolean(s.quarentena_em) }).ok) {
    entradasLiberadas = false;
    // Dedup pelo Telegram: o evento já saiu no dia da deriva; repetir a cada 5
    // minutos afogaria o sinal. A quarentena continua valendo em silêncio.
  } else {
    const dbConta = getSupabaseAdmin();
    if (dbConta) {
      try {
        const rc = await reconciliarConta({ db: dbConta }, s, creds);
        if (rc.resultado === "deriva") {
          entradasLiberadas = false;
          await recordEvent("account_drift", { wallet: s.wallet_address, meta: {
            severity: "high", session: s.id, achados: rc.achados,
            quarentenaGravada: rc.quarentenaGravada,
            why: "o saldo livre real nao sustenta o inventario interno do bot. "
              + "Sessao em QUARENTENA: zero BUY autonomo, saidas permitidas, ate mao humana.",
          } });
          notifyTelegram(
            `🔴 <b>ACCOUNT_DRIFT</b> — sessão em quarentena\n${rc.achados.join("\n").slice(0, 300)}`,
            { dedupKey: `account_drift:${s.id}` });
        } else if (rc.resultado === "bloqueio_nao_explicado") {
          /**
           * ⚠️ O INVENTÁRIO EXISTE — a trava sobre ele é que não tem dono.
           * Fail-closed nas ENTRADAS, como toda incerteza sobre a conta; mas
           * SEM quarentena (nada a apagar) e SEM dizer "saldo não sustenta o
           * inventário" — ele sustenta. Evento e dedup PRÓPRIOS: afogar isto
           * no canal do drift diluiria os dois sinais.
           */
          entradasLiberadas = false;
          await recordEvent("account_external_activity", { wallet: s.wallet_address, meta: {
            severity: "med", session: s.id, achados: rc.achados,
            why: "o saldo total sustenta o inventario, mas ha saldo travado/"
              + "atividade externa que a Z-SWAP nao explica. Novas entradas "
              + "bloqueadas (fail-closed), sem quarentena — saidas livres.",
          } });
          notifyTelegram(
            `🟠 <b>ACCOUNT_EXTERNAL_ACTIVITY</b> — entradas bloqueadas\n${rc.achados.join("\n").slice(0, 300)}`,
            { dedupKey: `account_external_activity:${s.id}` });
        } else if (rc.resultado === "leitura_falhou") {
          // ⚠️ NÃO é "sem drift". Entradas presas até ler de novo; saídas livres.
          entradasLiberadas = false;
          await recordEvent("reconciliacao_conta_falhou", { wallet: s.wallet_address, meta: {
            severity: "med", session: s.id, etapa: rc.etapa, porque: rc.porque,
            why: "nao deu para conferir a conta — novas entradas bloqueadas ate leitura confiavel (fail-closed).",
          } });
        }
      } catch (e) {
        entradasLiberadas = false;
        await recordEvent("reconciliacao_conta_falhou", { wallet: s.wallet_address, meta: {
          severity: "med", session: s.id,
          porque: (e as Error)?.message?.slice(0, 200) ?? "erro",
          why: "a reconciliacao de conta estourou — fail-closed: zero BUY nesta passada.",
        } });
      }
    }
  }

  // ── 6. Bounded per-trade cap (can only shrink vs the armed cap) ──
  const pct = RISK_PCT[s.risk_mode] ?? 0.20;
  const dynamicMax = Math.max(2, Math.round(totalUsd * pct));
  const effectiveMaxTradeUsd = Math.min(dynamicMax, s.max_trade_usd);

  // ── 7. Open positions + reference prices (guard + position context + cap) ──
  const refPrices     = await getCexSpotPrices(s.allowed_symbols);
  /**
   * ⚠️⚠️⚠️ O INVENTÁRIO É PRÉ-REQUISITO DA PASSADA — A133.
   *
   * Aqui nasciam `exposureUsd` e `ownedBases`. Com a leitura devolvendo `[]`
   * em erro de banco, os dois viravam "o bot não tem nada": o teto de
   * exposição liberava o valor inteiro de novo e o ramo de venda deixava de
   * achar as posições que existem. Falha de leitura virava licença para
   * comprar — e para esquecer o que já está comprado.
   *
   * Agora a passada PARA. Nada de scan, nada de ordem nova. A reconciliação de
   * intents pendentes (recovery do que já saiu) roda fora desta função e
   * continua acontecendo.
   */
  const leituraDoLivro = await getOpenServerPositions(s.id);
  if (!leituraDoLivro.ok || !livroLegivelNoSettle) {
    const porque = leituraDoLivro.ok ? "settle nao conseguiu ler o livro" : leituraDoLivro.porque;
    await recordEvent("autopilot_livro_ilegivel", { wallet: s.wallet_address, meta: {
      severity: "high", session: s.id, etapa: "inventario", porque,
      why: "sem inventario nao se afirma exposicao nem posse. ZERO entrada nova nesta "
        + "passada — 'nao consegui ler' nunca pode valer como 'o bot nao tem nada'.",
    } });
    await telemetria(s.id, { last_scan_at: nowIso, last_error: `position book unreadable: ${porque}`.slice(0, 300) });
    if (runRows.length) await recordRuns(runRows);
    return { origem, fired: 0, note: "position book unreadable — zero new entries" };
  }
  const openPositions = leituraDoLivro.posicoes;
  // D3 Executor: ADX trend regime per symbol — feeds the scan's context AND
  // the hard entry gate below. Fail-closed: if the fetch fails, the map stays
  // empty and every BUY is rejected (exits are never gated).
  /**
   * ⚠️⚠️ O CERTIFICADO DA ESTRATÉGIA DESTA SESSÃO — achado A110.
   *
   * Autorizar a carteira não é autorizar a estratégia. Sem certificado vivo, o
   * motor de política recusa TODA entrada autônoma — e o banco recusa o intent
   * antes disso (`cex_intent_autonomo_tem_certificado`). É o fail-closed que o
   * veredito da auditoria pede para o autopilot de fundo.
   *
   * ⚠️ Leitura que FALHA conta como ausência, e ausência é recusa. Esta é a
   * direção certa para esta pergunta: um banco intermitente não pode virar
   * licença para operar sem envelope.
   */
  /**
   * ⚠️⚠️ O PLANO DA SESSÃO, REVALIDADO COM PRAZO — achado A111.
   *
   * O tier era conferido UMA VEZ, ao armar, e a sessão dura horas. Assinatura
   * cancelada no meio não chegava a lugar nenhum.
   *
   * ⚠️ E A REVALIDAÇÃO NÃO PODE DERRUBAR TUDO. Se o provedor de assinatura não
   * responder, o carimbo antigo vale até o prazo duro — senão uma instabilidade
   * comercial vira indisponibilidade de segurança, que o briefing proíbe.
   */
  const agoraMsTier = Date.now();
  const carimbadoEmMs = s.tier_checked_at ? new Date(s.tier_checked_at).getTime() : null;
  let revalidacao: { satisfaz: boolean; tier: string } | null | undefined;
  if (precisaRevalidar({ carimbadoEmMs, agoraMs: agoraMsTier })) {
    try {
      const { tier } = await getTierForWallet(s.wallet_address, "evm");
      revalidacao = { satisfaz: tierSatisfies(tier, FEATURE_TIER.cexAutopilot), tier };
    } catch {
      // ⚠️ `null` = tentei e não respondeu. Diferente de `undefined` (nem tentei).
      revalidacao = null;
    }
  }
  const autorizacao = decidirPelaAutorizacao({
    carimbo: s.tier_snapshot, carimbadoEmMs, agoraMs: agoraMsTier, revalidacao,
  });
  if (autorizacao.abreEntrada && autorizacao.precisaCarimbar) {
    await carimbarPlano(s.id, autorizacao.tier, new Date(agoraMsTier).toISOString());
  }

  const dbCert = getSupabaseAdmin();
  const certificadoDaSessao = dbCert && s.strategy_id && s.strategy_version
    ? (await certificadoVivo(dbCert, s.strategy_id, s.strategy_version)) ?? null
    : null;

  const marketInd = await getMarketIndicators(s.allowed_symbols).catch(() => null);
  const regimeBy = new Map<string, string>();
  for (const ind of marketInd?.indicators ?? []) if (ind.regime) regimeBy.set(ind.symbol.toUpperCase(), ind.regime);
  let   exposureUsd   = openPositions.reduce((sum, p) => sum + Number(p.cost_usd || 0), 0);
  const maxExposureUsd = RISK_EXPOSURE_USD[s.risk_mode] ?? 200;
  const ownedBases    = new Set(openPositions.map((p) => p.base.toUpperCase()));

  // ── 8. Scan (with open positions so ZION proposes exits) ──
  const scan = await runAutopilotCexScan({
    exchangeId:     s.exchange_id,
    riskMode:       s.risk_mode,
    marketType:     s.market_type,
    maxTradeUsd:    effectiveMaxTradeUsd,
    allowedSymbols: s.allowed_symbols,
    balanceContext,
    openPositionsContext: buildPositionsContext(openPositions, refPrices),
    remainingTradesToday: Math.max(0, s.max_trades_per_day - tradesToday),
    regimeContext:  marketInd ? formatRegimeContext(marketInd.indicators) : "",
    lang:           s.lang,
  });

  if (scan.error) {
    if (runRows.length) await recordRuns(runRows);
    await telemetria(s.id, { last_scan_at: nowIso, last_error: `scan: ${scan.error}`.slice(0, 300) });
    await recordRuns([{ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, status: "scan_error", reason: scan.error.slice(0, 200) }]);
    return { origem, fired: 0, note: "scan error" };
  }
  if (scan.cards.length === 0) {
    if (runRows.length) await recordRuns(runRows);
    await telemetria(s.id, { last_scan_at: nowIso, last_error: null });
    await recordRuns([{ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, status: "scan_empty", reason: "no actionable setup" }]);
    return { origem, fired: 0, note: "no setup" };
  }

  // ── 9. Background firing is SPOT-ONLY (no unattended leverage) ──
  if (s.market_type !== "spot") {
    if (runRows.length) await recordRuns(runRows);
    await telemetria(s.id, { last_scan_at: nowIso, last_error: null });
    await recordRuns([{
      session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id,
      status: "skipped", card_kind: s.market_type,
      reason: "background mode fires spot only; futures/margin need you present",
    }]);
    return { fired: 0, note: `${s.market_type} scan-only (spot-only firing in background)` };
  }

  // ── 10. Fire eligible intents ──
  let fired = 0;
  let remainingTrades = s.max_trades_per_day - tradesToday;

  /**
   * ⚠️ AS DUAS BANDEIRAS DA AUDITORIA DE 23/08.
   *
   * `contadorConfiavel` cai quando o incremento do contador diario falha: a
   * partir daí o limite que o usuario configurou nao e mais confiavel, e
   * seguir disparando seria operar SEM limite. Falha fechada.
   *
   * `posicaoPerdida` cai quando a ordem executou e a posicao nao foi gravada.
   * Nao muda o que ja aconteceu — entra no resumo para o operador enxergar
   * sem ter de caçar no Telegram.
   */
  let contadorConfiavel = true;
  let posicaoPerdida    = false;

  /**
   * ⚠️⚠️⚠️ A VAGA DO DIA É RESERVADA ANTES DA ORDEM — A132.
   *
   * O cron contava DEPOIS, com `bumpSessionTrades` (`trades_today + n`, sem
   * conferir teto), enquanto o navegador já reservava ANTES por
   * compare-and-swap. Com 4/5, os dois canais passavam e o dia fechava em 6.
   *
   * Agora os dois chamam `reservaDaVagaDiaria`, e a reserva entra na costura
   * `ReservaDeRisco` do executor: ela roda entre AUTHORIZED e SUBMITTING, e
   * `liberar` só é chamada onde há PROVA de que nada saiu — nunca em UNKNOWN.
   *
   * ⚠️ UMA POR ORDEM. Cada perna de um cartão multi-perna cria a sua; reservar
   * as três de antemão contaria vagas por pernas que podem nunca sair.
   */
  const novaVaga = (): VagaDiaria => reservaDaVagaDiaria(s.id, today);
  /**
   * Traduz a recusa da reserva para a bandeira que para a passada.
   *
   * ⚠️ `limite_diario` é parada LEGÍTIMA (o teto do usuário foi atingido);
   * `erro`/`virou_o_dia`/`sessao_inativa` significam que não dá para confiar
   * no contador — e seguir disparando seria operar sem limite.
   */
  const anotarRecusaDaVaga = (vaga: VagaDiaria) => {
    const motivo = vaga.ultimoMotivo();
    if (!motivo) return;
    if (motivo === "limite_diario") { remainingTrades = 0; return; }
    contadorConfiavel = false;
  };

  const pushRow = (intent: { symbol: string; side: string; type: string; amount: number; price?: number; notionalUsd: number }, status: string, cardKind: string, extra: Partial<AutopilotRunRow> = {}) =>
    runRows.push({ session_id: s.id, wallet_address: s.wallet_address, exchange_id: s.exchange_id, symbol: intent.symbol, side: intent.side, order_type: intent.type, amount: intent.amount, price: intent.price ?? null, notional_usd: intent.notionalUsd, status, card_kind: cardKind, ...extra });

  outer:
  for (const card of scan.cards) {
    if (fired >= MAX_ORDERS_PER_RUN || remainingTrades <= 0 || !contadorConfiavel) break;
    if (frozenUntil === today) break;             // a sell may have tripped the freeze mid-run
    const intents = mapCardToCexIntents(card);
    if (!intents) continue;

    for (const intent of intents) {
      if (fired >= MAX_ORDERS_PER_RUN || remainingTrades <= 0 || !contadorConfiavel) break outer;
      if (frozenUntil === today) break outer;

      // A3 (money-path audit): multi-venue cards (cross-CEX arb) pin each leg
      // to a specific exchange. A background session runs ONE venue — firing a
      // pinned leg here would execute at another market's price. Skip it.
      if (intent.exchange && intent.exchange !== s.exchange_id) {
        pushRow(intent, "rejected", card.kind, { reason: `leg pinned to ${intent.exchange}; session venue is ${s.exchange_id}` });
        continue;
      }

      const base = intent.symbol.split("/")[0].toUpperCase();
      if (!s.allowed_symbols.includes(intent.symbol.split("/")[0])) {
        pushRow(intent, "rejected", card.kind, { reason: "symbol not allowed" });
        continue;
      }
      /**
       * ── PRÉ-VOO DA VENDA (A5 + A13) — o que o bot tem é o TETO do que ele vende.
       *
       * ⚠⚠ ISTO ACONTECE ANTES DA GUARDA DE NOCIONAL DE PROPÓSITO: a guarda
       * precisa checar a quantidade QUE VAI SER ENVIADA, e o registro da linha
       * precisa mostrar o nocional real, não o que o modelo pediu.
       *
       * O comentário antigo aqui dizia *"only sell a base the bot actually
       * holds — never dump an unrelated user holding"*, e conferia o SÍMBOLO e
       * nunca o TAMANHO: `placeCexOrder` recebia `intent.amount`, vindo do
       * cartão do modelo. E `price-guard.ts` isenta as vendas do teto por
       * operação justamente porque *"they are naturally bounded by the user's
       * holdings"* — as posses do USUÁRIO, que incluem moeda que o bot nunca
       * comprou. Duas suposições, cada uma contando com a outra; entre elas só
       * restava o teto rígido de US$ 100.000 por ordem, a cada 5 minutos.
       */
      let vendaDe: AutopilotPositionRow | null = null;
      let amount = intent.amount;
      if (intent.side === "sell") {
        const pos = openPositions.find((p) => p.base.toUpperCase() === base);
        if (!pos || !ownedBases.has(base)) {
          pushRow(intent, "skipped", card.kind, { reason: "no open autopilot position for this base" });
          continue;
        }
        /**
         * ⚠⚠ UMA SAÍDA ARMADA JÁ É UMA ORDEM VIVA NA CORRETORA. Uma segunda
         * venda aqui vende a MESMA bolsa duas vezes — exatamente o desfecho que
         * `markServerExitArmed` teme por escrito, só que pelo caminho de
         * SUCESSO em vez do de falha. O modelo recebe `exit_armed=yes` no
         * contexto, mas informar o modelo não é travar o código.
         *
         * Falha FECHADA: pula e deixa a ordem armada resolver sozinha. Trocar
         * uma saída armada por uma a mercado exigiria cancelar a primeira, e
         * cancelar-e-repor não existe aqui — enquanto não existir, duas ordens
         * vivas é o pior dos desfechos.
         */
        if (pos.status === "exit_armed") {
          pushRow(intent, "skipped", card.kind, {
            order_id: pos.exit_order_id,
            reason: "exit already armed for this base — a second sell would dump the same bag twice",
          });
          continue;
        }
        const venda = quantoPodeVender(intent.amount, pos.base_amount);
        if (!venda.ok) {
          pushRow(intent, "rejected", card.kind, { reason: `sell blocked: ${venda.porque}` });
          continue;
        }
        if (venda.limitada) {
          // O modelo pediu mais do que o bot tem. NÃO é ruído: é a diferença
          // entre vender a posição e vender a bolsa do dono.
          await recordEvent("autopilot_venda_limitada_a_posicao", { meta: {
            session: s.id, pair: intent.symbol, pedido: intent.amount, naPosicao: venda.naPosicao,
            why: "o cartão pediu vender mais do que o bot comprou — o excedente seria moeda "
              + "do próprio usuário, que o autopilot não tem mandato para vender",
          } });
        }
        amount = venda.qtd;
        vendaDe = pos;
      }

      const refPrice = refPrices.get(base)?.priceUsd ?? null;
      const guard = checkRealNotional({ side: intent.side, baseAmount: amount, refPrice, maxTradeUsd: effectiveMaxTradeUsd });
      if (!guard.ok) {
        pushRow(intent, "rejected", card.kind, { notional_usd: guard.realNotionalUsd ?? intent.notionalUsd, reason: guard.reason ?? "notional guard" });
        continue;
      }

      // ── SELL (A5): market sell settles P&L now; a limit sell is armed e
      //    liquidada numa passada posterior. ──
      if (vendaDe) {
        const pos = vendaDe;
        try {
          /**
           * ⚠️⚠️ PASSA PELO EXECUTOR AUTORITATIVO (A107). O intent é gravado
           * ANTES do envio, o kill-switch é conferido no limiar (A106) e um
           * timeout vira DÚVIDA — nunca "errored" com o livro afirmando o que
           * não sabe.
           */
          const vagaDaVenda = novaVaga();
          const exec = await executarOrdemCex(
            { db: getSupabaseAdmin() },
            /** ⚠️ Venda não leva certificado — saída não precisa de licença. */
            { origin: "autopilot_cron", autonomous: true,
              walletAddress: s.wallet_address, sessionId: s.id, conexaoId: s.conexao_id,
              strategyId: s.strategy_id, strategyVersion: s.strategy_version },
            { exchangeId: exchange, symbol: intent.symbol, side: "sell",
              type: intent.type, qty: amount, price: intent.price ?? null,
              notionalUsd: guard.realNotionalUsd ?? intent.notionalUsd },
            creds,
            // ⚠️ A132: a vaga é RESERVADA aqui dentro, antes do envio.
            vagaDaVenda,
          );

          if (exec.desfecho === "recusado") {
            anotarRecusaDaVaga(vagaDaVenda);
            pushRow(intent, "errored", card.kind, { reason: `${exec.motivo}: ${exec.porque}`.slice(0, 200) });
            continue;
          }

          /**
           * ⚠️⚠️ A BOLSA PODE TER SIDO VENDIDA. Não se mexe na posição, não se
           * realiza P&L — mas o contador diário SOBE, porque o fato "existe uma
           * ordem possivelmente viva" já aconteceu.
           */
          if (exec.desfecho === "incerto") {
            // ⚠️ A132: a vaga JÁ foi consumida na reserva, e NÃO é devolvida em
            // dúvida — devolvê-la autorizaria um segundo envio para uma ordem
            // que talvez esteja viva (INVARIANTE 4).
            fired++; remainingTrades--;
            avisarRegistroPerdido("VENDA INCERTA — a posicao NAO foi alterada", {
              pair: intent.symbol, intent: exec.intentId, porque: exec.porque,
              why: "reduzir a posicao agora e nao reduzir sao os dois erros possiveis. "
                + "A reconciliacao decide com o que a corretora disser.",
            });
            pushRow(intent, "errored", card.kind, { reason: `incerto: ${exec.porque}`.slice(0, 200) });
            continue;
          }

          /**
           * ⚠️ O "order" daqui para baixo é uma VISTA DO LIVRO, não a resposta
           * crua da corretora. `realizedFromSell` e `taxaEmUsd` continuam sendo
           * as contas de sempre — só que agora alimentadas por evidência.
           */
          const order = {
            id: exec.externalOrderId ?? exec.intentId,
            filled: exec.filledQty, cost: exec.filledQuote,
            average: exec.filledQty > 0 ? exec.filledQuote / exec.filledQty : 0,
            fee: exec.feeTotal != null && exec.feeCurrency
              ? { cost: exec.feeTotal, currency: exec.feeCurrency } : undefined,
          } as unknown as CexOrder;
          // ⚠️ A132: nada de contar aqui. A vaga foi RESERVADA antes do envio,
          // e contar de novo seria a conta dobrada que o Round 8 tirou do
          // navegador.
          fired++; remainingTrades--;
          if (intent.type === "market") {
            const { realized, aviso } = realizedFromSell(order, pos);
            if (aviso) await avisarTaxaNaoPrecificada(pos.pair, aviso);
            if (realized !== null) {
              pnlToday += realized;
              await exigirGravacao(
                await applySessionPnl(s.id, realized, today),
                "P&L realizado NAO contabilizado — o stop de perda diaria nao viu esta perda e pode nao puxar o freio hoje",
                { session: s.id, base: pos.base, realized });
              if (pnlToday <= -s.daily_loss_stop_usd) frozenUntil = today;
            }
            /**
             * ⚠⚠ SAÍDA PARCIAL NÃO APAGA A LINHA (A14). Antes, qualquer
             * preenchimento > 0 chamava `closeServerPosition`: vendida uma
             * parte, o bot passava a acreditar que não tem nada — o resto
             * ficava órfão na conta do cliente e o teto de exposição liberava o
             * custo INTEIRO, então ele ainda comprava por cima.
             *
             * ⚠️⚠️ ACHADO A81, NA LINHA EXATA. Isto era:
             *
             *     const vendido = Number(order.filled) > 0 ? ... : amount;
             *
             * O comentário defendia a convenção: tratar como "vendeu zero"
             * faria a passada seguinte vender de novo. O raciocínio era
             * razoável e o efeito não — `filled` ausente passou a significar
             * "vendeu tudo", e a posição saía do livro sem evidência nenhuma.
             *
             * Agora vem do LIVRO, e zero é zero. O caso do ACK sem
             * preenchimento é tratado logo abaixo como o que ele é: uma ordem
             * a mercado que ainda não devolveu execução, e que a reconciliação
             * resolve. Vender de novo por engano é o erro caro; esperar uma
             * passada é o barato.
             */
            const vendido = exec.filledQty;
            if (!(vendido > 0)) {
              avisarRegistroPerdido("venda a mercado aceita SEM preenchimento — posicao mantida", {
                pair: intent.symbol, intent: exec.intentId, estado: exec.state,
              });
              pushRow(intent, "fired", card.kind, { order_id: order.id,
                reason: "aceita sem preenchimento — posicao intacta ate reconciliar" });
              continue;
            }
            const sobra = oQueSobrou(Number(pos.base_amount), Number(pos.cost_usd || 0), vendido);
            if (sobra.fecha) {
              await exigirGravacao(
                await closeServerPosition(s.id, pos.base),
                "posicao NAO removida apos sair — o teto de exposicao conta capital que nao esta mais la, e o ramo de venda pode tentar vender de novo",
                { session: s.id, base: pos.base });
              ownedBases.delete(base);
            } else {
              await exigirGravacao(
                await reduzirServerPosition(s.id, pos.base, sobra.baseRestante, sobra.custoRestante),
                "saida PARCIAL nao gravada — o banco segue dizendo que a bolsa inteira esta la, e a passada seguinte tenta vender de novo o que ja saiu",
                { session: s.id, base: pos.base, resta: sobra.baseRestante });
              // A base CONTINUA nas mãos do bot: sai de `ownedBases` só quando fecha.
            }
            exposureUsd = Math.max(0, exposureUsd - sobra.custoRemovido);
            logOperation({ walletAddress: s.wallet_address, kind: "autopilot_cex", chain: s.exchange_id, pair: intent.symbol, side: "sell", volumeUsd: sobra.custoRemovido || null, pnlUsd: realized, status: "filled", route: "cron", ref: `${exchange}:${order.id}` });
            pushRow(intent, "fired", card.kind, { order_id: order.id, notional_usd: realized ?? guard.realNotionalUsd ?? intent.notionalUsd, reason: realized !== null ? `exit filled, realized $${realized.toFixed(2)}${sobra.fecha ? "" : `, ${sobra.baseRestante} still held`}` : "exit filled" });
          } else {
            await exigirGravacao(
              await markServerExitArmed(s.id, pos.base, order.id),
              "saida NAO marcada como armada — a passada seguinte arma DE NOVO e vende duas vezes a mesma bolsa",
              { session: s.id, base: pos.base, order_id: order.id });
            pushRow(intent, "fired", card.kind, { order_id: order.id, reason: "exit armed (limit)" });
          }
        } catch (e) {
          pushRow(intent, "errored", card.kind, { reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
        }
        continue;
      }

      /**
       * ⚠️⚠️ O MOTOR DE POLÍTICA ÚNICO — achado A113.
       *
       * Esta decisão era `trendGate("buy", regime)` inline, AQUI e em lugar
       * nenhum mais. O piloto do navegador dispara o MESMO cartão por
       * `/api/cex/order` e nunca passava por ela: dois canais, dois vereditos
       * para a mesma estratégia.
       *
       * Agora os dois chamam `avaliarDecisaoDeEstrategia`, e a versão da
       * política entra no registro — senão "por que este trade passou?" não
       * tem resposta reconstruível.
       */
      /**
       * ⚠️⚠️ TIER REBAIXADO FECHA A ENTRADA, e SÓ a entrada (A111). Barrar a
       * venda prenderia o cliente numa posição por causa de uma cobrança — o
       * pior desfecho possível de um controle de acesso.
       */
      if (!autorizacao.abreEntrada) {
        pushRow(intent, "rejected", card.kind, {
          reason: `autorizacao/${autorizacao.motivo}: ${autorizacao.porque}`.slice(0, 200) });
        continue;
      }

      /**
       * ⚠️⚠️ QUARENTENA DE CONTA (A103): ZERO BUY autônomo.
       *
       * Este gate mora DEPOIS do ramo de venda de propósito: saída e redução
       * NUNCA são presas pela quarentena — trancar saída seria trancar o
       * cliente numa posição por causa de um alarme nosso. Só a entrada, que é
       * onde dinheiro novo entraria sobre um inventário que não fecha.
       */
      if (!entradasLiberadas) {
        pushRow(intent, "rejected", card.kind, {
          reason: "conta em quarentena ou reconciliacao sem leitura confiavel — zero BUY autonomo (A103)" });
        continue;
      }

      const regime = regimeBy.get(base) ?? null;
      const decisao = avaliarDecisaoDeEstrategia({
        canal: "worker", side: "buy", symbol: intent.symbol, base,
        regime, notionalUsd: guard.realNotionalUsd ?? intent.notionalUsd,
        maxTradeUsd: effectiveMaxTradeUsd,
        allowedSymbols: s.allowed_symbols ?? null,
        autonomous: true, certificado: certificadoDaSessao, venue: exchange,
        strategyHash: s.strategy_hash,
      });
      if (!decisao.permite) {
        pushRow(intent, "rejected", card.kind, {
          reason: `politica v${decisao.versao}/${decisao.motivo}: ${decisao.porque}`.slice(0, 200) });
        continue;
      }

      // ── then the total-exposure cap (A4 server side), fire, and record the
      //    entry server-side (A5). ──
      const buyNotional = guard.realNotionalUsd ?? intent.notionalUsd;
      if (exposureUsd + buyNotional > maxExposureUsd) {
        pushRow(intent, "rejected", card.kind, { reason: `total exposure cap $${maxExposureUsd} would be exceeded` });
        continue;
      }
      try {
        /**
         * ⚠️⚠️ PASSA PELO EXECUTOR AUTORITATIVO (A107). Intent durável antes do
         * envio, kill-switch no limiar (A106), timeout vira DÚVIDA (A104).
         */
        const vagaDaCompra = novaVaga();
        const exec = await executarOrdemCex(
          { db: getSupabaseAdmin() },
          { origin: "autopilot_cron", autonomous: true,
            walletAddress: s.wallet_address, sessionId: s.id, conexaoId: s.conexao_id,
            strategyId: s.strategy_id, strategyVersion: s.strategy_version,
            certificateId: decisao.certificadoId,
            /** A110 round 2: a autorização FINAL acontece no banco, no passo 6
             *  do executor — o hash é o que amarra o certificado aos parâmetros
             *  com que esta sessão vai rodar agora. */
            strategyHash: s.strategy_hash },
          { exchangeId: exchange, symbol: intent.symbol, side: "buy",
            type: intent.type, qty: intent.amount, price: intent.price ?? null,
            notionalUsd: buyNotional },
          creds,
          // ⚠️ A132: a vaga é RESERVADA aqui dentro, antes do envio.
          vagaDaCompra,
        );

        if (exec.desfecho === "recusado") {
          anotarRecusaDaVaga(vagaDaCompra);
          pushRow(intent, "errored", card.kind, { reason: `${exec.motivo}: ${exec.porque}`.slice(0, 200) });
          continue;
        }

        /**
         * ⚠️⚠️ A COMPRA PODE TER ACONTECIDO. NÃO se grava posição — gravar uma
         * entrada sobre dúvida é inventar uma bolsa que talvez não exista, e o
         * ramo de venda passaria a tentar vendê-la. O contador diário sobe,
         * porque a ordem pode estar viva.
         */
        if (exec.desfecho === "incerto") {
          // ⚠️ A132: vaga consumida na reserva, e NÃO devolvida em dúvida.
          fired++; remainingTrades--;
          avisarRegistroPerdido("COMPRA INCERTA — posicao NAO gravada", {
            pair: intent.symbol, intent: exec.intentId, porque: exec.porque,
            why: "a ordem pode ter executado. A reconciliacao abre a posicao se ela existir.",
          });
          pushRow(intent, "errored", card.kind, { reason: `incerto: ${exec.porque}`.slice(0, 200) });
          continue;
        }

        const order = { id: exec.externalOrderId ?? exec.intentId };
        // ⚠️ A132: a vaga já foi reservada antes do envio. Contar aqui também
        // seria a conta dobrada que o Round 8 tirou do navegador.
        fired++; remainingTrades--;
        /**
         * ⚠️⚠️ ACHADO A81, NA LINHA EXATA. Isto era:
         *
         *     const filledQty = Number(order.filled) > 0 ? Number(order.filled) : intent.amount;
         *
         * — e o comentário acima dela dizia *"Record the entry with REAL fill
         * data"*. Não era real: `filled` ausente ou zero virava a quantidade
         * PEDIDA, e o bot abria uma posição inteira sobre um ACK. Depois o teto
         * de exposição contava esse capital, e o ramo de venda tentava vender
         * uma bolsa que podia não existir.
         *
         * Agora sai do LIVRO. ACK sem preenchimento não abre posição nenhuma.
         */
        const filledQty = exec.filledQty;
        const spentUsd  = exec.filledQuote;
        const fillPrice = filledQty > 0 && spentUsd > 0 ? spentUsd / filledQty : 0;
        /**
         * ⚠️ O ELSE EXISTE AGORA. Antes, preco ou quantidade nao positivos
         * pulavam o registro EM SILENCIO — e a posicao ficava orfa: o ramo de
         * venda nunca mais a encontraria, e o teto de exposicao ficaria cego.
         * Hoje o ramo e inalcancavel (a guarda de preco garante refPrice > 0),
         * mas caminho de dinheiro sem `else` e exatamente como a FREYJA passou
         * dez dias parada sem ninguem saber de que.
         */
        if (fillPrice > 0 && filledQty > 0) {
          const gravou = await recordServerEntry({
            sessionId: s.id, walletAddress: s.wallet_address, exchangeId: s.exchange_id,
            pair: intent.symbol, entryPrice: fillPrice, baseAmount: filledQty, costUsd: spentUsd,
            reasoning: card.summary?.slice(0, 300), entryLabel: card.title?.slice(0, 80),
          });
          if (!gravou.ok) {
            avisarRegistroPerdido("posicao NAO gravada — o bot nunca vai sair deste trade sozinho", {
              pair: intent.symbol, order_id: order.id, entry: fillPrice, qty: filledQty, erro: gravou.erro,
            });
            posicaoPerdida = true;
          }
          // ⚠️ Soma na memoria mesmo se a gravacao falhou: dentro DESTA passada
          // o dinheiro esta exposto de verdade, e o teto tem de enxerga-lo.
          exposureUsd += spentUsd;
          ownedBases.add(base);
        } else {
          /**
           * ⚠️ AGORA ESTE RAMO SIGNIFICA OUTRA COISA, e melhor: a ordem foi
           * ACEITA e ainda não preencheu. Não é registro perdido — é ordem
           * viva. Uma limitada esperando o livro cai aqui normalmente, e a
           * reconciliação abre a posição quando (e se) ela executar.
           */
          pushRow(intent, "fired", card.kind, { order_id: order.id,
            reason: `aceita sem preenchimento (${exec.state}) — posicao abre na reconciliacao` });
          continue;
        }
        logOperation({ walletAddress: s.wallet_address, kind: "autopilot_cex", chain: s.exchange_id, pair: intent.symbol, side: "buy", volumeUsd: buyNotional, pnlUsd: null, status: "fired", route: "cron", ref: `${exchange}:${order.id}` });
        pushRow(intent, "fired", card.kind, { order_id: order.id, notional_usd: buyNotional });
      } catch (e) {
        pushRow(intent, "errored", card.kind, { reason: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
      }
    }
  }

  if (frozenUntil === today) alertIfNewlyFrozen(); // a sell may have tripped it mid-run
  await recordRuns(runRows);
  // CONTADOR INCREMENTAL (auditoria de dinheiro, 30/07).
  //
  // Antes o contador diário era somado UMA vez, aqui no fim da execução. O
  // limite dentro de uma mesma passada era respeitado (remainingTrades vive em
  // memória), mas se a função morresse depois de disparar e antes desta linha
  // — timeout do serverless no meio de chamadas de corretora, que levam
  // segundos cada — as ordens JÁ EXISTIAM na corretora e o contador nunca as
  // via. A passada seguinte lia o número velho e liberava a cota diária
  // inteira de novo.
  //
  // O limite de trades por dia é o que o usuário usa para limitar a própria
  // exposição. Ele não pode depender da função chegar viva até o fim.
  //
  // Agora cada ordem é contada logo após existir. O RPC é relativo e atômico
  // (o mesmo que o navegador usa), então somas concorrentes não se perdem — e
  // pagar uma ida ao banco por ordem executada é barato no caminho do dinheiro.
  await telemetria(s.id, {
    last_scan_at: nowIso,
    last_error:   null,
  });

  /**
   * ⚠️ O RESUMO NAO PODE DIZER SO "fired N" quando algo ficou pendurado.
   * Ordem executada sem registro exige reconciliacao humana, e contador
   * perdido significa que a passada parou por falta de confianca no limite —
   * as duas coisas somem se a nota so contar sucessos.
   */
  const avisos = [
    posicaoPerdida    ? "POSICAO NAO GRAVADA — reconciliar a mao" : "",
    !contadorConfiavel ? "contador diario perdido — passada interrompida" : "",
  ].filter(Boolean).join(" · ");
  const base = fired > 0 ? `fired ${fired}` : "nothing eligible";
  return { fired, note: avisos ? `${base} ⚠ ${avisos}` : base };
}
