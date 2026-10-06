import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { messages } from "@/lib/i18n/messages";
import { PLAN_TIERS, FOUNDERS_PRICE_STATUS, precoPublicoUsd } from "@/lib/pricing/plans";

/**
 * TRAVAS DE COPY DA VENDA FOUNDERS (OD-NFT-14, 19 e 11/15/18 — `docs/FOUNDERS-NFT-COPY-CORRECTION.md`).
 *
 * Varre só `src/` (código e copy que chegam ao usuário). `docs/` fica de fora DE PROPÓSITO: auditorias e
 * planos citam a copy antiga como evidência. Os padrões são de AFIRMAÇÃO — a copy nova diz "não é por ordem
 * de chegada" e "não é distribuído a holders", e isso tem de passar.
 */
const RAIZ = process.cwd();
const PROIBIDOS: Array<[string, RegExp]> = [
  ["expiração por versão (v3)", /(until|or)\s+platform\s+v3|at\s+3\s+years\s+or\s+platform\s+v3|até a v3 da plataforma|na v3 da plataforma|hasta la v3 de la plataforma|en la v3 de la plataforma|至平台\s*v3|或平台\s*v3/i],
  ["data de lançamento vencida", /Mint opens July 2026|julho de 2026|julio de 2026|2026\s*年\s*7\s*月/i],
  ["alocação por ordem de chegada", /(?<!not )(?<!it is not )\bis first-come|(?<!não )é por ordem de chegada|(?<!no )es por orden de llegada|(?<!并非)配额先到先得/i],
  ["distribuição de royalty/receita a holders", /(?<!not )(?<!are not )distributed to (Founder )?holders|distribuído aos holders|distribuido a los holders|分配给\s*(Founder\s*)?持有者|rewards pool distributed|pool de recompensas distribu/i],
  ["pool de recompensas Founder", /funds a Founder rewards pool|financia um pool de recompensas|financia un pool de recompensas|注入\s*Founder\s*奖励池/i],
  ["governança de tesouraria", /roadmap and treasury governance|governança de tesouraria|gobernanza de tesorería|金库治理中拥有发言权/i],
  ["whitelist garantida em coleções futuras", /Guaranteed allowlist on every future/i],
  ["benefícios futuros de todo o ecossistema", /keeps unlocking benefits across the whole|continua liberando benefícios em todo|sigue desbloqueando beneficios en todo|在整个\s*Zettaword\s*生态系统中持续解锁权益/i],
  ["acesso perpétuo a produto futuro", /perpetual beta access|acesso beta perpétuo|acceso beta perpetuo|永久 Beta 访问/i],
  ["preço antigo em SOL como verdade", /Pro 1\.5 SOL|Trader 4 SOL|Pilot 30 SOL|30 SOL Pilot|Pilot de 30 SOL|30 SOL 的 Pilot|"1\.5 SOL"|"4 SOL"|"30 SOL"/],
  ["royalty de 5% exposto", /(?<![\d.,])5\s?%\s*(of every|de cada|of each)/i],
];

function arquivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) arquivos(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("Founders — copy proibida não volta", () => {
  const fontes = arquivos(join(RAIZ, "src")).map((p) => ({ p: p.replace(RAIZ + "/", ""), s: readFileSync(p, "utf8") }));

  for (const [nome, re] of PROIBIDOS) {
    it(`sem ${nome} em src/`, () => {
      const achados = fontes.filter((f) => re.test(f.s)).map((f) => f.p);
      expect(achados).toEqual([]);
    });
  }

  it("as 4 línguas dizem 36 meses e não falam em v3 no bloco pricing", () => {
    for (const lang of ["en", "pt", "es", "zh"] as const) {
      const catalog = messages[lang] as unknown as { pricing: Record<string, string>; founders: Record<string, string> };
      const pr = catalog.pricing;
      expect(pr.heroTitleHL, lang).toMatch(/36/);
      expect(pr.faq2A, lang).toMatch(/36/);
      expect(Object.values(pr).join(" "), lang).not.toMatch(/\bv3\b/i);
      expect(Object.values({ ...catalog.pricing, ...catalog.founders }).join(" "), lang)
        .not.toMatch(/lifetime\s+premium|premium\s+(vitalício|vitalicio|perpetuo|perpétuo|forever)|永久\s*Premium/i);
      for (const k of ["tierProPrice", "tierTraderPrice", "tierPilotPrice"]) expect(pr[k], `${lang}.${k}`).not.toMatch(/\d/);
    }
  });

  it("as 4 línguas publicam a mesma regra cumulativa da venda", () => {
    for (const lang of ["en", "pt", "es", "zh"] as const) {
      const catalog = messages[lang] as unknown as { pricing: Record<string, string>; founders: Record<string, string> };
      expect(catalog.pricing.saleRules, lang).toMatch(/48/);
      expect(catalog.pricing.saleRules, lang).toMatch(/14/);
      expect(catalog.founders.pg_faq7A, lang).toMatch(/1/);
      expect(catalog.founders.pg_faq7A, lang).toMatch(/2/);
      expect(catalog.founders.pg_pilotPublicSale, lang).toMatch(/Pilot/i);
    }
  });
});

describe("Founders — preço provisório nunca aparece como final", () => {
  it("status provisório e preço público nulo", () => {
    expect(FOUNDERS_PRICE_STATUS).toBe("PROVISIONAL_FOR_DEMAND_VALIDATION");
    for (const p of PLAN_TIERS) expect(precoPublicoUsd(p)).toBeNull();
    expect(precoPublicoUsd({ usdTarget: 149 }, "FINAL")).toBe(149);
  });

  it("supply pago e preços provisórios do dono (OD-NFT-02, 04/10) — sem 1.500/500/50 nem 218/580/4.350", () => {
    expect(PLAN_TIERS.map((p) => [p.tier, p.supply, p.usdTarget])).toEqual([["pro", 2000, 149], ["trader", 750, 399], ["pilot", 100, 1990]]);
  });

  it("a página pública só usa preço via precoPublicoUsd", () => {
    const view = readFileSync(join(RAIZ, "src/components/pricing/PricingView.tsx"), "utf8");
    expect(view).toMatch(/precoPublicoUsd\(cfg\)/);
    expect(view).not.toMatch(/priceUsd:\s*cfg\.usdTarget/);
  });
});
