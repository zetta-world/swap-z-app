import https from "node:https";
import fs from "node:fs";
import { URL } from "node:url";

const port = Number(process.env.PORT || 443);
const cert = fs.readFileSync(process.env.FAKE_BINANCE_TLS_CERT_FILE || "/run/secrets/fake_binance_tls_cert");
const key = fs.readFileSync(process.env.FAKE_BINANCE_TLS_KEY_FILE || "/run/secrets/fake_binance_tls_key");

const fixedNow = 1_800_000_000_000;
let orderCounter = 20_000;
let submitCount = 0;
let faultMode = "normal";
let lastFault = null;
let runId = null;
let recoveryReadsBlocked = false;
let blockedReadCount = 0;
let successfulRecoveryReads = 0;
const ordersById = new Map();
const ordersByClient = new Map();

const symbols = [
  { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", price: 60000 },
  { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", price: 3000 },
];

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
  });
  res.end(data);
}

function exchangeInfo() {
  return {
    timezone: "UTC", serverTime: fixedNow, rateLimits: [], exchangeFilters: [],
    symbols: symbols.map((s) => ({
      symbol: s.symbol, status: "TRADING", baseAsset: s.baseAsset,
      baseAssetPrecision: 8, quoteAsset: s.quoteAsset, quotePrecision: 8,
      quoteAssetPrecision: 8, orderTypes: ["LIMIT", "MARKET"],
      icebergAllowed: false, ocoAllowed: true, otoAllowed: false,
      quoteOrderQtyMarketAllowed: true, allowTrailingStop: false,
      cancelReplaceAllowed: true, isSpotTradingAllowed: true,
      isMarginTradingAllowed: false,
      filters: [
        { filterType: "PRICE_FILTER", minPrice: "0.01", maxPrice: "1000000", tickSize: "0.01" },
        { filterType: "LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
        { filterType: "MARKET_LOT_SIZE", minQty: "0.00001", maxQty: "1000", stepSize: "0.00001" },
        { filterType: "MIN_NOTIONAL", minNotional: "5", applyToMarket: true, avgPriceMins: 0 },
      ],
      permissions: ["SPOT"], permissionSets: [["SPOT"]],
      defaultSelfTradePreventionMode: "NONE",
      allowedSelfTradePreventionModes: ["NONE"],
    })),
  };
}

function normalizedOrder(order) {
  return order;
}

function tradeFor(order) {
  const qty = Number(order.executedQty);
  if (!(qty > 0)) return null;
  const price = order.symbol === "ETHUSDT" ? 3000 : 60000;
  return {
    symbol: order.symbol,
    id: Number(order.orderId) + 100000,
    orderId: order.orderId,
    orderListId: -1,
    price: String(price),
    qty: String(qty),
    quoteQty: String(qty * price),
    commission: "0.00000001",
    commissionAsset: order.symbol.startsWith("ETH") ? "ETH" : "BTC",
    time: fixedNow,
    isBuyer: order.side === "BUY",
    isMaker: false,
    isBestMatch: true,
  };
}

function setFault(mode, nextRunId) {
  if (!["normal", "accept_then_hang", "accept_then_truncate",
    "accept_then_truncate_block_reconcile"].includes(mode)) {
    return false;
  }
  faultMode = mode;
  submitCount = 0;
  lastFault = null;
  runId = nextRunId || null;
  recoveryReadsBlocked = false;
  blockedReadCount = 0;
  successfulRecoveryReads = 0;
  ordersById.clear();
  ordersByClient.clear();
  return true;
}

function reconciliationRead(path, method) {
  return method === "GET" && (
    path.endsWith("/order")
    || path.endsWith("/allOrders")
    || path.endsWith("/openOrders")
    || path.endsWith("/myTrades")
  );
}

const server = https.createServer({ key, cert }, async (req, res) => {
  const u = new URL(req.url || "/", "https://fake-binance.local");
  const path = u.pathname;

  if (path === "/healthz") return json(res, 200, { ok: true, venue: "fake-binance-chaos", deterministic: true });
  if (path === "/__control/state" && req.method === "GET") {
    return json(res, 200, {
      ok: true, faultMode, submitCount, lastFault, runId,
      recoveryReadsBlocked, blockedReadCount, successfulRecoveryReads,
      orders: [...ordersById.values()].map((o) => ({
        orderId: o.orderId, clientOrderId: o.clientOrderId, status: o.status,
      })),
    });
  }
  if (path === "/__control/reset" && req.method === "POST") {
    const mode = u.searchParams.get("mode") || "normal";
    const nextRunId = u.searchParams.get("runId");
    return setFault(mode, nextRunId)
      ? json(res, 200, { ok: true, faultMode, runId })
      : json(res, 400, { ok: false, error: "invalid_fault_mode" });
  }
  if (path === "/__control/release-recovery" && req.method === "POST") {
    const requestedRunId = u.searchParams.get("runId");
    if (!runId || requestedRunId !== runId) {
      return json(res, 409, { ok: false, error: "run_id_mismatch" });
    }
    if (!recoveryReadsBlocked || blockedReadCount < 1) {
      return json(res, 409, { ok: false, error: "inline_reconciliation_not_observed" });
    }
    recoveryReadsBlocked = false;
    return json(res, 200, { ok: true, runId, blockedReadCount });
  }

  if (reconciliationRead(path, req.method)) {
    if (recoveryReadsBlocked) {
      blockedReadCount += 1;
      return json(res, 503, {
        code: -1007,
        msg: "Synthetic timeout: inline reconciliation is blocked until explicit release",
      });
    }
    if (lastFault === "accept_then_truncate_block_reconcile") {
      successfulRecoveryReads += 1;
    }
  }

  if (path.endsWith("/time")) return json(res, 200, { serverTime: fixedNow });
  if (path.endsWith("/exchangeInfo")) return json(res, 200, exchangeInfo());
  if (path.endsWith("/margin/allPairs")) return json(res, 200, []);
  if (path.endsWith("/margin/isolated/allPairs")) return json(res, 200, { rows: [], total: 0 });
  if (path.endsWith("/account")) {
    return json(res, 200, {
      makerCommission: 10, takerCommission: 10, buyerCommission: 0,
      sellerCommission: 0, canTrade: true, canWithdraw: false, canDeposit: false,
      updateTime: fixedNow, accountType: "SPOT",
      balances: [
        { asset: "USDT", free: "10000.00000000", locked: "0.00000000" },
        { asset: "BTC", free: "0.50000000", locked: "0.00000000" },
        { asset: "ETH", free: "2.00000000", locked: "0.00000000" },
      ],
      permissions: ["SPOT"],
    });
  }
  if (path.endsWith("/account/apiRestrictions")) {
    return json(res, 200, {
      ipRestrict: true, createTime: fixedNow, enableReading: true,
      enableSpotAndMarginTrading: true, enableWithdrawals: false,
      enableInternalTransfer: false, permitsUniversalTransfer: false,
    });
  }
  if (path.endsWith("/ticker/price")) {
    const symbol = u.searchParams.get("symbol");
    if (symbol) {
      const found = symbols.find((s) => s.symbol === symbol);
      return found ? json(res, 200, { symbol, price: String(found.price) })
        : json(res, 400, { code: -1121, msg: "Invalid symbol." });
    }
    return json(res, 200, symbols.map((s) => ({ symbol: s.symbol, price: String(s.price) })));
  }
  if (path.endsWith("/ticker/bookTicker")) {
    return json(res, 200, symbols.map((s) => ({
      symbol: s.symbol, bidPrice: String(s.price - 10), bidQty: "1.00000000",
      askPrice: String(s.price + 10), askQty: "1.00000000",
    })));
  }
  if (path.endsWith("/depth")) {
    const symbol = u.searchParams.get("symbol") || "BTCUSDT";
    const found = symbols.find((s) => s.symbol === symbol) || symbols[0];
    return json(res, 200, {
      lastUpdateId: 1,
      bids: [[String(found.price - 10), "1.00000000"]],
      asks: [[String(found.price + 10), "1.00000000"]],
    });
  }
  if (path.endsWith("/openOrders")) {
    return json(res, 200, [...ordersById.values()].filter((o) => o.status === "NEW"));
  }
  if (path.endsWith("/allOrders")) {
    const symbol = u.searchParams.get("symbol");
    return json(res, 200, [...ordersById.values()].filter((o) => !symbol || o.symbol === symbol));
  }
  if (path.endsWith("/myTrades")) {
    const symbol = u.searchParams.get("symbol");
    const trades = [...ordersById.values()]
      .filter((o) => (!symbol || o.symbol === symbol) && Number(o.executedQty) > 0)
      .map(tradeFor).filter(Boolean);
    return json(res, 200, trades);
  }
  if (path.endsWith("/order") && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyParams = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
    const value = (name) => bodyParams.get(name) ?? u.searchParams.get(name);
    const symbol = value("symbol") || "BTCUSDT";
    const side = value("side") || "BUY";
    const type = value("type") || "MARKET";
    const quantity = value("quantity") || "0.001";
    const clientOrderId = value("newClientOrderId") || `fake-${orderCounter}`;
    const price = symbols.find((s) => s.symbol === symbol)?.price || 60000;
    const order = normalizedOrder({
      symbol, orderId: orderCounter++, orderListId: -1, clientOrderId,
      transactTime: fixedNow, updateTime: fixedNow,
      price: value("price") || "0.00000000",
      origQty: quantity, executedQty: type === "MARKET" ? quantity : "0.00000000",
      cummulativeQuoteQty: type === "MARKET" ? String(Number(quantity) * price) : "0.00000000",
      status: type === "MARKET" ? "FILLED" : "NEW",
      timeInForce: value("timeInForce") || "GTC", type, side,
      workingTime: fixedNow,
      fills: type === "MARKET" ? [{ price: String(price), qty: quantity,
        commission: "0.00000001", commissionAsset: symbol.startsWith("ETH") ? "ETH" : "BTC", tradeId: 1 }] : [],
      selfTradePreventionMode: "NONE",
    });
    ordersById.set(String(order.orderId), order);
    ordersByClient.set(order.clientOrderId, order);
    submitCount += 1;

    const appliedFault = faultMode;
    faultMode = "normal";
    lastFault = appliedFault;
    if (appliedFault === "accept_then_truncate_block_reconcile") {
      recoveryReadsBlocked = true;
    }
    if (appliedFault === "accept_then_hang") {
      console.log(JSON.stringify({ event: "accepted_then_hang", submitCount, orderId: order.orderId }));
      req.on("close", () => res.destroy());
      return;
    }
    if (appliedFault === "accept_then_truncate"
        || appliedFault === "accept_then_truncate_block_reconcile") {
      const data = JSON.stringify(order);
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
        "cache-control": "no-store",
      });
      const partial = data.slice(0, Math.max(1, Math.floor(data.length / 3)));
      console.log(JSON.stringify({
        event: "accepted_then_truncate", submitCount, orderId: order.orderId,
        recoveryReadsBlocked,
      }));
      res.write(partial, () => res.socket?.destroy());
      return;
    }
    return json(res, 200, order);
  }
  if (path.endsWith("/order") && req.method === "GET") {
    const id = u.searchParams.get("orderId");
    const client = u.searchParams.get("origClientOrderId") || u.searchParams.get("clientOrderId");
    const found = id ? ordersById.get(id) : client ? ordersByClient.get(client) : undefined;
    return found ? json(res, 200, found)
      : json(res, 400, { code: -2013, msg: "Order does not exist." });
  }
  if (path.endsWith("/order") && req.method === "DELETE") {
    const id = u.searchParams.get("orderId");
    const client = u.searchParams.get("origClientOrderId") || u.searchParams.get("clientOrderId");
    const found = id ? ordersById.get(id) : client ? ordersByClient.get(client) : undefined;
    if (!found) return json(res, 400, { code: -2011, msg: "Unknown order sent." });
    found.status = "CANCELED";
    return json(res, 200, found);
  }
  if (path.includes("/capital/config/getall")) {
    return json(res, 200, [
      { coin: "BTC", name: "Bitcoin", free: "0.5", locked: "0", freeze: "0", withdrawing: "0", ipoing: "0", ipoable: "0", storage: "0", isLegalMoney: false, trading: true, networkList: [] },
      { coin: "USDT", name: "Tether", free: "10000", locked: "0", freeze: "0", withdrawing: "0", ipoing: "0", ipoable: "0", storage: "0", isLegalMoney: false, trading: true, networkList: [] },
    ]);
  }

  console.log(JSON.stringify({ event: "unimplemented", method: req.method, path }));
  return json(res, 404, { code: -1000, msg: "Fake Binance endpoint not implemented", path });
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "fake-binance-chaos-ready", port, deterministic: true }));
});
