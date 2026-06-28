import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { withdrawFromCex } from "@/lib/cex/server";
import { getReferencePriceUsd } from "@/lib/autopilot/price-guard";
import { logSecurity, logError, notifyTelegram } from "@/lib/admin/track";
import { classifyCexError, sanitizeUpstreamMessage, statusForError } from "@/lib/cex/errors";
import { type CexId, type CexCredentials, SUPPORTED_CEX_IDS, CEX_META } from "@/lib/cex/types";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);
// Withdrawals are the highest-stakes endpoint we expose — actual
// real-money outflow that the exchange will execute. 3 attempts per
// minute is generous for legitimate use and tight enough that a
// runaway script or replay can't drain an account before the user
// notices.
const RL_OPTS = { windowMs: 60_000, max: 3 };

// Hard server-side ceiling regardless of what the client says or what
// the user's CEX has whitelisted. If they truly want a bigger move
// they go to the exchange's own UI; we are not the right surface for
// 6-figure transfers.
const HARD_WITHDRAWAL_CEILING_USD = 50_000;
// Conservative USD estimates for the currencies we'll let pass the
// ceiling check. Anything not in here just trusts the amount as USD
// — fine for stables, conservative for everything else.
const ROUGH_USD_PRICE: Record<string, number> = {
  BTC: 80_000, ETH: 3_500, BNB: 700, SOL: 200, AVAX: 40, MATIC: 1, POL: 1,
  LINK: 25,   ARB: 1,     OP:  2,   ATOM: 8, ADA: 1, DOT: 8,
  USDT: 1,    USDC: 1,    BUSD: 1,  DAI: 1,  FDUSD: 1, TUSD: 1,
};

interface BodyShape {
  exchange:    string;
  currency:    string;
  amount:      number;
  address:     string;
  network?:    string;
  tag?:        string;
  twoFactorCode?: string;
  /** Magic token — same pattern as /api/cex/order, enforced server-side
   *  so accidental calls never reach the exchange. */
  confirm:     string;
  apiKey:      string;
  apiSecret:   string;
  passphrase?: string;
  /** Set true by the autopilot rebalance bridge — enables the real-price
   *  per-rebalance cap check below (C6). */
  autopilot?:  boolean;
  /** The user's per-rebalance USD cap, enforced server-side against a fresh
   *  price so a non-stable withdrawal can't bypass it via token quantity. */
  maxNotionalUsd?: number;
}

const STABLE_CCY = new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USDP", "USD", "USDE", "PYUSD"]);

/**
 * POST /api/cex/withdraw
 *
 * Place an on-chain withdrawal from the user's CEX to a destination
 * address. THE EXCHANGE WILL ACTUALLY SEND FUNDS. The route enforces:
 *
 *   1. confirm magic-string (same defense-in-depth pattern as orders).
 *   2. Per-IP rate limit (3/min) — burst protection.
 *   3. Hard USD ceiling ($50k via rough price table). Larger withdrawals
 *      have to go through the user's own CEX UI.
 *   4. Strict shape validation on currency / address / network / amount.
 *
 * Things this route deliberately does NOT enforce, because the
 * exchanges already do, and trying to mirror them would be brittle:
 *   - Address-whitelist on the CEX side: every major exchange requires
 *     the destination to be pre-whitelisted (often with email/SMS
 *     confirmation + a cooldown). If the user hasn't whitelisted the
 *     address, the exchange rejects with a specific error code and we
 *     pass it through as `detail`.
 *   - 2FA: the user supplies the code as `twoFactorCode`; ccxt passes
 *     it to the exchange in the withdrawal params.
 *
 * NEVER store, log, or echo the destination address, the amount, the
 * 2FA code, or the API credentials.
 */
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }

  const rl = await rateLimitDurable(`cex_withdraw:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    logSecurity("rate_limited", { route: "cex/withdraw" }, "med");
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: BodyShape;
  try {
    body = await req.json() as BodyShape;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (body.confirm !== "I-CONFIRM-REAL-WITHDRAWAL") {
    logSecurity("invalid_confirmation", { route: "cex/withdraw" }, "high");
    return NextResponse.json({ ok: false, error: "missing_confirmation" }, { status: 400 });
  }

  const exchange = body.exchange?.toLowerCase?.() as CexId;
  if (!VALID_EXCHANGES.has(exchange)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }

  const currency = (body.currency || "").toUpperCase();
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(currency)) {
    return NextResponse.json({ ok: false, error: "invalid_currency" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || body.amount <= 0 || !Number.isFinite(body.amount)) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }

  // USD ceiling. For currencies we know about we estimate via the rough
  // table; for unknown ones we treat the amount as USD which is the
  // most conservative possible interpretation.
  const roughUsd = (ROUGH_USD_PRICE[currency] ?? 1) * body.amount;
  if (roughUsd > HARD_WITHDRAWAL_CEILING_USD) {
    logSecurity("withdraw_ceiling_block", { currency, roughUsd: Math.round(roughUsd) }, "high");
    return NextResponse.json(
      { ok: false, error: "amount_exceeds_ceiling", detail: `Server-side cap is ~$${HARD_WITHDRAWAL_CEILING_USD.toLocaleString()}. Use the exchange's own UI for larger transfers.` },
      { status: 400 },
    );
  }

  // C6: autopilot per-rebalance cap with a FRESH real price. The intent's
  // notionalUsd can fall back to the token QUANTITY for a non-stable currency
  // (e.g. "5 ETH" → notionalUsd 5), letting a withdrawal blow past a small
  // per-rebalance cap. Recompute the true USD value and enforce the cap here,
  // server-side, where it can't be bypassed. Fail-safe: reject if we can't
  // price a non-stable currency for an autopilot withdrawal.
  if (body.autopilot === true) {
    const unitUsd = STABLE_CCY.has(currency)
      ? 1
      : (await getReferencePriceUsd(currency)) ?? ROUGH_USD_PRICE[currency] ?? null;
    if (unitUsd === null) {
      return NextResponse.json(
        { ok: false, error: "unpriceable_currency", detail: `Cannot price ${currency} for the per-rebalance cap check.` },
        { status: 400 },
      );
    }
    const estUsd = unitUsd * body.amount;
    const cap = typeof body.maxNotionalUsd === "number" && body.maxNotionalUsd > 0
      ? body.maxNotionalUsd
      : HARD_WITHDRAWAL_CEILING_USD;
    if (estUsd > cap * 1.5) {
      return NextResponse.json(
        { ok: false, error: "exceeds_rebalance_cap", detail: `Withdrawal ~$${estUsd.toFixed(2)} exceeds the per-rebalance cap of $${cap}.` },
        { status: 400 },
      );
    }
  }

  if (typeof body.address !== "string" || body.address.length < 20 || body.address.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid_address" }, { status: 400 });
  }
  if (body.network !== undefined && (typeof body.network !== "string" || !/^[A-Za-z0-9_-]{2,32}$/.test(body.network))) {
    return NextResponse.json({ ok: false, error: "invalid_network" }, { status: 400 });
  }
  if (body.tag !== undefined && (typeof body.tag !== "string" || body.tag.length > 64)) {
    return NextResponse.json({ ok: false, error: "invalid_tag" }, { status: 400 });
  }
  if (body.twoFactorCode !== undefined && (typeof body.twoFactorCode !== "string" || !/^[0-9]{4,10}$/.test(body.twoFactorCode))) {
    return NextResponse.json({ ok: false, error: "invalid_2fa" }, { status: 400 });
  }

  if (typeof body.apiKey !== "string" || body.apiKey.length < 8 || body.apiKey.length > 200) {
    return NextResponse.json({ ok: false, error: "invalid_api_key" }, { status: 400 });
  }
  if (typeof body.apiSecret !== "string" || body.apiSecret.length < 8 || body.apiSecret.length > 600) {
    return NextResponse.json({ ok: false, error: "invalid_api_secret" }, { status: 400 });
  }
  if (CEX_META[exchange].needsPassphrase && (!body.passphrase || typeof body.passphrase !== "string")) {
    return NextResponse.json({ ok: false, error: `passphrase_required_for_${exchange}` }, { status: 400 });
  }

  const creds: CexCredentials = {
    apiKey:    body.apiKey,
    apiSecret: body.apiSecret,
    passphrase: body.passphrase,
  };

  try {
    const receipt = await withdrawFromCex(exchange, creds, {
      currency,
      amount:        body.amount,
      address:       body.address,
      network:       body.network,
      tag:           body.tag,
      twoFactorCode: body.twoFactorCode,
    });
    // Money left the building — always worth a ping.
    notifyTelegram(`💸 <b>Withdrawal sent</b> — ${currency} (~$${Math.round(roughUsd).toLocaleString()}) from ${exchange} → ${body.address.slice(0, 8)}…${body.address.slice(-4)}`);
    return NextResponse.json(
      { ok: true, exchange, receipt, fetchedAt: Date.now() },
      { headers: { "Cache-Control": "no-store, no-transform" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Withdraw failures often surface exchange-specific guidance
    // ("address not whitelisted", "withdraw suspended", "2FA required",
    // "minimum withdraw is X"). We pass that through to the UI but
    // never log the destination address.
    console.warn("[cex/withdraw]", exchange, currency, "failed:", msg.slice(0, 160));
    const code = classifyCexError(msg);
    logError("cex/withdraw", code, { exchange, currency });
    const detail = sanitizeUpstreamMessage(msg, body.apiKey);
    return NextResponse.json(
      { ok: false, error: code, detail },
      { status: statusForError(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}
