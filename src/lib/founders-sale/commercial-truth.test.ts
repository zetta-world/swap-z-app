import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAINS } from "@/lib/chains";
import { TIER_FEE_BPS, CONTA_TAXA_SOLANA } from "@/lib/tier/fees";
import { messages } from "@/lib/i18n/messages";
import {
  BENEFICIOS,
  ESTADOS_BENEFICIO,
  OFERTA_PADRAO_PILOT,
  POLITICA_STATUS_FOUNDER,
  POLITICA_SUPORTE_PRIORITARIO,
  beneficioPodeSerVendidoComoDisponivel,
  beneficiosDisponiveisNoLancamento,
  beneficiosPorEstado,
} from "./beneficios";

const langs = ["en", "pt", "es", "zh"] as const;

describe("Founders commercial truth — estado nunca é promovido", () => {
  it("usa exatamente os cinco estados autorizados", () => {
    expect(ESTADOS_BENEFICIO).toEqual([
      "AVAILABLE_AT_LAUNCH",
      "IMPLEMENTED_DISABLED",
      "COMING_SOON_ROADMAP",
      "NOT_PART_OF_THE_OFFER",
      "A_CONFIRMAR",
    ]);
    expect(new Set(BENEFICIOS.map((b) => b.id)).size).toBe(BENEFICIOS.length);
  });

  it.each(ESTADOS_BENEFICIO)("%s tem semântica fechada", (estado) => {
    expect(beneficioPodeSerVendidoComoDisponivel(estado)).toBe(estado === "AVAILABLE_AT_LAUNCH");
  });

  it("Autopilot CEX é implementado/desabilitado; nunca disponível", () => {
    for (const tier of ["PRO", "TRADER", "PILOT"] as const) {
      expect(beneficiosPorEstado(tier, "IMPLEMENTED_DISABLED").map((b) => b.id)).toContain("cex_autopilot");
      expect(beneficiosDisponiveisNoLancamento(tier).map((b) => b.id)).not.toContain("cex_autopilot");
    }
  });

  it("scanner de arbitragem permanece A CONFIRMAR; nunca disponível", () => {
    for (const tier of ["TRADER", "PILOT"] as const) {
      expect(beneficiosPorEstado(tier, "A_CONFIRMAR").map((b) => b.id)).toContain("arb_scanner");
      expect(beneficiosDisponiveisNoLancamento(tier).map((b) => b.id)).not.toContain("arb_scanner");
    }
    expect(beneficiosPorEstado("PRO", "A_CONFIRMAR").map((b) => b.id)).not.toContain("arb_scanner");
  });

  it("suporte prioritário começa no Trader e não promete SLA, 24/7, concierge ou CEO", () => {
    expect(POLITICA_SUPORTE_PRIORITARIO).toEqual({
      comecaNoTier: "TRADER",
      canal: "FILA_ASSINCRONA_PRIORITARIA",
      slaRigido: false,
      humano24x7: false,
      concierge: false,
      obrigacaoPessoalDoCeo: false,
    });
    expect(beneficiosDisponiveisNoLancamento("PRO").map((b) => b.id)).not.toContain("priority_support");
    expect(beneficiosDisponiveisNoLancamento("TRADER").map((b) => b.id)).toContain("priority_support");
    expect(beneficiosDisponiveisNoLancamento("PILOT").map((b) => b.id)).toContain("priority_support");
  });

  it("automação avançada Pilot é roadmap sujeito a safety gates", () => {
    expect(beneficiosPorEstado("PILOT", "COMING_SOON_ROADMAP").map((b) => b.id)).toContain("pilot_advanced_automation");
    expect(beneficiosDisponiveisNoLancamento("PILOT").map((b) => b.id)).not.toContain("pilot_advanced_automation");
  });
});

describe("Founders commercial truth — redes, fees e Pilot", () => {
  it("status Founder é duradouro no passe sem prometer Premium ou produtos futuros", () => {
    expect(POLITICA_STATUS_FOUNDER).toEqual({
      natureza: "PROPRIEDADE_DURADOURA_DO_PASSE",
      direitosPertencemAo: "HOLDER_ATUAL",
      conformePoliticaOwnership: true,
      premiumMeses: 36,
      transferenciaReiniciaPremium: false,
      garanteBeneficiosFuturos: false,
      garanteProdutosFuturos: false,
    });
    expect(BENEFICIOS.filter((b) => b.id.startsWith("founder_")).every((b) => b.duracao === "STATUS_ENQUANTO_HOLDER")).toBe(true);
  });

  it("redes disponíveis e ZETTA Chain em breve são exatas", () => {
    expect(CHAINS.filter((c) => !c.comingSoon).map((c) => c.name)).toEqual([
      "Ethereum", "BNB Chain", "Polygon", "Base", "Arbitrum", "Optimism", "Avalanche", "Solana",
    ]);
    expect(CHAINS.filter((c) => c.comingSoon).map((c) => c.name)).toEqual(["ZETTA Chain"]);
  });

  it("fees são a escada EVM e Solana permanece sem platform fee", () => {
    expect(TIER_FEE_BPS).toEqual({ free: 100, pro: 50, trader: 25, pilot: 10 });
    expect(CONTA_TAXA_SOLANA).toBeNull();
  });

  it("Pilot 5.000 é padrão de estratégia própria; modo mesa fica separado", () => {
    expect(OFERTA_PADRAO_PILOT).toEqual({
      backtestsPorJanela: 5000,
      janelaHoras: 24,
      tipo: "ESTRATEGIA_PROPRIA",
      ativosMax: 3,
      historicoDiasMax: 365,
      candle: "4h",
      cargasMaioresConsomemProporcionalmente: true,
      modoMesaIncluidoNaMesmaDefinicao: false,
      budgetFraction: "1/16",
    });
  });
});

describe("Founders commercial truth — todas as superfícies derivam e rotulam", () => {
  it("pricing e a venda usam a fonte canônica, sem listas ativas hardcoded", () => {
    const pricing = readFileSync(join(process.cwd(), "src/components/pricing/PricingView.tsx"), "utf8");
    const founderBenefits = readFileSync(join(process.cwd(), "src/components/pricing/FounderBenefits.tsx"), "utf8");
    const sale = readFileSync(join(process.cwd(), "src/components/founders/FoundersSalePage.tsx"), "utf8");
    const preview = readFileSync(join(process.cwd(), "src/lib/founders-sale/previa.ts"), "utf8");
    expect(pricing).toContain("beneficiosPublicaveis");
    expect(pricing).toContain("featAutopilotDisabled");
    expect(pricing).toContain("featArbUnconfirmed");
    expect(sale).toContain("idsNoEstado(\"AVAILABLE_AT_LAUNCH\")");
    expect(sale).toContain("idsNoEstado(\"IMPLEMENTED_DISABLED\")");
    expect(sale).toContain("idsNoEstado(\"A_CONFIRMAR\")");
    expect(preview).toContain("beneficiosPorEstado(\"PRO\", \"AVAILABLE_AT_LAUNCH\")");
    expect(preview).toContain("beneficiosPorEstado(\"PRO\", \"IMPLEMENTED_DISABLED\")");
    expect(founderBenefits).toContain('b.estado === "AVAILABLE_AT_LAUNCH"');
  });

  it("DEX/on-chain e CEX mantêm modelos de autorização distintos", () => {
    const cex = readFileSync(join(process.cwd(), "src/app/api/cex/order/route.ts"), "utf8");
    const dex = readFileSync(join(process.cwd(), "src/app/api/quote/route.ts"), "utf8");
    expect(cex).toContain('body.confirm !== "I-CONFIRM-REAL-ORDER"');
    expect(cex).toContain("apiSecret");
    expect(dex).toContain("firm, signable payload");
    expect(dex).toContain("taker");
    expect(dex).not.toContain("I-CONFIRM-REAL-ORDER");
  });

  it("pricing e sale preview rotulam desabilitado, a confirmar e suporte em quatro línguas", () => {
    const reDisabled = /disabled|desabilitad|deshabilitad|禁用/i;
    const reUnconfirmed = /confirm|confirmar|待确认/i;
    const reAsync = /asynchronous|assíncron|asíncron|异步/i;
    for (const lang of langs) {
      const catalog = messages[lang] as unknown as {
        pricing: Record<string, string>;
        founders: Record<string, string>;
      };
      expect(catalog.pricing.featAutopilotDisabled, lang).toMatch(reDisabled);
      expect(catalog.pricing.featArbUnconfirmed, lang).toMatch(reUnconfirmed);
      expect(catalog.pricing.featSupport, lang).toMatch(reAsync);
      expect(catalog.founders.pg_ben_cex_autopilot, lang).toMatch(reDisabled);
      expect(catalog.founders.pg_ben_arb_scanner, lang).toMatch(reUnconfirmed);
      expect(catalog.founders.pg_ben_priority_support, lang).toMatch(reAsync);
    }
  });

  it("pricing e FAQ distinguem status duradouro de Premium temporário em quatro línguas", () => {
    const re36 = /36/;
    const reFutureDisclaimer = /does not guarantee|não garante|no garantiza|不保证/iu;
    const reCurrentHolder = /current holder|holder atual|holder actual|当前 holder/iu;
    const reAttachedToPass = {
      en: /durable Founder status.*(?:with|attached to) the pass/iu,
      pt: /status Founder duradouro.*(?:com o passe|associado ao passe)/iu,
      es: /estatus Founder duradero.*(?:con el pase|vinculado al pase)/iu,
      zh: /Founder 身份.*(?:通行证.*持久|持久.*通行证)|通行证.*持久.*Founder 身份/iu,
    } as const;
    const reTransferDoesNotRestart = {
      en: /transfer does not restart the 36-month period/iu,
      pt: /transferência não reinicia o período de 36 meses/iu,
      es: /transferencia no reinicia el período de 36 meses/iu,
      zh: /转让不会重新开始 36 个月期限/iu,
    } as const;
    for (const lang of langs) {
      const catalog = messages[lang] as unknown as {
        pricing: Record<string, string>;
        founders: Record<string, string>;
      };
      expect(catalog.pricing.layerABody, lang).toMatch(re36);
      expect(catalog.pricing.layerBBody, lang).toMatch(reFutureDisclaimer);
      expect(catalog.pricing.layerBBody, lang).toMatch(reCurrentHolder);
      expect(catalog.pricing.heroTitleB, lang).toMatch(reAttachedToPass[lang]);
      expect(catalog.pricing.faq1A, lang).toMatch(reAttachedToPass[lang]);
      expect(catalog.pricing.faq3A, lang).toMatch(reTransferDoesNotRestart[lang]);
      expect(catalog.founders.pg_heroSub, lang).toMatch(re36);
      expect(catalog.founders.pg_heroSub, lang).toMatch(reAttachedToPass[lang]);
      expect(catalog.founders.pg_thesis2, lang).toMatch(reAttachedToPass[lang]);
    }
  });
});
