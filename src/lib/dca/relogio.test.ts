import { describe, it, expect } from "vitest";
import {
  proximaJanela, decidirCiclo, tetoDoCiclo, MAX_JANELAS_POR_PASSADA,
  type EstadoPlano, type Tetos,
} from "@/lib/dca/relogio";

/**
 * ⚠️ CADA CASO AQUI É UM JEITO DE PERDER DINHEIRO (docs/PLANO-DCA-AUTOMATICO.md).
 *
 * Este módulo decide QUANDO e QUANTO comprar, sem ninguém olhando. Os defeitos
 * que ele pode ter não aparecem em teste manual: precisam de um cron fora do ar
 * por três dias, ou de um plano mensal começando dia 31.
 */

describe("proximaJanela — os offsets fixos", () => {
  it("hora, dia e semana andam o esperado", () => {
    expect(proximaJanela("2026-08-24T10:00:00.000Z", "hourly")).toBe("2026-08-24T11:00:00.000Z");
    expect(proximaJanela("2026-08-24T10:00:00.000Z", "daily")).toBe("2026-08-25T10:00:00.000Z");
    expect(proximaJanela("2026-08-24T10:00:00.000Z", "weekly")).toBe("2026-08-31T10:00:00.000Z");
  });

  it("data ilegível volta ela mesma — nunca vira 'agora'", () => {
    // ⚠️ Uma data corrompida que virasse `Date.now()` faria um plano parado
    // comprar imediatamente. Devolver o lixo deixa o cron esperar e registrar.
    expect(proximaJanela("não-é-data", "daily")).toBe("não-é-data");
  });
});

describe("⚠️ proximaJanela mensal — mês NÃO é offset fixo", () => {
  it("mês normal preserva o dia", () => {
    expect(proximaJanela("2026-03-15T08:00:00.000Z", "monthly")).toBe("2026-04-15T08:00:00.000Z");
  });

  it("31/01 vira 28/02, e não 03/03 nem uma data inexistente", () => {
    // Somar 30 ou 31 dias daria 02/03 ou 03/03 — o plano andaria no calendário.
    expect(proximaJanela("2026-01-31T08:00:00.000Z", "monthly")).toBe("2026-02-28T08:00:00.000Z");
  });

  it("respeita ano bissexto", () => {
    // 2028 é bissexto: 29 dias em fevereiro.
    expect(proximaJanela("2028-01-31T08:00:00.000Z", "monthly")).toBe("2028-02-29T08:00:00.000Z");
  });

  it("31/03 vira 30/04, mês de 30 dias", () => {
    expect(proximaJanela("2026-03-31T08:00:00.000Z", "monthly")).toBe("2026-04-30T08:00:00.000Z");
  });

  it("vira o ano corretamente", () => {
    expect(proximaJanela("2026-12-15T08:00:00.000Z", "monthly")).toBe("2027-01-15T08:00:00.000Z");
  });

  it("⚠️ NÃO gruda no fim do mês — a data corrente é sempre a base", () => {
    // 31/01 → 28/02 → 28/03 (não 31/03). É escolha, e está documentada no
    // módulo: voltar ao dia 31 exigiria guardar o dia original do plano.
    const fev = proximaJanela("2026-01-31T08:00:00.000Z", "monthly");
    expect(proximaJanela(fev, "monthly")).toBe("2026-03-28T08:00:00.000Z");
  });

  it("preserva a hora do dia", () => {
    expect(proximaJanela("2026-03-15T23:45:30.500Z", "monthly")).toBe("2026-04-15T23:45:30.500Z");
  });
});

const base: EstadoPlano = {
  agoraIso:         "2026-08-24T12:00:00.000Z",
  nextRunAtIso:     "2026-08-24T12:00:00.000Z",
  intervalo:        "daily",
  ciclosFeitos:     0,
  ciclosPulados:    0,
  ciclosTotal:      12,
  status:           "ativo",
  conexaoExpiraIso: "2027-08-24T00:00:00.000Z",
};

describe("decidirCiclo — o caminho normal", () => {
  it("janela futura: espera, não compra", () => {
    const d = decidirCiclo({ ...base, nextRunAtIso: "2026-08-25T12:00:00.000Z" });
    expect(d.acao).toBe("esperar");
  });

  it("janela vencida agora: executa o ciclo 1 e agenda o seguinte", () => {
    const d = decidirCiclo(base);
    expect(d).toEqual({
      acao: "executar", ciclo: 1,
      agendadoPara: "2026-08-24T12:00:00.000Z",
      pular: [],
      proximoRunAt: "2026-08-25T12:00:00.000Z",
    });
  });

  it("o número do ciclo conta feitos E pulados — é ele que a trava unique usa", () => {
    const d = decidirCiclo({ ...base, ciclosFeitos: 3, ciclosPulados: 2 });
    expect(d.acao === "executar" && d.ciclo).toBe(6);
  });
});

describe("⚠️⚠️ decidirCiclo — as janelas perdidas", () => {
  it("cron fora 3 dias: pula as antigas e executa UMA, nunca três", () => {
    // ⚠️ O defeito que este teste existe para impedir: comprar 3× o previsto
    // num preço só, que é o oposto do que DCA faz.
    const d = decidirCiclo({ ...base, agoraIso: "2026-08-27T12:30:00.000Z" });
    expect(d.acao).toBe("executar");
    if (d.acao !== "executar") return;
    expect(d.pular).toHaveLength(3);
    expect(d.pular.map((p) => p.ciclo)).toEqual([1, 2, 3]);
    expect(d.pular.every((p) => p.motivo === "janela_perdida")).toBe(true);
  });

  it("executa a janela CORRENTE, não a mais antiga", () => {
    // Comprar "referente a três dias atrás" com o preço de hoje não é o que o
    // dono pediu, nem no valor nem na data.
    const d = decidirCiclo({ ...base, agoraIso: "2026-08-27T12:30:00.000Z" });
    expect(d.acao === "executar" && d.agendadoPara).toBe("2026-08-27T12:00:00.000Z");
    expect(d.acao === "executar" && d.ciclo).toBe(4);
  });

  it("o próximo agendamento é FUTURO, não mais um vencido", () => {
    const d = decidirCiclo({ ...base, agoraIso: "2026-08-27T12:30:00.000Z" });
    expect(d.acao === "executar" && d.proximoRunAt).toBe("2026-08-28T12:00:00.000Z");
    if (d.acao !== "executar") return;
    expect(Date.parse(d.proximoRunAt)).toBeGreaterThan(Date.parse("2026-08-27T12:30:00.000Z"));
  });

  it("⚠️ plano cujo intervalo INTEIRO já passou encerra sem comprar", () => {
    // 3 compras diárias a partir de 24/08, e hoje é 30/09: as três janelas
    // estão no passado distante. A primeira versão deste módulo disparava a
    // última mesmo assim — uma ordem a mercado avulsa, cinco semanas depois do
    // plano ter acabado, num momento que o dono não escolheu. O teste pegou.
    const d = decidirCiclo({
      ...base, ciclosTotal: 3, agoraIso: "2026-09-30T12:00:00.000Z",
    });
    expect(d.acao).toBe("encerrar");
    expect(d.acao === "encerrar" && d.motivo).toBe("completo");
    // E as três janelas ficam registradas como perdidas, não somem.
    expect(d.acao === "encerrar" && d.pular).toHaveLength(3);
  });

  it("mas um plano cujo intervalo AINDA corre dispara a janela corrente", () => {
    // A diferença entre este e o de cima é só o número de ciclos: aqui o plano
    // ainda alcança o presente, e comprar agora é o que o dono pediu.
    const d = decidirCiclo({
      ...base, ciclosTotal: 60, agoraIso: "2026-09-30T12:00:00.000Z",
    });
    expect(d.acao).toBe("executar");
    expect(d.acao === "executar" && d.agendadoPara).toBe("2026-09-30T12:00:00.000Z");
  });

  it("⚠️ teto de janelas por passada — plano horário dormente não derruba a função", () => {
    // Um ano parado num plano horário são ~8.760 janelas. Sem teto, a passada
    // estouraria o tempo da Vercel e mataria os planos dos OUTROS usuários.
    const d = decidirCiclo({
      ...base, intervalo: "hourly", ciclosTotal: 100_000,
      nextRunAtIso: "2025-08-24T12:00:00.000Z",
      agoraIso:     "2026-08-24T12:00:00.000Z",
      conexaoExpiraIso: "2030-01-01T00:00:00.000Z",
    });
    // ⚠️ E NÃO COMPRA. Paramos por limite de tempo, não por ter alcançado o
    // presente — a janela onde paramos ainda está um ano atrasada.
    expect(d.acao).toBe("pular");
    expect(d.acao === "pular" && d.pular.length).toBe(MAX_JANELAS_POR_PASSADA);
  });

  it("a passada seguinte continua de onde a anterior parou", () => {
    const um = decidirCiclo({
      ...base, intervalo: "hourly", ciclosTotal: 100_000,
      nextRunAtIso: "2025-08-24T12:00:00.000Z",
      agoraIso:     "2026-08-24T12:00:00.000Z",
      conexaoExpiraIso: "2030-01-01T00:00:00.000Z",
    });
    if (um.acao !== "pular") throw new Error("esperava pular");
    const dois = decidirCiclo({
      ...base, intervalo: "hourly", ciclosTotal: 100_000,
      ciclosPulados: um.pular.length,
      nextRunAtIso: um.proximoRunAt,
      agoraIso:     "2026-08-24T12:00:00.000Z",
      conexaoExpiraIso: "2030-01-01T00:00:00.000Z",
    });
    // Avançou: a segunda passada começa depois de onde a primeira parou.
    expect(Date.parse(um.proximoRunAt)).toBeGreaterThan(Date.parse("2025-08-24T12:00:00.000Z"));
    expect(dois.acao === "pular" && dois.pular[0].ciclo).toBe(MAX_JANELAS_POR_PASSADA + 1);
  });
});

describe("decidirCiclo — os encerramentos, que não são todos iguais", () => {
  it("plano completo encerra como 'completo'", () => {
    const d = decidirCiclo({ ...base, ciclosFeitos: 12 });
    expect(d).toMatchObject({ acao: "encerrar", motivo: "completo" });
  });

  it("⚠️ conexão vencida NÃO é plano completo — o dono precisa saber a diferença", () => {
    // Somar os dois daria "12 planos concluídos" incluindo os que morreram
    // porque a credencial expirou. É `expired` ≠ win/loss em outra roupa.
    const d = decidirCiclo({ ...base, conexaoExpiraIso: "2026-08-01T00:00:00.000Z" });
    expect(d).toMatchObject({ acao: "encerrar", motivo: "conexao_expirada" });
  });

  it("a credencial vence ANTES de qualquer conta de janela", () => {
    // Plano com 3 janelas vencidas E conexão morta: não gasta ciclo à toa.
    const d = decidirCiclo({
      ...base, agoraIso: "2026-08-27T12:00:00.000Z",
      conexaoExpiraIso: "2026-08-25T00:00:00.000Z",
    });
    expect(d).toMatchObject({ acao: "encerrar", motivo: "conexao_expirada", pular: [] });
  });

  it("pausado não compra, e diz que foi pausa", () => {
    const d = decidirCiclo({ ...base, status: "pausado" });
    expect(d).toMatchObject({ acao: "encerrar", motivo: "pausado" });
  });

  it("data ilegível espera — nunca vira compra imediata", () => {
    const d = decidirCiclo({ ...base, nextRunAtIso: "lixo" });
    expect(d.acao).toBe("esperar");
  });
});

const tetos: Tetos = {
  porCicloUsd:           100,
  gastoAcumuladoUsd:     0,
  orcamentoTotalUsd:     1200,
  gastoHojeCarteiraUsd:  0,
  tetoDiarioCarteiraUsd: 500,
  tetoPlataformaUsd:     10_000,
  minimoUsd:             5,
};

describe("tetoDoCiclo — o menor teto manda", () => {
  it("caminho normal gasta o valor do ciclo", () => {
    expect(tetoDoCiclo(tetos)).toEqual({ ok: true, valorUsd: 100 });
  });

  it("orçamento esgotado recusa", () => {
    expect(tetoDoCiclo({ ...tetos, gastoAcumuladoUsd: 1200 }))
      .toEqual({ ok: false, motivo: "orcamento_esgotado" });
  });

  it("⚠️ o teto diário POR CARTEIRA corta, mesmo com orçamento sobrando", () => {
    // O teto que a separação do autopilot exigiu: dez planos de US$ 100/dia na
    // mesma carteira seriam US$ 1.000/dia sem nada olhando o conjunto.
    expect(tetoDoCiclo({ ...tetos, gastoHojeCarteiraUsd: 450 }))
      .toEqual({ ok: true, valorUsd: 50 });
  });

  it("teto de plataforma corta acima de tudo", () => {
    expect(tetoDoCiclo({ ...tetos, tetoPlataformaUsd: 25 }))
      .toEqual({ ok: true, valorUsd: 25 });
  });

  it("⚠️ o último ciclo VARRE o resto em vez de deixar dinheiro parado", () => {
    // Sobram 40 num plano de 100 por ciclo: gasta 40 e fecha. Recusar deixaria
    // dinheiro que o dono acha que foi investido.
    expect(tetoDoCiclo({ ...tetos, gastoAcumuladoUsd: 1160 }))
      .toEqual({ ok: true, valorUsd: 40 });
  });

  it("⚠️ mas não abaixo do mínimo da corretora — senão tenta para sempre", () => {
    // Sobram 2 e o mínimo é 5: a ordem seria recusada LÁ, e o plano ficaria
    // batendo na porta a cada passada.
    expect(tetoDoCiclo({ ...tetos, gastoAcumuladoUsd: 1198 }))
      .toEqual({ ok: false, motivo: "abaixo_do_minimo" });
  });

  it("o mínimo é conferido DEPOIS dos tetos, não antes", () => {
    // Ciclo de 100 cabe no orçamento, mas o teto diário o corta para 2: não
    // sai ordem. ⚠️ E o motivo é o TETO DIÁRIO, não `abaixo_do_minimo`: esta
    // asserção esperava `abaixo_do_minimo`, que o cron trata como terminal e
    // encerrava o plano como `completo` por causa do gasto do dia. O plano não
    // acabou — amanhã o teto reabre.
    expect(tetoDoCiclo({ ...tetos, gastoHojeCarteiraUsd: 498 }))
      .toEqual({ ok: false, motivo: "teto_diario_carteira" });
  });

  it("⚠️ teto de plataforma abaixo do mínimo também é espera, não fim", () => {
    expect(tetoDoCiclo({ ...tetos, tetoPlataformaUsd: 3 }))
      .toEqual({ ok: false, motivo: "teto_plataforma" });
  });

  it("⚠️ valor por ciclo abaixo do mínimo continua terminal — nunca vai comprar", () => {
    expect(tetoDoCiclo({ ...tetos, porCicloUsd: 3 }))
      .toEqual({ ok: false, motivo: "abaixo_do_minimo" });
  });

  it("teto de plataforma zerado é PARADA, não passe livre", () => {
    // ⚠️ Um teto que chega 0 por config faltando não pode significar "sem
    // limite". Falha FECHADO, como o price-guard.
    expect(tetoDoCiclo({ ...tetos, tetoPlataformaUsd: 0 }))
      .toEqual({ ok: false, motivo: "teto_plataforma" });
  });

  it("número inválido não vira gasto", () => {
    expect(tetoDoCiclo({ ...tetos, porCicloUsd: NaN })).toEqual({ ok: false, motivo: "orcamento_esgotado" });
    expect(tetoDoCiclo({ ...tetos, orcamentoTotalUsd: Infinity, gastoAcumuladoUsd: Infinity }))
      .toEqual({ ok: false, motivo: "orcamento_esgotado" });
  });
});
