// GeckoTerminal API v2 — free, no key
// https://api.geckoterminal.com/docs/index.html

const NETWORK_IDS: Record<string, string> = {
  ethereum:  "eth",
  bsc:       "bsc",
  polygon:   "polygon_pos",
  base:      "base",
  arbitrum:  "arbitrum",
  optimism:  "optimism",
  avalanche: "avax",
  solana:    "solana",
};

interface GTRel<T = string> { data: { id: T; type: string } }
interface GTPoolAttrs {
  name?:                      string;
  address?:                   string;
  base_token_price_usd?:      string;
  quote_token_price_usd?:     string;
  reserve_in_usd?:            string;
  fdv_usd?:                   string;
  market_cap_usd?:            string;
  pool_created_at?:           string;
  price_change_percentage?:   { h1?: string; h24?: string };
  volume_usd?:                { h1?: string; h24?: string };
  transactions?:              { h24?: { buys?: number; sells?: number; buyers?: number; sellers?: number } };
}
interface GTPool {
  id:         string;
  type:       string;
  attributes: GTPoolAttrs;
  relationships?: {
    base_token?:  GTRel;
    quote_token?: GTRel;
    network?:     GTRel;
    dex?:         GTRel;
  };
}

export interface PoolSummary {
  id:         string;
  dex:        string;
  name:       string;
  network:    string;
  tvlUsd:     number;
  volume24h:  number;
  change24h:  number;
  priceUsd:   number;
  baseSymbol: string;
  quoteSymbol: string;
  address:    string;
  /** ISO 8601 string of pool creation timestamp (when available). */
  createdAt?: string;
  /** Unix ms of pool creation, derived from createdAt. Undefined when unknown. */
  createdAtMs?: number;
  /**
   * ⚠️⚠️ O ENDEREÇO DO TOKEN BASE — e a falta dele matou um agente por dez dias.
   *
   * O `pool_novo` do Celeiro montava o endereço do token fazendo
   * `id.split("_")[1]` sobre o id do POOL. Mas o id da GeckoTerminal é
   * `<rede>_<endereço do POOL>` — o token base não está ali. O resultado era
   * `tokenAddress === poolAddress` SEMPRE, e a GoPlus, perguntada sobre a
   * segurança de um contrato de pool, não devolvia nada. O agente reprovava
   * 100% dos candidatos com "pool não lido" e parecia estar trabalhando.
   *
   * O dado sempre esteve na resposta, em `relationships.base_token`. Só não
   * subia para cá. Ver `extrairEndereco`.
   */
  baseTokenAddress?: string;
}

/**
 * O endereço dentro de um id da GeckoTerminal (`<rede>_<endereço>`).
 *
 * ⚠️ CORTA NO ÚLTIMO `_`, NUNCA NO PRIMEIRO. Há redes com underscore no slug —
 * `arbitrum_nova` é a que existe hoje — e `split("_")[1]` devolveria `"nova"`
 * em vez do endereço. Endereço EVM não contém underscore, então o último
 * separador é sempre a fronteira certa.
 */
export function extrairEndereco(id: string | undefined | null): string {
  const t = (id ?? "").trim();
  const corte = t.lastIndexOf("_");
  return corte >= 0 ? t.slice(corte + 1) : t;
}

function attrNumber(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function poolToSummary(pool: GTPool, networkSlug: string): PoolSummary {
  const a = pool.attributes;
  const [base, quote] = (a.name ?? " / ").split(" / ");
  const dexId = pool.relationships?.dex?.data?.id ?? "—";
  const createdAt = a.pool_created_at;
  const createdAtMs = createdAt ? Date.parse(createdAt) : NaN;
  return {
    id:          pool.id,
    dex:         dexId.replace(/_/g, " "),
    name:        a.name ?? "",
    network:     networkSlug,
    tvlUsd:      attrNumber(a.reserve_in_usd),
    volume24h:   attrNumber(a.volume_usd?.h24),
    change24h:   attrNumber(a.price_change_percentage?.h24),
    priceUsd:    attrNumber(a.base_token_price_usd),
    baseSymbol:  base?.trim() ?? "",
    quoteSymbol: quote?.trim() ?? "",
    address:     a.address ?? "",
    createdAt,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined,
    // ⚠️ O token BASE, não o pool. Ver a nota em `PoolSummary.baseTokenAddress`.
    baseTokenAddress: extrairEndereco(pool.relationships?.base_token?.data?.id) || undefined,
  };
}

/**
 * ⚠️⚠️ FALHA DA FONTE NÃO É LISTA VAZIA — e neste arquivo era, em toda função.
 *
 * O padrão `if (!res.ok) return []` aparecia 20 vezes aqui. Uma rede sem pools e
 * a GeckoTerminal fora do ar produziam **exatamente o mesmo valor**, e /pools
 * mostrava "nenhuma pool encontrada" nos dois casos. O usuário selecionava
 * Polygon e concluía que Polygon não tem liquidez.
 *
 * ⚠️ E NÃO É HIPÓTESE — foi medido em produção em 30/08:
 *
 *     /api/pools?chain=polygon  ->  0 pools, HTTP 200, sem erro
 *     api.geckoterminal.com/.../polygon_pos/pools  ->  20 pools
 *     api.geckoterminal.com/.../optimism/pools     ->  429 "exceeded the Rate Limit"
 *
 * É a invariante nº 33 rodando em página pública: vazio-por-falha com a cara de
 * vazio-por-ausência. E piora com tráfego — o limite da GeckoTerminal é por IP,
 * e os IPs de saída da Vercel são compartilhados entre todos os projetos.
 *
 * ⚠️ SEM TELEMETRIA AQUI, DE PROPÓSITO. Este módulo é importado por nove
 * componentes `"use client"` — só como `import type`, que o build apaga. Trazer
 * `recordEvent` para cá criaria uma aresta de VALOR até `supabase/server`, que é
 * exatamente a cadeia que derrubou a produção em 25/08. Quem grava o evento é a
 * ROTA, que já é servidor.
 */
export type MotivoIndisponivel = "limite" | "erro" | "rede";

export class GeckoIndisponivel extends Error {
  constructor(readonly status: number, readonly motivo: MotivoIndisponivel) {
    super("geckoterminal indisponivel: " + motivo + " (status " + status + ")");
    this.name = "GeckoIndisponivel";
  }
}

/** `true` quando a falha é a fonte fora do ar, e não um defeito nosso. */
export function ehIndisponivel(e: unknown): e is GeckoIndisponivel {
  return e instanceof GeckoIndisponivel;
}

/**
 * O único ponto deste arquivo que fala com a rede.
 *
 * ⚠️ LANÇA em vez de devolver vazio. Quem quiser melhor-esforço escreve o
 * `try/catch` à vista — e aí a decisão de engolir a falha fica no chamador,
 * onde dá para ler, em vez de escondida aqui dentro.
 */
async function buscar<T>(url: string, revalidate: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate },
    });
  } catch {
    throw new GeckoIndisponivel(0, "rede");
  }
  // 429 é o caso que mais acontece e o que mais dói: sem chave, o limite é por
  // IP, e um vizinho de infraestrutura consome a nossa cota.
  if (res.status === 429) throw new GeckoIndisponivel(429, "limite");
  if (!res.ok) throw new GeckoIndisponivel(res.status, "erro");
  return await res.json() as T;
}

/**
 * Page through every pool on a chain. GeckoTerminal v2 paginates 20 pools
 * per page; we pass the page through and let the caller decide how deep to
 * go. Used by the catalog/search page in /explorer.
 */
export async function getPoolsPage(chainName: string, page: number): Promise<PoolSummary[]> {
  const network = NETWORK_IDS[chainName];
  if (!network) return [];
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools?page=${Math.max(1, Math.min(100, page))}&include=dex`;
  const data = await buscar<{ data: GTPool[] }>(url, 30);
  return (data.data ?? []).map((p) => poolToSummary(p, network));
}

/**
 * Search GeckoTerminal by token symbol or address. Returns matching pools
 * across all networks.
 */
export async function searchPools(query: string, limit = 30): Promise<PoolSummary[]> {
  const q = query.trim();
  if (!q) return [];
  const url = `https://api.geckoterminal.com/api/v2/search/pools?query=${encodeURIComponent(q)}&include=dex&page=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: GTPool[] };
    return (data.data ?? []).slice(0, limit).map((p) => {
      const networkId = p.relationships?.network?.data?.id ?? "";
      return poolToSummary(p, networkId);
    });
  } catch {
    return [];
  }
}

/**
 * ⚠️ O TTL VEM DE FORA (31/08) — é ele que decide o custo, e quem sabe o custo
 * é a rota, que conhece o tier de quem pediu.
 *
 * O cache de DADOS do Next é keyado pela URL **mais as opções do fetch**, então
 * a mesma URL com `revalidate` diferente vira entradas separadas. É isso que
 * permite três faixas de frescor sobre o mesmo endpoint sem uma servir dado da
 * outra — e é onde a economia de crédito realmente acontece, não no
 * `Cache-Control` da resposta.
 */
export async function getTopPools(chainName: string, limit = 8, ttlSegundos = 30): Promise<PoolSummary[]> {
  const network = NETWORK_IDS[chainName];
  if (!network) return [];

  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools?page=1&include=dex`;
  const data = await buscar<{ data: GTPool[] }>(url, ttlSegundos);
  return (data.data ?? []).slice(0, limit).map((p) => poolToSummary(p, network));
}

/**
 * New pools on a specific chain — GeckoTerminal returns these in
 * reverse-chronological order, fresh first. Used by the Live Feed in
 * /explorer to surface tokens that just hit the market.
 */
export async function getNewPoolsForChain(chainName: string, limit = 20): Promise<PoolSummary[]> {
  const network = NETWORK_IDS[chainName];
  if (!network) return [];
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1&include=dex`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      // Tighter cache: new pairs feed needs to feel live
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data: GTPool[] };
    return (data.data ?? []).slice(0, limit).map((p) => poolToSummary(p, network));
  } catch {
    return [];
  }
}

/**
 * New pools across every chain we know — paginates one call per chain in
 * parallel and merges. The Live Feed sorts the union by pool age desc.
 */
export async function getNewPoolsAcrossChains(perChain = 10): Promise<PoolSummary[]> {
  const chains = Object.keys(NETWORK_IDS);
  const results = await Promise.all(
    chains.map((c) => getNewPoolsForChain(c, perChain).catch(() => [] as PoolSummary[])),
  );
  return results.flat();
}

export async function getTrendingPools(limit = 12, ttlSegundos = 60): Promise<PoolSummary[]> {
  const url = `https://api.geckoterminal.com/api/v2/networks/trending_pools?page=1&include=dex`;
  const data = await buscar<{ data: GTPool[] }>(url, ttlSegundos);
  return (data.data ?? []).slice(0, limit).map((p) => {
    const networkId = p.relationships?.network?.data?.id ?? "";
    return poolToSummary(p, networkId);
  });
}

export interface TokenInfo {
  symbol?:    string;
  name?:      string;
  address:    string;
  priceUsd?:  number;
  mcapUsd?:   number;
  fdvUsd?:    number;
  volume24h?: number;
  holders?:   number;
  totalSupply?: number;
}

interface GTTokenAttrs {
  address?:         string;
  name?:            string;
  symbol?:          string;
  decimals?:        number;
  price_usd?:       string;
  fdv_usd?:         string;
  market_cap_usd?:  string;
  volume_usd?:      { h24?: string };
  total_supply?:    string;
}

export async function getTokenInfo(chainName: string, address: string): Promise<TokenInfo | null> {
  const network = NETWORK_IDS[chainName];
  if (!network || !address || address === "native") return null;
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address.toLowerCase()}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = await res.json() as { data?: { attributes: GTTokenAttrs } };
    const a = data.data?.attributes;
    if (!a) return null;
    return {
      address:    a.address ?? address,
      name:       a.name,
      symbol:     a.symbol,
      priceUsd:   attrNumber(a.price_usd),
      mcapUsd:    attrNumber(a.market_cap_usd),
      fdvUsd:     attrNumber(a.fdv_usd),
      volume24h:  attrNumber(a.volume_usd?.h24),
      totalSupply: attrNumber(a.total_supply),
    };
  } catch {
    return null;
  }
}

export function geckoNetworkId(chainName: string): string | undefined {
  return NETWORK_IDS[chainName];
}

// ─── Pool metadata (used to determine base/quote correctly) ──────────

export interface PoolMeta {
  address:           string;
  name:              string;
  dexId:             string;
  baseTokenSymbol:   string;
  baseTokenAddress:  string;
  quoteTokenSymbol:  string;
  quoteTokenAddress: string;
  priceUsd:          number;
  tvlUsd:            number;
  volume24h:         number;
  change24h:         number;

  /**
   * ⚠️⚠️ TUDO ABAIXO JÁ CHEGAVA NA MESMA RESPOSTA E ERA JOGADO FORA (31/08).
   *
   * `GTPoolAttrs` declara estes campos, o `fetch` os traz, o `JSON.parse` os
   * materializa — e o objeto de retorno os descartava. Zero requisição nova
   * para qualquer um deles.
   *
   * ⚠️ E O MAIS VALIOSO É O ÚLTIMO. `buyers`/`sellers` são carteiras ÚNICAS, não
   * número de trades: é a diferença entre mil carteiras comprando e uma
   * carteira comprando mil vezes. Nenhuma outra métrica do painel responde isso,
   * e ela vinha de graça desde sempre.
   *
   * ⚠️ `null` QUANDO A FONTE NÃO MANDOU, nunca zero. Zero em `holders` diria
   * "ninguém tem este token"; em `buyers`, "ninguém comprou". As duas são
   * afirmações fortes construídas sobre ausência.
   */
  marketCapUsd:  number | null;
  fdvUsd:        number | null;
  /** Quando a pool foi criada. Idade é sinal de risco de primeira ordem. */
  criadaEmMs:    number | null;
  change1h:      number | null;
  volume1h:      number | null;
  quotePriceUsd: number | null;
  /** Carteiras ÚNICAS em 24h — não é contagem de trades. */
  compradores24h: number | null;
  vendedores24h:  number | null;
  compras24h:     number | null;
  vendas24h:      number | null;
}

/** ⚠️ `null` para ausente; `attrNumber` devolveria 0 e 0 é uma afirmação. */
function numeroOuNulo(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

interface GTIncluded {
  id: string;
  type: string;
  attributes?: { symbol?: string; address?: string; name?: string };
}

export async function getPoolMeta(chainName: string, poolAddress: string): Promise<PoolMeta | null> {
  const network = NETWORK_IDS[chainName];
  if (!network || !poolAddress) return null;
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress.toLowerCase()}?include=base_token,quote_token,dex`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      data?: { id: string; attributes: GTPoolAttrs; relationships?: GTPool["relationships"] };
      included?: GTIncluded[];
    };
    const pool = data.data;
    if (!pool) return null;
    const a = pool.attributes;
    const inc = data.included ?? [];

    const baseId  = pool.relationships?.base_token?.data?.id;
    const quoteId = pool.relationships?.quote_token?.data?.id;
    const dexId   = pool.relationships?.dex?.data?.id ?? "—";

    const baseTok  = inc.find((x) => x.type === "token" && x.id === baseId);
    const quoteTok = inc.find((x) => x.type === "token" && x.id === quoteId);

    return {
      address:           a.address ?? poolAddress,
      name:              a.name ?? "",
      dexId,
      baseTokenSymbol:   baseTok?.attributes?.symbol  ?? "?",
      baseTokenAddress:  baseTok?.attributes?.address ?? "",
      quoteTokenSymbol:  quoteTok?.attributes?.symbol ?? "?",
      quoteTokenAddress: quoteTok?.attributes?.address ?? "",
      priceUsd:          attrNumber(a.base_token_price_usd),
      tvlUsd:            attrNumber(a.reserve_in_usd),
      volume24h:         attrNumber(a.volume_usd?.h24),
      change24h:         attrNumber(a.price_change_percentage?.h24),

      // ⚠️ Campos que já chegavam e eram descartados. Ver a nota em `PoolMeta`.
      marketCapUsd:   numeroOuNulo(a.market_cap_usd),
      fdvUsd:         numeroOuNulo(a.fdv_usd),
      criadaEmMs:     a.pool_created_at ? (Number.isFinite(Date.parse(a.pool_created_at)) ? Date.parse(a.pool_created_at) : null) : null,
      change1h:       numeroOuNulo(a.price_change_percentage?.h1),
      volume1h:       numeroOuNulo(a.volume_usd?.h1),
      quotePriceUsd:  numeroOuNulo(a.quote_token_price_usd),
      compradores24h: numeroOuNulo(a.transactions?.h24?.buyers),
      vendedores24h:  numeroOuNulo(a.transactions?.h24?.sellers),
      compras24h:     numeroOuNulo(a.transactions?.h24?.buys),
      vendas24h:      numeroOuNulo(a.transactions?.h24?.sells),
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a token's most-liquid pool (E1) so we can pull its OHLCV for DEX
 * technical analysis. Returns the pool address and whether the token is the
 * pool's BASE side (which `getOHLCV(token:)` needs to chart the right price).
 */
export async function getTokenTopPool(
  chainName: string,
  tokenAddress: string,
): Promise<{ address: string; tokenIsBase: boolean } | null> {
  const network = NETWORK_IDS[chainName];
  if (!network || !tokenAddress || tokenAddress === "native") return null;
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress.toLowerCase()}/pools?include=base_token&page=1`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const data = await res.json() as {
      data?: Array<{ attributes?: { address?: string }; relationships?: { base_token?: { data?: { id?: string } } } }>;
      included?: GTIncluded[];
    };
    const pool = data.data?.[0];           // highest-liquidity pool first
    const addr = pool?.attributes?.address;
    if (!addr) return null;
    const baseId   = pool?.relationships?.base_token?.data?.id;
    const baseTok  = (data.included ?? []).find((x) => x.id === baseId);
    const baseAddr = baseTok?.attributes?.address?.toLowerCase() ?? "";
    return { address: addr, tokenIsBase: baseAddr === tokenAddress.toLowerCase() };
  } catch {
    return null;
  }
}

// ─── OHLCV (chart candles) ───────────────────────────────────────────

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
export type PriceToken = "base" | "quote";

const TF_MAP: Record<Timeframe, { timeframe: string; aggregate: number }> = {
  "1m":  { timeframe: "minute", aggregate: 1  },
  "5m":  { timeframe: "minute", aggregate: 5  },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h":  { timeframe: "hour",   aggregate: 1  },
  "4h":  { timeframe: "hour",   aggregate: 4  },
  "1d":  { timeframe: "day",    aggregate: 1  },
};

export interface Candle {
  time:   number;   // unix seconds
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

/**
 * Fetch OHLCV candles for a specific pool from GeckoTerminal.
 *
 * `token` selects which side of the pool's price we want:
 *   - "base"  (default) → price of the pool's base_token in USD
 *   - "quote"           → price of the pool's quote_token in USD
 *
 * Caller is responsible for picking the side that matches the symbol the
 * user expects to see on the chart (e.g. for BNB/USDT on a pool where
 * USDT is base, pass token: "quote" to chart BNB).
 */
export async function getOHLCV(
  chainName: string,
  poolAddress: string,
  tf: Timeframe,
  limit = 200,
  token: PriceToken = "base",
): Promise<Candle[]> {
  const network = NETWORK_IDS[chainName];
  if (!network || !poolAddress) return [];
  const cfg = TF_MAP[tf];
  if (!cfg) return [];

  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress.toLowerCase()}/ohlcv/${cfg.timeframe}?aggregate=${cfg.aggregate}&limit=${Math.min(limit, 1000)}&currency=usd&token=${token}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 30 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const rows = data.data?.attributes?.ohlcv_list ?? [];
    return rows
      .map((r) => ({
        time:   Math.floor(r[0]),
        open:   Number(r[1]),
        high:   Number(r[2]),
        low:    Number(r[3]),
        close:  Number(r[4]),
        volume: Number(r[5] ?? 0),
      }))
      .filter((c) => Number.isFinite(c.open) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

// ─── Recent trades on a pool ─────────────────────────────────────────

export interface Trade {
  ts:        number;     // unix seconds
  kind:      "buy" | "sell";
  priceUsd:  number;
  amountIn:  number;
  amountOut: number;
  txHash:    string;
  /** Wallet that signed the trade (lowercased hex). Exposed for whale
   *  highlighting + explorer links. Empty if upstream didn't include it. */
  trader:    string;
  /** Trade size in USD as reported by GeckoTerminal — preferred over
   *  recomputing from amounts × priceUsd because the upstream value is
   *  already routed through the right token side. */
  sizeUsd:   number;
}

interface GTTradeAttrs {
  block_number?:               number;
  block_timestamp?:             string;
  tx_hash?:                    string;
  tx_from_address?:             string;
  from_token_amount?:            string;
  to_token_amount?:              string;
  price_to_in_currency_token?:  string;
  price_from_in_currency_token?: string;
  price_from_in_usd?:           string;
  price_to_in_usd?:             string;
  kind?:                       string;        // "buy" | "sell"
  volume_in_usd?:               string;
}

/**
 * ⚠️⚠️ O PREÇO DA TRADE ERA O DO TOKEN QUE POR ACASO ESTAVA SAINDO (31/08).
 *
 * A linha era `price_from_in_usd ?? price_to_in_usd` — sempre a ponta FROM do
 * swap, que muda de token conforme a direção. No mesmo feed do WBNB/USDT o
 * dono viu, lado a lado:
 *
 *     SELL  $6   0.9998     ← preço do USDT
 *     BUY   $34  687.59     ← preço do WBNB
 *
 * Duas escalas na mesma coluna, e nenhuma etiqueta dizendo qual era qual. Uma
 * coluna de preço que troca de unidade por linha não é uma coluna de preço.
 *
 * `lado` diz qual ponta do par a tela está cotando — o MESMO `base`/`quote` que
 * o gráfico já usa para não desenhar $1 no lugar de $700. Sem ele, o padrão
 * segue o comportamento antigo, porque quem não passa o lado não tem como
 * saber qual está certo.
 */
export async function getRecentTrades(
  chainName: string,
  poolAddress: string,
  limit = 25,
  lado?: PriceToken,
): Promise<Trade[]> {
  const network = NETWORK_IDS[chainName];
  if (!network || !poolAddress) return [];
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${poolAddress.toLowerCase()}/trades?trade_volume_in_usd_greater_than=0`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json;version=20230302" },
      next: { revalidate: 15 },
    });
    if (!res.ok) return [];
    const data = await res.json() as { data?: { attributes: GTTradeAttrs }[] };
    return (data.data ?? []).slice(0, limit).map((t) => {
      const a = t.attributes;
      const ts = a.block_timestamp ? Math.floor(new Date(a.block_timestamp).getTime() / 1000) : 0;
      const isBuy = (a.kind ?? "").toLowerCase() === "buy";
      /**
       * ⚠️ NA GECKOTERMINAL, `from` É O TOKEN QUE SAI DA CARTEIRA. Numa COMPRA
       * do base, sai o quote; numa VENDA, sai o base. Então a ponta que carrega
       * o preço do BASE inverte com a direção — e é isso que a linha abaixo
       * desfaz, para a coluna ter uma unidade só.
       */
      const doBase = isBuy ? a.price_to_in_usd : a.price_from_in_usd;
      const doQuote = isBuy ? a.price_from_in_usd : a.price_to_in_usd;
      const escolhido = lado === "quote" ? doQuote : lado === "base" ? doBase : (a.price_from_in_usd ?? a.price_to_in_usd);
      return {
        ts,
        kind:      isBuy ? "buy" as const : "sell" as const,
        priceUsd:  Number(escolhido ?? 0),
        amountIn:  Number(a.from_token_amount ?? 0),
        amountOut: Number(a.to_token_amount   ?? 0),
        txHash:    a.tx_hash ?? "",
        trader:    (a.tx_from_address ?? "").toLowerCase(),
        sizeUsd:   Number(a.volume_in_usd ?? 0),
      };
    }).filter((t) => t.ts > 0);
  } catch {
    return [];
  }
}
