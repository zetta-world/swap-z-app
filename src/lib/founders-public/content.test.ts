import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FOUNDERS_PUBLIC_FAQ_COUNT, foundersPublicCopy } from "./content";
import { foundersPublicFacts } from "./facts";
import type { PublicLocale } from "./types";

const locales: PublicLocale[] = ["en", "pt", "es", "zh"];
const facts = foundersPublicFacts();

describe("Founders public copy", () => {
  it("ships a complete, structurally identical FAQ in all public languages", () => {
    expect(FOUNDERS_PUBLIC_FAQ_COUNT).toBeGreaterThanOrEqual(50);
    expect(FOUNDERS_PUBLIC_FAQ_COUNT).toBe(59);
    const expectedIds = foundersPublicCopy("en", facts).faqs.map((item) => item.id);
    for (const locale of locales) {
      const copy = foundersPublicCopy(locale, facts);
      expect(copy.faqs).toHaveLength(59);
      expect(copy.faqs.map((item) => item.id)).toEqual(expectedIds);
      expect(new Set(copy.faqs.map((item) => item.category))).toEqual(new Set(["general", "founder", "sale", "tiers", "tools", "fees", "security", "risk", "support"]));
      expect(JSON.stringify(copy)).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it("publishes uncertainty instead of inventing sale, payment or support decisions", () => {
    for (const locale of locales) {
      const copy = foundersPublicCopy(locale, facts);
      for (const id of ["sale-date", "final-supply", "payment", "scam-policy", "partnership"]) {
        expect(copy.faqs.find((item) => item.id === id)?.decisionPending, `${locale}:${id}`).toBe(true);
      }
      expect(copy.labels.priceValue).toBeTruthy();
      expect(copy.labels.noBuy).toBeTruthy();
    }
  });

  it("states disabled and roadmap benefits without presenting them as current", () => {
    for (const locale of locales) {
      const copy = foundersPublicCopy(locale, facts);
      expect(copy.benefitCopy.cexAutopilot.body).toBeTruthy();
      expect(copy.statusLabels.IMPLEMENTED_DISABLED).toBeTruthy();
      expect(copy.statusLabels.A_CONFIRMAR).toBeTruthy();
      expect(copy.statusLabels.COMING_SOON_ROADMAP).toBeTruthy();
      expect(copy.benefitCopy.pilotAdvancedAutomation.body).toBeTruthy();
    }
  });

  it("keeps forbidden commercial claims out of public production sources", () => {
    const roots = [
      "src/lib/founders-public/content.ts",
      "src/components/founders/FoundersPublicPage.tsx",
      "src/components/founders/FoundersTierComparison.tsx",
      "src/app/(previa)/founders-pass/page.tsx",
    ];
    const source = roots.map((path) => readFileSync(join(process.cwd(), path), "utf8")).join("\n").toLowerCase();
    const forbidden = [
      ["lifetime", " premium"], ["permanent", " premium"], ["guaranteed", " returns"],
      ["buy", " now"], ["mint", " now"],
    ].map((parts) => parts.join(""));
    for (const claim of forbidden) expect(source, claim).not.toContain(claim);
    for (const locale of locales) {
      const economicRights = foundersPublicCopy(locale, facts).faqs.find((item) => item.id === "economic-rights")!;
      expect(economicRights.answer).toMatch(/^(No\.|Não\.|没有。)/);
      const futureRights = foundersPublicCopy(locale, facts).faqs.find((item) => item.id === "future-rights")!;
      expect(futureRights.answer).toMatch(/^(No\.|Não\.|不保证。)/);
    }
  });
});
