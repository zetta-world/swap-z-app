/**
 * ⚠️⚠️ TODO TOKEN DE SOLANA ERA RENDERIZADO COMO SEGURO — achado A26.
 *
 * GoPlus e Honeypot.is cobrem 7 das 8 redes do produto. Solana não está em
 * nenhuma das duas. Sem provedor, a rota caía no ramo "nenhum sinal" e devolvia
 * `score: 0` → `category: "safe"`.
 *
 * `token-safety.ts` só cai em `unverified` quando `typeof api.score !== "number"`
 * — e um ZERO é número. Passava direto por essa porta como SEGURO, com mensagem
 * vazia e botão liberado.
 *
 * ⚠️ E O CONSUMIDOR ESCREVE A REGRA CONTRÁRIA, em caixa alta, no cabeçalho:
 *
 *     "Ausência de verificação NUNCA renderiza como segurança."
 *
 * Ele a implementa corretamente para `null`. Quem a derrotava era quem o
 * ALIMENTA, fabricando um número onde não houve medição — a mesma família do
 * A27, e a décima vez nesta auditoria.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assessTokenSafety } from "./token-safety";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const RISK    = semComentarios(leia("src/app/api/risk/route.ts"));
const SCANNER = semComentarios(leia("src/components/explorer/RiskScanner.tsx"));
const MSG     = leia("src/lib/i18n/messages.ts");

describe("① o consumidor já sabia ler 'não medido' — e continua", () => {
  it("⚠️⚠️ score ausente vira `unverified`, nunca `safe`", () => {
    const a = assessTokenSafety({ score: undefined, category: "safe", signals: [] });
    expect(a.level).toBe("unverified");
    expect(a.blocks).toBe(false);
    expect(a.message).toContain("NÃO significa que é seguro");
  });

  it("⚠️⚠️ e um ZERO era a porta dos fundos — número é número", () => {
    // Esta é a aritmética do defeito: com `score: 0` o guarda de `unverified`
    // não dispara, e o veredito sai `safe` com mensagem VAZIA.
    const comZero = assessTokenSafety({ score: 0, category: "safe", signals: [] });
    expect(comZero.level).toBe("safe");
    expect(comZero.message).toBe("");
    // Por isso a correção é no PRODUTOR: ele não pode mais mandar zero.
  });
});

describe("② a rota devolve `null` quando ninguém mediu", () => {
  it("⚠️⚠️ sem provedor → score null e categoria `unverified`", () => {
    expect(RISK).toMatch(/const semCobertura = s === null && h === null/);
    const i = RISK.indexOf("if (semCobertura)");
    expect(i).toBeGreaterThan(0);
    const ramo = RISK.slice(i, i + 420);
    expect(ramo).toMatch(/score: null/);
    expect(ramo).toMatch(/category: "unverified"/);
  });

  it("⚠️⚠️ e o ramo sai ANTES de o score ser calculado — zero não escapa", () => {
    const iRamo = RISK.indexOf("if (semCobertura)");
    const iScore = RISK.indexOf("score = Math.min(score, 100)");
    expect(iScore).toBeGreaterThan(iRamo);
    expect(RISK.slice(iRamo, iScore)).toMatch(/return \{/);
  });

  it("⚠️ 'consultei e não achei nada' É medição, e continua valendo zero", () => {
    // Provedor que respondeu sem apontar nada é diferente de provedor que não
    // foi consultado. Confundir os dois na direção oposta seria trocar um
    // defeito por outro — o usuário aprenderia a ignorar o aviso.
    expect(RISK).toMatch(/label: "Checked — no risk signals found"/);
  });

  it("⚠️ e o rótulo diz que não é atestado de saúde", () => {
    expect(RISK).toMatch(/this is NOT a clean bill of health/);
  });
});

describe("③ o explorer não pinta 'não verificado' de verde", () => {
  it("⚠️⚠️ `unverified` tem cor própria, cinza, sem brilho", () => {
    expect(SCANNER).toMatch(/unverified: \{ color: "text-ink-3"/);
    expect(SCANNER).toMatch(/glow: ""/);
  });

  it("⚠️ mostra um traço, não um zero — zero é NOTA", () => {
    expect(SCANNER).toMatch(/result\.score \?\? "—"/);
    expect(SCANNER).toMatch(/result\.score == null \? t\("explorer\.scannerNaoMedido"\)/);
  });

  it("⚠️⚠️ e a barra de score não existe sem medição", () => {
    // Uma barra vazia pintada de verde diria "risco baixo" sobre nada.
    expect(SCANNER).toMatch(/result\.score != null && \(/);
  });

  it("o tipo admite `null` — senão o compilador deixaria o zero voltar", () => {
    expect(SCANNER).toMatch(/score: number \| null;/);
    expect(SCANNER).toMatch(/"safe" \| "caution" \| "risky" \| "danger" \| "unverified"/);
  });

  it("os QUATRO locales têm as chaves novas", () => {
    expect([...MSG.matchAll(/scannerCatUnverified:/g)]).toHaveLength(4);
    expect([...MSG.matchAll(/scannerNaoMedido:/g)]).toHaveLength(4);
  });
});
