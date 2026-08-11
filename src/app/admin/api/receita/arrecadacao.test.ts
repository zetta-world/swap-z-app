/**
 * ARRECADADO NÃO É TETO, E CUSTO NÃO É RECEITA — as travas da Fase 11.
 *
 * ⚠️ A CICATRIZ: por meses o topo deste painel dizia "RECEITA (TETO, a 1%)
 * $1,27", calculado como 1% de $127 de volume. Em 11/08 a Fase 9 provou que a
 * cotação FIRME nunca mandava a taxa ao 0x — de 13/06 até as 10:42 daquele
 * dia, TODA troca cobrou zero. O arrecadado real no histórico inteiro era uma
 * retenção de $0,092.
 *
 * O teto não era estimativa conservadora do que houve. Era a resposta de outra
 * pergunta — "quanto TERIA rendido SE" — ocupando o lugar do resultado.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

function semComentarios(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
const rota   = semComentarios(readFileSync("src/app/admin/api/receita/route.ts", "utf8"));
const painel = semComentarios(readFileSync("src/components/admin/panels/ReceitaPanel.tsx", "utf8"));
const sync   = semComentarios(readFileSync("src/lib/hooks/useOperationSync.ts", "utf8"));

describe("o arrecadado é soma de PARCELA, nunca porcentagem de agregado", () => {
  /**
   * ⚠️ A DIFERENÇA QUE O PAINEL ESCONDIA. `receitaUsd(volume, "free")` responde
   * "quanto renderia"; somar `platform_fee_usd` responde "quanto rendeu". Se
   * o arrecadado voltar a ser derivado do volume, esta trava quebra.
   */
  it("arrecadado soma platform_fee_usd, e não deriva do volume", () => {
    expect(rota).toContain("platform_fee_usd");
    expect(rota).toMatch(/arrecadado\s*=\s*\{[\s\S]{0,200}reduce/);
    // O teto continua existindo — mas com nome próprio, longe do arrecadado.
    expect(rota).toContain("receitaRealTetoUsd");
    expect(rota).not.toMatch(/arrecadado[\s\S]{0,120}receitaUsd\(/);
  });

  /**
   * ⚠️ AMOSTRA AO LADO DO AGREGADO (invariante nº 6). "Arrecadou $0" e "não
   * temos parcela nenhuma" somam o mesmo total e pedem coisas diferentes.
   */
  it("a contagem de operações que retiveram viaja junto do total", () => {
    expect(rota).toMatch(/arrecadado\s*=\s*\{[\s\S]{0,220}operacoes:/);
    expect(painel).toContain("data.arrecadado.operacoes");
  });

  /** Zero com zero parcelas tem que se explicar na tela, não sumir. */
  it("zero sem parcela nenhuma vira aviso, não um zero mudo", () => {
    expect(painel).toMatch(/arrecadado\.operacoes === 0/);
  });
});

describe("origem que NÃO pode cobrar não é origem que falhou", () => {
  /**
   * ⚠️ `autopilot_cex` e `cex_spot` são ordens do usuário na corretora dele.
   * Não passam por `/api/quote` e não têm onde reter nada — a receita é zero
   * POR CONSTRUÇÃO. Sem essa distinção, "VOLUME $127" ao lado de "RECEITA"
   * faz o leitor concluir que os $127 renderam; onze das dezessete operações
   * não podiam render nada.
   */
  it("a rota marca quais origens têm mecanismo de cobrança", () => {
    expect(rota).toContain("COBRAM");
    expect(rota).toContain("cobravel");
    expect(rota).toMatch(/COBRAM[^\n]*dex_swap/);
    expect(rota).not.toMatch(/COBRAM[^\n]*cex/);
  });

  it("e a tela mostra a diferença em vez de um zero ambíguo", () => {
    expect(painel).toContain("não cobra");
    expect(painel).toMatch(/o\.cobravel \? usdFino\(o\.arrecadadoUsd\) : "—"/);
  });
});

describe("receita nossa e custo do usuário nunca se encostam", () => {
  /**
   * ⚠️ DOIS CAMPOS CHAMADOS "FEE" COM SINAIS OPOSTOS. `feesUsd` no histórico é
   * o que o CLIENTE pagou (gás, ponte, taker). `platformFeeUsd` é o que NÓS
   * recebemos. Sincronizar o primeiro como receita inverteria o sinal — por
   * isso o `useOperationSync` manda um e não o outro.
   */
  it("o sync manda a receita nossa e NÃO manda o custo do usuário", () => {
    expect(sync).toMatch(/platformFeeUsd:\s+e\.platformFeeUsd/);
    expect(sync).not.toMatch(/volumeUsd:\s*e\.feesUsd/);
    expect(sync).not.toMatch(/platformFeeUsd:\s*e\.feesUsd/);
  });
});

describe("o teto não pode voltar para o lugar do resultado", () => {
  /**
   * ⚠️ ELE ERA VERDE E FICAVA NO TOPO. Verde, acima e maior que o arrecadado
   * é a leitura errada montada — o olho pega o maior número colorido de
   * positivo. Âmbar e com "TERIA" no rótulo é o mínimo para ele não mentir.
   */
  it("o teto é âmbar e diz TERIA rendido", () => {
    expect(painel).toMatch(/TETO — TERIA RENDIDO/);
    expect(painel).toMatch(/TETO — TERIA RENDIDO[\s\S]{0,120}adm-amber/);
  });

  /** O arrecadado é o primeiro bloco da tela, antes de qualquer projeção. */
  it("ARRECADADO aparece antes do TETO e antes da PROJEÇÃO", () => {
    const iArr  = painel.indexOf("ARRECADADO");
    const iTeto = painel.indexOf("TETO — TERIA RENDIDO");
    const iProj = painel.indexOf("PROJEÇÃO");
    expect(iArr).toBeGreaterThan(-1);
    expect(iArr).toBeLessThan(iTeto);
    expect(iArr).toBeLessThan(iProj);
  });
});

describe("arrecadação pequena não pode ser arredondada até sumir", () => {
  /**
   * ⚠️ A PRIMEIRA RETENÇÃO DA HISTÓRIA FOI $0,092. Com duas casas ela vira
   * "$0,09"; a próxima, menor, viraria "$0,00" — um valor que existe exibido
   * como se não existisse, que é a forma mais silenciosa de perder receita de
   * vista.
   */
  it("valores abaixo de $1 são escritos com quatro casas", () => {
    expect(painel).toContain("usdFino");
    expect(painel).toMatch(/n < 1 \? `\$\$\{n\.toFixed\(4\)\}`/);
  });
});


describe("arrecadar SEM saber quanto era devido não é conferir", () => {
  /**
   * ⚠️ O SWAP DAS 11:17 ARRECADOU E GRAVOU `platform_fee_bps = NULL`.
   *
   * O valor retido estava lá — $0,0918 sobre $9,187 — mas os pontos-base
   * pedidos não viajaram: o campo existia no tipo, existia no sync, e o
   * `ExecuteSwap` nunca o preenchia porque só lia `body.result` da cotação e
   * descartava `body.taxa`.
   *
   * Sem os bps, o livro responde "arrecadamos algo" e não "arrecadamos o
   * certo" — e a diferença entre 1,00% e 0,10% num plano `free` seria
   * invisível. Retenção sem a régua que a julga é a invariante nº 5: número
   * sem o `n` que o sustenta.
   */
  const exec = semComentarios(readFileSync("src/components/swap/ExecuteSwap.tsx", "utf8"));

  it("o cliente guarda os bps que a cotação declarou", () => {
    expect(exec).toContain("taxaBpsRef");
    expect(exec).toMatch(/body\?\.taxa\?\.bps/);
  });

  it("e eles viajam junto com o valor retido", () => {
    expect(exec).toMatch(/platformFeeBps:\s+taxaBpsRef\.current/);
    expect(sync).toMatch(/platformFeeBps:\s+e\.platformFeeBps/);
  });
});
