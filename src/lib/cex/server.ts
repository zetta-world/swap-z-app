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
  CexOrderRequest, CexOrder, CexOrderSide, CexOrderType,
} from "./types";

const EXCHANGE_CLASSES: Record<CexId, keyof typeof ccxt> = {
  binance:  "binance",
  coinbase: "coinbaseadvanced",
  okx:      "okx",
  bybit:    "bybit",
  kraken:   "kraken",
  kucoin:   "kucoin",
  bitfinex: "bitfinex",
  mexc:     "mexc",
  gateio:   "gateio",
  htx:      "htx",
};

// Exchanges that take the trading passphrase as the `password` field on the
// ccxt config. The user supplies it as creds.passphrase in our schema.
const PASSPHRASE_EXCHANGES = new Set<CexId>(["okx", "kucoin"]);

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
    // Serverless cold starts on Vercel can be seconds off real wall-clock
    // time; without this Binance / Bybit / OKX reject signatures as "stale".
    // Forces ccxt to call /time once and offset every signed request.
    options: {
      adjustForTimeDifference: true,
      recvWindow: 60_000,
    },
  };
  if (PASSPHRASE_EXCHANGES.has(id) && creds.passphrase) {
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

// ─── Trading ────────────────────────────────────────────────────────────

// ccxt's Order type is intentionally loose (every exchange returns slightly
// different fields). We normalize down to our CexOrder schema.
function normalizeOrder(raw: Record<string, unknown>): CexOrder {
  const amount    = Number(raw.amount    ?? 0);
  const filled    = Number(raw.filled    ?? 0);
  const remaining = Number(raw.remaining ?? Math.max(0, amount - filled));
  const feeRaw    = raw.fee as { cost?: number; currency?: string } | undefined;
  return {
    id:         String(raw.id ?? ""),
    symbol:     String(raw.symbol ?? ""),
    side:       (raw.side as CexOrderSide) ?? "buy",
    type:       (raw.type as CexOrderType) ?? "market",
    status:     String(raw.status ?? "open"),
    amount,
    filled,
    remaining,
    price:      typeof raw.price   === "number" ? raw.price   : undefined,
    average:    typeof raw.average === "number" ? raw.average : undefined,
    cost:       typeof raw.cost    === "number" ? raw.cost    : undefined,
    fee:        feeRaw && typeof feeRaw.cost === "number"
                  ? { cost: feeRaw.cost, currency: String(feeRaw.currency ?? "") }
                  : undefined,
    timestamp:  typeof raw.timestamp === "number" ? raw.timestamp : undefined,
  };
}

/**
 * Place a single order. Market orders fill against the orderbook now;
 * limit orders sit at the book until matched or cancelled.
 *
 * REAL FUNDS MOVE WHEN THIS IS CALLED. The API route layer enforces a
 * "confirm" guard from the client side, but defense in depth — the v1
 * server is otherwise a thin pass-through to ccxt.createOrder.
 */
export async function placeCexOrder(
  id: CexId,
  creds: CexCredentials,
  req: CexOrderRequest,
): Promise<{ order: CexOrder; filledImmediately: boolean }> {
  if (req.amount <= 0 || !Number.isFinite(req.amount)) {
    throw new Error("Invalid amount.");
  }
  if (req.type === "limit" && (!req.price || !Number.isFinite(req.price) || req.price <= 0)) {
    throw new Error("Limit orders require a positive price.");
  }

  const exchange = instantiate(id, creds);
  const raw = await exchange.createOrder(
    req.symbol,
    req.type,
    req.side,
    req.amount,
    req.type === "limit" ? req.price : undefined,
  ) as unknown as Record<string, unknown>;

  const order = normalizeOrder(raw);

  // Market orders typically come back "closed" immediately on ccxt; if not,
  // we still treat any non-zero filled amount as immediate-fill for UX.
  const filledImmediately =
    order.status === "closed" ||
    (order.type === "market" && order.filled > 0 && order.remaining === 0);

  return { order, filledImmediately };
}

/** Cancel one specific order by exchange id + symbol. */
export async function cancelCexOrder(
  id: CexId,
  creds: CexCredentials,
  orderId: string,
  symbol: string,
): Promise<CexOrder> {
  const exchange = instantiate(id, creds);
  const raw = await exchange.cancelOrder(orderId, symbol) as unknown as Record<string, unknown>;
  return normalizeOrder(raw);
}

/** Open orders (optionally filtered by symbol). */
export async function listOpenCexOrders(
  id: CexId,
  creds: CexCredentials,
  symbol?: string,
): Promise<CexOrder[]> {
  const exchange = instantiate(id, creds);
  const raw = await exchange.fetchOpenOrders(symbol) as unknown as Record<string, unknown>[];
  return raw.map(normalizeOrder);
}
