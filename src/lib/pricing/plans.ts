import type { Tier } from "@/lib/tier/types";

/**
 * Single source of truth for plan pricing & theming — LAUNCH (NFT, Norse gods)
 * and NORMAL (recurring, the warriors who serve the gods). Both `/pricing`
 * (launch) and the normal-plans page read from here.
 *
 * USD-ANCHORED: `usdTarget` is the owner's USD anchor (PROVISIONAL — see below). At the
 * sale, the SOL amount is fixed per phase from a snapshotted SOL/USD reference
 * (`founders-sale/preco.ts`), never re-priced continuously during a phase.
 */

/**
 * ⚠️ PREÇO DO PASSE = DECISÃO DO DONO, AINDA PROVISÓRIA (OD-NFT-02, 04/10/2026).
 *
 * $149 / $399 / $1.990 com supply pago 2.000 / 750 / 100 (`docs/FOUNDERS-NFT-OWNER-DECISIONS.md`).
 * Enquanto `FOUNDERS_PRICE_STATUS` não for `FINAL` (só depois da validação de demanda, OD-NFT-21),
 * NENHUMA superfície pública mostra esses números: `precoPublicoUsd` devolve `null` e a página diz
 * "preço em definição". Superfícies internas (admin) podem mostrar o valor COM o rótulo PROVISÓRIO.
 * O antigo `SOL_USD_REF = 145` (1,5 / 4 / 30 SOL) saiu: âncora em USD, pagamento em SOL com
 * referência fotografada e congelada por fase (`src/lib/founders-sale/preco.ts`).
 */
export type FoundersPriceStatus = "PROVISIONAL_FOR_DEMAND_VALIDATION" | "FINAL";
export const FOUNDERS_PRICE_STATUS: FoundersPriceStatus = "PROVISIONAL_FOR_DEMAND_VALIDATION";

/** Preço que uma superfície PÚBLICA pode exibir. `null` enquanto o preço não for FINAL. */
export function precoPublicoUsd(
  plan: Pick<PlanTier, "usdTarget">,
  status: FoundersPriceStatus = FOUNDERS_PRICE_STATUS,
): number | null {
  return status === "FINAL" ? plan.usdTarget : null;
}

/** Planning baseline only: "+30% vs the launch/NFT-holder rate" (NFT-BRIEFING §9).
 *  OD-NFT-20 (owner, 04/10/2026): NON_BINDING_PRICING_GUIDANCE — Founders NFT and
 *  the recurring plans are separate commercial products; no customer is entitled
 *  to any minimum premium of the monthly plan over NFT economics, and the
 *  authoritative monthly prices are the explicit `monthlyUsd` anchors below.
 *  Used only as the fallback for a tier with no anchor (none today). */
export const NORMAL_PREMIUM = 1.3;

export interface PlanTier {
  tier:          Tier;
  usdTarget:     number;  // owner price (USD anchor), PROVISIONAL until FOUNDERS_PRICE_STATUS = FINAL
  supply:        number;  // PAID-SALE supply of the launch collection (reserve is separate, OD-NFT-04)
  dailyAnalyses: number;  // mirrors TIER_DAILY_ANALYSES
  // Launch identity (gods)
  god:           string;
  rune:          string;
  epithet:       string;
  card:          string;  // NFT art path
  // Normal identity (the Hird — sworn warriors who serve the gods)
  warrior:       string;
  warriorDesc:   string;
  warriorRune:   string;  // the warrior's own rune monogram (medallion hero)
  crest:         string;  // crest image of the god SERVED (public/tiers/*)
  monthlyUsd:    number;  // AUTHORITATIVE Hird monthly price (clean anchor,
                          // CEO-set) — the /36 × premium formula is only the
                          // baseline used to derive these
  avatar?:       string;  // circular profile portrait for the medallion
                          // (public/warriors/*.jpg, 1:1) — rune shows until set
}

export const PLAN_TIERS: PlanTier[] = [
  {
    tier: "pro", usdTarget: 149, supply: 2000, dailyAnalyses: 10,
    god: "Freyr", rune: "ᚠ", epithet: "Prosperity", card: "/nft/pro.jpg",
    warrior: "Drengr", warriorDesc: "guerreiro de honra", warriorRune: "ᛞ", crest: "/tiers/freyr.png", monthlyUsd: 7.90, avatar: "/warriors/drengr.jpg",
  },
  {
    tier: "trader", usdTarget: 399, supply: 750, dailyAnalyses: 25,
    god: "Thor", rune: "ᚦ", epithet: "Thunder Strike", card: "/nft/trader.png",
    warrior: "Berserkr", warriorDesc: "guerreiro feroz", warriorRune: "ᛒ", crest: "/tiers/thor.png", monthlyUsd: 20.90, avatar: "/warriors/berserkr.jpg",
  },
  {
    tier: "pilot", usdTarget: 1990, supply: 100, dailyAnalyses: 30,
    god: "Odin", rune: "ᚨ", epithet: "Allfather", card: "/nft/pilot.jpg",
    warrior: "Einherjar", warriorDesc: "escolhido de Valhalla", warriorRune: "ᛖ", crest: "/tiers/pilot.png", monthlyUsd: 159, avatar: "/warriors/einherjar.jpg",
  },
];

/** SOL to charge for a USD target at a live SOL/USD rate (USD-pegged). */
export function usdToSol(usd: number, solUsd: number): number {
  return solUsd > 0 ? usd / solUsd : 0;
}

/** Monthly recurring price (USD) for the Hird plan of a tier. The explicit
 *  `monthlyUsd` anchor wins (clean price points the CEO set: 7.90 / 20.90 /
 *  159); the launch-target/36 × premium formula is the fallback baseline for
 *  any future tier that hasn't been anchored yet. */
export function normalMonthlyUsd(plan: Pick<PlanTier, "usdTarget" | "monthlyUsd">): number {
  return plan.monthlyUsd ?? (plan.usdTarget / 36) * NORMAL_PREMIUM;
}
