/**
 * Tier-gate master switch. While `false` (the default), the entire auth +
 * tier infrastructure is live and observable, but NO feature is actually
 * gated — ZION never returns 402, <TierGate> always renders its children.
 *
 * Flip TIER_GATES_ENABLED=true only after the 5.4 NFT mint is live, so paying
 * members have a real path to unlock what the gate starts enforcing. One env
 * var turns the whole thing on; nothing else has to change.
 */
export function gatesEnabled(): boolean {
  return process.env.TIER_GATES_ENABLED === "true";
}
