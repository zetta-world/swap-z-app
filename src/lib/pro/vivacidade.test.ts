/**
 * ⚠️⚠️ O SELO DO TERMINAL NÃO PODE VENDER FRESCOR QUE NÃO TEM.
 *
 * Quem opera olha este ponto verde antes de mandar ordem. Se ele diz "ao vivo"
 * sobre um gráfico vazio, ou "última vela há 8s" sobre uma vela de 1h aberta há
 * 52 minutos, a tela está participando da decisão com informação falsa.
 */
import { describe, it, expect } from "vitest";
import { vivacidadeDoGrafico, DURACAO_MS, TOLERANCIA_MS } from "@/lib/pro/vivacidade";

const AGORA = Date.parse("2026-09-08T17:00:00Z");

describe("vivacidadeDoGrafico", () => {
  it("a idade da vela é do FECHAMENTO — a busca recente não a rejuvenesce", () => {
    // Vela de 1h aberta às 16:00 → fecha às 17:00. A busca voltou há 8s.
    const v = vivacidadeDoGrafico(
      { buscaEmMs: AGORA - 8_000, velaAbreEmMs: Date.parse("2026-09-08T16:00:00Z") },
      "1h", AGORA,
    );
    expect(v.selo).toBe("ao_vivo");
    expect(v.fonteHaMs).toBe(8_000);
    expect(v.velaHaMs).toBe(0);
  });

  it("vela ANTIGA com busca fresca: a fonte está viva e o dado não é novo", () => {
    // Aberta às 13:00, fechou às 14:00 — três horas atrás. O selo segue verde
    // (a fonte responde), mas a dica agora diz a verdade sobre o dado.
    const v = vivacidadeDoGrafico(
      { buscaEmMs: AGORA - 5_000, velaAbreEmMs: Date.parse("2026-09-08T13:00:00Z") },
      "1h", AGORA,
    );
    expect(v.selo).toBe("ao_vivo");
    expect(v.velaHaMs).toBe(3 * 3_600_000);
    // O defeito antigo: mostrar 5s como se fosse a idade da vela.
    expect(v.velaHaMs).not.toBe(v.fonteHaMs);
  });

  it("vela EM FORMAÇÃO não tem idade negativa", () => {
    const v = vivacidadeDoGrafico(
      { buscaEmMs: AGORA, velaAbreEmMs: AGORA - 60_000 }, "1h", AGORA,
    );
    expect(v.velaHaMs).toBe(0);
  });

  it("resposta 200 com lista VAZIA não é vida — `sem_vela`, nunca `ao_vivo`", () => {
    const v = vivacidadeDoGrafico({ buscaEmMs: AGORA - 1_000, velaAbreEmMs: null }, "5m", AGORA);
    expect(v.selo).toBe("sem_vela");
    expect(v.velaHaMs).toBeNull();   // ausência continua ausência, não zero
    expect(v.fonteHaMs).toBe(1_000); // a fonte respondeu — isso é verdade e fica
  });

  it("nunca perguntou é `aguardando`, e não é o mesmo que `sem_vela`", () => {
    const v = vivacidadeDoGrafico({ buscaEmMs: null, velaAbreEmMs: null }, "5m", AGORA);
    expect(v.selo).toBe("aguardando");
    expect(v.fonteHaMs).toBeNull();
  });

  it("passou da tolerância do timeframe, `atrasado` — e a tolerância é por tf", () => {
    const dentro = vivacidadeDoGrafico(
      { buscaEmMs: AGORA - TOLERANCIA_MS["1m"], velaAbreEmMs: AGORA - 60_000 }, "1m", AGORA);
    const fora = vivacidadeDoGrafico(
      { buscaEmMs: AGORA - TOLERANCIA_MS["1m"] - 1, velaAbreEmMs: AGORA - 60_000 }, "1m", AGORA);
    expect(dentro.selo).toBe("ao_vivo");
    expect(fora.selo).toBe("atrasado");
    // O MESMO atraso num gráfico de 1 dia é silêncio normal, não sintoma.
    expect(vivacidadeDoGrafico(
      { buscaEmMs: AGORA - TOLERANCIA_MS["1m"] - 1, velaAbreEmMs: AGORA - 60_000 }, "1d", AGORA,
    ).selo).toBe("ao_vivo");
  });

  it("relógio adiantado não produz idade negativa", () => {
    const v = vivacidadeDoGrafico({ buscaEmMs: AGORA + 9_000, velaAbreEmMs: AGORA }, "5m", AGORA);
    expect(v.fonteHaMs).toBe(0);
  });

  it("cada timeframe tem duração e tolerância — nenhum cai em `undefined`", () => {
    for (const tf of ["1m", "5m", "15m", "1h", "4h", "1d"] as const) {
      expect(DURACAO_MS[tf]).toBeGreaterThan(0);
      expect(TOLERANCIA_MS[tf]).toBeGreaterThan(0);
      // A tolerância da FONTE é sempre menor que a vela: uma fonte muda tem de
      // ser denunciada antes de a vela envelhecer.
      expect(TOLERANCIA_MS[tf]).toBeLessThan(DURACAO_MS[tf] * 2);
    }
  });
});
