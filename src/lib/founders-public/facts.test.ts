import { describe, expect, it } from "vitest";
import { foundersPublicFacts } from "./facts";

describe("Founders public facts", () => {
  const facts = foundersPublicFacts();

  it("projects sale rules without disclosing undecided date, supply or provisional prices", () => {
    expect(facts.sale).toMatchObject({
      open: false,
      dateAnnounced: false,
      finalSupplyAnnounced: false,
      allowlistHours: 48,
      allowlistLimits: { pro: 1, trader: 1, pilot: 1 },
      eventLimits: { pro: 2, trader: 2, pilot: 1 },
      pilotPublicSale: true,
      calendarDays: 14,
      earlyEndOnlyByRealSoldOut: true,
      unsold: "UNMINTED",
    });
    expect(facts.founder.priceStatus).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    expect(facts.tiers.filter((tier) => tier.tier !== "free").every((tier) => tier.publicFounderPriceUsd === null)).toBe(true);
  });

  it("keeps Founder status separate from the exact Premium clock", () => {
    expect(facts.founder).toMatchObject({
      premiumMonths: 36,
      premiumStartsAtOfficialSaleClose: true,
      transferRestartsClock: false,
      durableStatusAttachedToPass: true,
      rightsFollowCurrentHolder: true,
    });
  });

  it("derives network, fee and quota facts from the current canonical modules", () => {
    expect(facts.networks.available).toEqual(["Ethereum", "BNB Chain", "Polygon", "Base", "Arbitrum", "Optimism", "Avalanche", "Solana"]);
    expect(facts.networks.roadmap).toEqual(["ZETTA Chain"]);
    expect(Object.fromEntries(facts.tiers.map((tier) => [tier.tier, tier.evmFeeBps]))).toEqual({ free: 100, pro: 50, trader: 25, pilot: 10 });
    expect(Object.fromEntries(facts.tiers.map((tier) => [tier.tier, tier.backtestsPer24h]))).toEqual({ free: 10, pro: 100, trader: 500, pilot: 5_000 });
  });

  it("does not upgrade disabled, roadmap or undecided benefits to available", () => {
    expect(facts.benefitStatus).toEqual({
      cexAutopilot: "IMPLEMENTED_DISABLED",
      arbScanner: "A_CONFIRMAR",
      prioritySupport: "AVAILABLE_AT_LAUNCH",
      pilotAdvancedAutomation: "COMING_SOON_ROADMAP",
    });
    expect(facts.pilotStandard).toEqual({
      backtestsPerRollingWindow: 5_000,
      rollingHours: 24,
      maxAssets: 3,
      maxHistoryDays: 365,
      candle: "4h",
      deskModeIncluded: false,
    });
  });
});
