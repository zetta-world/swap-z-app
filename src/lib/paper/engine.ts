/**
 * Paper-trading engine — the autonomous Gate.io simulation agent.
 *
 * Reads the flywheel's signals (zion_suggestions, READ-ONLY) and executes them
 * as SIMULATED trades, filled against Gate.io's LIVE public price. One virtual
 * wallet per signal source, so we get a portfolio equity curve per AI agent:
 * not just "was the signal right?" but "would this agent have MADE money?".
 *
 * ISOLATION: never imports the live autopilot / placeCexOrder / any exchange
 * key. No real order is ever sent. Fully self-contained: its only writes are to
 * paper_accounts / paper_positions; zion_suggestions is only ever SELECTed.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { medirFrescor, MAX_FRACAO_DO_HORIZONTE } from "@/lib/paper/frescor";
import { DESKS as DESK_LIST, isArquivada } from "@/lib/zion/desks";
import { getOHLCV } from "@/lib/api/geckoterminal";
import { recordEvent } from "@/lib/admin/track";
import { CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";
/**
 * ⚠️ A CONVENÇÃO DE SAÍDA MORA EM `paper/saida.ts`, PURA — este arquivo importa
 * `supabase/server`, e o empacotador puxa o módulo inteiro. Reexportado aqui
 * para que nenhum chamador antigo precise mudar; quem é código de CLIENTE tem
 * de importar de `saida.ts` diretamente.
 */
export { computeExit, computeExitPath, type ExitVerdict } from "@/lib/paper/saida";
import { computeExitPath, type Candle } from "@/lib/paper/saida";

// Round-trip execution cost (fees + slippage, both legs) — mirrors the flywheel
// so paper P&L is net, not gross. Default 0.2%.
// ⚠️ IDA E VOLTA, não uma perna. Até 16/08 esta linha lia o custo de UMA
// ordem e o cobrava pelo ciclo inteiro — metade da taxa real da Gate.io
// (0,2% por ordem, medida). Cada posição de papel fechada aqui parecia 0,2
// ponto melhor do que foi, e este número vira dinheiro em `pnl_usd`.
const COST_PCT     = CUSTO_IDA_E_VOLTA_PCT;
const POSITION_PCT = Number(process.env.PAPER_POSITION_PCT  ?? 0.05); // deploy 5% of starting capital per signal
const STARTING_USD = Number(process.env.PAPER_STARTING_USD  ?? 1000);
const MIN_CASH_USD = Number(process.env.PAPER_MIN_CASH_USD  ?? 25);   // floor to open a position (out-of-capital below this)
// Champion sizing (alavanca 3): the tournament's current champion (set by the
// cull engine in admin_kv) deploys a bigger slice per signal — paper capital
// concentrates on what is PROVEN to work at the minimum sample.
const CHAMPION_MULT = Number(process.env.PAPER_CHAMPION_MULT ?? 2);

/** The flywheel sources that get their own paper wallet — the tournament, at
 *  the portfolio level. */
export const PAPER_SOURCES = [
  "self_scan", "hybrid_scan", "mistral_scan", "grok_scan", "deepseek_scan", "kimi_scan", "radar", "sniper",
  "oracle_self", "oracle_mistral", "oracle_grok", "oracle_deepseek", "oracle_kimi",
  // Ragnarök (PLANO-RAGNAROK): mesa long-only de acumulação de USDT. A carteira
  // paper É a métrica deste experimento — não o win-rate, mas quanto USDT sobra.
  "strat_mech", "strat_ai", "strat_dex", "strat_day", "ullr_launch",
  // URÐR: a mesa que obedece ao histórico medido. Terceiro braço do duelo.
  "strat_record",
  // Os gêmeos alavancados do JÖRMUNGANDR — margem menor por ciclo, e o risco
  // de liquidação que a alavancagem cria.
  "arbiter2_3x", "arbiter2_5x",
] as const;
export type PaperSource = (typeof PAPER_SOURCES)[number];

// Rótulos vêm do registro de mesas (src/lib/zion/desks.ts) — fonte única de
// nomes. A carteira mostra o mesmo nome que o torneio, sempre.
const LABELS: Record<string, string> = Object.fromEntries(
  DESK_LIST.map((d) => [d.source, `${d.sigil} ${d.name}`]),
);

// ── Pure helpers (unit-tested — no DB, no network) ────────────────────────

/** Capital to deploy on one signal: a fixed slice of STARTING capital, capped
 *  by cash actually available. Returns 0 when out of capital (below the floor)
 *  — that "ran out of money" state is exactly the portfolio insight we want. */
export function sizePosition(cashAvail: number, startingUsd: number, conviction = 1): number {
  const size = Math.min(cashAvail, startingUsd * POSITION_PCT * conviction);
  return size >= MIN_CASH_USD ? size : 0;
}

/** NEUTRALIZED (auditoria 25/07): this used to size bets UP with the model's
 *  stated probability — which the flywheel proved ANTI-calibrated (win 32.7%
 *  below 60 conf → 0% above 80), so it bet the most exactly where the model
 *  was most wrong. Flat 1× until we can size by MEASURED per-agent
 *  calibration from the ledger — never by self-reported confidence. */
export function convictionFactor(_probability: number | null): number {
  return 1;
}

/**
 * A TENDÊNCIA DAS 24 HORAS ANTERIORES — o sinal do filtro de regime.
 * (`docs/PLANO-TAMANHO-E-REGIME.md`)
 *
 * ⚠️⚠️ O SINAL OLHA PARA TRÁS, E ISSO É A COISA TODA.
 *
 * A tentação é filtrar pelo retorno DO DIA — e isso é viés de antecipação
 * puro: usa o resultado para decidir a entrada que o produziu. Um backtest
 * assim aprova qualquer coisa. Aqui a janela termina na vela mais recente
 * DISPONÍVEL no momento da decisão e começa 24h antes dela.
 *
 * ⚠️ SEM VELA DE 24H ATRÁS, DEVOLVE `null` — nunca 0%. Zero seria "de lado",
 * uma afirmação sobre o mercado; `null` é "não sei", e quem não sabe não barra
 * (ver `permiteEntrada`). Confundir os dois faria série curta virar veredito.
 *
 * ⚠️ Exigir uma vela em `fim − 24h` já garante que a janela cobre 24 horas de
 * verdade; não há guarda extra de cobertura porque ela seria inalcançável.
 */
export function tendencia24h(candles: Candle[], agoraMs: number): number | null {
  const janela = candles.filter((c) => c.t <= agoraMs && c.close > 0).sort((a, b) => a.t - b.t);
  if (janela.length < 2) return null;

  const fim = janela[janela.length - 1];
  const alvo = fim.t - 24 * 3_600_000;

  // A vela mais RECENTE que ainda esteja em `fim − 24h` ou antes.
  let inicio: Candle | null = null;
  for (const c of janela) {
    if (c.t <= alvo) inicio = c; else break;
  }
  if (inicio == null) return null;

  return ((fim.close - inicio.close) / inicio.close) * 100;
}

/**
 * O PORTÃO DO REGIME — e ele FALHA ABERTO, ao contrário do resto do repo.
 *
 * ⚠️ A regra da casa é que o caminho do dinheiro falha FECHADO: sem preço de
 * referência, rejeita. Aqui é o oposto, de propósito, e a diferença é o que
 * está em jogo dos dois lados.
 *
 * Um `price-guard` sem preço protege capital ao recusar. Este filtro sem sinal
 * não protege nada — ele só impede a mesa de operar. Um provedor de velas fora
 * do ar desligaria o laboratório inteiro em silêncio, que é exatamente o tipo
 * de morte muda que este projeto já pagou caro (a FREYJA, dez dias).
 *
 * ⚠️ `> 0`, não `>= 0`: preço parado não é tendência de alta. Empate barra.
 */
export function permiteEntrada(tendenciaPct: number | null): boolean {
  return tendenciaPct == null || tendenciaPct > 0;
}

/** A trade can only be ENTERED if the live fill sits on the correct side of the
 *  bracket — you can't market-enter a signal that already reached its target or
 *  stop (a stale signal). buy: stop < fill < target. sell(short): target < fill < stop. */
export function canEnter(side: string, fill: number, target: number | null, stop: number | null): boolean {
  if (!(fill > 0)) return false;
  if (target == null || stop == null) return false;
  return side === "buy"
    ? fill > stop && fill < target
    : fill < stop && fill > target;
}

/** Gate.io 5-minute candlesticks for [fromMs, toMs]. Row shape (v4):
 *  [t(sec), quoteVol, close, high, low, open, …]. Best-effort → [] on failure. */
export async function gateioKlines(symbol: string, fromMs: number, toMs: number): Promise<Candle[]> {
  try {
    const url = `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${symbol.toUpperCase()}_USDT&interval=5m`
      + `&from=${Math.floor(fromMs / 1000)}&to=${Math.ceil(toMs / 1000)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const rows = await res.json() as string[][];
    return rows
      .map((r) => ({ t: Number(r[0]) * 1000, close: parseFloat(r[2]), high: parseFloat(r[3]), low: parseFloat(r[4]) }))
      .filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low) && c.high > 0);
  } catch { return []; }
}

/**
 * ⚠️ TETO DE CHAMADAS DO FILTRO DE REGIME, e ele é ANUNCIADO.
 *
 * `gateioSpot` resolve N símbolos em UMA chamada; velas são uma chamada POR
 * símbolo. No universo medido são ~15 símbolos, e 30 dá folga — mas se um dia
 * passar disso, o excedente entra sem sinal (falha aberta) e o número sai no
 * evento `paper_regime_tick`. Corte silencioso lê-se como "filtrei tudo".
 */
const MAX_SIMBOLOS_REGIME = Number(process.env.PAPER_MAX_SIMBOLOS_REGIME ?? 30);

/**
 * A tendência de 24h de cada símbolo, para o filtro de regime do abridor.
 *
 * ⚠️ MELHOR-ESFORÇO EM TODO SÍMBOLO: falha de rede vira `null`, e `null` deixa
 * passar. O filtro nunca é o motivo de a mesa parar (ver `permiteEntrada`).
 */
export async function lerTendencias(
  simbolos: readonly string[], agoraMs: number,
): Promise<{ porSimbolo: Map<string, number | null>; ignorados: number }> {
  const unicos = [...new Set(simbolos.map((s) => s.toUpperCase()))];
  const lidos = unicos.slice(0, MAX_SIMBOLOS_REGIME);
  const porSimbolo = new Map<string, number | null>();

  // 26h de janela para garantir que exista vela em `fim − 24h` mesmo com buraco.
  const desde = agoraMs - 26 * 3_600_000;
  await Promise.all(lidos.map(async (sym) => {
    const velas = await gateioKlines(sym, desde, agoraMs);
    porSimbolo.set(sym, tendencia24h(velas, agoraMs));
  }));

  return { porSimbolo, ignorados: Math.max(0, unicos.length - lidos.length) };
}

/** One call to Gate.io's public tickers; returns base→USDT last price for the
 *  wanted symbols. Best-effort: a symbol missing from the map simply won't be
 *  filled/resolved this tick (fail-closed — no price, no trade). */
export async function gateioSpot(symbols: string[]): Promise<Map<string, number>> {
  const want = new Set(symbols.map((s) => s.toUpperCase()));
  const out = new Map<string, number>();
  if (want.size === 0) return out;
  try {
    const res = await fetch("https://api.gateio.ws/api/v4/spot/tickers", { cache: "no-store" });
    if (!res.ok) return out;
    const rows = await res.json() as Array<{ currency_pair?: string; last?: string }>;
    for (const r of rows) {
      const pair = r.currency_pair ?? "";
      if (!pair.endsWith("_USDT")) continue;
      const base = pair.replace(/_USDT$/, "").toUpperCase();
      if (!want.has(base)) continue;
      const px = parseFloat(r.last ?? "");
      if (Number.isFinite(px) && px > 0) out.set(base, px);
    }
  } catch { /* best-effort */ }
  return out;
}

/** Candles de um pool on-chain (S3), normalizados para o formato do Gate.io.
 *  GeckoTerminal devolve `time` em SEGUNDOS — converter é obrigatório, senão
 *  toda vela cai em 1970 e a janela de replay sai vazia. */
export async function poolKlines(chain: string, pool: string, fromMs: number, toMs: number): Promise<Candle[]> {
  const span = toMs - fromMs;
  const tf = span <= 12 * 3_600_000 ? "5m" : span <= 3 * 86_400_000 ? "1h" : "4h";

  /**
   * ⚠️ ESCADA DE JANELA — e o que ela NÃO é (14/08).
   *
   * A FREYJA gerou 19 sugestões desde 03/08, todas com `chain` + `pool_address`,
   * e a carteira de papel dela nunca abriu UMA posição. Descartei pelo banco o
   * que dava: não é fila (cada sugestão ficou `open` de 3 a 14 HORAS), não é o
   * caminho on-chain em geral (a ULLR abriu 1 das 4 dela, também com pool), não
   * é caixa ($1.000 intactos).
   *
   * Sobraram DOIS candidatos, e eles moram no abridor: "não consegui preço do
   * pool" e "o preço saiu da faixa de entrada". O `paper_open_skip` (13/08) vai
   * dizer qual é — mas há uma coisa que dá para consertar sem saber a resposta.
   *
   * O abridor pede uma janela de 1 HORA, o que escolhe velas de 5 MINUTOS. Num
   * pool fino a GeckoTerminal pode simplesmente não ter vela de 5m no período —
   * e aí a lista volta vazia, sem erro, e o símbolo é pulado para sempre. Um
   * pool com liquidez de sobra (o cbBTC da ULLR) tem; VELVET, CTR e afins podem
   * não ter.
   *
   * ⚠️ ISTO NÃO É UM PALPITE SOBRE A CAUSA. Se a causa for o preço fora da
   * faixa, esta escada não muda nada — ela é inerte. O que ela faz é **eliminar
   * um dos dois candidatos**, de modo que a resposta do `paper_open_skip` fique
   * sem ambiguidade. Três hipóteses erradas em 11/08 custaram um swap real do
   * dono cada uma; a lição foi parar de adivinhar e passar a estreitar.
   *
   * ⚠️ E A PRIMEIRA RESPOSTA COM VELA VENCE. Não se mistura granularidade: uma
   * vela de 4h e uma de 5m descrevem períodos diferentes, e concatenar as duas
   * produziria uma série com buracos de escala que o resolvedor leria como
   * movimento.
   */
  const escada: Array<"5m" | "1h" | "4h" | "1d"> = tf === "5m"
    ? ["5m", "1h", "4h", "1d"]
    : tf === "1h" ? ["1h", "4h", "1d"] : ["4h", "1d"];

  for (const passo of escada) {
    try {
      const rows = await getOHLCV(chain, pool, passo, 300, "base");
      const velas = rows
        .map((c) => ({ t: c.time * 1000, close: c.close, high: c.high, low: c.low }))
        .filter((c) => Number.isFinite(c.high) && c.high > 0)
        .sort((a, b) => a.t - b.t);
      if (velas.length > 0) return velas;
    } catch { /* fonte instável neste passo: tenta o próximo */ }
  }
  return [];
}

// ── DB orchestration ──────────────────────────────────────────────────────

type Db = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

/** Idempotent seed of the per-agent wallets. Never resets an existing wallet
 *  (ignoreDuplicates) — so re-running can't wipe collected paper history. */
export async function ensurePaperAccounts(db: Db): Promise<void> {
  const rows = PAPER_SOURCES.map((s) => ({
    source: s, label: LABELS[s] ?? s, exchange: "gateio",
    starting_usd: STARTING_USD, cash_usd: STARTING_USD,
  }));
  /**
   * ⚠⚠ ISTO TAMBÉM ERA `try/catch` — e pelo mesmo engano: `supabase-js`
   * RESOLVE com `{ error }` e não lança, então o `catch` nunca rodou.
   *
   * ⚠️ O DANO AQUI É SILÊNCIO, NÃO ESTRAGO. Com `ignoreDuplicates`, a
   * re-execução normal é no-op, então um erro é excepcional de verdade. E se a
   * semente não entrar, toda leitura seguinte cai em `if (!acc) continue`: o
   * agente de papel não abre nada, não fecha nada, e NÃO DIZ NADA — a
   * invariante nº 7 desta casa, indistinguível de "não havia o que fazer".
   */
  const { error } = await db.from("paper_accounts").upsert(rows, { onConflict: "source", ignoreDuplicates: true });
  if (error) {
    recordEvent("paper_contas_nao_semeadas", { meta: {
      contas: rows.length, erro: error.message.slice(0, 160),
      why: "sem as carteiras de papel o agente nao abre nem fecha posicao, e sai "
        + "silencioso a cada passada — igual a 'nao havia o que fazer'.",
    } });
  }
}

interface PaperAccount { id: string; source: string; starting_usd: number; cash_usd: number; realized_pnl_usd: number; wins: number; losses: number; }

/**
 * A chave do par (carteira, símbolo).
 *
 * ⚠️ MAIÚSCULA SEMPRE. O ledger guarda o símbolo como a fonte mandou, e
 * `gateioSpot` é consultado em maiúscula — um `ada` vindo de uma fonte e um
 * `ADA` de outra virariam duas chaves distintas, e o guarda-duplicata deixaria
 * as duas passarem justamente no caso que ele existe para pegar.
 */
export function chaveSimbolo(accountId: string, symbol: string): string {
  return `${accountId}:${symbol.toUpperCase()}`;
}

/**
 * Os pares (carteira, símbolo) em que há posição VIVA E ABERTA agora.
 *
 * ⚠️ OS DOIS FILTROS SÃO OBRIGATÓRIOS, e por motivos opostos. Sem
 * `status === "open"`, uma mesa que já FECHOU ADA ficaria proibida de operar
 * ADA para sempre — o guarda viraria uma lista negra permanente. Sem
 * `archived_at == null`, uma posição retirada da medição continuaria bloqueando
 * a mesa por uma exposição que não existe mais.
 */
export function simbolosAbertos(
  posicoes: ReadonlyArray<{ account_id: string; symbol: string; status: string; archived_at: string | null }>,
): Set<string> {
  return new Set(
    posicoes.filter((p) => p.status === "open" && p.archived_at == null)
            .map((p) => chaveSimbolo(p.account_id, p.symbol)),
  );
}

/** Open new positions: each wallet market-enters its source's still-open signals
 *  (with a bracket) that it hasn't taken yet, at the live Gate.io fill, sized by
 *  available cash. Returns how many were opened. */
export async function openPaperPositions(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  await ensurePaperAccounts(db);

  const { data: accounts } = await db.from("paper_accounts").select("id, source, starting_usd, cash_usd, realized_pnl_usd, wins, losses");
  if (!accounts?.length) return 0;
  const accBySource = new Map<string, PaperAccount>(accounts.map((a) => [a.source, a as PaperAccount]));

  // leitura-limitada: as 500 sugestões abertas MAIS ANTIGAS por tick. É um
  // recorte deliberado — a fila é processada por ordem de chegada e o que
  // sobrar entra no tick seguinte, então nada é perdido, só adiado. O teto
  // existe para o tick caber no tempo do cron.
  // inclui-arquivadas: `status = open` já exclui o que foi resolvido; sugestão
  // arquivada com status aberto não existe (o arquivamento fecha antes).
  const { data: sugg } = await db.from("zion_suggestions")
    .select("id, symbol, side, target_price, stop_price, probability, horizon_hours, source, status, created_at, chain, pool_address")
    .in("source", PAPER_SOURCES as unknown as string[])
    .eq("status", "open")
    .not("target_price", "is", null)
    .not("stop_price", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (!sugg?.length) return 0;

  // ⚠️ PAGINADO — SEM ISTO O CAPITAL VAZAVA (causa raiz, achada em 01/08).
  //
  // Este `select` não tinha `.limit()`, e o PostgREST devolve no máximo 1.000
  // linhas por padrão. A tabela passou de 2.700 posições, então o conjunto de
  // "já peguei esta sugestão" vinha TRUNCADO: milhares de pares
  // (conta, sugestão) sumiam da memória e as mesas tentavam reabrir posições
  // que já tinham.
  //
  // Como existe `UNIQUE (account_id, suggestion_id)`, a reinserção violava a
  // constraint — e o insert é EM LOTE, então UMA duplicata matava o lote
  // inteiro, levando junto as posições novas e legítimas. Daí as amostras
  // minúsculas. A segunda metade do estrago está no débito, logo abaixo.
  const held = await selectAllRows<{ account_id: string; suggestion_id: string; symbol: string; status: string; archived_at: string | null }>(
    // inclui-arquivadas: o dedup protege a chave UNIQUE (account, suggestion),
    // que não conhece arquivamento. Filtrar aqui faria a mesa TENTAR reabrir
    // uma posição arquivada; o upsert ignoraria em silêncio e o trabalho seria
    // desperdiçado a cada tick, para sempre.
    (from, to) => db.from("paper_positions").select("account_id, suggestion_id, symbol, status, archived_at")
      .order("id", { ascending: true }).range(from, to),
  );
  const taken = new Set(held.map((h) => `${h.account_id}:${h.suggestion_id}`));

  /**
   * ⚠️⚠️ UMA POSIÇÃO POR SÍMBOLO POR MESA — e a amostra que isto salva (13/08).
   *
   * A fila é processada por ordem de chegada e uma sugestão pode esperar mais
   * de um tick para virar posição. Em 13/08 às 19:31 a VÖLUNDR abriu ADA DUAS
   * VEZES no mesmo instante: a sugestão das 18:00 estava encalhada e a das
   * 19:30 chegou por cima. As duas preencheram ao MESMO preço (0,18162), com o
   * mesmo playbook (`range_reversion`) e o mesmo alvo. Os stops diferiam na
   * quinta casa decimal. A SKAÐI e a URÐR fizeram idêntico, no mesmo segundo.
   *
   * O estrago é duplo, e o segundo é o grave:
   *
   *  1. EXPOSIÇÃO — $100 na mesma ideia onde o mandato manda $50.
   *  2. AMOSTRA — as duas vão bater o mesmo alvo ou o mesmo stop, juntas, e o
   *     ledger vai registrar DOIS trades. A contagem de fechados é a régua de
   *     confiança do laboratório inteiro (a coluna FECH. fica âmbar abaixo de
   *     10 justamente por isso). Dois trades que carregam a informação de um
   *     inflam essa régua sem inflar o que ela mede — é a mesma família do
   *     `expired ≠ win/loss` do flywheel: contar como parcela algo que não é.
   *
   * A sugestão preterida NÃO é descartada: ela continua `open` e vira posição
   * quando a mesa sair de ADA. Adiar é o comportamento certo; empilhar não.
   */
  const jaDentro = simbolosAbertos(held);

  // Current champion (cull engine, alavanca 3) — best-effort, null when unset.
  let champion: string | null = null;
  try {
    const { data: champ } = await db.from("admin_kv").select("value").eq("key", "tournament_champion").maybeSingle();
    champion = champ?.value || null;
  } catch { /* no champion on a KV hiccup */ }

  // Preço de entrada: CEX pelo ticker do Gate.io, DEX pelo último close do
  // pool. Sem isto, uma sugestão on-chain nunca preencheria — `gateioSpot` não
  // conhece um token que só existe em DEX, e a posição jamais abriria.
  const cexSugg = sugg.filter((s) => !(s.chain && s.pool_address));
  const px = cexSugg.length ? await gateioSpot([...new Set(cexSugg.map((s) => s.symbol))]) : new Map<string, number>();
  const poolPx = new Map<string, number>();
  await Promise.all([...new Set(sugg.filter((s) => s.chain && s.pool_address).map((s) => `${s.chain}|${s.pool_address}`))]
    .map(async (key) => {
      const [chain, pool] = key.split("|");
      const c = await poolKlines(chain, pool, Date.now() - 3_600_000, Date.now());
      if (c.length) poolPx.set(key, c[c.length - 1].close);
    }));
  /**
   * O FILTRO DE REGIME (`docs/PLANO-TAMANHO-E-REGIME.md`).
   *
   * ⚠️ SÓ PARA OS SÍMBOLOS DE CEX. O lado on-chain preenche por pool, e a vela
   * da Gate.io descreveria outro livro — o mesmo descasamento que carimbou o
   * custo do HEIMDALL com o nome da GERI. Sugestão de pool passa sem sinal, e
   * `null` deixa passar.
   */
  const regime = cexSugg.length
    ? await lerTendencias(cexSugg.map((s) => s.symbol), Date.now())
    : { porSimbolo: new Map<string, number | null>(), ignorados: 0 };
  let bloqueadosPorRegime = 0;
  let velhas = 0;
  let somaFracaoVelha = 0;

  const spent = new Map<string, number>(); // account_id → cash deployed this tick
  type PaperInsert = {
    account_id: string; suggestion_id: string; source: string; symbol: string;
    side: "buy" | "sell"; qty: number; entry_price: number; cost_usd: number;
    target_price: number | null; stop_price: number | null; horizon_hours: number;
    chain: string | null; pool_address: string | null;
  };
  const inserts: PaperInsert[] = [];

  /**
   * ⚠️⚠️ POR QUE A SUGESTÃO NÃO VIROU POSIÇÃO — o buraco entre decidir e
   * executar, que não tinha rastro nenhum (13/08).
   *
   * A FREYJA (`strat_dex`) gerou 19 sugestões desde 03/08. Todas com alvo e
   * stop, todas resolveram no torneio (`hit_stop`, `hit_target`), e cada uma
   * ficou `open` de 3 a 14 HORAS — tempo de sobra para dezenas de ticks deste
   * abridor. A carteira de papel dela nunca abriu **uma única posição**.
   *
   * Não dava para saber por quê, e a razão é esta linha:
   *
   *     if (fill == null || !canEnter(...)) continue;
   *
   * **Duas causas diferentes num `continue` só**, e mudas. "não consegui preço
   * do pool" e "o preço saiu da faixa de entrada" pedem investigações opostas —
   * a primeira é a FONTE, a segunda é o MERCADO — e do lado de fora as duas
   * têm exatamente a mesma aparência: nada acontece.
   *
   * ⚠️ E foi instrumentação, não raciocínio, que quebrou o ciclo da taxa em
   * 11/08: três hipóteses erradas caíram no minuto em que passamos a gravar o
   * que MANDAMOS ao lado do que VOLTOU. Aqui é a mesma forma — o abridor passa
   * a dizer, por mesa, quantas recusou e por quê.
   */
  const recusas = new Map<string, Record<string, number>>();
  const nota = (source: string, motivo: string) => {
    const r = recusas.get(source) ?? {};
    r[motivo] = (r[motivo] ?? 0) + 1;
    recusas.set(source, r);
  };

  for (const s of sugg) {
    /**
     * ⚠️ A SEGUNDA TRAVA, e ela fica no caminho do DINHEIRO de propósito.
     *
     * O gate do registro no cron do torneio (13/08) impede que uma mesa
     * arquivada gere sugestão nova. Este aqui impede que uma sugestão que já
     * existe — as 6 da MUNINN gravadas às 20:00 daquele dia, por exemplo —
     * vire posição depois. As duas travas parecem redundantes e não são: a
     * primeira governa o gasto de token, a segunda governa o capital.
     *
     * A regra deste repo é que o caminho do dinheiro FALHA FECHADO. Uma mesa
     * declarada "o capital é histórico, não alocação ativa" não pode voltar a
     * alocar porque uma linha antiga sobrou numa fila.
     *
     * ⚠️ Não conta como recusa que ACUSA: a mesa está arquivada por decisão, e
     * disparar `paper_open_skip` por isso a cada tick transformaria o alarme em
     * ruído permanente — que é a mesma coisa que não ter alarme.
     */
    if (isArquivada(s.source)) continue;
    const acc = accBySource.get(s.source);
    if (!acc) { nota(s.source, "sem_carteira"); continue; }
    // `ja_pega` é o estado NORMAL: a sugestão já virou posição e continua
    // aberta no ledger de sinais. Conta, mas não acusa (ver o filtro abaixo).
    if (taken.has(`${acc.id}:${s.id}`)) { nota(s.source, "ja_pega"); continue; }
    // `jaDentro` cresce DENTRO do laço: duas sugestões do mesmo símbolo podem
    // chegar no mesmo tick, e ler só o estado do banco deixaria as duas passar.
    if (jaDentro.has(chaveSimbolo(acc.id, s.symbol))) { nota(s.source, "ja_no_simbolo"); continue; }
    /**
     * ⚠️⚠️ O SINAL VELHO NÃO ABRE (29/08 — `docs/PLANO-ATRASO-DE-EXECUCAO.md`).
     *
     * A fila acima é o que cria o problema: `ja_no_simbolo` ADIA a sugestão, e
     * adiar é certo — empilhar $100 onde o mandato manda $50 é pior. Mas a
     * preterida esperava INDEFINIDAMENTE e executava quando a vaga abrisse, com
     * alvo e stop calculados sobre um preço que já não existe. Atraso medido:
     * mediana de 180 min, cauda até 94,5 HORAS.
     *
     * ⚠️ O motivo NÃO é que trade atrasado perde dinheiro — medi, e não perde.
     * É que ele transforma horizonte em ficção: aberta no prazo, 15% expiram;
     * com metade do horizonte já gasto, 52%. E `expired` não é win nem loss —
     * é amostra sem veredito, inflando a régua de confiança do laboratório sem
     * inflar o que ela mede.
     *
     * ⚠️ CHECAGEM PURA, ANTES DA BUSCA DE PREÇO. Custa uma subtração; recusar
     * aqui poupa a leitura do mapa e mantém a ordem barato→caro que o filtro de
     * regime abaixo também respeita.
     *
     * ⚠️ CONSEQUÊNCIA ACEITA: a barrada continua `open` e será reavaliada todo
     * tick. A fila lê as 500 mais antigas e hoje há 9 abertas — folga de ~55×.
     * O conserto de verdade é a F3 (a sugestão expira na origem); enquanto isso
     * o número aparece no tick e o teto da fila é grande o bastante.
     */
    const fr = medirFrescor(s.created_at, s.horizon_hours, Date.now());
    if (!fr.fresca) {
      nota(s.source, "sinal_velho");
      velhas++;
      somaFracaoVelha += fr.fracaoGasta ?? 0;
      continue;
    }
    const onChain = s.chain && s.pool_address;
    const fill = onChain ? poolPx.get(`${s.chain}|${s.pool_address}`) : px.get(s.symbol.toUpperCase());
    // ⚠️ SEPARADOS DE PROPÓSITO — ver o comentário acima. Juntar os dois foi o
    // que deixou a FREYJA dez dias sem executar e sem ninguém saber de quê.
    if (fill == null) { nota(s.source, onChain ? "sem_preco_de_pool" : "sem_preco_de_cex"); continue; }
    if (!canEnter(s.side, fill, s.target_price, s.stop_price)) { nota(s.source, "preco_fora_da_faixa"); continue; }
    /**
     * ⚠️ O FILTRO DE REGIME FICA AQUI, DEPOIS DOS PORTÕES BARATOS, e a posição
     * na fila não é detalhe: as recusas anteriores custam um `Map.get`, esta
     * custou uma chamada de rede. Pôr a cara antes da barata gastaria banda
     * para decidir sobre sugestão que já ia ser descartada de graça.
     *
     * ⚠️ SÓ PARA LONG. Uma venda em tendência de queda é a operação CERTA — as
     * mesas de hoje são todas long-only, mas escrever a regra sem o lado
     * deixaria uma armadilha pronta para a primeira mesa que vender.
     */
    if (s.side === "buy" && !permiteEntrada(regime.porSimbolo.get(s.symbol.toUpperCase()) ?? null)) {
      nota(s.source, "contra_tendencia"); bloqueadosPorRegime++; continue;
    }
    const cashAvail = Number(acc.cash_usd) - (spent.get(acc.id) ?? 0);
    const champMult = s.source === champion ? CHAMPION_MULT : 1;
    const size = sizePosition(cashAvail, Number(acc.starting_usd), convictionFactor(s.probability) * champMult);
    if (size <= 0) { nota(s.source, "sem_caixa"); continue; } // out of capital
    jaDentro.add(chaveSimbolo(acc.id, s.symbol));
    inserts.push({
      account_id: acc.id, suggestion_id: s.id, source: s.source, symbol: s.symbol, side: s.side,
      qty: size / fill, entry_price: fill, cost_usd: size,
      target_price: s.target_price, stop_price: s.stop_price, horizon_hours: s.horizon_hours ?? 72,
      chain: s.chain ?? null, pool_address: s.pool_address ?? null,
    });
    spent.set(acc.id, (spent.get(acc.id) ?? 0) + size);
    taken.add(`${acc.id}:${s.id}`);
  }

  /**
   * A mesa que RECEBEU sugestão e não abriu NADA neste tick — e o porquê.
   *
   * ⚠️ `ja_pega` fica de fora do gatilho: uma mesa cujas sugestões já viraram
   * posição está funcionando, e acusá-la faria o evento disparar sempre, o que
   * é a mesma coisa que não disparar nunca.
   */
  const abriuPorFonte = new Set(inserts.map((i) => i.source));
  for (const [source, motivos] of recusas) {
    if (abriuPorFonte.has(source)) continue;
    const semJaPega = Object.entries(motivos).filter(([k]) => k !== "ja_pega");
    if (semJaPega.length === 0) continue;
    recordEvent("paper_open_skip", { meta: {
      source, ...Object.fromEntries(semJaPega),
      why: "a mesa tinha sugestão aberta e o abridor não executou nenhuma",
    } });
  }

  /**
   * ⚠️⚠️ A RECUSA POR FALTA DE CAIXA PRECISA DE EVENTO PRÓPRIO — e o motivo é
   * o `continue` quinze linhas acima.
   *
   * O `paper_open_skip` só dispara para a mesa que não abriu NADA. Faz sentido
   * para o que ele mede ("a mesa está muda?"), e é exatamente o errado para
   * medir capital: a mesa que abre 3 e recusa 5 por falta de caixa está
   * FUNCIONANDO — e é justamente ela que está com o tamanho apertado. Hoje
   * esse caso não deixa rastro nenhum.
   *
   * ⚠️ ISTO É O INSTRUMENTO QUE PRECEDE O AUMENTO DE `PAPER_POSITION_PCT`
   * (`docs/PLANO-TAMANHO-E-REGIME.md`, passo 2 antes do passo 3). Sem ele,
   * subir o tamanho seria mexer no capital sem ter como saber se foi longe
   * demais — e "descobrir depois" é como a FREYJA passou dez dias parada.
   *
   * O critério do plano é `sem_caixa` abaixo de ~5% das entradas; sem este
   * evento esse número não existe para ser conferido.
   */
  for (const [source, motivos] of recusas) {
    const semCaixa = motivos["sem_caixa"] ?? 0;
    if (semCaixa === 0) continue;
    const acc = accBySource.get(source);
    recordEvent("paper_sem_caixa", { meta: {
      source,
      recusadas: semCaixa,
      abertas_no_tick: inserts.filter((i) => i.source === source).length,
      // ⚠️ O ESTADO DA CARTEIRA VIAJA JUNTO: "5 recusadas" não diz se o
      // tamanho está apertado ou se a mesa está sem banca. São causas opostas.
      caixa_usd: acc ? Number(acc.cash_usd) : null,
      banca_usd: acc ? Number(acc.starting_usd) : null,
      why: "havia sugestão aprovada e não havia capital para abrir",
    } });
  }

  /**
   * O tick do filtro de regime — SÓ quando teve o que dizer.
   *
   * ⚠️ Evento por tick seria 288 por dia, num `platform_events` que já grava
   * 522 e ainda não tem política de retenção. Barrar nada é o estado normal e
   * não merece linha; barrar alguém, ou estourar o teto de símbolos, merece.
   */
  const semSinal = [...regime.porSimbolo.values()].filter((v) => v == null).length;
  /**
   * ⚠️⚠️ O FILTRO CEGO — o defeito que eu deixei aqui em 23/08 e a outra sessão
   * apontou.
   *
   * `permiteEntrada(null)` é PASSA: o filtro falha aberto de propósito, para
   * nunca ser o motivo de a mesa parar (ver `lerTendencias`). A consequência é
   * que, se a Gate.io recusa as velas, TODO símbolo volta `null`, tudo passa,
   * `bloqueadosPorRegime` fica 0 — e a condição acima nunca dispara.
   *
   * Resultado: filtro funcionando sem nada para barrar e filtro CEGO por
   * rate-limit produziam o MESMO silêncio. É a invariante nº 33 no instrumento
   * que deveria medir o filtro.
   *
   * Cegueira TOTAL é o caso inequívoco e é o que o rate-limit produz. Não fica
   * barulhento no caminho normal: só grava quando avaliou alguma coisa e não
   * conseguiu sinal de NENHUMA delas.
   */
  const cego = regime.porSimbolo.size > 0 && semSinal === regime.porSimbolo.size;

  if (bloqueadosPorRegime > 0 || regime.ignorados > 0 || cego) {
    recordEvent("paper_regime_tick", { meta: {
      bloqueados: bloqueadosPorRegime,
      simbolos_avaliados: regime.porSimbolo.size,
      // Sem sinal = passou sem ser julgado. É a taxa de cobertura do filtro.
      sem_sinal: semSinal,
      simbolos_ignorados_por_teto: regime.ignorados,
      // ⚠️ Duas causas OPOSTAS não podem partilhar a mesma frase: uma diz que o
      // filtro trabalhou, a outra que ele não enxergou nada.
      why: cego
        ? "FILTRO CEGO — avaliou " + regime.porSimbolo.size + " símbolos e não "
          + "obteve tendência de nenhum. Tudo passou SEM ser julgado (o filtro "
          + "falha aberto). Suspeita: rate-limit ou indisponibilidade da corretora"
        : "entradas long barradas por tendência de 24h não positiva",
    } });
  }

  /**
   * O TICK DO PORTÃO DE FRESCOR — e ele NÃO compartilha evento com o regime.
   *
   * ⚠️ São duas recusas com causas opostas e ações opostas: "contra a
   * tendência" pede olhar o mercado, "sinal velho" pede olhar a FILA. Juntar as
   * duas num contador só faria a soma subir e ninguém saber qual mexeu — a
   * mesma família do `expired ≠ win/loss`.
   *
   * ⚠️ A FRAÇÃO MÉDIA VAI JUNTO porque é ela que a F2 usa para escolher o teto
   * de verdade. Saber que barrou 4 não diz se o teto está apertado ou frouxo;
   * saber que as 4 estavam a 0,52 do horizonte diz.
   */
  if (velhas > 0) {
    recordEvent("paper_sinal_velho", { meta: {
      barradas: velhas,
      fracao_media_do_horizonte: Math.round((somaFracaoVelha / velhas) * 100) / 100,
      teto: MAX_FRACAO_DO_HORIZONTE,
      why: "sugestao ficou na fila (uma posicao por simbolo por mesa) e chegou "
        + "na vez dela com o horizonte majoritariamente gasto. Abrir agora "
        + "produziria posicao que expira em vez de dar veredito",
    } });
  }

  if (inserts.length === 0) return 0;

  // ⚠️ A OUTRA METADE DA CAUSA RAIZ (01/08).
  //
  // Isto era `try { await db.insert(inserts); } catch { return 0; }` — e o
  // `catch` NUNCA disparava. O cliente do Supabase não lança em erro de banco:
  // ele RESOLVE com `{ data: null, error }`. Uma violação de UNIQUE devolvia
  // erro silencioso, a promessa resolvia normalmente, e a execução seguia
  // direto para o laço de débito abaixo — que descontava o caixa de posições
  // QUE NUNCA FORAM CRIADAS.
  //
  // Foi assim que catorze carteiras perderam de US$450 a US$1.000, e o MÍMIR
  // ficou com exatamente $950 a menos: dezenove lotes debitados sem uma única
  // linha gravada. Nada disso levantava exceção, então nada aparecia em log.
  //
  // Duas mudanças fecham o buraco:
  //
  //  1. `ignoreDuplicates` — uma duplicata deixa de matar o lote inteiro. As
  //     posições novas entram; as repetidas são puladas em silêncio, que é o
  //     comportamento correto para um seed idempotente.
  //  2. `.select()` faz o insert DEVOLVER as linhas realmente gravadas, e o
  //     débito passa a ser calculado a partir DELAS. O caixa não pode mais
  //     divergir das posições: ele é derivado do que o banco confirmou, não do
  //     que a aplicação pretendia.
  const { data: created, error: insErr } = await db
    .from("paper_positions")
    .upsert(inserts, { onConflict: "account_id,suggestion_id", ignoreDuplicates: true })
    .select("account_id, cost_usd");
  if (insErr || !created?.length) return 0;

  // Débito derivado do que FOI GRAVADO — não do que se tentou gravar.
  const debited = new Map<string, number>();
  for (const row of created) {
    const id = String(row.account_id);
    debited.set(id, (debited.get(id) ?? 0) + Number(row.cost_usd ?? 0));
  }
  for (const [accId, cash] of debited) {
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) continue;
    /**
     * ⚠️ O DÉBITO É DERIVADO DO QUE O BANCO CONFIRMOU (ver a nota acima) — e a
     * ÚLTIMA LINHA da derivação estava solta. Recusado, as posições existem e o
     * caixa não foi debitado: a conta passa a dizer que tem mais dinheiro do que
     * tem, e abre mais posição por cima. É a mesma divergência que o `.select()`
     * acima existe para impedir, entrando pela porta seguinte.
     */
    const { error: erroDoDebito } = await db.from("paper_accounts")
      .update({ cash_usd: Number(acc.cash_usd) - cash, updated_at: new Date().toISOString() })
      .eq("id", accId);
    if (erroDoDebito) {
      recordEvent("paper_debito_nao_gravado", { meta: {
        account: accId, caixa: cash, erro: erroDoDebito.message.slice(0, 160),
        why: "as posicoes foram abertas e o caixa NAO foi debitado. A conta acredita "
          + "ter mais capital do que tem e vai abrir mais posicao por cima.",
      } });
    }
  }
  return created.length;
}

/** Resolve open positions against the live Gate.io price: close on target/stop
 *  touch or horizon, realize P&L back to the wallet's cash. Returns closed count. */
export async function resolvePaperPositions(): Promise<number> {
  const db = getSupabaseAdmin();
  if (!db) return 0;
  // arbiter2's open rows are HEDGED spot+perp cycles that close by spread
  // CONVERGENCE (its own scan does that) — resolving them here by target/
  // stop/horizon would book directional P&L a hedge doesn't have.
  // ⚠️ `archived_at is null` (03/08): este é o caminho que CREDITA caixa ao
  // fechar. Sem o filtro, uma posição já retirada da medição volta a ser
  // resolvida e devolve `custo + P&L` a uma carteira que já foi acertada — foi
  // exatamente o que aconteceu com o Arbiter 2.0 no minuto seguinte ao
  // zeramento. Todo leitor do ledger filtra arquivadas; os que creditam dinheiro
  // são os que menos podem esquecer.
  // ⚠️ PAGINADO. Truncar AQUI é o pior caso possível: a posição que ficar de
  // fora nunca é resolvida, fica aberta para sempre, e o capital dela some do
  // caixa disponível sem virar resultado nenhum. `.limit(1000)` dava a
  // impressão de teto — e o teto do PostgREST é o mesmo 1.000, então o limite
  // nunca chegava a valer.
  const openFull = await selectAllRows<{
    id: string; account_id: string; symbol: string; side: string;
    entry_price: number; cost_usd: number; target_price: number | null;
    stop_price: number | null; horizon_hours: number; opened_at: string;
    chain: string | null; pool_address: string | null;
  }>((from, to) => db.from("paper_positions")
    .select("id, account_id, symbol, side, entry_price, cost_usd, target_price, stop_price, horizon_hours, opened_at, chain, pool_address")
    .eq("status", "open").neq("source", "arbiter2").is("archived_at", null)
    .order("id", { ascending: true }).range(from, to));
  if (!openFull.length) return 0;
  // Mesma separação da abertura: pool tem preço próprio, símbolo tem o do
  // Gate.io. A chave é o pool — dois pools do mesmo token são preços distintos.
  const cexPos = openFull.filter((p) => !(p.chain && p.pool_address));
  const symbols = [...new Set(cexPos.map((p) => p.symbol))];
  const nowMs = Date.now();

  // Path-aware (F3): one Gate.io candle fetch per symbol, from that symbol's
  // oldest open position to now, reused across its positions. Spot is fallback.
  const candlesBySymbol = new Map<string, Candle[]>();
  const candlesByPool = new Map<string, Candle[]>();
  await Promise.all([
    ...symbols.map(async (sym) => {
      const earliest = Math.min(...cexPos.filter((p) => p.symbol === sym).map((p) => Date.parse(p.opened_at)));
      candlesBySymbol.set(sym, await gateioKlines(sym, earliest, nowMs));
    }),
    ...[...new Set(openFull.filter((p) => p.chain && p.pool_address).map((p) => `${p.chain}|${p.pool_address}`))]
      .map(async (key) => {
        const [chain, pool] = key.split("|");
        const earliest = Math.min(...openFull.filter((p) => `${p.chain}|${p.pool_address}` === key).map((p) => Date.parse(p.opened_at)));
        candlesByPool.set(key, await poolKlines(chain, pool, earliest, nowMs));
      }),
  ]);
  const prices = symbols.length ? await gateioSpot(symbols) : new Map<string, number>();

  const delta = new Map<string, { cash: number; pnl: number; wins: number; losses: number }>();
  let closed = 0;

  for (const p of openFull) {
    const onChain = p.chain && p.pool_address;
    const candles = onChain ? candlesByPool.get(`${p.chain}|${p.pool_address}`) ?? [] : candlesBySymbol.get(p.symbol) ?? [];
    const v = computeExitPath(p, candles, onChain ? candles[candles.length - 1]?.close : prices.get(p.symbol.toUpperCase()), nowMs);
    if (!v) continue;
    /**
     * ⚠⚠ ISTO ERA UM `try/catch`, E ELE NÃO PEGAVA NADA.
     *
     * É a invariante nº 1 desta casa ao contrário: `supabase-js` **NÃO LANÇA**
     * em erro de banco — ele RESOLVE com `{ error }`. O `catch { continue; }`
     * foi escrito para tornar o laço resistente e nunca executou uma vez.
     *
     * O estrago é no LIVRO, e é de dupla contagem: com o UPDATE recusado, a
     * execução caía direto no `delta` abaixo e a conta era CREDITADA pelo P&L
     * enquanto a posição continuava `open`. Na passada seguinte
     * `resolvePaperPositions` acha a mesma posição, fecha (ou falha) de novo, e
     * **credita de novo** — `realized_pnl_usd` e `wins` crescendo sem teto sobre
     * uma única saída.
     *
     * ⚠️ E é o flywheel que lê esses números. Expectancy inflada por contagem
     * dupla é pior que expectancy ausente: ela decide escala.
     *
     * Agora o `continue` acontece por LEITURA DO ERRO. Posição não fechada não
     * credita nada, e a passada seguinte tenta de novo — que é o desfecho certo.
     */
    const { error: erroDoFecho } = await db.from("paper_positions").update({
      status: "closed", exit_price: v.exit, exit_reason: v.reason,
      pnl_usd: v.pnlUsd, pnl_pct: v.netPct, closed_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (erroDoFecho) {
      recordEvent("paper_fecho_nao_gravado", { meta: {
        position: p.id, account: p.account_id, symbol: p.symbol, erro: erroDoFecho.message.slice(0, 160),
        why: "a posicao continua ABERTA e o caixa NAO foi creditado. A passada seguinte "
          + "tenta de novo — creditar aqui seria contar a mesma saida duas vezes.",
      } });
      continue;
    }
    const d = delta.get(p.account_id) ?? { cash: 0, pnl: 0, wins: 0, losses: 0 };
    d.cash += Number(p.cost_usd) + v.pnlUsd; // return deployed capital + P&L to cash
    d.pnl  += v.pnlUsd;
    if (v.win) d.wins++; else d.losses++;
    delta.set(p.account_id, d);
    closed++;
  }

  for (const [accId, d] of delta) {
    const { data: acc } = await db.from("paper_accounts").select("cash_usd, realized_pnl_usd, wins, losses").eq("id", accId).maybeSingle();
    if (!acc) continue;
    /**
     * ⚠️ AQUI NÃO DÁ PARA DESFAZER: as posições JÁ estão `closed`. Se este
     * crédito for recusado, o P&L daquelas saídas some do livro para sempre — e
     * nada vai tentar de novo, porque a passada seguinte não as enxerga mais.
     *
     * Então o objetivo não é impedir, é NUNCA PERDER O FATO — a mesma doutrina
     * de `positions-server.ts`. O evento carrega o valor para reconciliação.
     */
    const { error: erroDoCredito } = await db.from("paper_accounts").update({
      cash_usd: Number(acc.cash_usd) + d.cash,
      realized_pnl_usd: Number(acc.realized_pnl_usd) + d.pnl,
      wins: Number(acc.wins) + d.wins, losses: Number(acc.losses) + d.losses,
      updated_at: new Date().toISOString(),
    }).eq("id", accId);
    if (erroDoCredito) {
      recordEvent("paper_credito_nao_gravado", { meta: {
        account: accId, caixa: d.cash, pnl: d.pnl, wins: d.wins, losses: d.losses,
        erro: erroDoCredito.message.slice(0, 160),
        why: "as posicoes ja estao closed e este P&L NAO entrou no livro. Nada vai "
          + "tentar de novo: a expectancy desta mesa fica menor que a real.",
      } });
    }
  }
  return closed;
}

/** One paper-agent tick: resolve first (free cash), then open new positions. */
export async function runPaperAgent(): Promise<{ opened: number; closed: number }> {
  const closed = await resolvePaperPositions().catch(() => 0);
  const opened = await openPaperPositions().catch(() => 0);
  return { opened, closed };
}
