/**
 * AS TRAVAS DA MESA DE LIQUIDEZ.
 *
 * ⚠️ A perda impermanente é o lugar onde esta família engana: o APR da taxa
 * está publicado em toda interface, e a metade que falta não está. Estes testes
 * protegem a metade que falta — e, principalmente, o SINAL dela.
 */

import { describe, it, expect } from "vitest";
import {
  perdaImpermanente, janelaPiscina, resumirLiquidez, vereditoLiquidez,
  ALVOS, MIN_PISCINAS, type AlvoPiscina, type JanelaPiscina,
} from "@/lib/lab/liquidez";

/** Helpers em escopo de MÓDULO — já escorreguei duas vezes prendendo em `describe`. */
const alvo = (over: Partial<AlvoPiscina> = {}): AlvoPiscina => ({
  id: "t", base: "ETH", cotacao: null, rotulo: "ETH / USDC",
  llama: { project: "p", symbol: "s", chain: "c" }, porque: "teste", ...over,
});

const janela = (over: Partial<JanelaPiscina> = {}): JanelaPiscina => ({
  alvo: alvo(), dias: 90, razao: 1, ilPct: 0, taxaPct: 5,
  liquidoPct: 5, segurarPct: 0, apyDe: "apyBase", apyAnualPct: 20, ...over,
});

describe("perda impermanente — o sinal é a trava", () => {
  /**
   * ⚠️ A INVARIANTE DESTA FAMÍLIA. Estar na piscina não pode render MAIS que
   * segurar por efeito de preço: o ganho vem da taxa, que entra por fora. Um
   * valor positivo aqui é o mesmo defeito que "custo negativo" (nº 1) e "ida e
   * volta que ganha" (nº 2), com a roupa desta fase.
   */
  it("NUNCA é positiva, para nenhuma razão", () => {
    for (const r of [0.01, 0.5, 0.9, 1, 1.1, 2, 5, 100, 1e6]) {
      expect(perdaImpermanente(r), `razao=${r}`).toBeLessThanOrEqual(0);
    }
  });

  it("é exatamente zero quando os preços não divergem", () => {
    expect(perdaImpermanente(1)).toBe(0);
  });

  /** Dobrar de preço custa ~5,7% — o número de referência da literatura. */
  it("bate os pontos conhecidos da curva", () => {
    expect(perdaImpermanente(2) * 100).toBeCloseTo(-5.72, 1);
    expect(perdaImpermanente(4) * 100).toBeCloseTo(-20.0, 1);
    expect(perdaImpermanente(1.25) * 100).toBeCloseTo(-0.62, 1);
  });

  /**
   * ⚠️ SIMÉTRICA: subir 2× e cair para metade doem igual. Se der diferente, a
   * razão foi montada invertida em algum lado — e um par inteiro sairia com a
   * perda do outro.
   */
  it("é simétrica entre subir e cair na mesma proporção", () => {
    for (const r of [1.5, 2, 3, 10]) {
      expect(perdaImpermanente(r)).toBeCloseTo(perdaImpermanente(1 / r), 12);
    }
  });

  it("entrada inválida vira zero, não NaN", () => {
    for (const r of [0, -1, NaN, Infinity]) {
      expect(perdaImpermanente(r)).toBe(0);
    }
  });
});

describe("a janela de uma piscina", () => {
  const base = {
    alvo: alvo(), precoCotacaoIni: null, precoCotacaoFim: null,
    apyBase: 20, apyMean30d: null, dias: 365,
  };

  it("preço parado: perda zero, e o líquido é a taxa inteira", () => {
    const j = janelaPiscina({ ...base, precoBaseIni: 2000, precoBaseFim: 2000 })!;
    expect(j.ilPct).toBe(0);
    expect(j.taxaPct).toBeCloseTo(20, 6);
    expect(j.liquidoPct).toBeCloseTo(20, 6);
    expect(j.segurarPct).toBeCloseTo(0, 6);
  });

  /**
   * ⚠️ O CASO QUE VENDE A MESA ERRADA: o ativo dobra, a piscina fica positiva
   * pela taxa — e MESMO ASSIM perde feio de ter segurado.
   */
  it("ativo dobra: a piscina fica positiva e ainda assim perde de segurar", () => {
    const j = janelaPiscina({ ...base, precoBaseIni: 2000, precoBaseFim: 4000 })!;
    expect(j.ilPct).toBeCloseTo(-5.72, 1);
    expect(j.liquidoPct).toBeGreaterThan(0);        // taxa 20% − perda 5,7%
    expect(j.segurarPct).toBeCloseTo(50, 6);        // metade parada, metade dobrou
    expect(j.liquidoPct).toBeLessThan(j.segurarPct);
  });

  /** Dois voláteis que andam JUNTOS quase não têm perda — a razão fica em 1. */
  it("dois voláteis correlacionados quase não perdem", () => {
    const j = janelaPiscina({
      ...base, alvo: alvo({ base: "BTC", cotacao: "ETH" }),
      precoBaseIni: 100, precoBaseFim: 150,
      precoCotacaoIni: 10, precoCotacaoFim: 15,
    })!;
    expect(j.razao).toBeCloseTo(1, 9);
    expect(j.ilPct).toBe(0);
  });

  /** A taxa é proporcional aos dias, e a tela diz que é proporcional. */
  it("a taxa acompanha o tamanho da janela", () => {
    const meio = janelaPiscina({ ...base, precoBaseIni: 1, precoBaseFim: 1, dias: 182.5 })!;
    expect(meio.taxaPct).toBeCloseTo(10, 6);
  });

  /**
   * ⚠️ APY AUSENTE NÃO É TAXA ZERO (invariante nº 6). A janela sai marcada, e
   * quem consome exclui — nunca conclui "a taxa não cobre".
   */
  it("sem APY nenhum, a janela sai MARCADA como ausente", () => {
    const j = janelaPiscina({
      ...base, precoBaseIni: 1, precoBaseFim: 1, apyBase: null, apyMean30d: null,
    })!;
    expect(j.apyDe).toBe("ausente");
    expect(j.apyAnualPct).toBeNull();
  });

  it("cai para apyMean30d só quando apyBase falta, e diz de onde veio", () => {
    const j = janelaPiscina({
      ...base, precoBaseIni: 1, precoBaseFim: 1, apyBase: null, apyMean30d: 7,
    })!;
    expect(j.apyDe).toBe("apyMean30d");
    expect(j.apyAnualPct).toBe(7);
  });

  it("preço faltando devolve null em vez de inventar janela", () => {
    expect(janelaPiscina({ ...base, precoBaseIni: 0, precoBaseFim: 100 })).toBeNull();
    expect(janelaPiscina({ ...base, precoBaseIni: 100, precoBaseFim: null })).toBeNull();
  });
});

describe("o resumo e o veredito", () => {
  /**
   * ⚠️ O CONTROLE NÃO ENTRA NAS MEDIANAS. Um par estável tem perda ≈0 e
   * entraria puxando o número para cima como se fosse mérito da estratégia.
   */
  it("o par de controle fica fora das medianas", () => {
    const r = resumirLiquidez([
      janela({ ilPct: -10, liquidoPct: -5 }),
      janela({ ilPct: -8,  liquidoPct: -3 }),
      janela({ alvo: alvo({ controle: true }), ilPct: 0, liquidoPct: 5 }),
    ]);
    expect(r.medidas).toHaveLength(2);
    expect(r.ilMedianoPct).toBeLessThan(0);
    expect(r.janelas).toHaveLength(3);   // mas continua visível na tela
  });

  it("amostra abaixo do piso é CINZA, nunca reprovada", () => {
    const r = resumirLiquidez([janela(), janela()]);
    const v = vereditoLiquidez(r, MIN_PISCINAS);
    expect(v.status).toBe("cinza");
    expect(v.texto).toContain("inconclusivo não é reprovado");
  });

  it("líquido negativo mata a mesa", () => {
    const r = resumirLiquidez([
      janela({ taxaPct: 3, ilPct: -10, liquidoPct: -7, segurarPct: -20 }),
      janela({ taxaPct: 3, ilPct: -9,  liquidoPct: -6, segurarPct: -20 }),
      janela({ taxaPct: 3, ilPct: -11, liquidoPct: -8, segurarPct: -20 }),
    ]);
    expect(vereditoLiquidez(r).status).toBe("morta");
  });

  /**
   * ⚠️ O TESTE QUE MATA. Positiva e ainda assim pior que segurar: a taxa foi
   * paga com o patrimônio do próprio provedor.
   */
  it("positiva mas abaixo de segurar TAMBÉM mata", () => {
    const r = resumirLiquidez([
      janela({ liquidoPct: 12, segurarPct: 40 }),
      janela({ liquidoPct: 14, segurarPct: 45 }),
      janela({ liquidoPct: 13, segurarPct: 42 }),
    ]);
    const v = vereditoLiquidez(r);
    expect(v.status).toBe("morta");
    expect(v.texto).toContain("PERDE de segurar");
  });

  it("cobre a perda E bate segurar: verde", () => {
    const r = resumirLiquidez([
      janela({ liquidoPct: 18, segurarPct: 5 }),
      janela({ liquidoPct: 20, segurarPct: 6 }),
      janela({ liquidoPct: 19, segurarPct: 4 }),
    ]);
    expect(vereditoLiquidez(r).status).toBe("verde");
  });
});

describe("os alvos declarados", () => {
  it("tem grupo de controle, e é exatamente um", () => {
    expect(ALVOS.filter((a) => a.controle)).toHaveLength(1);
  });

  /** Piscina sem o porquê na tela vira constante que ninguém confere. */
  it("toda piscina declara por que está na lista", () => {
    for (const a of ALVOS) expect(a.porque.length, a.id).toBeGreaterThan(20);
  });

  /** Sem voláteis suficientes o piso de amostra nunca fecha. */
  it("há alvos não-controle bastantes para o piso", () => {
    expect(ALVOS.filter((a) => !a.controle).length).toBeGreaterThanOrEqual(MIN_PISCINAS);
  });
});
