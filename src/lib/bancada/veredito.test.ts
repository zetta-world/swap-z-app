/**
 * ⚠️ AS TRÊS INVARIANTES QUE ATRAVESSAM DO ADMIN, cada uma comprada com uma
 * medição errada que foi ao ar: a grade VERDE tendo perdido metade do capital,
 * o painel do Valhalla exibindo n=2 com o peso de n=268, e cinco linhas com cor
 * de prejuízo para medição que não existia.
 */
import { describe, it, expect } from "vitest";
import { julgar, resumir, NAO_MEDIDO } from "@/lib/bancada/veredito";
import type { RodadaDoMotor, Operacao, Desfecho } from "@/lib/bancada/motor";
import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";

const e: EstrategiaDoCliente = {
  entrada: { tipo: "media", n: 20 }, direcao: "compra",
  alvoPct: 2.5, stopPct: 2.5, horasLimite: 24, praca: "spot_gate", papel: "taker",
};

/** `n` operações, cada uma com `brutoPct`, do desfecho pedido. */
function rodada(n: number, brutoPct: number, desfecho: Desfecho = "alvo"): RodadaDoMotor {
  const operacoes: Operacao[] = Array.from({ length: n }, (_, k) => ({
    abriuEm: k, entrada: 100, saida: 100 + brutoPct, desfecho,
    brutoPct, liquidoPct: brutoPct - 0.4,
  }));
  return { operacoes, velasLidas: 1000, aindaAbertas: 0 };
}

describe("a amostra tem precedência sobre o sinal", () => {
  it("⚠️ nenhuma operação não é resultado ruim, é AUSÊNCIA de resultado", () => {
    const v = julgar(resumir(rodada(0, 0), e), e, 0);
    expect(v.veredito).toBe("ruido");
    expect(v.classe).toBe("sem_dado");
    expect(v.pinta).toBe(false);
    expect(v.titulo).toMatch(/NÃO ABRIU/);
  });

  it("⚠️ um lucro enorme com n=6 continua sendo ruído, e sem cor", () => {
    // +4% por operação seria espetacular. Com seis operações é cara-ou-coroa,
    // e pintá-lo de verde é o defeito do painel do Valhalla.
    const v = julgar(resumir(rodada(6, 4), e), e, 0);
    expect(v.veredito).toBe("ruido");
    expect(v.pinta).toBe(false);
    expect(v.rotuloDaAmostra).toMatch(/ruído/);
  });

  it("acima do limiar o veredito passa a valer (a metade positiva)", () => {
    const v = julgar(resumir(rodada(40, 4), e), e, 0);
    expect(v.pinta).toBe(true);
    expect(v.veredito).toBe("ganhou");
  });
});

describe("os três estados da cor — e o zero que não é ganho", () => {
  it("⚠️ perdeu dinheiro é VERMELHO mesmo tendo batido o competidor", () => {
    // A cicatriz literal: a grade perdeu 51% e saiu verde porque segurar perdeu
    // 66%. Perder menos que o competidor não é ganhar.
    const v = julgar(resumir(rodada(40, -2), e), e, -20);
    expect(v.veredito).toBe("perdeu");
    expect(v.classe).toBe("perdeu");
  });

  it("⚠️ ganhou dinheiro mas o competidor rendeu mais → ÂMBAR, não verde", () => {
    const resumo = resumir(rodada(40, 1), e);   // líquido +0,6 × 40 = +24
    const v = julgar(resumo, e, 100);           // ficar parado rendia +100
    expect(v.veredito).toBe("ganhou_perdendo_do_indice");
    expect(v.classe).toBe("so_perdeu_menos");
    expect(v.titulo).toMatch(/não fazer nada teria rendido mais/);
  });

  it("ganhou dos dois → verde", () => {
    const v = julgar(resumir(rodada(40, 1), e), e, 1);
    expect(v.veredito).toBe("ganhou");
  });
});

describe("⚠️ o que não foi medido tem NOME, e nunca vira zero", () => {
  it("a derrapagem entra sempre — backtest lê vela, e vela não tem livro", () => {
    const resumo = resumir(rodada(40, 1), e);
    expect(resumo.derrapagemPct).toBeNull();      // ⚠️ nulo, jamais 0
    const v = julgar(resumo, e, 0);
    expect(v.naoMedido).toContain(NAO_MEDIDO.derrapagem);
  });

  it("na DEX o gás entra também — ele não está na taxa do pool", () => {
    const naDex = { ...e, praca: "dex" as const };
    const v = julgar(resumir(rodada(40, 1), naDex), naDex, 0);
    expect(v.naoMedido).toContain(NAO_MEDIDO.gas);
    // E na CEX ele não aparece: listar o que não se aplica dilui a lista.
    expect(julgar(resumir(rodada(40, 1), e), e, 0).naoMedido).not.toContain(NAO_MEDIDO.gas);
  });

  it("⚠️ competidor ausente é NOMEADO, não tratado como zero", () => {
    // Zero afirmaria que o mercado ficou parado — medição que ninguém fez.
    const v = julgar(resumir(rodada(40, 1), e), e, null);
    expect(v.competidorPct).toBeNull();
    expect(v.naoMedido.join(" ")).toMatch(/ficar em caixa/);
    // Sem competidor não dá para dizer "bateu o índice": sobra só ganhou/perdeu.
    expect(v.veredito).toBe("ganhou");
  });
});

describe("a contagem separa as quatro classes", () => {
  it("⚠️ expirada NO LUCRO não conta como acerto de tese", () => {
    // Contá-la como vitória infla a borda; como derrota, infla o custo.
    const resumo = resumir(rodada(40, 1, "expirada"), e);
    expect(resumo.n).toBe(40);
    expect(resumo.acertos).toBe(0);
    expect(resumo.acertoPct).toBe(0);
    expect(resumo.porDesfecho).toEqual({ alvo: 0, stop: 0, expirada: 40 });
  });

  it("⚠️ a taxa aparece NEGATIVA — é dinheiro que sai", () => {
    const resumo = resumir(rodada(10, 1), e);
    expect(resumo.taxaPct).toBeCloseTo(-4.0, 6);   // 10 × 0,40%
    expect(resumo.brutoPct + resumo.taxaPct).toBeCloseTo(resumo.liquidoPct, 6);
  });

  it("⚠️ bruto positivo e líquido negativo: a frase acusa o PEDÁGIO", () => {
    // É literalmente o Maker de Faixa: acertou 70,4% e entregou 121% do ganho
    // de preço em taxa.
    const resumo = resumir(rodada(40, 0.3), e);   // +0,3 bruto, −0,1 líquido
    expect(resumo.brutoPct).toBeGreaterThan(0);
    expect(resumo.liquidoPct).toBeLessThan(0);
    const v = julgar(resumo, e, -50);
    expect(v.veredito).toBe("perdeu");
    expect(v.porque).toMatch(/pedágio comeu tudo/);
  });

  it("o equilíbrio exigido acompanha o veredito", () => {
    const v = julgar(resumir(rodada(40, 1), e), e, 0);
    expect(v.equilibrioPct).toBeCloseTo(58.0, 1);   // ±2,5% com custo 0,40%
  });
});
