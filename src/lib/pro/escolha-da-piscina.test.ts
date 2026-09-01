import { describe, it, expect } from "vitest";
import {
  medirVelas, julgarPar, JANELA_MIN, COBERTURA_MINIMA_PCT, DIFERENCA_QUE_DECIDE_PCT,
  type LeituraDaPiscina, type VelaLida,
} from "./escolha-da-piscina";

const AGORA = 1_756_670_400_000; // 2025-08-31T16:00:00Z, um instante fixo

/** N velas de 1 minuto terminando `atrasoMin` antes de `agora`. */
function velas(n: number, atrasoMin = 0, amplitude = 0.01): VelaLida[] {
  const fim = Math.floor((AGORA - atrasoMin * 60_000) / 1000);
  return Array.from({ length: n }, (_, i) => {
    const t = fim - (n - 1 - i) * 60;
    return { time: t, high: 100 + amplitude, low: 100, close: 100 };
  });
}

function leitura(p: Partial<LeituraDaPiscina> & { piscina: string }): LeituraDaPiscina {
  return {
    rotulo: p.piscina, atual: false, porqueNaoLeu: null,
    velasLidas: 100, velasParadas: 0, minutosComVela: 100,
    coberturaPct: 55, amplitudeMediaPct: 0.01, atrasoMin: 1,
    tvlUsd: 1_000_000, volume24hUsd: 1_000_000, trocas24h: 100, precoUsd: 100,
    ...p,
  };
}

describe("medirVelas — a queixa do gráfico, virada número", () => {
  it("90 minutos com vela numa janela de 180 dão 50% de cobertura", () => {
    const m = medirVelas(velas(90), AGORA);
    expect(m.minutosComVela).toBe(90);
    expect(m.coberturaPct).toBeCloseTo(50, 5);
  });

  it("velas mais velhas que a janela não entram na cobertura", () => {
    // 300 velas: só as 180 que caem dentro da janela contam.
    const m = medirVelas(velas(300), AGORA);
    expect(m.minutosComVela).toBe(180);
    expect(m.coberturaPct).toBe(100);
  });

  it("duas velas no MESMO minuto contam um minuto só", () => {
    const t = Math.floor(AGORA / 1000) - 60;
    const dup: VelaLida[] = [
      { time: t,      high: 101, low: 100, close: 100 },
      { time: t + 30, high: 101, low: 100, close: 100 },
    ];
    const m = medirVelas(dup, AGORA);
    expect(m.velasLidas).toBe(2);
    expect(m.minutosComVela).toBe(1); // não 2 — cobertura afirma MINUTOS
  });

  it("lista vazia é cobertura ZERO, mas atraso DESCONHECIDO — não zero", () => {
    const m = medirVelas([], AGORA);
    expect(m.coberturaPct).toBe(0);
    expect(m.minutosComVela).toBe(0);
    // ⚠️ atraso 0 significaria "acabou de negociar", o oposto da verdade.
    expect(m.atrasoMin).toBeNull();
    expect(m.amplitudeMediaPct).toBeNull();
  });

  it("o atraso olha a vela mais nova mesmo quando ela está FORA da janela", () => {
    const m = medirVelas(velas(5, 400), AGORA); // tudo velho
    expect(m.minutosComVela).toBe(0);
    expect(m.coberturaPct).toBe(0);
    expect(m.atrasoMin).toBeCloseTo(400, 0); // e o atraso ainda é lido
  });

  it("agora inválido não produz número nenhum", () => {
    for (const mau of [NaN, 0, -1, Infinity]) {
      const m = medirVelas(velas(90), mau);
      expect(m.coberturaPct).toBeNull();
      expect(m.atrasoMin).toBeNull();
    }
  });

  it("vela parada é high === low — houve trade, a um preço só", () => {
    const paradas = velas(10).map((c) => ({ ...c, high: c.low }));
    const m = medirVelas([...paradas, ...velas(10, 20)], AGORA);
    expect(m.velasParadas).toBe(10);
  });

  it("vela com preço zero ou high < low é descartada, não somada", () => {
    const sujas: VelaLida[] = [
      { time: Math.floor(AGORA / 1000) - 60, high: 100, low: 101, close: 100 }, // invertida
      { time: Math.floor(AGORA / 1000) - 120, high: 101, low: 100, close: 0 },  // sem preço
    ];
    const m = medirVelas(sujas, AGORA);
    expect(m.velasLidas).toBe(0);
    expect(m.atrasoMin).toBeNull();
  });

  it("⚠️ a janela de N minutos nunca conta N+1 — nem com vela no futuro", () => {
    // 300 velas cobrindo tudo, MAIS uma carimbada 40s no futuro (relógio torto).
    const comFuturo: VelaLida[] = [
      ...velas(300),
      { time: Math.floor((AGORA + 40_000) / 1000), high: 101, low: 100, close: 100 },
    ];
    const m = medirVelas(comFuturo, AGORA, JANELA_MIN);
    expect(m.minutosComVela).toBe(JANELA_MIN);   // não JANELA_MIN + 1
    expect(m.coberturaPct).toBe(100);            // e não 100,55%
  });

  it("a janela é parâmetro e muda a cobertura na proporção certa", () => {
    expect(medirVelas(velas(60), AGORA, 60).coberturaPct).toBe(100);
    expect(medirVelas(velas(60), AGORA, 120).coberturaPct).toBeCloseTo(50, 5);
  });
});

describe("julgarPar — duas réguas, e o silêncio quando discordam", () => {
  it("uma piscina lida só não julga nada — mas a recusa da fonte é dita", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true }),
      leitura({ piscina: "b", porqueNaoLeu: "geckoterminal limite (status 429)" }),
    ]);
    // ⚠️ `inconclusiva`, NÃO `fonte_recusou`: metade da rodada foi medida.
    expect(j.veredito).toBe("inconclusiva");
    expect(j.lidas).toBe(1);
    expect(j.candidatas).toBe(2);
    expect(j.porque).toContain("recusa da fonte");
  });

  /**
   * ⚠️⚠️ O DEFEITO DE 31/08, VIRADO TESTE. A rota devolveu 56 de 62 leituras em
   * 429 e o veredito gravado foi "0 de 1 piscinas foram lidas — comparação
   * precisa de duas", que se lê como "este par só tem uma piscina". O estado
   * real era "não medimos nada". São conclusões opostas.
   */
  it("⚠️ TUDO recusado pela fonte NÃO é 'só existe uma piscina'", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, porqueNaoLeu: "geckoterminal limite (status 429)" }),
      leitura({ piscina: "b", porqueNaoLeu: "geckoterminal limite (status 429)" }),
    ]);
    expect(j.veredito).toBe("fonte_recusou");
    expect(j.porque).toContain("NADA foi medido");
    expect(j.porque).not.toContain("comparação precisa de duas");
  });

  it("⚠️ mas um erro que NÃO é da fonte não vira 'fonte recusou'", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, porqueNaoLeu: "TypeError: x is not a function" }),
      leitura({ piscina: "b", porqueNaoLeu: "TypeError: x is not a function" }),
    ]);
    expect(j.veredito).toBe("inconclusiva");
  });

  it("⚠️ e uma piscina única de verdade continua sendo inconclusiva", () => {
    const j = julgarPar([leitura({ piscina: "a", atual: true })]);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.porque).toContain("comparação precisa de duas");
  });

  it("a atual não lida também é inconclusiva — não há contra o que comparar", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, porqueNaoLeu: "erro" }),
      leitura({ piscina: "b" }),
      leitura({ piscina: "c" }),
    ]);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.atual).toBeNull();
  });

  it("atual ganha nas DUAS réguas → fica", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 90, tvlUsd: 50e6 }),
      leitura({ piscina: "b", coberturaPct: 85, tvlUsd: 10e6 }),
    ]);
    expect(j.veredito).toBe("atual_e_a_melhor");
    expect(j.melhorParaOGrafico).toBe("a");
    expect(j.maiorLiquidez).toBe("a");
  });

  it("alternativa ganha nas DUAS réguas, com folga → trocar", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 30, tvlUsd: 10e6 }),
      leitura({ piscina: "b", coberturaPct: 95, tvlUsd: 80e6 }),
    ]);
    expect(j.veredito).toBe("trocar");
    expect(j.melhorParaOGrafico).toBe("b");
    expect(j.maiorLiquidez).toBe("b");
  });

  it("⚠️ réguas apontando para piscinas DIFERENTES nunca vira recomendação", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 30, tvlUsd: 10e6 }),
      leitura({ piscina: "b", coberturaPct: 95, tvlUsd: 5e6 }),   // gráfico
      leitura({ piscina: "c", coberturaPct: 40, tvlUsd: 90e6 }),  // liquidez
    ]);
    expect(j.veredito).toBe("conflito");
    expect(j.melhorParaOGrafico).toBe("b");
    expect(j.maiorLiquidez).toBe("c");
    expect(j.porque).toContain("NÃO escolhe");
  });

  it("⚠️ cobertura empatada NÃO autoriza ficar quando o TVL de outra é maior", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 88, tvlUsd: 10e6 }),
      leitura({ piscina: "b", coberturaPct: 90, tvlUsd: 90e6 }),
    ]);
    // ganho de 2 pontos está dentro do ruído, mas a liquidez não está
    expect(j.veredito).toBe("conflito");
  });

  it("⚠️ ganho de cobertura dentro do ruído não troca o endereço de produção", () => {
    const dentroDoRuido = DIFERENCA_QUE_DECIDE_PCT - 1;
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 60, tvlUsd: 90e6 }),
      leitura({ piscina: "b", coberturaPct: 60 + dentroDoRuido, tvlUsd: 10e6 }),
    ]);
    expect(j.veredito).toBe("atual_e_a_melhor");
  });

  /**
   * ⚠️⚠️ "NÃO PUBLICOU TAMANHO" E "NÃO PERGUNTAMOS" LEVAM A AÇÕES OPOSTAS.
   * A primeira é um fato sobre a piscina; a segunda é uma rodada a repetir.
   * Sem o motivo, `julgarPar` descrevia duas piscinas de bilhões de dólares
   * como "não devolveram TVL".
   */
  it("⚠️ TVL barrado pela fonte NÃO é 'a piscina não devolveu TVL'", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 20, tvlUsd: null,
                porqueNaoLeuMeta: "geckoterminal limite (status 429)" }),
      leitura({ piscina: "b", coberturaPct: 95, tvlUsd: null,
                porqueNaoLeuMeta: "geckoterminal limite (status 429)" }),
    ]);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.porque).toContain("não foi perguntado");
    expect(j.porque).not.toContain("nenhuma das 2 piscinas lidas devolveu TVL");
  });

  it("⚠️ mas TVL genuinamente ausente continua sendo ausência", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 20, tvlUsd: null, porqueNaoLeuMeta: null }),
      leitura({ piscina: "b", coberturaPct: 95, tvlUsd: null, porqueNaoLeuMeta: null }),
    ]);
    expect(j.porque).toContain("devolveu TVL");
    expect(j.porque).not.toContain("não foi perguntado");
  });

  it("⚠️ sem TVL em ninguém, uma régua faltou — e uma régua só não decide", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 20, tvlUsd: null }),
      leitura({ piscina: "b", coberturaPct: 95, tvlUsd: null }),
    ]);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.maiorLiquidez).toBeNull();
    expect(j.porque).toContain("TVL");
  });

  it("a queixa do dono aparece no texto quando a atual está abaixo do mínimo", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: COBERTURA_MINIMA_PCT - 20, tvlUsd: 90e6 }),
      leitura({ piscina: "b", coberturaPct: COBERTURA_MINIMA_PCT - 18, tvlUsd: 10e6 }),
    ]);
    expect(j.porque).toContain("não se mexe");
    expect(j.porque).toContain(String(JANELA_MIN));
  });

  it("preço parado há muito tempo é dito, mesmo quando a atual vence", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 90, tvlUsd: 90e6, atrasoMin: 40 }),
      leitura({ piscina: "b", coberturaPct: 80, tvlUsd: 10e6 }),
    ]);
    expect(j.veredito).toBe("atual_e_a_melhor");
    expect(j.porque).toContain("história");
  });

  it("empate de cobertura desempata por TVL, não pela ordem do array", () => {
    const j = julgarPar([
      leitura({ piscina: "a", atual: true, coberturaPct: 50, tvlUsd: 1e6 }),
      leitura({ piscina: "b", coberturaPct: 70, tvlUsd: 5e6 }),
      leitura({ piscina: "c", coberturaPct: 70, tvlUsd: 50e6 }),
    ]);
    expect(j.melhorParaOGrafico).toBe("c");
  });
});
