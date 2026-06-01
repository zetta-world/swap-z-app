/**
 * Shared CEX error classification + upstream-message sanitization.
 * Used by every /api/cex/* route so a Binance-1021 timestamp error or
 * a Kraken IP-whitelist rejection produces the same granular code and
 * a safe, actionable detail string regardless of which endpoint hit it.
 */

/**
 * Map a raw upstream / ccxt error message into one of the granular error
 * codes the UI knows how to render. Order matters — more specific checks
 * come first so a "Timestamp ... recvWindow" Binance error doesn't get
 * classified as a generic "auth_failed".
 */
export function classifyCexError(msg: string): string {
  const m = msg.toLowerCase();
  // Region block MUST come first — Binance's geo-block response from
  // Vercel's US data centers sometimes also mentions "timestamp" or
  // "service" in the same message; without this ordering the user
  // sees "timestamp drift" and chases a clock issue that doesn't
  // exist. Common phrasings:
  //   "Service unavailable from a restricted location according to..."
  //   "Eligibility — your country is not supported"
  //   "451 Unavailable For Legal Reasons"
  //   "418 I'm a teapot"  (Binance's actual ban response on AWS US ranges)
  if (m.includes("restricted location") || m.includes("restricted region")
      || m.includes("eligible") || m.includes("eligibility")
      || m.includes("451") || m.includes("418")
      || m.includes("-2010")
      || (m.includes("region") && (m.includes("not") || m.includes("unavailable") || m.includes("supported")))
      || (m.includes("country") && (m.includes("not") || m.includes("unsupported")))
      || (m.includes("forbidden") && (m.includes("legal") || m.includes("region")))) {
    return "region_blocked";
  }
  // Timestamp / clock drift — Binance -1021, Bybit -7011, OKX 50114 etc.
  if (m.includes("timestamp") || m.includes("recvwindow") || m.includes("recv_window")
      || m.includes("clock") || m.includes("nonce") || m.includes("ahead of")
      || m.includes("-1021")) {
    return "timestamp_drift";
  }
  if (m.includes("ip") && (m.includes("not in") || m.includes("not allowed")
      || m.includes("not whitelist") || m.includes("invalid ip"))) {
    return "ip_not_whitelisted";
  }
  if (m.includes("permission") || m.includes("scope") || m.includes("not authorized for")
      || m.includes("-2015")) {
    return "permission_denied";
  }
  if (m.includes("invalid api") || m.includes("signature") || m.includes("unauthorized")
      || m.includes("apikey") || m.includes("api-key") || m.includes("invalid key")
      || m.includes("-2014")) {
    return "auth_failed";
  }
  if (m.includes("timeout") || m.includes("etimeout") || m.includes("etimedout")) {
    return "timeout";
  }
  if (m.includes("rate limit") || m.includes("too many requests")) {
    return "rate_limited";
  }
  if (m.includes("not found") || m.includes("does not exist") || m.includes("no such order")) {
    return "order_not_found";
  }
  if (m.includes("already") && (m.includes("filled") || m.includes("canceled")
      || m.includes("closed"))) {
    return "order_already_closed";
  }
  // Order-specific size / price filter rejections
  if (m.includes("min") && (m.includes("notional") || m.includes("size")
      || m.includes("amount") || m.includes("qty"))) {
    return "below_minimum";
  }
  if (m.includes("max") && (m.includes("position") || m.includes("size")
      || m.includes("amount") || m.includes("qty"))) {
    return "above_maximum";
  }
  if (m.includes("price") && (m.includes("filter") || m.includes("range")
      || m.includes("tick"))) {
    return "invalid_price";
  }
  if (m.includes("insufficient") || (m.includes("balance") && m.includes("low"))
      || m.includes("not enough")) {
    return "insufficient_balance";
  }
  if (m.includes("symbol") && (m.includes("invalid") || m.includes("not found")
      || m.includes("not exist"))) {
    return "symbol_not_found";
  }
  return "upstream_failed";
}

/**
 * Trim and redact an upstream error message so it's safe to return as
 * `detail`. Caps the length, strips angle brackets that could let the
 * client render arbitrary HTML, and explicitly redacts the API key in
 * case the upstream echoed it back (some exchanges do).
 */
export function sanitizeUpstreamMessage(raw: string, apiKey: string): string {
  let s = raw.replace(/[\r\n]+/g, " ").trim();
  if (apiKey && apiKey.length >= 8) {
    s = s.split(apiKey).join("***apiKey***");
  }
  s = s.replace(/[<>]/g, "");
  if (s.length > 240) s = s.slice(0, 240) + "…";
  return s;
}

/** HTTP status code matching the granular error class. */
export function statusForError(code: string): number {
  if (code === "auth_failed" || code === "permission_denied"
      || code === "ip_not_whitelisted" || code === "region_blocked") return 401;
  if (code === "rate_limited") return 429;
  if (code === "timeout") return 504;
  if (code === "order_not_found" || code === "symbol_not_found") return 404;
  if (code === "order_already_closed" || code === "insufficient_balance"
      || code === "timestamp_drift") return 400;
  return 502;
}
