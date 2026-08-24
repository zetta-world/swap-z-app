/**
 * RADAR DE DEPENDÊNCIAS EXTERNAS — o que o código não consegue apontar.
 *
 * A LIÇÃO QUE ORIGINOU ESTE ARQUIVO (29/07):
 *
 * A Jupiter desligou `quote-api.jup.ag`. O nosso código continuou perfeito:
 * bem tipado, com tratamento de erro, revisado. E TODO swap de Solana estava
 * quebrado — em silêncio, por dias.
 *
 * Nenhuma auditoria de código acharia isso, porque não é um defeito de código.
 * É uma falha de LIVENESS: um terceiro apagou um servidor, e essa informação
 * não existe no repositório. Só se descobre DISCANDO O NÚMERO.
 *
 * O painel de saúde da plataforma monitorava os cérebros de IA — Anthropic,
 * DeepSeek, Kimi — com ping e latência. E não monitorava NADA do caminho do
 * dinheiro. Ou seja: sabia-se em minutos se o Kimi caísse, mas o agregador que
 * executa os swaps podia estar morto por semanas. Monitorava-se o que PENSA,
 * não o que PAGA.
 *
 * Este módulo fecha esse buraco. Cada dependência declara:
 *   · como saber se está viva (uma chamada barata e real, não um ping de DNS),
 *   · e sobretudo O QUE QUEBRA quando ela cai.
 *
 * O "o que quebra" é o campo mais importante. "GeckoTerminal: down" não diz
 * nada às 3 da manhã; "GeckoTerminal down → FREYJA para de operar e os gráficos
 * de DEX ficam vazios" diz tudo.
 */

export type DepImpact = "critical" | "degraded" | "cosmetic";

export interface ExternalDep {
  id: string;
  name: string;
  /** O que essa dependência serve na plataforma. */
  purpose: string;
  /** O que PARA de funcionar quando ela cai — o campo acionável. */
  breaks: string;
  impact: DepImpact;
  /** Chamada barata que prova vida de verdade. */
  probe: () => Promise<Response>;
}

export interface DepStatus {
  id: string; name: string; purpose: string; breaks: string; impact: DepImpact;
  ok: boolean;
  latencyMs: number | null;
  /** Diagnóstico legível: status HTTP, ou a causa raiz da falha de conexão. */
  note?: string;
  /** HTTP 451 — o fornecedor recusa o IP da região onde o app roda.
   *
   *  Isto NÃO é incidente: é uma condição PERMANENTE da infraestrutura (a
   *  Binance bloqueia IP de datacenter americano, e a Vercel roda nos EUA).
   *  Tratar como queda faria o painel ficar amarelo para sempre — e um alarme
   *  que nunca apaga treina o operador a ignorar todos os outros. */
  geoBlocked?: boolean;
}

const TIMEOUT_MS = 6000;

/** Fetch com timeout e SEM cache — um health check que lê cache mente. */
function probe(url: string, init?: RequestInit): () => Promise<Response> {
  return async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
    } finally { clearTimeout(t); }
  };
}

// ── A frota de dependências ───────────────────────────────────────────────
//
// Cada `probe` é uma chamada REAL e barata (cotação mínima, ticker, um candle).
// Um HEAD na home não serve: o host pode estar de pé e a API morta.

export const EXTERNAL_DEPS: ExternalDep[] = [
  {
    id: "jupiter", name: "Jupiter (Solana)",
    purpose: "cotação e montagem de transação para todo swap em Solana",
    breaks: "TODO swap de Solana para. Foi exatamente o que aconteceu em 29/07 sem ninguém ver.",
    impact: "critical",
    probe: probe(
      `${process.env.JUPITER_BASE_URL ?? "https://lite-api.jup.ag/swap/v1"}` +
      "/quote?inputMint=So11111111111111111111111111111111111111112" +
      "&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=10000000&slippageBps=50",
    ),
  },
  {
    id: "zerox", name: "0x (EVM)",
    purpose: "rota e calldata dos swaps em redes EVM",
    breaks: "swaps EVM perdem a rota 0x (LiFi ainda cobre parte, com preço pior)",
    impact: "critical",
    probe: probe(
      "https://api.0x.org/swap/allowance-holder/price?chainId=1" +
      "&sellToken=0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
      "&buyToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&sellAmount=1000000",
      { headers: { "0x-api-key": process.env.ZEROX_API_KEY ?? "", "0x-version": "v2" } },
    ),
  },
  {
    id: "lifi", name: "LiFi (cross-chain)",
    purpose: "rotas entre redes diferentes",
    breaks: "swap cross-chain para; swaps EVM na mesma rede seguem pelo 0x",
    impact: "critical",
    probe: probe("https://li.quest/v1/chains"),
  },
  {
    id: "geckoterminal", name: "GeckoTerminal (DEX)",
    purpose: "pools, preços e candles on-chain",
    breaks: "FREYJA e ULLR param de operar; catálogo de pools e gráficos DEX ficam vazios",
    impact: "critical",
    probe: probe("https://api.geckoterminal.com/api/v2/networks?page=1",
      { headers: { Accept: "application/json;version=20230302" } }),
  },
  {
    id: "binance_spot", name: "Binance (dados de mercado)",
    purpose: "candles e livro de ofertas que alimentam TODOS os indicadores",
    breaks: "o flywheel inteiro fica cego: sem RSI/MACD/ATR/ADX, nenhuma mesa emite plano",
    impact: "critical",
    probe: probe("https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1"),
  },
  {
    id: "gateio", name: "Gate.io (paper)",
    purpose: "preço de preenchimento e fechamento das posições simuladas",
    breaks: "as carteiras de USDT congelam — nada abre nem fecha, e o experimento para de medir",
    impact: "degraded",
    probe: probe("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT"),
  },
  {
    id: "binance_futures", name: "Binance Futuros",
    purpose: "funding e open interest",
    breaks: "JÖRMUNGANDR perde o sinal de funding; o score de confiança fica mais fraco",
    impact: "degraded",
  // Sem espelho geo-livre para futuros: de regiões bloqueadas devolve 451, e
  // isso é informação legítima ("indisponível DAQUI"), não um falso alarme.
    probe: probe("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT"),
  },
  {
    id: "feargreed", name: "Fear & Greed",
    purpose: "índice de sentimento de mercado",
    breaks: "só o componente de sentimento do score some; nenhuma mesa para",
    impact: "cosmetic",
    probe: probe("https://api.alternative.me/fng/?limit=1"),
  },
];

/**
 * Classifica a falha. A distinção que importa:
 *
 *   · erro de CONEXÃO (host morto, DNS, timeout) → o endpoint pode ter sido
 *     desligado. Foi este caso que passou despercebido, porque o fetch do Node
 *     só diz "fetch failed", sem host nem causa.
 *   · erro de STATUS (4xx/5xx) → o host existe e respondeu; é chave, cota,
 *     geobloqueio ou instabilidade do fornecedor.
 */
function describeError(e: unknown): string {
  const cause = (e as { cause?: { code?: string } })?.cause?.code;
  if (cause === "ENOTFOUND") return "host não existe (DNS) — endpoint desligado?";
  if (cause === "ECONNREFUSED") return "conexão recusada";
  if (cause === "ETIMEDOUT" || (e as Error)?.name === "AbortError") return `sem resposta em ${TIMEOUT_MS / 1000}s`;
  if (cause) return `falha de conexão [${cause}]`;
  return (e as Error)?.message?.slice(0, 120) ?? "falha de conexão";
}

async function checkOne(dep: ExternalDep): Promise<DepStatus> {
  const base = { id: dep.id, name: dep.name, purpose: dep.purpose, breaks: dep.breaks, impact: dep.impact };
  const start = Date.now();
  try {
    const res = await dep.probe();
    const latencyMs = Date.now() - start;
    if (res.ok) return { ...base, ok: true, latencyMs };
    // 429 é instabilidade momentânea, não morte — vale distinguir para não
    // acordar ninguém por um rate limit passageiro.
    if (res.status === 451) {
      return { ...base, ok: false, geoBlocked: true, latencyMs,
        note: "bloqueio geográfico (451) — permanente para a região do deploy, não é queda" };
    }
    const note =
      res.status === 429 ? "rate limit (429) — momentâneo"
      : res.status === 401 || res.status === 403 ? `autenticação recusada (${res.status}) — chave ou cota`
      : `HTTP ${res.status}`;
    return { ...base, ok: false, latencyMs, note };
  } catch (e) {
    return { ...base, ok: false, latencyMs: null, note: describeError(e) };
  }
}

/** Checa todas em paralelo. Nunca lança — um health check que derruba a página
 *  que deveria monitorar é pior que não ter health check. */
export async function checkExternalDeps(): Promise<DepStatus[]> {
  return Promise.all(EXTERNAL_DEPS.map((d) => checkOne(d).catch((): DepStatus => ({
    id: d.id, name: d.name, purpose: d.purpose, breaks: d.breaks, impact: d.impact,
    ok: false, latencyMs: null, note: "falha ao checar",
  }))));
}

/** Resumo pronto para alerta: só o que realmente merece acordar alguém. */
export function summarizeDeps(deps: DepStatus[]): {
  criticalDown: DepStatus[]; degradedDown: DepStatus[]; geoBlocked: DepStatus[]; verdict: string;
} {
  // Geobloqueio sai da conta de incidente: é condição fixa da região, não
  // evento. Continua VISÍVEL (o operador precisa saber que aquele sinal não
  // chega), mas não pinta o painel nem dispara alerta.
  const geoBlocked = deps.filter((d) => d.geoBlocked);
  const down = deps.filter((d) => !d.ok && !d.geoBlocked);
  const criticalDown = down.filter((d) => d.impact === "critical");
  const degradedDown = down.filter((d) => d.impact === "degraded");
  const geoNote = geoBlocked.length > 0 ? ` (${geoBlocked.map((d) => d.name).join(", ")}: bloqueio regional permanente)` : "";
  const verdict =
    criticalDown.length > 0
      ? `🔴 ${criticalDown.length} dependência(s) CRÍTICA(s) fora: ${criticalDown.map((d) => d.name).join(", ")}`
      : degradedDown.length > 0
        ? `🟡 degradado — ${degradedDown.map((d) => d.name).join(", ")}`
        : `🟢 todas as dependências externas respondendo${geoNote}`;
  return { criticalDown, degradedDown, geoBlocked, verdict };
}
