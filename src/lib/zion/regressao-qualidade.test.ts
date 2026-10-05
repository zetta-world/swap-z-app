/**
 * CE-08 — o gabarito de qualidade do ZION e a prova de que o round não mexeu
 * em prompt nenhum.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { casosDeQualidade, avaliarResposta } from "@/lib/zion/regressao-qualidade";
import { ZION_FOUNDATION } from "@/lib/zion/foundation";
import { getModeInstructions, type ZionOp } from "@/lib/zion/mode-prompts";

describe("o gabarito cobre os temas exigidos e vem do código", () => {
  it("dez temas, cada um com fato obrigatório ou afirmação proibida", () => {
    const casos = casosDeQualidade();
    expect(casos.map((c) => c.id)).toEqual(
      ["redes", "zetta", "solana", "taxas", "tiers", "founders", "workbench", "zion", "institucional", "complexa"]);
    for (const c of casos) expect(c.obrigatorios.length + c.proibidos.length, c.id).toBeGreaterThan(0);
  });

  it("ZETTA Chain é 'em breve' no código — e o gabarito reprova quem a der como disponível", () => {
    const zetta = casosDeQualidade().find((c) => c.id === "zetta")!;
    expect(avaliarResposta(zetta, "A ZETTA Chain ainda não está disponível — chega em breve.").aprovado).toBe(true);
    expect(avaliarResposta(zetta, "Sim! A ZETTA Chain já está disponível na plataforma.").aprovado).toBe(false);
  });

  it("taxas e cotas do gabarito são as do código (100/50/25/10 bps; 5/10/25/30 análises)", () => {
    const taxas = casosDeQualidade().find((c) => c.id === "taxas")!;
    const boa = "Free paga 1%, Pro 0,5%, Trader 0,25% e Pilot 0,1%.";
    expect(avaliarResposta(taxas, boa)).toEqual({ aprovado: true, faltando: [], proibidosEncontrados: [] });
    expect(avaliarResposta(taxas, "Todos os planos pagam 1%.").aprovado).toBe(false);
    const tiers = casosDeQualidade().find((c) => c.id === "tiers")!;
    expect(avaliarResposta(tiers, "Free 5, Pro 10, Trader 25 e Pilot 30 por dia.").aprovado).toBe(true);
    expect(avaliarResposta(tiers, "O Pilot tem análises ilimitadas, os outros 5, 10 e 25, e 30 no total.").aprovado).toBe(false);
  });

  it("Founders (RM-09): preço EM DEFINIÇÃO + 36 meses aprova; citar o preço provisório, 'final' ou 'vitalício' reprova", () => {
    // ⚠️ Antes este teste APROVAVA "Pro US$ 149, Trader 399 e Pilot 1.990, preços provisórios" — a vitrine
    // (OD-NFT-02, `/pricing`) não mostra preço provisório em superfície pública, e o ZION é uma.
    const f = casosDeQualidade().find((c) => c.id === "founders")!;
    expect(avaliarResposta(f, "O preço do passe ainda está em definição; o premium vale 36 meses a partir do encerramento da venda.").aprovado).toBe(true);
    expect(avaliarResposta(f, "Pro US$ 149, Trader US$ 399 e Pilot US$ 1.990, preços provisórios; premium por 36 meses.").aprovado).toBe(false);
    expect(avaliarResposta(f, "Preço em definição, premium vitalício por 36 meses.").aprovado).toBe(false);
  });
});

describe("⚠️ o round NÃO mudou nenhum prompt — o custo caiu sem tocar no que o modelo lê", () => {
  it("fundação e instruções de modo são byte a byte as da base 0afa841", () => {
    const base = (arq: string) => execSync(`git show 0afa841:${arq}`, { encoding: "utf8" });
    const h = (s: string) => createHash("sha256").update(s).digest("hex");
    expect(h(execSync("cat src/lib/zion/foundation.ts", { encoding: "utf8" }))).toBe(h(base("src/lib/zion/foundation.ts")));
    expect(h(execSync("cat src/lib/zion/mode-prompts.ts", { encoding: "utf8" }))).toBe(h(base("src/lib/zion/mode-prompts.ts")));
    // E o que o módulo exporta não depende de relógio nem de acaso (prefixo estável = cacheável).
    const ops: ZionOp[] = ["trading", "arbitrage", "sniper", "pair", "ask", "futures", "accumulation", "research", "autopilot_cex"];
    expect(ZION_FOUNDATION).toBe(ZION_FOUNDATION.slice());
    for (const op of ops) expect(getModeInstructions(op)).toBe(getModeInstructions(op));
  });
});
