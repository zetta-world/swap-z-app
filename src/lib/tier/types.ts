/**
 * Membership tiers, ordered free → pilot. The numeric rank lets gates ask
 * "is this wallet at least `pro`?" without enumerating every higher tier.
 *
 * Tiers map 1:1 to the /pricing cards (FASE 5.1) and, once 5.4 ships, to the
 * NFT membership passes minted on Solana.
 */
export type Tier = "free" | "pro" | "trader" | "pilot";

export const TIER_RANK: Record<Tier, number> = {
  free:   0,
  pro:    1,
  trader: 2,
  pilot:  3,
};

export const ALL_TIERS: Tier[] = ["free", "pro", "trader", "pilot"];

export function isTier(v: unknown): v is Tier {
  return typeof v === "string" && v in TIER_RANK;
}

/** True when `have` satisfies a `required` gate (e.g. trader satisfies pro). */
export function tierSatisfies(have: Tier, required: Tier): boolean {
  return TIER_RANK[have] >= TIER_RANK[required];
}

/** Where a cached tier came from — purely informational for now. */
export type TierSource = "nft" | "subscription" | "admin";

export interface TierResult {
  tier:   Tier;
  source: TierSource | "default";
  /** Epoch ms when this answer should be re-checked. */
  expiresAt: number;
}

/**
 * Feature → minimum tier matrix. The single source of truth for which gate a
 * surface sits behind. Keep keys stable; UI and API both read from here.
 */
export const FEATURE_TIER: Record<string, Tier> = {
  zionAdvisory:  "pro",   // ZION streaming analysis
  cexAutopilot:  "pro",   // CEX autopilot panel
  arbScanner:    "trader",
  prioritySupport: "trader",
};
