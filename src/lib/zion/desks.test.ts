import { describe, it, expect } from "vitest";
import { DESKS, type DeskSector } from "@/lib/zion/desks";
import { PLAYBOOKS } from "@/lib/zion/playbooks";

/**
 * A FROTA, POR SETOR — e a ficha de construção de cada mesa.
 *
 * Duas reclamações do dono viraram estes testes:
 *
 *   "temos que separar bem tudo para testar corretamente dessa vez"
 *   "não sei como cada agente novo foi montado"
 *
 * A primeira é o SETOR: sem ele o painel comparava um scalper market-neutral
 * com um swing direcional na mesma tabela, e o ranking dizia qualquer coisa.
 * Mesas com mandatos diferentes precisam de tabelas diferentes.
 *
 * A segunda é a FICHA: a lógica de cada mesa morava espalhada em três arquivos
 * e um comentário. Agora é declaração — o que vê, o que decide, sob que regra,
 * contra quem, e quando aposentar.
 */

const live = DESKS.filter((d) => d.status === "live");

describe("toda mesa VIVA tem ficha de construção", () => {
  it("nenhuma caixa-preta em produção", () => {
    // Uma mesa sem ficha é uma caixa-preta operando dinheiro simulado — e
    // amanhã real. Se não dá para escrever o que ela faz, ela não devia rodar.
    for (const d of live) {
      expect(d.sheet, `${d.name} sem ficha`).toBeDefined();
    }
  });

  it("a ficha responde as quatro perguntas, sem enrolação", () => {
    for (const d of live) {
      expect(d.sheet!.sees.length, `${d.name}.sees`).toBeGreaterThan(20);
      expect(d.sheet!.decides.length, `${d.name}.decides`).toBeGreaterThan(15);
      expect(d.sheet!.rule.length, `${d.name}.rule`).toBeGreaterThan(15);
    }
  });

  it("TODA mesa declara quando deve ser APOSENTADA", () => {
    // O campo que mais importa. Mesa sem critério de aposentadoria vira
    // estimação: continua rodando porque ninguém teve coragem de desligar, e o
    // custo dela some no meio do resto.
    for (const d of live) {
      expect(d.sheet!.retireWhen.length, `${d.name} sem critério de aposentadoria`).toBeGreaterThan(20);
    }
  });
});

describe("os quatro setores", () => {
  it("toda mesa pertence a um setor", () => {
    const validos: DeskSector[] = ["A_direcional", "B_neutro", "C_lancamento", "D_arquivo"];
    for (const d of DESKS) expect(validos, d.name).toContain(d.sector);
  });

  it("o Setor A é onde mora a TESE — e tem o par do duelo", () => {
    const a = live.filter((d) => d.sector === "A_direcional").map((d) => d.source);
    expect(a).toContain("strat_mech");  // VÖLUNDR, o controle
    expect(a).toContain("strat_ai");    // MÍMIR, a variável testada
  });

  it("o duelo aponta para o par certo, dos dois lados", () => {
    // Se o MÍMIR não for lido contra o VÖLUNDR, a tese não é testada — é só
    // mais uma mesa produzindo número solto.
    const mimir = DESKS.find((d) => d.source === "strat_ai")!;
    const volundr = DESKS.find((d) => d.source === "strat_mech")!;
    expect(mimir.sheet!.comparedTo).toContain("VÖLUNDR");
    expect(volundr.sheet!.comparedTo).toContain("MÍMIR");
  });

  it("o Setor B não usa IA — é o que já paga hoje, e não se mexe", () => {
    for (const d of live.filter((x) => x.sector === "B_neutro")) {
      expect(d.brain, d.name).toBe("none");
      expect(d.direction, d.name).toBe("market_neutral");
    }
  });

  it("Valhalla é setor de ARQUIVO, e não compete com ninguém", () => {
    for (const d of DESKS.filter((x) => x.status === "valhalla")) {
      expect(d.sector, d.name).toBe("D_arquivo");
    }
  });
});

describe("coerência com o resto do sistema", () => {
  it("uma única mesa de IA no Setor A — o duelo tem de ter uma variável só", () => {
    // Duas mesas de IA ao mesmo tempo tornariam impossível dizer qual diferença
    // veio do quê.
    const comIa = live.filter((d) => d.sector === "A_direcional" && d.brain === "llm");
    expect(comIa).toHaveLength(1);
    expect(comIa[0].source).toBe("strat_ai");
  });

  it("as mesas mecânicas do Setor A são o CONTROLE — sem cérebro", () => {
    const controles = live.filter((d) => d.sector === "A_direcional" && d.brain === "none");
    expect(controles.length).toBeGreaterThanOrEqual(3); // VÖLUNDR, SKAÐI, FREYJA
  });

  it("a biblioteca de playbooks existe para o Setor A usar", () => {
    expect(PLAYBOOKS.length).toBeGreaterThanOrEqual(10);
  });

  it("nenhum `source` repetido — é chave de dados no ledger", () => {
    expect(new Set(DESKS.map((d) => d.source)).size).toBe(DESKS.length);
  });
});
