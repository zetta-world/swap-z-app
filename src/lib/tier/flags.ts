/**
 * Tier-gate master switch. Gates are ON by default — set TIER_GATES_ENABLED=false
 * in env vars to temporarily open everything (useful while testing before the
 * NFT mint is live). One env var controls the whole system; nothing else changes.
 *
 * Admin wallets (source='admin' in tier_cache) bypass all gates regardless of
 * this flag by holding an elevated tier row with a 100-year expiry.
 */
export function gatesEnabled(): boolean {
  return process.env.TIER_GATES_ENABLED !== "false";
}
