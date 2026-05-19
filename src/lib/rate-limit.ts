/**
 * Lightweight in-memory rate limiter.
 *
 * Per-Vercel-instance state — not perfectly shared across the deployment, but
 * still meaningful protection against single-source bursts. Each entry is
 * `[count, windowStartMs]`. Old entries are pruned lazily.
 *
 * Identifiers (typically client IP) are derived from request headers in the
 * route handler — see `src/lib/rate-limit.ts#getClientId`.
 */

interface Bucket { count: number; resetAt: number; }

const BUCKETS = new Map<string, Bucket>();
const MAX_BUCKETS = 4096;

export interface RateLimitOptions {
  /** Window in milliseconds (default 60s). */
  windowMs?: number;
  /** Max requests per window per identifier (default 12). */
  max?: number;
}

export interface RateLimitResult {
  ok:         boolean;
  remaining:  number;
  resetAt:    number;          // unix ms when window resets
  retryAfter: number;          // seconds until reset (only useful when !ok)
}

export function rateLimit(id: string, opts: RateLimitOptions = {}): RateLimitResult {
  const windowMs = opts.windowMs ?? 60_000;
  const max      = opts.max      ?? 12;
  const now      = Date.now();

  // Lazy prune: if we hit the cap, drop the oldest 25%
  if (BUCKETS.size > MAX_BUCKETS) {
    const sorted = [...BUCKETS.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    sorted.slice(0, Math.floor(MAX_BUCKETS / 4)).forEach(([k]) => BUCKETS.delete(k));
  }

  let b = BUCKETS.get(id);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    BUCKETS.set(id, b);
  }

  b.count++;
  const ok        = b.count <= max;
  const remaining = Math.max(0, max - b.count);
  return {
    ok,
    remaining,
    resetAt:    b.resetAt,
    retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}

/**
 * Derive a stable client identifier from request headers. Falls back to a
 * coarse bucket if none of the trusted forwarding headers are present.
 *
 * Headers tried (in order):
 *   - `x-forwarded-for`      (set by Vercel + most proxies)
 *   - `x-real-ip`            (some proxies)
 *   - `cf-connecting-ip`     (Cloudflare)
 *
 * Caller responsibility: this trusts the headers as set by the platform.
 * Do NOT use this as the only auth mechanism — it's defense-in-depth only.
 */
export function getClientId(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = headers.get("x-real-ip");
  if (xri) return xri.trim();
  const cf  = headers.get("cf-connecting-ip");
  if (cf)  return cf.trim();
  return "anonymous";
}
