import type { Tier } from "@/lib/tier/types";

/**
 * Single source of truth for plan pricing & theming — LAUNCH (NFT, Norse gods)
 * and NORMAL (recurring, the warriors who serve the gods). Both `/pricing`
 * (launch) and the normal-plans page read from here.
 *
 * USD-PEGGED: `usdTarget` is the AUTHORITATIVE price. The SOL amount is derived
 * at runtime from the live SOL/USD rate (Pyth at mint, CoinGecko for display)
 * via usdToSol() — so if SOL moves, the real price in USD stays put (we never
 * lose money when SOL drops, and it never gets astronomical when SOL pumps).
 */

// Reference SOL/USD used ONLY to seed the initial usdTarget from the agreed SOL
// amounts (1.5 / 4 / 30 SOL). ⚠️ CONFIRM at mint with the live rate. Runtime
// display always uses the live rate, not this.
export const SOL_USD_REF = 145;

/** Normal (warrior) recurring price = +30% vs the launch/NFT-holder rate —
 *  rewards launch buyers ("you're a god / Founder") and gives the recurring
 *  engine a fatter margin. */
export const NORMAL_PREMIUM = 1.3;

export interface PlanTier {
  tier:          Tier;
  usdTarget:     number;  // AUTHORITATIVE price (USD). Launch NFT = one-time.
  supply:        number;  // NFT supply for the launch collection
  dailyAnalyses: number;  // mirrors TIER_DAILY_ANALYSES
  // Launch identity (gods)
  god:           string;
  rune:          string;
  epithet:       string;
  solRef:        number;  // agreed SOL amount at launch (marketing reference)
  card:          string;  // NFT art path
  // Normal identity (the Hird — sworn warriors who serve the gods)
  warrior:       string;
  warriorDesc:   string;
  warriorRune:   string;  // the warrior's own rune monogram (medallion hero)
  crest:         string;  // crest image of the god SERVED (public/tiers/*)
}

export const PLAN_TIERS: PlanTier[] = [
  {
    tier: "pro", usdTarget: Math.round(1.5 * SOL_USD_REF), supply: 1500, dailyAnalyses: 10,
    god: "Freyr", rune: "ᚠ", epithet: "Prosperity", solRef: 1.5, card: "/nft/pro.jpg",
    warrior: "Drengr", warriorDesc: "guerreiro de honra", warriorRune: "ᛞ", crest: "/tiers/freyr.png",
  },
  {
    tier: "trader", usdTarget: Math.round(4 * SOL_USD_REF), supply: 500, dailyAnalyses: 25,
    god: "Thor", rune: "ᚦ", epithet: "Thunder Strike", solRef: 4, card: "/nft/trader.png",
    warrior: "Berserkr", warriorDesc: "guerreiro feroz", warriorRune: "ᛒ", crest: "/tiers/thor.png",
  },
  {
    tier: "pilot", usdTarget: Math.round(30 * SOL_USD_REF), supply: 50, dailyAnalyses: 30,
    god: "Odin", rune: "ᚨ", epithet: "Allfather", solRef: 30, card: "/nft/pilot.jpg",
    warrior: "Einherjar", warriorDesc: "escolhido de Valhalla", warriorRune: "ᛖ", crest: "/tiers/pilot.png",
  },
];

/** SOL to charge for a USD target at a live SOL/USD rate (USD-pegged). */
export function usdToSol(usd: number, solUsd: number): number {
  return solUsd > 0 ? usd / solUsd : 0;
}

/** Monthly recurring price (USD) for the normal/warrior plan of a tier.
 *  Launch NFT is one-time for 3 years; normal is monthly at +30%. Amortizes
 *  the launch USD target over 36 months as the baseline, then applies +30%. */
export function normalMonthlyUsd(usdTarget: number): number {
  return (usdTarget / 36) * NORMAL_PREMIUM;
}
