/**
 * ⚠️⚠️ UM SWAP DE SOLANA QUE FALHOU NA CADEIA ERA ANUNCIADO COMO CONFIRMADO.
 * Achado A19 da auditoria externa.
 *
 * `connection.confirmTransaction` responde "esta assinatura chegou a um slot
 * confirmado" — NÃO "ela deu certo". Uma transação que pousou e reverteu
 * (slippage estourado, saldo insuficiente, CPI que falhou) CONFIRMA, com o erro
 * dentro de `value.err`. E o retorno era jogado fora.
 *
 * O desfecho: a tela dizia "Swap confirmado", os tokens nunca chegavam, o
 * histórico gravava `confirmed` — e o `useOperationSync` contava volume e
 * receita em cima de um swap que não aconteceu.
 *
 * ⚠️ O CAMINHO EVM JÁ FAZIA CERTO, 200 LINHAS ACIMA NO MESMO ARQUIVO:
 * `if (receipt.status === "success")`. É a peça certa, escrita, e o outro
 * caminho sem ela — o padrão que esta auditoria mais encontrou.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const EXEC = semComentarios(leia("src/components/swap/ExecuteSwap.tsx"));
const MSG  = leia("src/lib/i18n/messages.ts");

describe("① o retorno da confirmação é lido", () => {
  it("⚠️⚠️ `confirmTransaction` tem o resultado guardado, não descartado", () => {
    expect(EXEC).toMatch(/const conf = await solConn\.confirmTransaction\(/);
    // O `await` solto era o defeito inteiro.
    expect(EXEC).not.toMatch(/^\s*await solConn\.confirmTransaction\(/m);
  });

  it("⚠️⚠️ e `value.err` decide — confirmado não é sucedido", () => {
    expect(EXEC).toMatch(/if \(conf\.value\.err\)/);
  });

  it("⚠️⚠️ transação revertida vira `tx_failed`, nunca `tx_confirmed`", () => {
    const i = EXEC.indexOf("if (conf.value.err)");
    expect(i).toBeGreaterThan(0);
    const ramo = EXEC.slice(i, EXEC.indexOf("setPhase(\"tx_confirmed\")", i));
    expect(ramo).toMatch(/setPhase\("tx_failed"\)/);
    expect(ramo).toMatch(/return;/);
  });

  it("⚠️⚠️ e o HISTÓRICO grava `failed` — senão o painel conta receita de um swap que não houve", () => {
    const i = EXEC.indexOf("if (conf.value.err)");
    const ramo = EXEC.slice(i, i + 700);
    expect(ramo).toMatch(/updateHistory\(historyId\.current, \{ status: "failed", txHash: sig \}\)/);
  });
});

describe("② a paridade com o caminho EVM, que já estava certo", () => {
  it("o EVM continua distinguindo sucesso de revertido", () => {
    expect(EXEC).toMatch(/if \(receipt\.status === "success"\)/);
  });

  it("⚠️ os DOIS caminhos agora conferem o desfecho real da transação", () => {
    // Um `setPhase("tx_confirmed")` sem checagem antes seria o defeito de volta.
    const confirmados = [...EXEC.matchAll(/setPhase\("tx_confirmed"\)/g)].length;
    const checagens = [...EXEC.matchAll(/if \(receipt\.status === "success"\)|if \(conf\.value\.err\)/g)].length;
    expect(confirmados).toBeGreaterThan(0);
    expect(checagens, "uma checagem por caminho").toBe(2);
  });
});

describe("③ e a frase diz o que aconteceu de verdade", () => {
  it("⚠️ 'chegou à rede mas FALHOU' — não um erro genérico", () => {
    // "confirmationFailed" diria que a confirmação não veio. Ela veio: o que
    // falhou foi a transação. São coisas diferentes e o dono precisa saber qual.
    expect(EXEC).toMatch(/swap\.solExecutionFailed/);
  });

  it("os QUATRO locales têm a chave", () => {
    expect([...MSG.matchAll(/solExecutionFailed:/g)]).toHaveLength(4);
  });

  it("⚠️ e o erro da cadeia viaja junto, para dar o que investigar", () => {
    expect(EXEC).toMatch(/JSON\.stringify\(conf\.value\.err\)/);
  });
});
