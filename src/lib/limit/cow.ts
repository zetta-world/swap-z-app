"use client";

/**
 * CoW Protocol limit-order pre-signing.
 *
 * The user signs an EIP-712 order off-chain → we POST it to CoW's hosted
 * order book → CoW's solver network watches the market and atomically
 * fills the order the moment a quote at or above the limit becomes
 * available. ZERO gas for the maker; the taker / solver pays.
 *
 * This is the DEX equivalent of the CEX autopilot we already have: ZION
 * emits a buy_limit / sell_* card → user pre-signs once → autopilot
 * fires (via CoW solvers) when the trigger price prints. No popup at
 * trigger time, no missed entries because the user was asleep.
 *
 * What CoW gives us, that vanilla 0x v4 limits don't:
 *   1. Hosted order book — no need to operate a watcher / cron.
 *   2. Permissionless API — no key, no rate-limit secret to manage.
 *   3. Solver competition — best price discovery from many fillers.
 *   4. Multi-chain — Ethereum, Arbitrum, Base, Gnosis. Polygon / BSC /
 *      Optimism are NOT supported by CoW today; those cards fall back
 *      to the existing manual "Save as pending" flow.
 *
 * What CoW does NOT do:
 *   - Native ETH selling (only WETH). We detect and surface a clear
 *     error pointing the user at the WETH wrap path.
 *   - stop_loss semantics — a "sell when price drops to X" is the
 *     opposite of a limit order's "sell at X or better" and would fill
 *     immediately if the market is currently above X. We skip stop_loss
 *     for pre-sign.
 *
 * Security:
 *   - User signs only the order's EIP-712 typed data — no transaction.
 *   - User must have pre-approved the CoW Vault Relayer
 *     (0xC92E…0110) to spend the sell token. We check + prompt before
 *     attempting to sign so the order can actually be filled.
 *   - Signature is held client-side until POST; never logged, never
 *     stored server-side.
 */

import { normalizarDecimalFinanceiro, toBaseUnits as paraUnidadesBase } from "@/lib/format";
import type { ActionCard } from "@/lib/zion/parse";
import type { ChainId } from "@/lib/chains";
import type { Hex } from "viem";

/**
 * CoW Protocol Vault Relayer — the contract the user must approve to
 * spend their sell token. Same address on every supported chain via
 * CREATE2 deployment.
 */
export const COW_VAULT_RELAYER = "0xC92E8bdf79f0507f65a392b0ab4667716BFE0110" as const;

/**
 * GPv2 Settlement contract — the EIP-712 verifyingContract. Same
 * address on every supported chain.
 */
export const COW_SETTLEMENT = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41" as const;

/**
 * Internal chain id → CoW API slug. Chains not listed here are not
 * supported by CoW today; the caller MUST gate on isCowSupportedChain
 * before invoking any of the helpers below.
 */
const COW_API_SLUG: Partial<Record<ChainId, string>> = {
  ethereum: "mainnet",
  arbitrum: "arbitrum_one",
  base:     "base",
  // CoW also runs on gnosis chain but Z-SWAP doesn't carry it yet.
};

const COW_NUMERIC_CHAIN: Partial<Record<ChainId, number>> = {
  ethereum: 1,
  arbitrum: 42161,
  base:     8453,
};

export function isCowSupportedChain(chain: ChainId | undefined): boolean {
  return !!chain && chain in COW_API_SLUG;
}

/**
 * Card kinds we CAN translate into a CoW order. stop_loss is not in
 * here on purpose — a limit order at the stop price would fill now
 * (price is above the stop). Stop-loss needs CoW's "composable order"
 * extension which is a separate, heavier integration.
 */
const COW_ELIGIBLE_KINDS = new Set([
  "buy_limit",
  "sell_safe",
  "sell_medium",
  "sell_aggressive",
]);

export function isCowEligibleCard(card: ActionCard): boolean {
  return COW_ELIGIBLE_KINDS.has(card.kind) && isCowSupportedChain(card.chain as ChainId);
}

// ─── EIP-712 typed-data scaffolding ────────────────────────────────────

/**
 * CoW Protocol GPv2 order — exactly the struct the Settlement contract
 * verifies. Field order matters; do NOT reorder or the digest changes.
 */
interface CowOrderTyped {
  sellToken:         Hex;
  buyToken:          Hex;
  receiver:          Hex;
  sellAmount:        string;   // uint256, decimal string
  buyAmount:         string;   // uint256, decimal string
  validTo:           number;   // uint32 unix seconds
  appData:           Hex;      // bytes32
  feeAmount:         string;   // uint256
  kind:              "sell" | "buy";
  partiallyFillable: boolean;
  sellTokenBalance:  "erc20" | "external" | "internal";
  buyTokenBalance:   "erc20" | "internal";
}

const ORDER_TYPES = {
  Order: [
    { name: "sellToken",         type: "address" },
    { name: "buyToken",          type: "address" },
    { name: "receiver",          type: "address" },
    { name: "sellAmount",        type: "uint256" },
    { name: "buyAmount",         type: "uint256" },
    { name: "validTo",           type: "uint32" },
    { name: "appData",           type: "bytes32" },
    { name: "feeAmount",         type: "uint256" },
    { name: "kind",              type: "string" },
    { name: "partiallyFillable", type: "bool" },
    { name: "sellTokenBalance",  type: "string" },
    { name: "buyTokenBalance",   type: "string" },
  ],
} as const;

function buildDomain(chain: ChainId) {
  const chainId = COW_NUMERIC_CHAIN[chain];
  if (!chainId) throw new Error(`CoW: unsupported chain ${chain}`);
  return {
    name:              "Gnosis Protocol",
    version:           "v2",
    chainId,
    verifyingContract: COW_SETTLEMENT,
  } as const;
}

// ─── Card → order translation ──────────────────────────────────────────

export interface BuildOrderInput {
  card:           ActionCard;
  /** Maker / receiver — connected wallet address. */
  maker:          Hex;
  /** Sell token contract address (must be ERC-20, NOT native). */
  sellToken:      Hex;
  /** Buy token contract address (can be any ERC-20 OR a sentinel for ETH
   *  via CoW's ETH-flow contract; we use the buyToken as-is and let CoW
   *  reject if unsupported). */
  buyToken:       Hex;
  /** Decimals of the sell token — for converting card.from.amount → wei. */
  sellDecimals:   number;
  /** Decimals of the buy token — for the limit-price calculation. */
  buyDecimals:    number;
  /** How many days the order stays live before auto-expiry. */
  validityDays?:  number;
}

export interface BuiltOrder {
  /** The EIP-712 payload to pass to wagmi's signTypedData. */
  domain:     ReturnType<typeof buildDomain>;
  types:      typeof ORDER_TYPES;
  primaryType: "Order";
  message:    CowOrderTyped;
  /** Helpful summary for the toast / orders list. */
  meta: {
    chain:       ChainId;
    kind:        "sell" | "buy";
    sellAmount:  string;     // human-readable, e.g. "0.5 ETH"
    buyAmount:   string;     // human-readable, e.g. "1710 USDC"
    limitPrice:  string;     // human-readable, e.g. "$3,420 / ETH"
    expiresAt:   number;     // unix ms
  };
}

/**
 * Build the EIP-712 payload + a small human-readable meta block for a
 * given action card. Throws on any reason we can't translate the card.
 */
export function buildCowOrder(input: BuildOrderInput): BuiltOrder {
  const { card, maker, sellToken, buyToken, sellDecimals, buyDecimals } = input;
  const chain = card.chain as ChainId;
  if (!isCowSupportedChain(chain)) {
    throw new Error(`CoW: chain ${chain} not supported (try Ethereum, Arbitrum, or Base)`);
  }
  if (!isCowEligibleCard(card)) {
    throw new Error(`CoW: card kind ${card.kind} not eligible for pre-signing`);
  }

  const amountStr = card.from?.amount;
  if (!amountStr) throw new Error("CoW: card is missing from.amount");
  const amountNormalizado = normalizarDecimalFinanceiro(amountStr);
  if (amountNormalizado === null) {
    throw new Error(`CoW: invalid or ambiguous from.amount "${amountStr}"`);
  }

  /**
   * MONEY-CRITICAL: derive the signed sellAmount from normalized TEXT. Neither
   * sellAmount nor buyAmount may depend on IEEE-754 Number arithmetic.
   */
  const sellAmountWei = paraUnidadesBase(amountNormalizado, sellDecimals);
  if (sellAmountWei === "0") throw new Error(`CoW: amount "${amountStr}" rounds to zero in base units`);

  const price = parsePriceRatio(card.triggerPrice ?? card.entryPrice ?? "");
  if (!price) {
    throw new Error("CoW: missing, invalid, ambiguous, or zero triggerPrice/entryPrice");
  }

  /**
   * CoW receives kind="sell", so `buyAmount` is a MINIMUM RECEIVE. The exact
   * decimal price is represented as pn/pd and the already-fixed sellAmount in
   * base units is the authority:
   *
   *   SELL LIMIT: ceil(S * pn * 10^bd / (pd * 10^sd))
   *   BUY LIMIT:  ceil(S * pd * 10^bd / (pn * 10^sd))
   *
   * CEIL is intentional. Floor would lower the signed minimum receive by one
   * base unit whenever there is a remainder, silently relaxing the user's
   * price limit. All factors stay BigInt until the uint256 string is fixed.
   */
  const isBuyLimit = card.kind === "buy_limit";
  const buyAmountWei = calcularBuyAmountWeiExato({
    sellAmountWei,
    sellDecimals,
    buyDecimals,
    price,
    isBuyLimit,
  });
  if (buyAmountWei === "0") throw new Error("CoW: buy amount rounds to zero in base units");

  const validityDays = Math.max(1, Math.min(30, input.validityDays ?? 7));
  const validTo = Math.floor(Date.now() / 1000) + validityDays * 24 * 3600;

  const message: CowOrderTyped = {
    sellToken,
    buyToken,
    receiver:          maker,
    sellAmount:        sellAmountWei,
    buyAmount:         buyAmountWei,
    validTo,
    // appData of all-zeroes = no extra metadata. CoW accepts this; IPFS-
    // pinned appData is only required for app-level fee splits / refunds.
    appData:           ("0x" + "00".repeat(32)) as Hex,
    feeAmount:         "0",
    kind:              "sell",
    partiallyFillable: false,
    sellTokenBalance:  "erc20",
    buyTokenBalance:   "erc20",
  };

  // Display/meta is deliberately downstream of the exact signed payload.
  // Number is allowed here because these values are non-authoritative UI text.
  const sellAmountUserUnits = Number(amountNormalizado);
  const buyAmountUserUnits = Number(buyAmountWei) / (10 ** buyDecimals);
  const triggerPriceDisplay = Number(price.canonical);

  return {
    domain:      buildDomain(chain),
    types:       ORDER_TYPES,
    primaryType: "Order",
    message,
    meta: {
      chain,
      kind:        message.kind,
      sellAmount:  `${formatUserUnits(sellAmountUserUnits)} ${card.from?.symbol ?? ""}`.trim(),
      buyAmount:   `${formatUserUnits(buyAmountUserUnits)} ${card.to?.symbol ?? ""}`.trim(),
      limitPrice:  formatLimitPrice(triggerPriceDisplay, card),
      expiresAt:   validTo * 1000,
    },
  };
}

// ─── CoW HTTP API ──────────────────────────────────────────────────────

export interface CowSubmissionResult {
  /** The 56-byte (112 hex char) order UID CoW returns on POST. */
  orderUid: string;
  /** API slug used in subsequent requests (status / cancel). */
  apiSlug:  string;
}

/**
 * POST the signed order to CoW. Returns the orderUid on success; throws
 * with the sanitized upstream message on failure (validation, allowance,
 * insufficient balance, etc.).
 */
export async function submitCowOrder(
  chain:     ChainId,
  built:     BuiltOrder,
  signature: Hex,
  maker:     Hex,
): Promise<CowSubmissionResult> {
  const apiSlug = COW_API_SLUG[chain];
  if (!apiSlug) throw new Error(`CoW: no API slug for chain ${chain}`);

  const body = {
    sellToken:         built.message.sellToken,
    buyToken:          built.message.buyToken,
    receiver:          built.message.receiver,
    sellAmount:        built.message.sellAmount,
    buyAmount:         built.message.buyAmount,
    validTo:           built.message.validTo,
    appData:           built.message.appData,
    feeAmount:         built.message.feeAmount,
    kind:              built.message.kind,
    partiallyFillable: built.message.partiallyFillable,
    sellTokenBalance:  built.message.sellTokenBalance,
    buyTokenBalance:   built.message.buyTokenBalance,
    signingScheme:     "eip712",
    signature,
    from:              maker,
  };

  const res = await fetch(`https://api.cow.fi/${apiSlug}/api/v1/orders`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // CoW returns { errorType, description } on validation failures.
    let detail = text.slice(0, 240);
    try {
      const parsed = JSON.parse(text) as { errorType?: string; description?: string };
      if (parsed.description) detail = parsed.description;
      if (parsed.errorType)   detail = `${parsed.errorType}: ${detail}`;
    } catch { /* keep raw */ }
    throw new Error(detail);
  }

  // Body on success is the orderUid as a JSON string.
  let orderUid: string;
  try {
    const parsed = JSON.parse(text);
    orderUid = typeof parsed === "string" ? parsed : String(parsed);
  } catch {
    orderUid = text.replace(/^"|"$/g, "");
  }
  if (!orderUid || !orderUid.startsWith("0x")) {
    throw new Error(`CoW: unexpected response shape: ${text.slice(0, 120)}`);
  }
  return { orderUid, apiSlug };
}

export interface CowOrderStatus {
  /** "open" | "fulfilled" | "cancelled" | "expired" — normalized. */
  status:  "open" | "fulfilled" | "cancelled" | "expired" | "unknown";
  /** Raw status string from CoW for debugging. */
  raw?:    string;
  /** When the order was filled, if applicable. */
  filledAt?: number;
  /** Transaction hash of the fill, if applicable. */
  txHash?: string;
}

/**
 * Read an order's current status. Used by /orders to render a status
 * badge for pre-signed orders.
 */
export async function fetchCowOrderStatus(
  chain:    ChainId,
  orderUid: string,
): Promise<CowOrderStatus> {
  const apiSlug = COW_API_SLUG[chain];
  if (!apiSlug) throw new Error(`CoW: no API slug for chain ${chain}`);
  const res = await fetch(`https://api.cow.fi/${apiSlug}/api/v1/orders/${orderUid}`);
  if (!res.ok) {
    if (res.status === 404) return { status: "unknown", raw: "404" };
    throw new Error(`CoW status ${res.status}`);
  }
  const body = await res.json() as {
    status?: string;
    invalidated?: boolean;
    executedSellAmount?: string;
    executedBuyAmount?: string;
  };
  const raw = body.status ?? "";
  let status: CowOrderStatus["status"] = "unknown";
  if (raw === "open" || raw === "presignaturePending") status = "open";
  else if (raw === "fulfilled") status = "fulfilled";
  else if (raw === "cancelled" || body.invalidated)    status = "cancelled";
  else if (raw === "expired")                          status = "expired";
  return { status, raw };
}

// ─── Helpers ───────────────────────────────────────────────────────────

interface DecimalRatio {
  /** Plain canonical decimal with `.` as separator. */
  canonical: string;
  numerator: bigint;
  denominator: bigint;
}

/** Convert a canonical decimal string into an exact base-10 rational. */
function parseCanonicalDecimalRatio(canonical: string): DecimalRatio | null {
  if (!/^\d+(?:\.\d+)?$/.test(canonical)) return null;
  const [integer = "0", fraction = ""] = canonical.split(".");
  const digits = (integer + fraction).replace(/^0+(?=\d)/, "") || "0";
  return {
    canonical,
    numerator: BigInt(digits),
    denominator: 10n ** BigInt(fraction.length),
  };
}

/** Normalize a trigger price without ever reducing it to Number. */
function parsePriceRatio(raw: string): DecimalRatio | null {
  // Preserve the historical convenience of an optional leading "$", but do
  // not strip arbitrary letters/symbols: exponent notation and garbage fail
  // closed instead of being transformed into a different decimal.
  const lexical = String(raw).trim().replace(/^\$\s*/, "");
  if (!lexical || !/^[0-9.,\s\u00A0\u202F]+$/.test(lexical)) return null;
  const canonical = normalizarDecimalFinanceiro(lexical);
  if (canonical === null) return null;
  const ratio = parseCanonicalDecimalRatio(canonical);
  if (!ratio || ratio.numerator <= 0n) return null;
  return ratio;
}

function potenciaDez(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`CoW: invalid token decimals ${decimals}`);
  }
  return 10n ** BigInt(decimals);
}

/**
 * Exact ceil(n / d) for the non-negative integers used by CoW amounts.
 * Floor is unsafe here because signed `buyAmount` is a minimum receive.
 */
function dividirComCeil(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error("CoW: invalid exact-ratio division");
  return (n + d - 1n) / d;
}

function calcularBuyAmountWeiExato(args: {
  sellAmountWei: string;
  sellDecimals: number;
  buyDecimals: number;
  price: DecimalRatio;
  isBuyLimit: boolean;
}): string {
  const sellAmount = BigInt(args.sellAmountWei);
  const sellScale = potenciaDez(args.sellDecimals);
  const buyScale = potenciaDez(args.buyDecimals);

  const numerator = args.isBuyLimit
    ? sellAmount * args.price.denominator * buyScale
    : sellAmount * args.price.numerator * buyScale;
  const denominator = args.isBuyLimit
    ? args.price.numerator * sellScale
    : args.price.denominator * sellScale;

  return dividirComCeil(numerator, denominator).toString();
}

function formatUserUnits(n: number): string {
  if (n === 0)        return "0";
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (Math.abs(n) >= 0.0001) return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return n.toExponential(2);
}

function formatLimitPrice(price: number, card: ActionCard): string {
  const isBuyLimit = card.kind === "buy_limit";
  const baseSym = isBuyLimit ? card.to?.symbol : card.from?.symbol;
  const quoteSym = isBuyLimit ? card.from?.symbol : card.to?.symbol;
  return `${price.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${quoteSym ?? ""} / ${baseSym ?? ""}`.trim();
}
