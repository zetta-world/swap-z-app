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
import type { CexSpotSource } from "@/lib/api/cex-spot";

export interface Book { asks: Level[]; bids: Level[] }

const pair = (b: string) => b.toUpperCase();
const num = (x: unknown): number => (typeof x === "string" ? parseFloat(x) : typeof x === "number" ? x : NaN);
const clean = (rows: unknown): Level[] =>
  Array.isArray(rows)
    ? rows.map((r) => (Array.isArray(r) ? [num(r[0]), num(r[1])] as Level : [NaN, NaN] as Level))
        .filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0)
    : [];

async function j(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
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
    return null; // kraken/coinbase not needed for the arb venue set
  } catch { return null; }
}
