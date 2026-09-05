/**
 * CEX orderbook depth (public, no key) — the input to the F2 realism check.
 *
 * Returns { asks, bids } as [price,size] levels for a (venue, base) on the
 * BASE/USDT market. Best-effort: null on any failure so the arbiter's realism
 * pass never breaks the desk. Mirrors the venue set in cex-spot.ts.
 *
 * NOTE: the live fetch runs in PROD (Vercel reaches the CEXs). It was not
 * exercised from the pentest/dev sandbox, whose egress proxy blocks these
 * hosts — the depth-walking MATH is unit-tested (arb-realism.test.ts); this
 * adapter's shapes follow each exchange's documented depth endpoint.
 */
import type { Level } from "@/lib/zion/arb-realism";
import { KRAKEN_PAIR, type CexSpotSource } from "@/lib/api/cex-spot";

export interface Book { asks: Level[]; bids: Level[] }

const pair = (b: string) => b.toUpperCase();
const num = (x: unknown): number => (typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN);
const clean = (rows: unknown): Level[] =>
  Array.isArray(rows)
    ? rows.map((r) => (Array.isArray(r) ? [num(r[0]), num(r[1])] as Level : [NaN, NaN] as Level))
        .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0)
    : [];

/**
 * ⚠️⚠️ POR QUE ESTE ARQUIVO GANHOU UM SEGUNDO CAMINHO (01/09).
 *
 * `fetchOrderbook` devolvia `null` para TUDO: 429, 502, timeout, venue sem
 * adaptador e livro genuinamente vazio. Para o ARBITRADOR isso está certo e
 * continua — ele precisa falhar fechado, e "não sei" e "não dá" levam à mesma
 * decisão: não operar.
 *
 * Para o LABORATÓRIO é o oposto. O painel de descartadas classificava toda
 * rota sem livro como **CADÁVER** e o veredito concluía *"4 não tem livro. O
 * teto está barrando o que o livro barraria de qualquer forma"*. Em 31/08 isso
 * incluiu rotas da **kraken** — que não tinha branch aqui e devolvia `null`
 * **sem fazer uma única chamada de rede**. O comentário `// kraken not needed
 * for the arb venue set` ficou falso no dia em que `EXCLUDE_VENUES` passou a
 * tirar só coinbase e kucoin: a kraken segue na matriz viva e cobre 40 símbolos.
 *
 * Chamar de "cadáver" um livro que ninguém olhou é a família de defeito mais
 * cara desta casa — e aqui ela some numa contagem que vira veredito.
 */
export type MotivoSemLivro =
  /** A venue respondeu e o livro está vazio. É a ÚNICA que autoriza "cadáver". */
  | "vazio"
  /** HTTP não-ok: 429, 5xx. Não medimos. */
  | "http"
  /** Rede caiu ou timeout. Não medimos. */
  | "rede"
  /** Não existe adaptador para esta praça. Não medimos, e nem tentamos. */
  | "sem_adaptador";

export type LeituraDoLivro =
  | { ok: true; book: Book }
  | { ok: false; motivo: MotivoSemLivro; detalhe?: string };

async function j(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Como `j`, mas diz POR QUE falhou. */
async function jDetalhado(url: string): Promise<{ ok: true; data: unknown } | { ok: false; motivo: MotivoSemLivro; detalhe: string }> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch (e) {
    return { ok: false, motivo: "rede", detalhe: String(e).slice(0, 120) };
  }
  if (!res.ok) return { ok: false, motivo: "http", detalhe: `status ${res.status}` };
  try {
    return { ok: true, data: await res.json() };
  } catch (e) {
    return { ok: false, motivo: "rede", detalhe: `json inválido: ${String(e).slice(0, 90)}` };
  }
}

/** Fetch top-of-book depth for one venue+base. null on failure. */
export async function fetchOrderbook(venue: CexSpotSource, base: string, limit = 20): Promise<Book | null> {
  const s = pair(base);
  try {
    if (venue === "binance") {
      const d = await j(`https://data-api.binance.vision/api/v3/depth?symbol=${s}USDT&limit=${limit}`) as { asks?: unknown; bids?: unknown } | null;
      return d ? { asks: clean(d.asks), bids: clean(d.bids) } : null;
    }
    if (venue === "gateio") {
      const d = await j(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${s}_USDT&limit=${limit}`) as { asks?: unknown; bids?: unknown } | null;
      return d ? { asks: clean(d.asks), bids: clean(d.bids) } : null;
    }
    if (venue === "okx") {
      const d = await j(`https://www.okx.com/api/v5/market/books?instId=${s}-USDT&sz=${limit}`) as { data?: Array<{ asks?: unknown; bids?: unknown }> } | null;
      const b = d?.data?.[0];
      return b ? { asks: clean(b.asks), bids: clean(b.bids) } : null;
    }
    if (venue === "bybit") {
      const d = await j(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${s}USDT&limit=${limit}`) as { result?: { a?: unknown; b?: unknown } } | null;
      return d?.result ? { asks: clean(d.result.a), bids: clean(d.result.b) } : null;
    }
    if (venue === "mexc") {
      const d = await j(`https://api.mexc.com/api/v3/depth?symbol=${s}USDT&limit=${limit}`) as { asks?: unknown; bids?: unknown } | null;
      return d ? { asks: clean(d.asks), bids: clean(d.bids) } : null;
    }
    return null; // ver `fetchOrderbookDetalhado` — aqui `null` é "não deu", e basta
  } catch { return null; }
}

/**
 * O MESMO LIVRO, dizendo por que não veio.
 *
 * ⚠️ `fetchOrderbook` acima FICA COMO ESTÁ, de propósito: o arbitrador o usa no
 * caminho do dinheiro e precisa falhar fechado. Afrouxar aquele `null` para
 * caber este uso seria trocar a segurança da mesa pela clareza de um painel.
 */
export async function fetchOrderbookDetalhado(
  venue: CexSpotSource, base: string, limit = 20,
): Promise<LeituraDoLivro> {
  const s = pair(base);

  /** Fecha a leitura: livro sem nenhum nível dos dois lados é "vazio" de verdade. */
  const fechar = (asks: Level[], bids: Level[]): LeituraDoLivro =>
    asks.length > 0 && bids.length > 0
      ? { ok: true, book: { asks, bids } }
      : { ok: false, motivo: "vazio", detalhe: `asks=${asks.length} bids=${bids.length}` };

  if (venue === "binance") {
    const r = await jDetalhado(`https://data-api.binance.vision/api/v3/depth?symbol=${s}USDT&limit=${limit}`);
    if (!r.ok) return r;
    const d = r.data as { asks?: unknown; bids?: unknown };
    return fechar(clean(d?.asks), clean(d?.bids));
  }
  if (venue === "gateio") {
    const r = await jDetalhado(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${s}_USDT&limit=${limit}`);
    if (!r.ok) return r;
    const d = r.data as { asks?: unknown; bids?: unknown };
    return fechar(clean(d?.asks), clean(d?.bids));
  }
  if (venue === "okx") {
    const r = await jDetalhado(`https://www.okx.com/api/v5/market/books?instId=${s}-USDT&sz=${limit}`);
    if (!r.ok) return r;
    const b = (r.data as { data?: Array<{ asks?: unknown; bids?: unknown }> })?.data?.[0];
    return fechar(clean(b?.asks), clean(b?.bids));
  }
  if (venue === "bybit") {
    const r = await jDetalhado(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${s}USDT&limit=${limit}`);
    if (!r.ok) return r;
    const d = (r.data as { result?: { a?: unknown; b?: unknown } })?.result;
    return fechar(clean(d?.a), clean(d?.b));
  }
  if (venue === "mexc") {
    const r = await jDetalhado(`https://api.mexc.com/api/v3/depth?symbol=${s}USDT&limit=${limit}`);
    if (!r.ok) return r;
    const d = r.data as { asks?: unknown; bids?: unknown };
    return fechar(clean(d?.asks), clean(d?.bids));
  }

  /**
   * ⚠️ A KRAKEN, que era o buraco. Ela usa nomes próprios de par (XBT no lugar
   * de BTC), e sem o mapa a chamada devolveria erro para os majors — o que
   * viraria "http" e continuaria não sendo cadáver, mas mediria menos do que dá.
   */
  if (venue === "kraken") {
    const par = KRAKEN_PAIR[s];
    if (!par) return { ok: false, motivo: "sem_adaptador", detalhe: `kraken não tem par para ${s}` };
    const r = await jDetalhado(`https://api.kraken.com/0/public/Depth?pair=${par}&count=${limit}`);
    if (!r.ok) return r;
    const d = r.data as { error?: string[]; result?: Record<string, { asks?: unknown; bids?: unknown }> };
    if (d?.error?.length) return { ok: false, motivo: "http", detalhe: d.error.join(", ").slice(0, 120) };
    const primeiro = d?.result ? Object.values(d.result)[0] : undefined;
    // ⚠️ Os níveis da Kraken vêm [preço, volume, timestamp] — `clean` lê os dois
    //    primeiros e ignora o resto, que é exatamente o que precisamos.
    return fechar(clean(primeiro?.asks), clean(primeiro?.bids));
  }

  return { ok: false, motivo: "sem_adaptador", detalhe: `sem adaptador de livro para ${venue}` };
}
