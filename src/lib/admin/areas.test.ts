import { describe, it, expect } from "vitest";
import {
  AREAS, AREA_DA_CATEGORIA, MESAS, ULFHEDNAR,
  areaDoModulo, modulosDaArea, areaPorId, contagemPorArea,
} from "@/lib/admin/areas";
import { MODULE_REGISTRY } from "@/lib/admin/modules";

/**
 * ⚠️ O ESTADO QUE ORIGINOU ISTO (16/08): 50 painéis, 20 deles na categoria
 * `lab`, num grid chapado sem hierarquia. O dono: *"tudo amontoado (…) muita
 * coisa ali merece sua própria UI"*.
 */
describe("áreas — ninguém pode sumir da navegação", () => {
  /**
   * ⚠️ O TESTE MAIS IMPORTANTE DO ARQUIVO. Um painel sem área não aparece em
   * menu nenhum — ele existe, gasta, e é invisível. Foi assim que a `lab`
   * virou depósito: cresceu um por vez e nada na tela contava.
   */
  it("TODO módulo do registro tem uma área", () => {
    const orfaos = MODULE_REGISTRY.filter((m) => areaDoModulo(m.id) === null);
    expect(orfaos.map((m) => `${m.id} (${m.category})`)).toEqual([]);
  });

  it("TODA categoria existente está mapeada — categoria nova não passa calada", () => {
    const categorias = new Set(MODULE_REGISTRY.map((m) => m.category));
    const semMapa = [...categorias].filter((c) => !(c in AREA_DA_CATEGORIA));
    expect(semMapa).toEqual([]);
  });

  it("a soma das áreas devolve o registro inteiro, sem perder nem duplicar", () => {
    const todos = AREAS.flatMap((a) => modulosDaArea(a.id));
    expect(todos.length).toBe(MODULE_REGISTRY.length);
    expect(new Set(todos).size).toBe(MODULE_REGISTRY.length);
  });
});

describe("áreas — a separação que o dono cobrou", () => {
  /**
   * ⚠️ MESA ≠ MEDIÇÃO, e é a decisão central. A `lab` misturava o experimento
   * VIVO (torneio, carteira, aprendizado) com perguntas sobre o PASSADO
   * (backtests, custo, liquidez). É a mesma confusão que ele apontou nos
   * conceitos: *"mesa, estratégia, paper, agente, torneio… nada, quando tudo
   * deveria ser isolado"*.
   */
  it("o torneio e a carteira são MESAS; o backtest é MEDIÇÃO", () => {
    expect(areaDoModulo("tournament")).toBe("mesas");
    expect(areaDoModulo("paper")).toBe("mesas");
    expect(areaDoModulo("aprendizado")).toBe("mesas");
    expect(areaDoModulo("launch-gate")).toBe("mesas");

    expect(areaDoModulo("backtest")).toBe("medicoes");
    expect(areaDoModulo("taxa-cex")).toBe("medicoes");
    expect(areaDoModulo("liquidez")).toBe("medicoes");
    expect(areaDoModulo("rotacao-grade")).toBe("medicoes");
  });

  it("a exceção por nome VENCE o mapa por categoria", () => {
    // Todo item de MESAS tem `category: "lab"` no registro — se a exceção não
    // valesse, os oito cairiam em MEDIÇÕES e o amontoado voltaria.
    for (const id of MESAS) {
      const m = MODULE_REGISTRY.find((x) => x.id === id);
      expect(m, `${id} não existe no registro`).toBeDefined();
      expect(m!.category, id).toBe("lab");
      expect(areaDoModulo(id), id).toBe("mesas");
    }
  });

  /**
   * ⚠️ A LISTA `MESAS` NÃO PODE CITAR FANTASMA. Um id que não existe no
   * registro é silencioso: não quebra nada, não aparece, e some da conta —
   * exatamente a invariante nº 25 em outra forma.
   */
  it("nenhum id de MESAS é fantasma", () => {
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id));
    expect(MESAS.filter((id) => !ids.has(id))).toEqual([]);
  });

  /**
   * ⚠️⚠️ O ÚLFHÉÐNAR É ABA, NÃO CARTÃO DENTRO DO COMANDO — e eu entreguei
   * errado primeiro (24/08).
   *
   * O dono pediu "uma aba nova com UI própria". Eu registrei um painel com
   * `category: "command"` e parei ali: ele virou o segundo cartão da área
   * COMANDO, no meio de outros três. Ele teve de vir dizer "isso tem que ficar
   * no painel ADM né".
   *
   * ⚠️ E NADA PODIA TER ACUSADO. Um painel registrado nas duas pontas
   * (`modules.ts` + `panel-map.tsx`) compila, aparece e funciona — só que na
   * área errada. A invariante nº 32 protege contra painel que não desenha;
   * não existia nada protegendo contra painel que desenha no lugar errado.
   *
   * Esta trava é esse pedaço: se alguém devolver o módulo para dentro do
   * COMANDO, ou apagar a área, o teste falha em vez de a aba sumir calada.
   */
  it("ÚLFHÉÐNAR é uma ÁREA do menu, não um painel do COMANDO", () => {
    expect(areaPorId("ulfhednar"), "a aba sumiu do menu").not.toBeNull();
    expect(areaDoModulo("ulfhednar")).toBe("ulfhednar");
    expect(modulosDaArea("ulfhednar")).toContain("ulfhednar");
    // E não pode estar nos dois lugares: cartão no COMANDO E aba própria.
    expect(modulosDaArea("comando")).not.toContain("ulfhednar");
  });

  it("nenhum id de ULFHEDNAR é fantasma", () => {
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id));
    expect(ULFHEDNAR.filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("áreas — o amontoado não pode voltar", () => {
  /**
   * ⚠️ O NÚMERO QUE ORIGINOU A REFORMA ERA 20. Este teste não trava o
   * crescimento — ele obriga a decisão a ser CONSCIENTE. Quem passar de 15
   * painéis numa área lê esta mensagem e decide dividir ou subir o teto; o que
   * não acontece é chegar a 20 sem ninguém perceber.
   */
  it("nenhuma área passa de 15 painéis sem alguém decidir isso", () => {
    const inchadas = Object.entries(contagemPorArea())
      .filter(([, n]) => n > 15)
      .map(([a, n]) => `${a}: ${n} painéis`);
    expect(inchadas, "a `lab` chegou a 20 crescendo um por vez").toEqual([]);
  });

  it("nenhuma área nasce vazia — área sem painel é item de menu que não leva a lugar nenhum", () => {
    const vazias = AREAS.filter((a) => modulosDaArea(a.id).length === 0);
    expect(vazias.map((a) => a.id)).toEqual([]);
  });

  it("a ordem das áreas é única e estável", () => {
    const ordens = AREAS.map((a) => a.ordem);
    expect(new Set(ordens).size).toBe(AREAS.length);
    expect([...ordens].sort((x, y) => x - y)).toEqual(ordens);
  });
});

describe("áreas — a ficha de cada uma", () => {
  it("toda área declara a PERGUNTA que responde", () => {
    // Sem isso o menu é uma lista de substantivos e o dono adivinha onde clicar.
    for (const a of AREAS) {
      expect(a.pergunta.length, a.id).toBeGreaterThan(15);
      expect(a.label.length, `${a.id}: label longo não cabe no celular`).toBeLessThanOrEqual(12);
    }
  });

  /**
   * ⚠️ A FAIXA DE AVISO SÓ ONDE CONFUNDIR CUSTA CARO. Aviso em toda tela é
   * aviso que ninguém lê — e misturar USDT simulado com receita real já
   * aconteceu neste painel.
   */
  it("MESAS, MEDIÇÕES e DINHEIRO avisam o que são; o resto não polui", () => {
    expect(areaPorId("mesas")!.aviso).toContain("SIMULADO");
    expect(areaPorId("medicoes")!.aviso).toContain("PASSADO");
    expect(areaPorId("dinheiro")!.aviso).toContain("REAIS");
    expect(areaPorId("comando")!.aviso).toBeNull();
    expect(areaPorId("sistema")!.aviso).toBeNull();
  });

  it("id desconhecido devolve null — URL digitada à mão não derruba a página", () => {
    expect(areaPorId("nao-existe")).toBeNull();
    expect(areaPorId("")).toBeNull();
  });
});
