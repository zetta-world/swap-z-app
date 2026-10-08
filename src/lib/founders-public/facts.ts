import { CHAINS } from "@/lib/chains";
import { BENEFICIOS, OFERTA_PADRAO_PILOT, POLITICA_STATUS_FOUNDER } from "@/lib/founders-commercial-truth";
import { CONFIG_APROVADA } from "@/lib/founders-sale/config";
import { FOUNDERS_PRICE_STATUS, PLAN_TIERS, precoPublicoUsd } from "@/lib/pricing/plans";
import { TIER_FEE_BPS } from "@/lib/tier/fees";
import { ALL_TIERS, BANCADA_COTAS, FEATURE_TIER, TIER_DAILY_ANALYSES } from "@/lib/tier/types";
import type { BenefitStatus, FoundersPublicFacts, PublicProductFact } from "./types";

const PRODUCTS: PublicProductFact[] = [
  { id: "swap", href: "/", status: "AVAILABLE" },
  { id: "zion", href: "/zion", status: "AVAILABLE" },
  { id: "workbench", href: "/laboratorio", status: "AVAILABLE" },
  { id: "paper", href: "/laboratorio", status: "AVAILABLE" },
  { id: "dashboard", href: "/dashboard", status: "AVAILABLE" },
  { id: "portfolio", href: "/portfolio", status: "AVAILABLE" },
  { id: "orders", href: "/orders", status: "AVAILABLE" },
  { id: "pools", href: "/pools", status: "AVAILABLE" },
];

function benefitStatus(id: string): BenefitStatus {
  const benefit = BENEFICIOS.find((item) => item.id === id);
  if (!benefit) throw new Error(`missing canonical Founder benefit: ${id}`);
  return benefit.estado;
}

/**
 * Server-side projection of public facts. It intentionally omits internal
 * infrastructure, planned supply figures and provisional price numbers.
 */
export function foundersPublicFacts(): FoundersPublicFacts {
  const planByTier = new Map(PLAN_TIERS.map((plan) => [plan.tier, plan]));
  const tiers = ALL_TIERS.map((tier) => {
    const quota = BANCADA_COTAS[tier];
    const plan = planByTier.get(tier);
    return {
      tier,
      zionPerDay: TIER_DAILY_ANALYSES[tier],
      backtestsPer24h: quota.backtestsPorDia,
      assetsPerBacktest: quota.simbolosPorTeste,
      historyDays: quota.janelaMaxDias,
      savedStrategies: quota.estrategiasSalvas,
      paperDesks: quota.mesasDePapel,
      simulationNotionalUsd: quota.capitalMaxUsd,
      evmFeeBps: TIER_FEE_BPS[tier],
      prioritySupport: ALL_TIERS.indexOf(tier) >= ALL_TIERS.indexOf(FEATURE_TIER.prioritySupport),
      publicFounderPriceUsd: plan ? precoPublicoUsd(plan) : null,
    };
  });

  return {
    verifiedAt: "2026-10-07",
    products: PRODUCTS,
    tiers,
    networks: {
      available: CHAINS.filter((chain) => !chain.comingSoon).map((chain) => chain.name),
      roadmap: CHAINS.filter((chain) => chain.comingSoon).map((chain) => chain.name),
    },
    sale: {
      open: false,
      dateAnnounced: false,
      finalSupplyAnnounced: false,
      allowlistHours: CONFIG_APROVADA.duracaoAllowlistMs / 3_600_000,
      allowlistLimits: {
        pro: CONFIG_APROVADA.tetos.allowlist.PRO,
        trader: CONFIG_APROVADA.tetos.allowlist.TRADER,
        pilot: CONFIG_APROVADA.tetos.allowlist.PILOT,
      },
      eventLimits: {
        pro: CONFIG_APROVADA.tetos.publica.PRO,
        trader: CONFIG_APROVADA.tetos.publica.TRADER,
        pilot: CONFIG_APROVADA.tetos.publica.PILOT,
      },
      pilotPublicSale: true,
      calendarDays: CONFIG_APROVADA.duracaoMaximaVendaMs / 86_400_000,
      earlyEndOnlyByRealSoldOut: true,
      unsold: "UNMINTED",
    },
    founder: {
      premiumMonths: CONFIG_APROVADA.premium.meses,
      premiumStartsAtOfficialSaleClose: CONFIG_APROVADA.premium.inicio === "ENCERRAMENTO_OFICIAL_DA_VENDA",
      transferRestartsClock: false,
      durableStatusAttachedToPass: POLITICA_STATUS_FOUNDER.natureza === "PROPRIEDADE_DURADOURA_DO_PASSE",
      rightsFollowCurrentHolder: POLITICA_STATUS_FOUNDER.direitosPertencemAo === "HOLDER_ATUAL",
      priceStatus: FOUNDERS_PRICE_STATUS,
    },
    benefitStatus: {
      cexAutopilot: benefitStatus("cex_autopilot"),
      arbScanner: benefitStatus("arb_scanner"),
      prioritySupport: benefitStatus("priority_support"),
      pilotAdvancedAutomation: benefitStatus("pilot_advanced_automation"),
    },
    pilotStandard: {
      backtestsPerRollingWindow: OFERTA_PADRAO_PILOT.backtestsPorJanela,
      rollingHours: OFERTA_PADRAO_PILOT.janelaHoras,
      maxAssets: OFERTA_PADRAO_PILOT.ativosMax,
      maxHistoryDays: OFERTA_PADRAO_PILOT.historicoDiasMax,
      candle: OFERTA_PADRAO_PILOT.candle,
      deskModeIncluded: false,
    },
    links: {
      platform: "/",
      pricing: "/pricing",
      community: process.env.NEXT_PUBLIC_COMUNIDADE_URL ?? "https://t.me/ZSwapCommunity",
    },
  };
}
