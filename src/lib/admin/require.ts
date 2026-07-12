import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { logSecurity } from "@/lib/admin/track";

/**
 * Server helper — call at the top of every admin Server Component / Route
 * Handler. Returns the verified wallet address or throws notFound() (404),
 * never 403, so the panel's existence is never revealed to outsiders.
 *
 * Access logic (ANY condition grants entry):
 *  1. Wallet address is in the ADMIN_WALLETS env var (comma-separated).
 *  2. The wallet has a row in `platform_admins` (grant/revoke from the panel).
 *  3. Legacy: the wallet has a tier_cache row with source = 'admin' (kept so
 *     wallets seeded before platform_admins existed are never locked out).
 *
 * The middleware pre-screens with (1) only to avoid a DB round-trip on every
 * request.
 */
export async function requireAdmin(): Promise<{ wallet: string }> {
  const session = await getSession();
  if (!session) notFound();

  const wallet = session.sub;

  if (isEnvAdmin(wallet)) return { wallet };

  const db = getSupabaseAdmin();
  if (!db) notFound();

  // Dedicated admin grants (the panel writes here).
  const { data: pa } = await db
    .from("platform_admins")
    .select("wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (pa) return { wallet };

  // Legacy fallback: tier_cache.source = 'admin' (pre-platform_admins grants).
  const { data } = await db
    .from("tier_cache")
    .select("source")
    .eq("wallet_address", wallet)
    .eq("source", "admin")
    .maybeSingle();

  if (!data) {
    // A signed-in wallet probing an admin surface — high-signal intrusion attempt.
    logSecurity("admin_access_denied", { wallet: `${wallet.slice(0, 10)}…` }, "high");
    notFound();
  }
  return { wallet };
}

/** Returns true if the wallet is in the ADMIN_WALLETS env var. */
export function isEnvAdmin(wallet: string): boolean {
  const raw = process.env.ADMIN_WALLETS ?? "";
  if (!raw.trim()) return false;
  const set = new Set(raw.split(",").map((w) => w.trim().toLowerCase()));
  return set.has(wallet.toLowerCase());
}

/** The env-configured admin wallets (lower-cased). These are baked into the
 *  deployment — the panel shows them read-only (can't be revoked from the UI). */
export function envAdminWallets(): string[] {
  const raw = process.env.ADMIN_WALLETS ?? "";
  return raw.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
}

/**
 * Writes one row to admin_audit_log. Fire-and-forget — never throws,
 * so a logging failure never aborts the action being audited.
 */
export async function logAdminAction(
  actor: string,
  action: string,
  target?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    await db.from("admin_audit_log").insert({ actor_wallet: actor, action, target: target ?? null, payload: payload ?? null });
  } catch {
    // intentionally swallowed — logging must not block the happy path
  }
}
