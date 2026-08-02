import { describe, it, expect } from "vitest";
import { dailyQuota, quotaBucket, denialResponse } from "@/lib/tier/enforce";
import { FEATURE_TIER, TIER_DAILY_ANALYSES, ALL_TIERS, tierSatisfies } from "@/lib/tier/types";
import { PLAN_TIERS } from "@/lib/pricing/plans";
import { OP_FEATURE, featureForOp } from "@/lib/zion/op-tier";

/**
 * A MATRIZ QUE NINGUÉM CONSULTAVA.
 *
 * `FEATURE_TIER` diz de si mesma: "UI and API both read from here". A UI lia; a
 * API não. Das quatro entradas, UMA era verificada no servidor. O resto do
 * controle era `TierGate` — componente de CLIENTE, que esconde a interface.
 *
 * Esconder botão não é controle de acesso: um `curl` na rota entrega igual.
 */

describe("cota diária — o número que a assinatura paga", () => {
  it("cada plano tem cota, e ela cresce com o plano", () => {
    // Se um plano mais caro desse menos análises, a tabela de preços estaria
    // vendendo o contrário do que entrega.
    for (let i = 1; i < ALL_TIERS.length; i++) {
      expect(dailyQuota(ALL_TIERS[i])).toBeGreaterThan(dailyQuota(ALL_TIERS[i - 1]));
    }
  });

  it("a cota vem da tabela, não de um número solto", () => {
    for (const t of ALL_TIERS) expect(dailyQuota(t)).toBe(TIER_DAILY_ANALYSES[t]);
  });

  it("nenhum plano tem cota infinita", () => {
    // Um `Infinity` aqui reabriria exatamente o furo: o assinante mais barato
    // consumindo sem limite o recurso mais caro.
    for (const t of ALL_TIERS) {
      expect(Number.isFinite(dailyQuota(t))).toBe(true);
      expect(dailyQuota(t)).toBeGreaterThan(0);
    }
  });
});

describe("a cota é por CARTEIRA, não por IP", () => {
  it("a mesma carteira cai no mesmo balde, com qualquer caixa", () => {
    // Por IP seria fácil de furar (trocar de rede zera) e injusto ao mesmo
    // tempo (um escritório atrás de NAT dividiria uma cota só).
    expect(quotaBucket("0xABC")).toBe(quotaBucket("0xabc"));
  });

  it("carteiras diferentes não dividem cota", () => {
    expect(quotaBucket("0xabc")).not.toBe(quotaBucket("0xdef"));
  });
});

describe("as recusas falam a verdade e apontam a saída", () => {
  it("sem sessão é 401, não 402 — o problema é entrar, não pagar", () => {
    const r = denialResponse({ kind: "unauthenticated" });
    expect(r.status).toBe(401);
  });

  it("plano insuficiente é 402 e diz qual plano falta", async () => {
    const r = denialResponse({ kind: "tier_required", required: "pro", have: "free" });
    expect(r.status).toBe(402);
    const b = await r.json();
    expect(b.requiredTier).toBe("pro");
    expect(b.currentTier).toBe("free");
    expect(b.upgradeUrl).toBe("/pricing");
  });

  it("cota esgotada é 429 com Retry-After — é limite temporário, não paywall", async () => {
    // Devolver 402 aqui empurraria upgrade para quem já pagou e só usou o dia.
    const r = denialResponse({ kind: "quota_exhausted", tier: "pro", limit: 10, retryAfter: 3600 });
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBe("3600");
    const b = await r.json();
    expect(b.dailyLimit).toBe(10);
    expect(b.message).toContain("10 análises");
  });

  it("nenhuma recusa é cacheável", async () => {
    for (const d of [
      { kind: "unauthenticated" as const },
      { kind: "tier_required" as const, required: "pro" as const, have: "free" as const },
      { kind: "quota_exhausted" as const, tier: "pro" as const, limit: 10, retryAfter: 60 },
    ]) {
      expect(denialResponse(d).headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

describe("a vitrine e a porta têm de dizer a MESMA coisa", () => {
  it("a cota de cada card de preço é a cota que o servidor aplica", () => {
    // Se divergirem, ou a plataforma entrega menos do que vendeu (quebra a
    // palavra com quem pagou), ou entrega mais do que cobrou (vazamento de
    // receita). Cada lado, sozinho, continua coerente — por isso ninguém vê.
    for (const p of PLAN_TIERS) {
      expect(p.dailyAnalyses, `plano ${p.tier}`).toBe(TIER_DAILY_ANALYSES[p.tier]);
    }
  });

  it("o plano Free tem acesso ao ZION — a página anuncia 5/dia", () => {
    // O gate exigia "pro" e entregava ZERO a quem a vitrine prometia cinco.
    // Quem separa os planos aqui é a COTA, não o portão.
    expect(FEATURE_TIER.zionAdvisory).toBe("free");
    expect(dailyQuota("free")).toBe(5);
  });
});

describe("operação do ZION com exigência própria", () => {
  it("a arbitragem exige o plano em que é VENDIDA", () => {
    // O card do plano Trader vende "Cross-CEX arbitrage feed". A entrada
    // `arbScanner: "trader"` existia na matriz e não correspondia a superfície
    // nenhuma — o feed entrava pelo op=arbitrage sob a regra genérica do ZION,
    // então qualquer plano com ZION levava junto o que era exclusivo do Trader.
    expect(featureForOp("arbitrage")).toBe("arbScanner");
    expect(FEATURE_TIER[featureForOp("arbitrage")]).toBe("trader");
  });

  it("operação sem exigência própria cai no gate geral do ZION", () => {
    for (const op of ["trading", "pair", "ask", "sniper", "research"] as const) {
      expect(featureForOp(op)).toBe("zionAdvisory");
    }
  });

  it("toda chave apontada pelo mapa existe na matriz", () => {
    // Um typo aqui abriria o recurso em vez de fechá-lo — `FEATURE_TIER[k]`
    // viria `undefined` e nenhum plano seria exigido.
    for (const k of Object.values(OP_FEATURE)) {
      expect(FEATURE_TIER[k!], `feature "${k}" não existe em FEATURE_TIER`).toBeDefined();
    }
  });
});

describe("a matriz de features", () => {
  it("o autopilot CEX segue sendo pago — ali o gate é o portão mesmo", () => {
    expect(FEATURE_TIER.cexAutopilot).toBe("pro");
  });

  it("um plano superior satisfaz o gate de um inferior", () => {
    // Sem isso, um assinante 'pilot' levaria 402 numa superfície 'pro'.
    expect(tierSatisfies("pilot", FEATURE_TIER.cexAutopilot)).toBe(true);
    expect(tierSatisfies("free", FEATURE_TIER.cexAutopilot)).toBe(false);
  });
});
