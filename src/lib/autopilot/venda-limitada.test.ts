/**
 * ⚠️⚠️ O BOT PODIA VENDER A BOLSA DO DONO, E A SAÍDA PARCIAL APAGAVA A POSIÇÃO.
 * Achados A13/A14 da auditoria externa (14/09), confirmados no código.
 *
 * Dinheiro real na corretora do cliente, a cada 5 minutos.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { quantoPodeVender, oQueSobrou } from "./venda-limitada";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const CRON = semComentarios(readFileSync(join(process.cwd(), "src/app/api/autopilot/cron/route.ts"), "utf8"));

describe("① a posição do bot é o TETO da venda", () => {
  it("⚠️⚠️ o pedido do modelo acima da posição é CORTADO na posição", () => {
    // O caso real: o bot comprou 0,01 BTC; o cartão manda vender 0,5. Os 0,49
    // de diferença seriam moeda do próprio usuário.
    const v = quantoPodeVender(0.5, 0.01);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.qtd).toBe(0.01);
    expect(v.limitada).toBe(true);
  });

  it("pedido abaixo da posição passa intacto — saída parcial é legítima", () => {
    const v = quantoPodeVender(0.004, 0.01);
    expect(v.ok && v.qtd).toBe(0.004);
    expect(v.ok && v.limitada).toBe(false);
  });

  it("pedido igual à posição não é 'limitada'", () => {
    const v = quantoPodeVender(0.01, 0.01);
    expect(v.ok && v.qtd).toBe(0.01);
    expect(v.ok && v.limitada).toBe(false);
  });

  it("⚠️⚠️ falha FECHADO: ausência de posição não é posição zero", () => {
    // `Number(null) === 0` e passa no isFinite — a armadilha nº 2 desta casa.
    for (const semPosicao of [null, undefined, 0, -1, NaN, Infinity, "abc"]) {
      const v = quantoPodeVender(1, semPosicao);
      expect(v.ok, `${String(semPosicao)} deveria recusar`).toBe(false);
    }
  });

  it("⚠️ quantidade pedida inválida recusa — nunca vira 'vende tudo'", () => {
    for (const pedidoRuim of [0, -3, NaN, Infinity, null, undefined, "x"]) {
      expect(quantoPodeVender(pedidoRuim, 5).ok, `${String(pedidoRuim)} deveria recusar`).toBe(false);
    }
  });
});

describe("② a saída parcial deixa o resto EXISTINDO", () => {
  it("⚠️⚠️ vendeu 1/5 → sobra 4/5 da base e 4/5 do custo", () => {
    const s = oQueSobrou(100, 500, 20);
    expect(s.fecha).toBe(false);
    if (s.fecha) return;
    expect(s.baseRestante).toBe(80);
    expect(s.custoRestante).toBeCloseTo(400, 9);
    expect(s.custoRemovido).toBeCloseTo(100, 9);
  });

  it("⚠️⚠️ o teto de exposição só devolve o que SAIU, não a posição inteira", () => {
    // Era o segundo dano do A14: liberava US$ 500 tendo voltado US$ 100, e o
    // bot comprava por cima com folga que não existe.
    const s = oQueSobrou(100, 500, 20);
    expect(s.custoRemovido).toBeCloseTo(100, 9);
    expect(s.custoRemovido).not.toBe(500);
  });

  it("vendeu tudo → fecha, e o custo removido é o custo inteiro", () => {
    const s = oQueSobrou(100, 500, 100);
    expect(s.fecha).toBe(true);
    expect(s.custoRemovido).toBe(500);
  });

  it("⚠️ ruído de ponto flutuante ao vender tudo ainda FECHA", () => {
    // 0,1 + 0,2 − 0,3 deixa 5,5e-17. Sem isto a posição ficaria viva com poeira
    // e o bot tentaria vendê-la para sempre.
    const s = oQueSobrou(0.3, 100, 0.1 + 0.2);
    expect(s.fecha).toBe(true);
  });

  it("⚠️ preenchimento acima da posição fecha — não deixa resto negativo", () => {
    const s = oQueSobrou(10, 100, 12);
    expect(s.fecha).toBe(true);
  });

  it("⚠️⚠️ sobra pequena demais para vender CONTINUA sendo sobra", () => {
    // Não há corte em dólares de propósito: a linha diz a verdade — o bot tem
    // aquilo e não consegue vender. Apagá-la é que seria a mentira.
    const s = oQueSobrou(1000, 500, 999);
    expect(s.fecha).toBe(false);
    if (s.fecha) return;
    expect(s.baseRestante).toBeCloseTo(1, 9);
    expect(s.custoRestante).toBeCloseTo(0.5, 9);
  });

  it("preenchimento zero/ausente não remove nada", () => {
    const s = oQueSobrou(10, 100, 0);
    expect(s.fecha).toBe(false);
    if (s.fecha) return;
    expect(s.baseRestante).toBe(10);
    expect(s.custoRemovido).toBe(0);
  });

  it("custo removido + custo restante = custo original (nada some, nada nasce)", () => {
    for (const vendido of [1, 7, 33.3, 99.9]) {
      const s = oQueSobrou(100, 500, vendido);
      if (s.fecha) continue;
      expect(s.custoRemovido + s.custoRestante).toBeCloseTo(500, 9);
    }
  });
});

/**
 * ⚠️⚠️ AS TRAVAS DO FIO — leitura de fonte DE PROPÓSITO.
 *
 * As funções acima têm teste que as executa. Mas a peça certa, testada e
 * DESLIGADA do caminho que decide é o padrão nº 8 desta casa, e os testes de
 * comportamento seguiriam verdes com o cron mandando `intent.amount` para a
 * corretora como antes.
 */
describe("③ e o cron REALMENTE usa as duas", () => {
  it("⚠️⚠️ a ordem de venda leva a quantidade CORTADA, não a do cartão", () => {
    /**
     * ⚠️ A ÂNCORA MUDOU DE FORMA, A PROPRIEDADE NÃO. A venda passou a ir pelo
     * executor autoritativo (achado A107), então o pedido virou um objeto
     * nomeado — mas continua tendo de levar `qty: amount`, a quantidade
     * CORTADA pela posição, e nunca a do cartão do modelo.
     */
    expect(CRON).toMatch(/symbol: intent\.symbol, side: "sell",\s*\n?\s*type: intent\.type, qty: amount,/);
    // `qty: intent.amount` na venda seria o defeito inteiro de volta.
    expect(CRON).not.toMatch(/side: "sell",[\s\S]{0,80}qty: intent\.amount/);
  });

  it("⚠️⚠️ a guarda de nocional confere a quantidade ENVIADA", () => {
    // Conferir `intent.amount` e mandar outra coisa mediria o que não vai.
    expect(CRON).toMatch(/checkRealNotional\(\{ side: intent\.side, baseAmount: amount,/);
  });

  it("⚠️⚠️ os TRÊS caminhos de liquidação tratam sobra", () => {
    /**
     * ⚠️ ERAM DOIS E VIRARAM TRÊS — achado A101. O terceiro é a saída armada
     * CANCELADA depois de preenchimento parcial: ela reabria a posição
     * INTEIRA, como se nada tivesse sido vendido. O que já executou é fato
     * imutável; só o remanescente volta.
     *
     * ⚠️⚠️ E NO ROUND 9 A ESCRITA DURÁVEL SAIU DOS TRÊS (A131-C, depois A136).
     *
     * Primeiro a venda imediata passou a projetar pela RPC 0064 (delta
     * cumulativo, para a reconciliação não reduzir a MESMA venda de novo).
     * Depois a liquidação da saída armada também: ela escrevia a posição com
     * `reduzirServerPosition`/`closeServerPosition` e o marcador com OUTRA
     * operação — e qualquer ordem entre as duas quebrava exactly-once.
     *
     * `oQueSobrou` continua nos três caminhos, e o que ele faz agora é a conta
     * EM MEMÓRIA: o teto de exposição desta passada e o texto da nota. Escrita
     * durável, nenhuma.
     */
    const chamadas = [...CRON.matchAll(/const sobra = oQueSobrou\(/g)].length;
    expect(chamadas, "mercado, settle da armada e cancelamento parcial").toBe(3);
    expect([...CRON.matchAll(/reduzirServerPosition\(|closeServerPosition\(/g)].length,
      "nenhuma escrita direta de posição sobrou no cron").toBe(0);
    // A venda imediata projeta; a liquidação da armada é transacional.
    expect(CRON).toMatch(/const projecao = await projetarEfeitoDoIntent\(exec\.intentId\)/);
    expect([...CRON.matchAll(/await liquidarNoLivro\(/g)].length,
      "settle preenchido e settle cancelado-com-parcial").toBe(2);
  });

  it("⚠️⚠️ a base só sai de `ownedBases` quando a posição FECHA", () => {
    // Removê-la numa saída parcial faria o resto sumir do mundo do bot.
    // ⚠️ A131-C: quem afirma que fechou passou a ser a projeção, que decide
    // dentro da transação que reduziu — e não mais a conta em memória.
    const i = CRON.indexOf("ownedBases.delete(base)");
    expect(i).toBeGreaterThan(0);
    const antes = CRON.slice(Math.max(0, i - 400), i);
    expect(antes).toMatch(/else if \(projecao\.fechou\) \{/);
  });

  it("⚠️⚠️ uma saída JÁ ARMADA não recebe segunda ordem de venda", () => {
    expect(CRON).toMatch(/if \(pos\.status === "exit_armed"\)/);
    expect(CRON).toMatch(/a second sell would dump the same bag twice/);
  });

  it("⚠️ e o corte vira EVENTO — o modelo pedir a bolsa do dono não é ruído", () => {
    expect(CRON).toMatch(/recordEvent\("autopilot_venda_limitada_a_posicao"/);
  });
});
