/**
 * O SILÊNCIO DAS MESAS — cinco estados que parecem um só na tela.
 *
 * ⚠️ O CASO QUE ORIGINOU ISTO (06/08).
 *
 * A URÐR aparecia com zero trades e caixa intacto. Qualquer um concluiria
 * "quebrada". O rastro dizia: 142 ticks, 15 com oferta, e nas 15
 * `vetoedByRecord: 1` — a mesa cujo mandato é obedecer ao histórico MEDIDO
 * recusou tudo porque o histórico é negativo.
 *
 * Ela é a ÚNICA mesa fazendo exatamente o que deveria, e no painel parecia a
 * mais morta de todas. Desligá-la seria desligar a única certa.
 */

import { describe, it, expect } from "vitest";
import { readSilence, deskTickFrom, TICK_EVENT_BY_SOURCE, MIN_CASH_USD } from "@/lib/zion/silence";

const tick = (o: Partial<Parameters<typeof readSilence>[0][number]> = {}) => ({ ...o });

describe("mesa que opera não está calada", () => {
  it("com posição aberta, o veredito é 'operando'", () => {
    expect(readSilence([], 1000, 3, 0).kind).toBe("operando");
  });

  it("com trade fechado também — histórico conta", () => {
    expect(readSilence([], 1000, 0, 12).kind).toBe("operando");
  });
});

describe("o caso da URÐR — disciplina não é problema", () => {
  /**
   * Os números reais dela: 15 ofertas ao longo da janela, 15 vetadas pelo
   * histórico. Este é o teste que impede alguém de "consertar" a mesa certa.
   */
  it("recebeu e recusou tudo por veto do histórico → NÃO é problema", () => {
    const ticks = Array.from({ length: 15 }, () => tick({ offered: 1, vetoedByRecord: 1, taken: 0 }));
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(false);
    expect(v.label).toContain("15");
    expect(v.action).toMatch(/nada a fazer/i);
  });

  /**
   * ⚠️ Recusar SEM ser pelo histórico é outra coisa: aí o bracket não fechou
   * por algum outro motivo, e isso merece investigação.
   */
  it("recusou sem veto do histórico → É problema, e diz para investigar", () => {
    const ticks = [tick({ offered: 3, vetoedByRecord: 0, taken: 0 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(true);
    expect(v.action).toMatch(/bracket/i);
  });
});

describe("os outros quatro estados", () => {
  it("sem tick nenhum: não dá para julgar, e isso É problema", () => {
    const v = readSilence([], 1000, 0, 0);
    expect(v.kind).toBe("sem_rastro");
    expect(v.isProblem).toBe(true);
    expect(v.action).toMatch(/antes de qualquer veredito/i);
  });

  it("quebra vence os outros — quem estoura não chegou a decidir", () => {
    const ticks = [tick({ erro: "fetch falhou" }), tick({ offered: 5, vetoedByRecord: 5 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("quebra");
    expect(v.action).toContain("fetch falhou");
  });

  /**
   * Fome vem antes de seca: sem caixa a mesa não abriria nem se recebesse
   * oferta. Diagnosticar "seca" aqui mandaria consertar a fonte quando o
   * problema é capital.
   */
  it("fome vence seca — sem caixa não abre nem com oferta", () => {
    const ticks = [tick({ offered: 0 })];
    const v = readSilence(ticks, 10, 0, 0);
    expect(v.kind).toBe("fome");
    expect(v.label).toContain(`$${MIN_CASH_USD}`);
    expect(v.action).toMatch(/recapitalizar/i);
  });

  it("seca COM motivo reportado não é problema — é o mercado", () => {
    const ticks = [tick({ offered: 0, skipped: [{ symbol: "BTC", reason: "sem estrutura" }] })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("seca");
    expect(v.isProblem).toBe(false);
    expect(v.action).toContain("sem estrutura");
  });

  /**
   * Seca SEM motivo é problema: "zero candidatos" não distingue mercado calmo
   * de fonte caída, e as duas pedem ações opostas.
   */
  it("seca SEM motivo é problema — não distingue mercado de fonte caída", () => {
    const ticks = [tick({ offered: 0 }), tick({ offered: 0 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("seca");
    expect(v.isProblem).toBe(true);
    expect(v.action).toMatch(/fonte caída/i);
  });
});

describe("a janela, não o tick", () => {
  /**
   * ⚠️ O ERRO QUE EU QUASE COMETI. Olhei UM tick da URÐR, vi `offered: 0`, e
   * ia reportar "desconectada". Com os 142 a resposta era o contrário.
   *
   * A assinatura pede a LISTA justamente para que um tick vazio no meio de uma
   * janela cheia de ofertas não vire veredito.
   */
  it("um tick vazio no meio de ofertas não vira 'seca'", () => {
    const ticks = [tick({ offered: 0 }), tick({ offered: 1, vetoedByRecord: 1 }), tick({ offered: 0 })];
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(false);
  });
});

/**
 * ⚠️ A PONTE QUE FALTAVA — `readSilence` passou de 06/08 a 13/08 sem nenhum
 * chamador fora deste arquivo. O módulo que abre citando "um controle que
 * ninguém lê não é um controle" era exatamente isso.
 *
 * O que impedia a ligação não era a classificação: era que cada mesa nomeia os
 * campos do tick à sua maneira, e ler `offered` cru daria ZERO em três das
 * quatro fontes — o veredito "seca", que acusa a fonte de estar caída. Duas
 * mesas disciplinadas seriam reportadas como quebradas.
 */
describe("deskTickFrom — os nomes não coincidem entre as fontes", () => {
  it("ULLR chama de eligible/fired o que a URÐR chama de offered/taken", () => {
    const t = deskTickFrom("ullr_tick", { seen: 64, fired: 0, capped: false, eligible: 1 });
    expect(t.offered).toBe(1);
    expect(t.taken).toBe(0);
  });

  it("FREYJA chama de candidates/logged — e o tick dela é o caso real", () => {
    const t = deskTickFrom("strat_dex_tick", {
      logged: 0, scanned: 9, candidates: 9,
      skipped: [{ reason: "faca caindo", symbol: "USDC" }, { reason: "sem preço", symbol: "MCX" }],
    });
    expect(t.offered).toBe(9);
    expect(t.taken).toBe(0);
    expect(t.skipped).toHaveLength(2);
  });

  it("URÐR grava offered/taken/vetoedByRecord com os nomes canônicos", () => {
    const t = deskTickFrom("strat_record_tick", { taken: 0, logged: 0, offered: 3, vetoedByRecord: 3 });
    expect(t.offered).toBe(3);
    expect(t.vetoedByRecord).toBe(3);
  });

  /**
   * ⚠️ SE ESTE TESTE CAIR, mesas disciplinadas voltam a parecer quebradas.
   * É a asserção que prova que a tradução é o que faz a classificação valer.
   */
  it("sem a tradução, 9 candidatos recusados viram 'seca' em vez de disciplina", () => {
    const meta = { logged: 0, candidates: 9, skipped: [{ reason: "faca caindo", symbol: "USDC" }] };
    const traduzido = readSilence([deskTickFrom("strat_dex_tick", meta)], 1000, 0, 0);
    expect(traduzido.kind).toBe("disciplina");

    // O que aconteceria lendo `offered` cru — exatamente o defeito evitado.
    const cru = readSilence([{ offered: (meta as Record<string, unknown>).offered as number ?? null }], 1000, 0, 0);
    expect(cru.kind).toBe("seca");
  });

  it("a janela vazia do arbiter carrega o `why` para não virar 'seca sem motivo'", () => {
    const t = deskTickFrom("arb_window_empty", {
      why: "piso de custo acima do teto de credibilidade — estratégia sem trade neste custo",
      ceil_pct: 0.3, floor_pct: 0.55,
    });
    expect(t.skipped?.[0].reason).toContain("piso de custo");
    const v = readSilence([t], 1000, 0, 0);
    expect(v.kind).toBe("seca");
    // Com motivo reportado, a seca NÃO acusa a fonte — ela aponta a premissa.
    expect(v.isProblem).toBe(false);
    expect(v.action).toContain("piso de custo");
  });

  it("metadado nulo ou vazio não explode nem inventa oferta", () => {
    expect(deskTickFrom("strat_ai_tick", null).offered).toBeNull();
    expect(deskTickFrom("strat_ai_tick", {}).taken).toBeNull();
  });

  it("toda mesa do mapa aponta para um event_type não-vazio", () => {
    for (const [source, ev] of Object.entries(TICK_EVENT_BY_SOURCE)) {
      expect(ev, source).toMatch(/\S/);
    }
  });
});

/**
 * ⚠️ OS QUATRO DEFEITOS QUE SÓ A CONFERÊNCIA CONTRA O BANCO ACHOU (13/08).
 *
 * A primeira versão da ligação passou em tsc, lint, 1213 testes e build — e
 * teria mostrado ALARME FALSO em 4 das 11 mesas vivas. O que a pegou foi rodar
 * `deskTickFrom` + `readSilence` de verdade sobre os 287 eventos reais de 24h e
 * as 23 contas reais, e LER a saída linha por linha.
 *
 * É a invariante nº 20 outra vez: teste verde não é execução observada.
 */
describe("o que a conferência contra dados reais reprovou", () => {
  /** DEFEITO 1 — a mesa que explica cada recusa acendia como quebrada. */
  it("FREYJA: 414 ofertas com 410 motivos escritos NÃO é problema", () => {
    // 46 ticks recusando 9 cada, todos com motivo, e nada tomado.
    const ticks = Array.from({ length: 46 }, () => ({
      offered: 9, taken: 0,
      skipped: Array.from({ length: 9 }, (_, i) => ({ symbol: `T${i}`, reason: "faca caindo" })),
    }));
    const v = readSilence(ticks, 1000, 0, 0);
    expect(v.kind).toBe("disciplina");
    expect(v.isProblem).toBe(false);
    expect(v.action).toContain("motivo");
  });

  /** ⚠️ A COBERTURA É EXIGIDA: um motivo solto não cala o controle inteiro. */
  it("mas 9 recusas com UM motivo só continuam sendo problema", () => {
    const v = readSilence([{ offered: 9, taken: 0, skipped: [{ symbol: "T", reason: "x" }] }], 1000, 0, 0);
    expect(v.isProblem).toBe(true);
  });

  /** DEFEITO 2 — `arb2_window_empty` não grava `why`, só as duas colunas. */
  it("a janela do arbiter2 vira motivo pela ARITMÉTICA quando falta o `why`", () => {
    const t = deskTickFrom("arb2_window_empty", { source: "arbiter2_3x", ceil_pct: 0.3, floor_pct: 0.6, over_ceiling: 0 });
    expect(t.skipped?.[0].reason).toContain("aritmética");
    expect(readSilence([t], 300, 0, 0).isProblem).toBe(false);
  });

  /**
   * ⚠️ E SÓ QUANDO A CONTA FECHA. Inventar motivo em cima de causa desconhecida
   * é pior que não ter motivo: ninguém procuraria a de verdade.
   */
  it("com piso ABAIXO do teto não inventa motivo nenhum", () => {
    const t = deskTickFrom("arb2_window_empty", { source: "arbiter2", ceil_pct: 0.6, floor_pct: 0.3 });
    expect(t.skipped).toBeNull();
    expect(readSilence([t], 300, 0, 0).isProblem).toBe(true);
  });

  /** DEFEITO 3 — três mesas dividem `arb2_window_empty` e liam 71 em vez de 24. */
  it("o tick carrega o dono, para cada mesa ler só o rastro dela", () => {
    expect(deskTickFrom("arb2_window_empty", { source: "arbiter2_5x" }).desk).toBe("arbiter2_5x");
    // `arb_window_empty` (a 1×) não identifica: vale para quem mapear nele.
    expect(deskTickFrom("arb_window_empty", { why: "x" }).desk).toBeNull();
  });

  /**
   * DEFEITO 4 — o sexto estado. A FREYJA gerou 19 sugestões desde 03/08, que
   * RESOLVERAM no torneio, e a carteira de papel dela nunca abriu nada.
   * Nos cinco estados antigos isso saía como "disciplina · nenhuma tomada" —
   * rótulo literalmente falso sobre uma mesa que tinha decidido 4 vezes.
   */
  it("decidiu e a carteira não abriu é estado PRÓPRIO, e vence a disciplina", () => {
    const v = readSilence([{ offered: 9, taken: 4, skipped: [{ symbol: "T", reason: "x" }] }], 1000, 0, 0);
    expect(v.kind).toBe("nao_executou");
    expect(v.isProblem).toBe(true);
    expect(v.label).toContain("4");
    // O silêncio está na EXECUÇÃO, e o texto tem que mandar olhar lá.
    expect(v.action).not.toContain("playbook」");
    expect(v.action).toContain("abertura");
  });

  it("mas uma mesa que decidiu E abriu continua 'operando'", () => {
    expect(readSilence([{ offered: 9, taken: 4 }], 1000, 2, 0).kind).toBe("operando");
  });
});
