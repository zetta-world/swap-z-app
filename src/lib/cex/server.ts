/**
 * Server-only CCXT wrapper. Builds a ccxt exchange instance per request,
 * uses it once, and discards. Credentials NEVER persist server-side —
 * they arrive in the request body (POST), get plugged into ccxt, and the
 * instance is garbage-collected after the response.
 *
 * IMPORTANT: never import this file from a client component. CCXT is ~3 MB
 * and ships with crypto deps that will explode the browser bundle.
 */

import ccxt, { type Exchange } from "ccxt";
import type {
  CexId, CexCredentials, CexBalance, CexOrderbookSnapshot,
} from "./types";

const EXCHANGE_CLASSES: Record<CexId, keyof typeof ccxt> = {
  binance:  "binance",
  coinbase: "coinbaseadvanced",
  okx:      "okx",
};

function instantiate(id: CexId, creds: CexCredentials): Exchange {
  const klass = EXCHANGE_CLASSES[id];
  // ccxt exposes each exchange as a top-level class on its default export
  const ExchangeClass = (ccxt as unknown as Record<string, new (cfg: Record<string, unknown>) => Exchange>)[klass];
  if (typeof ExchangeClass !== "function") {
    throw new Error(`Exchange '${id}' not available in ccxt build.`);
  }
  const config: Record<string, unknown> = {
    apiKey:    creds.apiKey,
    secret:    creds.apiSecret,
    enableRateLimit: true,
    timeout:   12_000,
  };
  if (id === "okx" && creds.passphrase) {
    config.password = creds.passphrase;
  }
  return new ExchangeClass(config);
}

/**
 * Fetch all balances for the exchange, with optional USD valuation via
 * the exchange's USDT or USD ticker for each asset. Best-effort —
 * unknown assets fall back to no USD value.
 */
export async function fetchCexBalance(
  id: CexId,
  creds: CexCredentials,
  withUsd = true,
): Promise<{ balances: CexBalance[]; totalUsd: number }> {
  const exchange = instantiate(id, creds);
  const raw = await exchange.fetchBalance();

  // ccxt normalizes to { ASSET: { free, used, total } }
  const balances: CexBalance[] = [];
  for (const [asset, val] of Object.entries(raw)) {
    if (typeof val !== "object" || val === null) continue;
    const v = val as { free?: number; used?: number; total?: number };
    if (typeof v.total !== "number" || v.total <= 0) continue;
    if (asset === "info" || asset === "free" || asset === "used" || asset === "total" || asset === "timestamp" || asset === "datetime") continue;
    balances.push({
      asset,
      free:  v.free  ?? 0,
      used:  v.used  ?? 0,
      total: v.total,
    });
  }

  let totalUsd = 0;
  if (withUsd && balances.length > 0) {
    // Pull all tickers at once if supported (single network call), otherwise
    // skip USD valuation rather than fan out one call per asset.
    if (exchange.has["fetchTickers"]) {
      try {
        const tickers = await exchange.fetchTickers();
        for (const b of balances) {
          if (b.asset === "USDT" || b.asset === "USDC" || b.asset === "USD" || b.asset === "BUSD" || b.asset === "DAI") {
            b.usdValue = b.total;
            totalUsd += b.total;
            continue;
          }
          // Try SYMBOL/USDT first, then SYMBOL/USD
          const candidates = [`${b.asset}/USDT`, `${b.asset}/USD`, `${b.asset}/USDC`];
          for (const sym of candidates) {
            const t = tickers[sym];
            if (t && typeof t.last === "number" && t.last > 0) {
              b.usdValue = b.total * t.last;
              totalUsd += b.usdValue;
              break;
            }
          }
        }
      } catch {
        // tickers unavailable — silently skip USD valuation
      }
    }
  }

  // Sort by USD value desc, then by raw amount
  balances.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0) || b.total - a.total);

  return { balances, totalUsd };
}

/**
 * Order-book snapshot for a symbol (CEX-native format, e.g. "BTC/USDT").
 */
export async function fetchCexOrderbook(
  id: CexId,
  creds: CexCredentials,
  symbol: string,
  depth = 10,
): Promise<Omit<CexOrderbookSnapshot, "ok" | "exchange" | "fetchedAt">> {
  const exchange = instantiate(id, creds);
  const ob = await exchange.fetchOrderBook(symbol, depth);
  const asks = (ob.asks || [])
    .slice(0, depth)
    .map(([p, a]) => ({ price: Number(p ?? 0), amount: Number(a ?? 0) }))
    .filter((row) => row.price > 0 && row.amount > 0);
  const bids = (ob.bids || [])
    .slice(0, depth)
    .map(([p, a]) => ({ price: Number(p ?? 0), amount: Number(a ?? 0) }))
    .filter((row) => row.price > 0 && row.amount > 0);
  const bestAsk = asks[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const mid     = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : Math.max(bestAsk, bestBid);
  return { symbol, bids, asks, mid, bestAsk, bestBid };
}
