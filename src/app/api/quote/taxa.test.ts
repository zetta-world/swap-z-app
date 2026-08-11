/**
 * A TAXA NO CAMINHO DA COTAÇÃO — Fase 9.2.
 *
 * ⚠️ Esta é a primeira vez que o projeto tira dinheiro do usuário no ato do
 * swap. As travas aqui protegem três coisas, e nenhuma é sobre o valor da
 * taxa: que ela NÃO seja pedida sem destino, que ela NÃO vaze para a Solana, e
 * que ela chegue à TELA — cobrar sem dizer é o que destrói confiança de uma vez.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function semComentarios(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
const rota  = semComentarios(readFileSync("src/app/api/quote/route.ts", "utf8"));
const zerox = semComentarios(readFileSync("src/lib/api/zerox.ts", "utf8"));
const lifi  = semComentarios(readFileSync("src/lib/api/lifi.ts", "utf8"));
const jup   = semComentarios(readFileSync("src/lib/api/jupiter.ts", "utf8"));

describe("a taxa só é pedida com destinatário", () => {
  /**
   * ⚠️ `swapFeeBps` sem `swapFeeRecipient` é cotação recusada — ou, pior,
   * aceita retendo para lugar nenhum. Os dois lados andam juntos.
   */
  it("0x exige bps E destinatário antes de mandar qualquer coisa", () => {
    expect(zerox).toContain("if (!(bps > 0) || !args.feeRecipient) return;");
    expect(zerox).toContain('params.set("swapFeeBps"');
    expect(zerox).toContain('params.set("swapFeeRecipient"');
  });

  it("LI.FI idem", () => {
    expect(lifi).toContain("if ((args.feeBps ?? 0) > 0 && args.feeRecipient)");
  });

  /**
   * ⚠️ A LI.FI RECEBE FRAÇÃO, NÃO PONTOS-BASE. Mandar `100` ali seria pedir
   * 10.000% — a conversão fica no ponto de contato, não em quem chama.
   */
  it("a LI.FI recebe fração, e a conversão está no ponto de contato", () => {
    /**
     * ⚠️ A ASSERÇÃO TEM QUE CITAR A LINHA DA TAXA, não só o divisor.
     *
     * A primeira versão conferia `"/ 10_000).toString()"` — string que também
     * aparece na conversão de SLIPPAGE, três linhas acima. A mutação que
     * trocava a fração por bps passou verde: o teste achava o divisor do
     * vizinho e dava por conferido. Achado pelo próprio teste de mutação.
     */
    expect(lifi).toContain('params.set("fee", ((args.feeBps as number) / 10_000).toString())');
    expect(lifi).not.toMatch(/params\.set\("fee",\s*String\(args\.feeBps\)\)/);
  });

  /** ⚠️ O 0x cobra no token de SAÍDA: no de entrada cobraria antes da troca. */
  it("o 0x cobra no token de saída", () => {
    expect(zerox).toContain('params.set("swapFeeToken", args.buyToken)');
  });
});

describe("a Solana não cobra — e a ausência é declarada", () => {
  it("a Jupiter não recebe platformFeeBps", () => {
    expect(jup).not.toContain('params.set("platformFeeBps"');
  });

  /** A família da cadeia decide, e `bpsEfetivos` devolve 0 sem conta. */
  it("a rota decide a taxa por família de cadeia", () => {
    expect(rota).toContain('fromChain === "solana" ? "solana" : "evm"');
    expect(rota).toContain("bpsEfetivos(planoDoCotante, familiaCadeia)");
  });
});

describe("a taxa chega à tela", () => {
  /**
   * ⚠️ COBRAR SEM DIZER destrói confiança de uma vez, e não se recupera. A
   * taxa vai em TODA resposta de sucesso — inclusive quando é zero, porque
   * "0%" e "campo ausente" são afirmações diferentes.
   */
  it("toda resposta de sucesso carrega a taxa", () => {
    const sucessos = rota.match(/ok: true/g) ?? [];
    const comTaxa  = rota.match(/taxa,/g) ?? [];
    expect(sucessos.length).toBeGreaterThan(0);
    expect(comTaxa.length).toBe(sucessos.length);
  });

  it("a taxa devolvida traz plano, bps e porcentagem", () => {
    expect(rota).toContain("tier: planoDoCotante");
    expect(rota).toContain("pct:");
  });
});

describe("a divulgação chega ao usuário antes da assinatura", () => {
  const card = readFileSync("src/components/swap/SwapCard.tsx", "utf8");
  const hook = readFileSync("src/lib/hooks/useQuotes.ts", "utf8");
  const msgs = readFileSync("src/lib/i18n/messages.ts", "utf8");

  /**
   * ⚠️ A TRAVA QUE MAIS IMPORTA DESTA FASE. Reter 1% sem dizer é o que a
   * primeira pessoa a conferir no explorador transforma em acusação pública —
   * e isso não se recupera. A cobrança e a divulgação sobem juntas, ou nenhuma
   * das duas sobe.
   */
  it("o card do swap mostra a taxa da plataforma", () => {
    expect(card).toContain("swap.platformFee");
    expect(card).toContain("taxaPlataforma");
  });

  it("a taxa viaja da rota até a tela", () => {
    expect(hook).toContain("taxa:         body.taxa ?? null");
    expect(card).toContain("taxaPlataforma={quotesState.taxa}");
  });

  it("a explicação existe nos 4 idiomas", () => {
    expect((msgs.match(/platformFee:/g) ?? [])).toHaveLength(4);
    expect((msgs.match(/platformFeeTip:/g) ?? [])).toHaveLength(4);
  });

  /** ⚠️ Zero também é dito. "0%" e campo ausente são afirmações diferentes. */
  it("a linha aparece mesmo quando a taxa é zero", () => {
    expect(card).toContain("{taxaPlataforma && (");
    expect(card).not.toContain("taxaPlataforma.pct > 0 && (");
  });
});

describe("sem sessão, o plano é o mais caro", () => {
  /**
   * ⚠️ Falha de resolução vira `free` — NUNCA "sem taxa". O contrário faria
   * qualquer erro de sessão virar swap de graça.
   */
  it("o fallback do plano é free, não ausência de taxa", () => {
    expect(rota).toContain('if (!s) return "free";');
    expect(rota).toContain('catch { return "free"; }');
  });
});
