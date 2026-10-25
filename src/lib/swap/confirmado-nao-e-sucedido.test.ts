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
 *
 * W3 (21/10): o desfecho Solana passou a vir de `consultarStatus` (servidor, `getSignatureStatuses`)
 * em vez do `confirmTransaction` do navegador (que dava 403). As MESMAS garantias são conferidas no
 * mecanismo novo: `err` decide antes de "confirmada", revertida vira `tx_failed` + `falhou_na_rede`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const EXEC = semComentarios(leia("src/components/swap/ExecuteSwap.tsx"));
const STATUS = semComentarios(leia("src/lib/solana/transmissao.ts"));
const FLUXO = semComentarios(leia("src/lib/solana/executar-swap.ts"));
const MSG  = leia("src/lib/i18n/messages.ts");

describe("① o desfecho on-chain é lido, e o erro decide", () => {
  it("⚠️⚠️ `consultarStatus` olha `err` ANTES de chamar de confirmada", () => {
    const iAusente = STATUS.indexOf('if (!("err" in st) || st.err === undefined) return { estado: "desconhecido"');
    // 24/10: o ramo do erro virou bloco — erro em `processed` ainda é pendente; só confirmed/finalized é falha.
    const iErr = STATUS.indexOf("if (st.err !== null) {");
    const iFalhou = STATUS.indexOf('return { estado: "falhou_na_rede"', iErr);
    const iConf = STATUS.indexOf('return { estado: "confirmada"');
    expect(iAusente).toBeGreaterThan(0);
    expect(iErr).toBeGreaterThan(iAusente);
    expect(iFalhou).toBeGreaterThan(iErr);
    expect(iConf).toBeGreaterThan(iFalhou);
  });

  it("⚠️⚠️ o caminho Solana não chama mais `confirmTransaction` do navegador (403 no RPC público)", () => {
    expect(EXEC).not.toMatch(/confirmTransaction\(/);
    expect(EXEC).not.toMatch(/sendRawTransaction\(/);
    expect(EXEC).toMatch(/await executarSwapSolana\(/);
    expect(FLUXO).toMatch(/const desfecho = await acompanhar\(sig, d\.validoAteBloco\)/);
  });

  it("⚠️⚠️ transação revertida vira `tx_failed`, nunca `tx_confirmed`", () => {
    const i = FLUXO.indexOf('if (desfecho.estado === "falhou_na_rede")');
    expect(i).toBeGreaterThan(0);
    const ramo = FLUXO.slice(i, FLUXO.indexOf('d.ui.fase("tx_confirmed")', i));
    expect(ramo).toMatch(/d\.ui\.fase\("tx_failed"\)/);
    expect(ramo).toMatch(/return \{ historyId: id, resultado: "falhou_na_rede" \}/);
  });

  it("⚠️⚠️ e o HISTÓRICO grava `falhou_na_rede` (status failed) — senão o painel conta receita de um swap que não houve", () => {
    const i = FLUXO.indexOf('if (desfecho.estado === "falhou_na_rede")');
    expect(FLUXO.slice(i, i + 400)).toMatch(/marcar\("falhou_na_rede"/);
  });
});

describe("② a paridade com o caminho EVM, que já estava certo", () => {
  it("o EVM continua distinguindo sucesso de revertido", () => {
    expect(EXEC).toMatch(/if \(receipt\.status === "success"\)/);
  });

  it("⚠️ os DOIS caminhos conferem o desfecho real da transação", () => {
    // EVM: no componente; Solana: no fluxo extraído. Uma checagem de desfecho em cada.
    expect([...EXEC.matchAll(/if \(receipt\.status === "success"\)/g)]).toHaveLength(1);
    expect([...FLUXO.matchAll(/if \(desfecho\.estado === "falhou_na_rede"\)/g)]).toHaveLength(1);
    expect([...FLUXO.matchAll(/d\.ui\.fase\("tx_confirmed"\)/g)]).toHaveLength(1);
  });
});

describe("③ e a frase diz o que aconteceu de verdade", () => {
  it("⚠️ 'chegou à rede mas FALHOU' — não um erro genérico", () => {
    expect(EXEC).toMatch(/texto: \(k\) => tImp\(`swap\.\$\{k\}`\)/);
    expect(FLUXO).toMatch(/d\.texto\("solExecutionFailed"\)/);
  });

  it("os QUATRO locales têm a chave", () => {
    expect([...MSG.matchAll(/solExecutionFailed:/g)]).toHaveLength(4);
  });

  it("⚠️ e o erro da cadeia viaja junto, para dar o que investigar", () => {
    expect(FLUXO).toMatch(/\$\{d\.texto\("solExecutionFailed"\)\} \$\{desfecho\.erro/);
  });
});
