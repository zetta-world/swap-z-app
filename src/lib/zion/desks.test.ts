import { describe, it, expect } from "vitest";
import { DESKS, isArquivada, deskFor, type DeskSector } from "@/lib/zion/desks";
import { EM_PROVA } from "@/lib/zion/cull";
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
    const validos: DeskSector[] = ["A_direcional", "B_neutro", "C_lancamento", "D_arquivo", "E_modelo"];
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

/**
 * CAPITAL E SUBTÍTULO — as duas colunas que a auditoria de 05/08 exigiu.
 *
 * ⚠️ DE ONDE VIERAM.
 *
 * As 23 mesas recebiam $1.000 (ou $300) independentemente do que a estratégia
 * exige. Isso não é neutro: mesa sub-capitalizada rende NEGATIVO por custo
 * fixo, e o resultado é lido como "a estratégia não presta". Funding com $1.000
 * perde porque as quatro pernas custam 0,45% e o funding acumula 0,2% no
 * período — provavelmente já matamos ideias boas assim.
 *
 * E o dono, olhando o painel: "se eu mostrar a um leigo ele não vai saber o que
 * é o quê, qual mesa é, e o que mede o quê". MÍMIR e VÖLUNDR não dizem nada
 * para quem não construiu o sistema.
 */
describe("capital declarado e subtítulo legível", () => {
  it("TODA mesa declara o capital que a estratégia exige", () => {
    const sem = DESKS.filter((d) => !(d.capitalRequiredUsd > 0));
    expect(sem.map((d) => d.source)).toEqual([]);
  });

  /**
   * O número sozinho vira constante que ninguém confere — foi assim que a
   * coluna `priority` nasceu e sobreviveu meses sem ser medida.
   */
  it("o capital vem com o PORQUÊ, não sozinho", () => {
    const semMotivo = DESKS.filter((d) => (d.capitalWhy ?? "").length < 25);
    expect(semMotivo.map((d) => d.source)).toEqual([]);
  });

  it("TODA mesa tem subtítulo funcional — nome viking sozinho não comunica", () => {
    const sem = DESKS.filter((d) => (d.subtitle ?? "").length < 10);
    expect(sem.map((d) => d.source)).toEqual([]);
  });

  /**
   * O subtítulo mostra o capital. Se ele disser $1.000 e o campo disser $5.000,
   * a tela mente — e é exatamente o tipo de divergência silenciosa que fez o
   * painel mostrar $20.842 onde havia $11.491.
   */
  it("o capital do subtítulo BATE com o capital declarado", () => {
    const divergentes = DESKS.filter((d) => {
      const m = d.subtitle.match(/\$([\d.]+)/);
      if (!m) return false;                       // subtítulo sem valor é permitido
      const noTexto = Number(m[1].replace(/\./g, ""));
      return noTexto !== d.capitalRequiredUsd;
    });
    expect(divergentes.map((d) => `${d.source}: ${d.subtitle}`)).toEqual([]);
  });

  /**
   * As mesas do DUELO precisam do MESMO capital, senão a comparação mede duas
   * variáveis ao mesmo tempo. VÖLUNDR × MÍMIR isola o cérebro; se um tiver
   * $5.000 e o outro $1.000, o resultado mede o capital.
   */
  it("as mesas do duelo direcional compartilham o mesmo capital", () => {
    const duelo = DESKS.filter((d) => d.sector === "A_direcional" && d.status === "live");
    const capitais = new Set(duelo.map((d) => d.capitalRequiredUsd));
    expect([...capitais], `capitais divergentes: ${duelo.map((d) => `${d.name} $${d.capitalRequiredUsd}`).join(", ")}`)
      .toHaveLength(1);
  });

  it("mesa arquivada declara que o capital dela é histórico, não alocação", () => {
    const arquivo = DESKS.filter((d) => d.status === "valhalla");
    expect(arquivo.length).toBeGreaterThan(0);
    for (const d of arquivo) {
      expect(d.capitalWhy, `${d.source}`).toMatch(/arquivad|histór/i);
    }
  });
});

/**
 * ⚠️ O REGISTRO PRECISA VALER — a MUNINN e a GERI operando aposentadas (13/08).
 *
 * As duas estão declaradas aqui com todas as letras: "mesa arquivada · rodada
 * encerrada", "o capital é histórico, NÃO alocação ativa", `status: valhalla`.
 * E às 20:01 de 13/08 abriram ARB com esse capital, porque o cron do torneio
 * gateava só por `pause_tournament` e pela lista de `culled` — nunca pelo
 * `status`. Uma mesa pode estar fora dos dois E arquivada ao mesmo tempo.
 *
 * O painel esconde as aposentadas atrás do botão do ARQUIVO, então elas
 * movimentavam capital numa aba que ninguém abre.
 */
describe("isArquivada — o registro como trava, não como comentário", () => {
  it("MUNINN continua arquivada", () => {
    expect(isArquivada("kimi_scan")).toBe(true);
  });

  /**
   * ⚠️ A GERI SAIU DE VALHALLA, e o teste vira junto — mas a trava que ele
   * guarda continua a mesma.
   *
   * Ela voltou porque foi a única mesa a mostrar aprendizado medível: cards por
   * tick de 4,00 para 1,00 e confiança de 54 para 65, com o líquido indo de
   * −0,524% (636 decididos) para −0,302% (56). Continua negativa; o que mudou
   * foi a derivada.
   *
   * ⚠️ E VOLTA COM CRITÉRIO DE APOSENTADORIA. Sem retireWhen, uma mesa que
   * volta vira estimação — e o critério que a mandou embora ("está negativa")
   * a mataria de novo no meio do aprendizado.
   */
  it("GERI voltou de Valhalla, e voltou com critério de saída", () => {
    expect(isArquivada("mistral_scan")).toBe(false);
    const geri = deskFor("mistral_scan")!;
    expect(geri.status).toBe("live");
    expect(geri.sector).toBe("E_modelo");
    expect(geri.sheet?.retireWhen, "mesa sem critério vira estimação").toBeTruthy();
    expect(geri.sheet!.retireWhen).toContain("NÃO aposentar por continuar negativa");
  });

  /**
   * ⚠️⚠️ A ISENÇÃO DE CORTE E O REGISTRO TÊM DE CONCORDAR — e este teste nasce
   * de uma regressão real (18/08).
   *
   * A PR #304 mergeou o EM_PROVA do cull.ts e o plano, mas NENHUMA linha de
   * desks.ts: a edição do registro morreu num git reset --hard. O repo ficou
   * dois dias com uma isenção de corte protegendo uma mesa ARQUIVADA — e nada
   * acusou, porque o teste antigo seguia afirmando o estado antigo, que era de
   * fato o estado do código. Verde e errado ao mesmo tempo.
   *
   * Uma isenção que aponta para mesa que não opera é pior que não ter isenção:
   * ela diz na tela que a mesa está protegida e em prova, quando ela está morta.
   */
  it("toda mesa EM PROVA está viva no registro", () => {
    for (const src of EM_PROVA) {
      expect(isArquivada(src), src + " está EM_PROVA e arquivada").toBe(false);
    }
  });

  it("nenhuma mesa VIVA é confundida com arquivada", () => {
    for (const d of DESKS.filter((x) => x.status === "live")) {
      expect(isArquivada(d.source), d.source).toBe(false);
    }
  });

  /**
   * ⚠️ MESA FORA DO REGISTRO CONTA COMO VIVA — mesma regra do painel desde
   * 05/08: o desconhecido não ganha dispensa. Se um `source` novo sumisse
   * calado por não estar registrado, o defeito seria pior que o original.
   */
  it("source desconhecido NÃO é tratado como arquivado", () => {
    expect(isArquivada("mesa_que_nunca_existiu")).toBe(false);
    expect(isArquivada("")).toBe(false);
  });

  /**
   * A coerência que o defeito violava: toda mesa arquivada declara o setor de
   * arquivo. Se alguém marcar `valhalla` e esquecer o setor (ou o contrário),
   * as duas leituras voltam a discordar — e foi a discordância entre duas
   * leituras da mesma coisa que criou o problema.
   */
  it("arquivada e D_arquivo andam sempre juntas", () => {
    for (const d of DESKS) {
      expect(d.status === "valhalla", d.source).toBe(d.sector === "D_arquivo");
    }
  });
});
