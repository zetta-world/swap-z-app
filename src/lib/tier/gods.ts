import type { Tier } from "./types";

/**
 * God identity per paid tier — mirrors the Access Pass NFT artwork.
 * Names/epithets are proper nouns from the cards, identical in all locales.
 */
export type PaidTier = Exclude<Tier, "free">;

export interface GodMeta {
  god:     string;
  epithet: string;
  /** Elder Futhark rune associated with the god (matches the card art). */
  rune:    string;
}

export const GOD_META: Record<PaidTier, GodMeta> = {
  pro:    { god: "FREYR", epithet: "PROSPERITY",     rune: "ᚠ" },
  trader: { god: "THOR",  epithet: "THUNDER STRIKE", rune: "ᚦ" },
  pilot:  { god: "ODIN",  epithet: "ALLFATHER",      rune: "ᚨ" },
};

export function isPaidTier(t: Tier): t is PaidTier {
  return t !== "free";
}
