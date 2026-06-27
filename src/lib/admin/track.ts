import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { rateLimit } from "@/lib/rate-limit";

type EventOpts = {
  wallet?: string | null;
  path?:   string | null;
  meta?:   Record<string, unknown>;
};

/**
 * Fire-and-forget platform event recorder.
 * Never throws, never awaited by callers — tracking must not add latency.
 */
export function recordEvent(type: string, opts: EventOpts = {}): void {
  const db = getSupabaseAdmin();
  if (!db) return;

  const promise = db.from("platform_events").insert({
    event_type:     type,
    wallet_address: opts.wallet ?? null,
    path:           opts.path   ?? null,
    metadata:       opts.meta   ?? null,
  });
  // Supabase builder returns a PromiseLike; cast to Promise for .catch
  Promise.resolve(promise).catch(() => undefined);

  // Nudge the admin live feed — but NOT for page_view, which can fire many
  // times per second under traffic and would flood the channel. Meaningful
  // events (swap_intent, cex_order) ping; page views show up on the next poll.
  if (type !== "page_view") broadcastAdminRefresh("events");
}

export type Severity = "low" | "med" | "high";

/**
 * Record a SECURITY-relevant event: a likely abuse / violation / attack
 * signal (bad confirmation token on a money endpoint, a blocked guard, a
 * rate-limit hit, an auth failure). Surfaced in the admin Logs & Security
 * panel so we can spot probing/attacks without reading server logs.
 */
export function logSecurity(kind: string, meta: Record<string, unknown> = {}, severity: Severity = "med"): void {
  recordEvent("security", { meta: { kind, severity, ...meta } });
  if (severity === "high") {
    notifyTelegram(`🔴 <b>SECURITY</b>: ${kind}\n${JSON.stringify(meta).slice(0, 200)}`, { dedupKey: `sec:${kind}`, meta: { kind } });
  }
}

/**
 * Record an ERROR / failure (a caught exception, a failed upstream call) so
 * bugs are queryable in the admin panel, not buried in Vercel logs. Messages
 * are truncated; never pass secrets in `meta`.
 */
export function logError(where: string, message: string, meta: Record<string, unknown> = {}): void {
  recordEvent("error", { meta: { where, message: String(message).slice(0, 300), ...meta } });
}

// ─── Proactive alerts (Telegram) ─────────────────────────────────────────

/** True when the Telegram bot is wired up (token + chat id present). */
export function alertConfigured(): boolean {
  return !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Push a proactive alert. Always logs to platform_events (visible in the
 * Alerts panel even with no bot) and, when Telegram is configured, sends the
 * message. `dedupKey` throttles repeats (1 per 5 min per key) so an attack
 * spike can't flood the channel. Fire-and-forget, never throws.
 */
export function notifyTelegram(text: string, opts: { dedupKey?: string; meta?: Record<string, unknown> } = {}): void {
  recordEvent("alert", { meta: { text: text.slice(0, 300), ...opts.meta } });

  if (opts.dedupKey) {
    const rl = rateLimit(`alert:${opts.dedupKey}`, { windowMs: 300_000, max: 1 });
    if (!rl.ok) return; // throttled
  }

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const promise = fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  Promise.resolve(promise).catch(() => undefined);
}

/**
 * Record one operation in the server-side operations ledger (the background
 * cron's equivalent of the browser's useOperationSync). Idempotent on `ref`;
 * fire-and-forget. Pass a stable, unique `ref` (e.g. "exchange:orderId").
 */
export function logOperation(op: {
  walletAddress?: string | null;
  kind:           string;
  chain?:         string | null;
  pair?:          string | null;
  side?:          string | null;
  volumeUsd?:     number | null;
  pnlUsd?:        number | null;
  status:         string;
  route?:         string | null;
  ref?:           string | null;
}): void {
  const db = getSupabaseAdmin();
  if (!db) return;
  const promise = db.from("operations").upsert({
    wallet_address: op.walletAddress ?? null,
    kind:           op.kind,
    chain:          op.chain ?? null,
    pair:           op.pair ?? null,
    side:           op.side ?? null,
    volume_usd:     op.volumeUsd ?? null,
    pnl_usd:        op.pnlUsd ?? null,
    status:         op.status,
    route:          op.route ?? null,
    ref:            op.ref ?? null,
  }, { onConflict: "ref", ignoreDuplicates: true });
  Promise.resolve(promise).catch(() => undefined);
}
