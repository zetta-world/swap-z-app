/**
 * ENDEREÇO NÃO SE COMPARA COM CAIXA.
 *
 * ⚠️ CICATRIZ (11/08). O dono mandou um print do painel ADMIN ACCESS com a
 * MESMA carteira em duas linhas: `0x072c80f3…b1668a` como `ENV (fixo)` e
 * `0x072c80F3…B1668A` como `legado`, esta com botão de REVOGAR.
 *
 * `envAdminWallets()` devolve minúsculo, o banco guarda com checksum, e a
 * comparação era literal. Três consequências, todas de uma linha:
 *
 *  1. duplicata na tela;
 *  2. o REVOGAR do "legado" apagaria a linha do `tier_cache` — que carrega o
 *     PLANO daquela carteira — enquanto o admin de ENV continuava valendo:
 *     um botão, duas consequências, nenhuma delas a anunciada;
 *  3. a trava do "último admin" contava o sósia e deixava revogar o último.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const rota = readFileSync("src/app/admin/api/admins/route.ts", "utf8");
function semComentarios(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
const src = semComentarios(rota);

describe("a lista não duplica a mesma carteira", () => {
  it("a chave do mapa é normalizada", () => {
    expect(src).toContain("const chave = (w: string) => w.trim().toLowerCase()");
    // E as três origens usam a MESMA chave — se uma escapar, a duplicata volta.
    expect((src.match(/byWallet\.set\(chave\(/g) ?? []).length).toBe(3);
    expect(src).toContain("byWallet.has(chave(");
  });

  /** A carteira EXIBIDA continua com a caixa original — só a chave normaliza. */
  it("mostra o endereço como ele é, sem achatar para minúsculo", () => {
    expect(src).toContain('wallet: r.wallet_address, source: "legacy"');
  });
});

describe("as travas de revogação comparam sem caixa", () => {
  it("não dá para revogar a si mesmo trocando a caixa", () => {
    expect(src).toContain("target.toLowerCase() === actor.toLowerCase()");
  });

  it("a contagem do último admin normaliza os três lados", () => {
    expect((src.match(/\.toLowerCase\(\)\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain("remaining.delete(target.toLowerCase())");
  });

  /**
   * ⚠️ `eq` exigia caixa exata: revogar com o endereço em minúsculo apagava
   * ZERO linhas e devolvia sucesso. O operador via "revogado" e o acesso
   * continuava de pé — a pior forma de falhar, porque parece ter funcionado.
   */
  it("o DELETE não depende da caixa", () => {
    expect(src).toContain('.ilike("wallet_address", target)');
    expect(src).not.toMatch(/delete\(\)\.eq\("wallet_address", target\)/);
  });
});
