import type { AppLang } from "@/lib/store/ui";
import type { Tier } from "@/lib/tier/types";

export type PublicLocale = AppLang;
export type PublicStatus = "AVAILABLE" | "BETA" | "PARTIAL" | "ROADMAP";
export type BenefitStatus = "AVAILABLE_AT_LAUNCH" | "IMPLEMENTED_DISABLED" | "COMING_SOON_ROADMAP" | "A_CONFIRMAR" | "NOT_PART_OF_THE_OFFER";

export interface PublicTierFact {
  tier: Tier;
  zionPerDay: number;
  backtestsPer24h: number;
  assetsPerBacktest: number;
  historyDays: number;
  savedStrategies: number;
  paperDesks: number;
  simulationNotionalUsd: number;
  evmFeeBps: number;
  prioritySupport: boolean;
  publicFounderPriceUsd: number | null;
}

export interface PublicProductFact {
  id: "swap" | "zion" | "workbench" | "paper" | "dashboard" | "portfolio" | "orders" | "pools";
  href: string;
  status: PublicStatus;
}

export interface FoundersPublicFacts {
  verifiedAt: string;
  products: PublicProductFact[];
  tiers: PublicTierFact[];
  networks: { available: string[]; roadmap: string[] };
  sale: {
    open: false;
    dateAnnounced: false;
    finalSupplyAnnounced: false;
    allowlistHours: number;
    allowlistLimits: Record<"pro" | "trader" | "pilot", number>;
    eventLimits: Record<"pro" | "trader" | "pilot", number>;
    pilotPublicSale: true;
    calendarDays: number;
    earlyEndOnlyByRealSoldOut: true;
    unsold: "UNMINTED";
  };
  founder: {
    premiumMonths: number;
    premiumStartsAtOfficialSaleClose: boolean;
    transferRestartsClock: false;
    durableStatusAttachedToPass: boolean;
    rightsFollowCurrentHolder: boolean;
    priceStatus: "PROVISIONAL_FOR_DEMAND_VALIDATION" | "FINAL";
  };
  benefitStatus: {
    cexAutopilot: BenefitStatus;
    arbScanner: BenefitStatus;
    prioritySupport: BenefitStatus;
    pilotAdvancedAutomation: BenefitStatus;
  };
  pilotStandard: {
    backtestsPerRollingWindow: number;
    rollingHours: number;
    maxAssets: number;
    maxHistoryDays: number;
    candle: string;
    deskModeIncluded: false;
  };
  links: { platform: string; community: string; pricing: string };
}

export type FaqCategory = "general" | "founder" | "sale" | "tiers" | "tools" | "fees" | "security" | "risk" | "support";

export interface LocalizedFaqItem {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  /** Questions whose answer is deliberately pending remain publishable because the uncertainty is the fact. */
  decisionPending?: boolean;
}

export interface FoundersPublicCopy {
  localeName: string;
  nav: { products: string; founder: string; tiers: string; sale: string; faq: string };
  hero: { eyebrow: string; title: string; body: string; saleClosed: string; primary: string; secondary: string; community: string };
  sections: Record<string, string>;
  labels: Record<string, string>;
  productCopy: Record<PublicProductFact["id"], { title: string; body: string }>;
  benefitCopy: Record<"cexAutopilot" | "arbScanner" | "prioritySupport" | "pilotAdvancedAutomation", { title: string; body: string }>;
  tierCopy: Record<Tier, { name: string; ideal: string; summary: string }>;
  statusLabels: Record<PublicStatus | BenefitStatus, string>;
  faqCategories: Record<FaqCategory, string>;
  faqSearchPlaceholder: string;
  faqNoResults: string;
  faqCount: string;
  riskItems: string[];
  footer: string;
  faqs: LocalizedFaqItem[];
}
