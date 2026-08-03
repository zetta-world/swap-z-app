import { describe, it, expect } from "vitest";
import {
  formatRecord, isStale, rankByRecord, RECORD_STALE_DAYS,
  type PlaybookRecordEntry, type PlaybookRecord,
} from "@/lib/zion/playbook-record";
import { NOISE_THRESHOLD } from "@/lib/admin/sample";

/**
 * O HISTÓRICO NA MÃO DE QUEM DECIDE — e a trava que impede o ruído de virar
 * evidência DENTRO da decisão.
 *
 * Um modelo que recebe "absorção: +2,1%" trata aquilo como fato, mesmo que os
 * +2,1% venham de três trades. Ele não tem como desconfiar: o número chegou com
 * a mesma autoridade dos outros.
 *
 * Na tela, ruído com cara de resultado engana quem olha. No prompt, ele MOVE
 * DINHEIRO — e é por isso que a regra aqui é mais dura que a do painel: abaixo
 * do limiar não sai número nenhum, sai a palavra DESCONHECIDO.
 */

const e = (over: Partial<PlaybookRecordEntry> = {}): PlaybookRecordEntry => ({
  playbook: "range_reversion", decided: 100, netPerTrade: 1.5,
  byRegime: { RANGING: { decided: 80, netPerTrade: 2.0 } },
  ...over,
});

describe("amostra pequena NÃO vira número", () => {
  it("abaixo do limiar sai como DESCONHECIDO, não como valor", () => {
    const s = formatRecord(e({ decided: 3, netPerTrade: 12.5, byRegime: {} }), "RANGING");
    expect(s).toContain("sem amostra suficiente");
    expect(s).toContain("DESCONHECIDO");
    // O número tentador não pode aparecer em lugar nenhum.
    expect(s).not.toContain("12.5");
  });

  it("e diz explicitamente que DESCONHECIDO não é neutro", () => {
    // Sem isso o modelo trataria a ausência como "nem bom nem ruim" e a somaria
    // ao lado dos que têm evidência, que é outro jeito de mentir.
    expect(formatRecord(e({ decided: 1, byRegime: {} }), "RANGING")).toContain("não como neutro");
  });

  it("regime com amostra pequena cai para o GERAL, dizendo que caiu", () => {
    const s = formatRecord(e({
      decided: 200, netPerTrade: 1.2,
      byRegime: { TRENDING_DOWN: { decided: 4, netPerTrade: 9.9 } },
    }), "TRENDING_DOWN");
    expect(s).toContain("GERAL");
    expect(s).toContain("só n=4");
    expect(s).not.toContain("9.9");   // o número do regime raso não vaza
  });
});

describe("o histórico do REGIME ATUAL vale mais que o geral", () => {
  it("com amostra no regime, é ele que aparece", () => {
    // Uma estratégia raramente é boa ou ruim em geral: ela é boa num terreno e
    // péssima noutro, e o terreno de agora é o que está em jogo.
    const s = formatRecord(e(), "RANGING");
    expect(s).toContain("neste regime");
    expect(s).toContain("+2.00%");
    expect(s).not.toContain("GERAL");
  });

  it("sem nada no regime, o geral vem marcado como geral", () => {
    const s = formatRecord(e({ byRegime: {} }), "TRENDING_UP");
    expect(s).toContain("GERAL");
    expect(s).toContain("sem amostra neste regime");
  });

  it("playbook nunca medido devolve null — a linha é OMITIDA", () => {
    // Uma lista cheia de "sem dados" vira ruído que o modelo aprende a pular, e
    // ele leva junto as linhas que importam.
    expect(formatRecord(undefined, "RANGING")).toBeNull();
  });
});

describe("o limiar é o mesmo do painel", () => {
  it("na fronteira, passa", () => {
    const s = formatRecord(e({
      decided: NOISE_THRESHOLD, netPerTrade: 1,
      byRegime: { RANGING: { decided: NOISE_THRESHOLD, netPerTrade: 3 } },
    }), "RANGING");
    expect(s).toContain("+3.00%");
  });

  it("um abaixo, não passa", () => {
    const s = formatRecord(e({
      decided: NOISE_THRESHOLD - 1, netPerTrade: 1,
      byRegime: { RANGING: { decided: NOISE_THRESHOLD - 1, netPerTrade: 3 } },
    }), "RANGING");
    expect(s).toContain("DESCONHECIDO");
  });
});

describe("histórico velho é pior que nenhum", () => {
  const rec = (measuredAt: string): PlaybookRecord => ({ entries: [], windowDays: 32, measuredAt });
  const now = Date.parse("2026-08-03T00:00:00Z");

  it("recente vale", () => {
    expect(isStale(rec("2026-07-25T00:00:00Z"), now)).toBe(false);
  });

  it("passado o prazo, é descartado", () => {
    // Um registro antigo descreve um mercado que já passou e chega com a mesma
    // autoridade de um recente — é assim que backtest velho vira armadilha.
    expect(isStale(rec("2026-05-01T00:00:00Z"), now)).toBe(true);
    expect(RECORD_STALE_DAYS).toBeGreaterThan(0);
  });

  it("data ilegível conta como velho — fail-closed", () => {
    expect(isStale(rec("nunca"), now)).toBe(true);
  });
});

describe("URÐR — obedecer ao que já aconteceu", () => {
  const c = (playbook: string) => ({ playbook });
  const rec = (entries: PlaybookRecordEntry[]): PlaybookRecord => ({
    entries, windowDays: 32, measuredAt: new Date().toISOString(),
  });
  const medido = (playbook: string, net: number, n = 100): PlaybookRecordEntry => ({
    playbook, decided: n, netPerTrade: net,
    byRegime: { RANGING: { decided: n, netPerTrade: net } },
  });

  it("SEM registro, a mesa NÃO opera", () => {
    // Se caísse na ordem declarada viraria um VÖLUNDR com outro nome, e o
    // ledger encheria de trades idênticos aos do controle sob a bandeira de um
    // terceiro braço. Foi a contaminação que o MÍMIR sofreu por semanas.
    expect(rankByRecord([c("range_reversion")], null, "RANGING")).toEqual([]);
  });

  it("ordena pelo MELHOR líquido medido, não pela prioridade declarada", () => {
    const r = rankByRecord(
      [c("range_reversion"), c("absorption")],
      rec([medido("range_reversion", 0.5), medido("absorption", 3.2)]),
      "RANGING",
    );
    expect(r.map((x) => x.candidate.playbook)).toEqual(["absorption", "range_reversion"]);
  });

  it("EXCLUI o que mediu negativo — seguir a evidência é NÃO operar o que perde", () => {
    const r = rankByRecord(
      [c("range_reversion"), c("absorption")],
      rec([medido("range_reversion", -1.4), medido("absorption", 2.0)]),
      "RANGING",
    );
    expect(r.map((x) => x.candidate.playbook)).toEqual(["absorption"]);
  });

  it("TODOS negativos → a mesa fica de FORA. É a disciplina que a evidência compra", () => {
    // Aqui mora a diferença entre URÐR e VÖLUNDR: o ferreiro tomaria o primeiro
    // da lista de qualquer jeito.
    const r = rankByRecord(
      [c("range_reversion"), c("absorption")],
      rec([medido("range_reversion", -1.4), medido("absorption", -0.2)]),
      "RANGING",
    );
    expect(r).toEqual([]);
  });

  it("DESCONHECIDO não é ruim — entra depois dos medidos, na ordem declarada", () => {
    // Excluir o não-medido o impediria para sempre de acumular amostra, e a
    // mesa nunca aprenderia nada novo.
    const r = rankByRecord(
      [c("range_reversion"), c("absorption"), c("pivot_reversion")],
      rec([medido("absorption", 2.0)]),
      "RANGING",
    );
    expect(r.map((x) => x.candidate.playbook)).toEqual(["absorption", "range_reversion", "pivot_reversion"]);
    expect(r[1].unknown).toBe(true);
    expect(r[0].unknown).toBe(false);
  });

  it("amostra rasa conta como DESCONHECIDO, não como medido", () => {
    const r = rankByRecord(
      [c("absorption")],
      rec([{ playbook: "absorption", decided: 3, netPerTrade: 9.9, byRegime: {} }]),
      "RANGING",
    );
    expect(r[0].unknown).toBe(true);
    expect(r[0].measuredNet).toBeNull();
  });

  it("o histórico do REGIME manda sobre o geral", () => {
    // Boa em geral e péssima aqui: a mesa tem de obedecer ao terreno de agora.
    const r = rankByRecord(
      [c("range_reversion")],
      rec([{
        playbook: "range_reversion", decided: 200, netPerTrade: 5,
        byRegime: { TRENDING_DOWN: { decided: 100, netPerTrade: -2 } },
      }]),
      "TRENDING_DOWN",
    );
    expect(r).toEqual([]);   // −2% no regime atual → excluída
  });
});
