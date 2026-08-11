/**
 * A ORIGEM DO TIER NÃO PODE MENTIR.
 *
 * ⚠️ CICATRIZ (11/08). O dono conectou uma carteira EVM, viu "SIGNED IN", ficou
 * no plano Free e perguntou por que não funcionava. O banco dizia
 * `source: "nft", tier: "free"` — que se lê como *"olhamos seus NFTs e você não
 * tem nenhum"*. Ninguém olhou: os passes vivem na SOLANA e o bloco de checagem
 * nem roda para EVM.
 *
 * A causa era o CHECK da coluna não aceitar um quarto estado, então o código
 * gravava `"nft"` com um comentário admitindo a troca. A restrição do banco
 * forçou a mentira — invariante nº 6, com o preço de um dono achando que o
 * produto estava quebrado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const check  = readFileSync("src/lib/tier/check.ts", "utf8");
const tipos  = readFileSync("src/lib/tier/types.ts", "utf8");
const migra  = readFileSync("supabase/migrations/0022_origem_do_tier_honesta.sql", "utf8");

/** Ver `espelho.test.ts`: comentário lido como código também APROVA. */
function semComentarios(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

describe("os dois estados existem e são distintos", () => {
  it("o tipo separa 'checou e não tem' de 'não checou'", () => {
    expect(tipos).toContain('"sem_pass"');
    expect(tipos).toContain('"nao_checado"');
  });

  it("o banco aceita os dois — era o CHECK que forçava a mentira", () => {
    expect(migra).toContain("sem_pass");
    expect(migra).toContain("nao_checado");
  });

  /**
   * ⚠️ A TRAVA PRINCIPAL: nenhuma tradução de origem na hora de gravar. Era
   * ali que a verdade era reescrita, mesmo quando quem chamava dizia certo.
   */
  it("a origem é gravada como veio, sem traduzir para 'nft'", () => {
    const src = semComentarios(check);
    expect(src).toContain("source: result.source");
    expect(src).not.toMatch(/source:.*\?\s*"nft"/);
    expect(src).not.toContain('{ ...free, source: "nft" }');
  });

  /** E `"default"` não pode voltar: ele era o estado sem nome que virava nft. */
  it("o estado sem nome ('default') não existe mais", () => {
    expect(semComentarios(tipos)).not.toContain('"default"');
    expect(semComentarios(check)).not.toContain('"default"');
  });

  /**
   * ⚠️ A DECISÃO DEPENDE DA CADEIA: só Solana pode ter passe, então só ela
   * pode registrar `sem_pass`. Qualquer outra cadeia é `nao_checado`.
   */
  it("a cadeia decide qual dos dois é gravado", () => {
    const src = semComentarios(check);
    expect(src).toContain('chain === "solana" ? "sem_pass" : "nao_checado"');
  });
});

describe("a tela conta onde os passes vivem", () => {
  const msgs = readFileSync("src/lib/i18n/messages.ts", "utf8");
  const view = readFileSync("src/components/pricing/PricingView.tsx", "utf8");

  /** ⚠️ Sem isto, quem conecta EVM fica no Free sem pista nenhuma. */
  it("o pricing avisa que os passes são de Solana, nos 4 idiomas", () => {
    expect(view).toContain("pricing.solanaOnly");
    expect(msgs.match(/solanaOnly:/g) ?? []).toHaveLength(4);
  });
});
