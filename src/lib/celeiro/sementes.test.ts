import { describe, it, expect } from "vitest";
import {
  SEMENTES, sementeDe, sementeAbreAlgumaVez, sementesImpossiveis, genomaAbre,
} from "./sementes";
import { agentePor } from "./agentes";
import { MULTIPLO_DO_PEDAGIO } from "./regime";
import { taxaPorPerna } from "./taxas";

describe("a trava: nenhuma semente pode ser impossível", () => {
  /**
   * ⚠️⚠️ ESTE É O TESTE QUE FALTAVA EM 31/08. O Maker nasceu com alvo de 1,50%
   * contra um mínimo de 2,40%, compilou, passou no CI, foi mergeado, deployado,
   * e recusou BTC/ETH/SOL em produção por duas horas antes de alguém olhar.
   */
  it("⚠️ nenhum agente do Celeiro nasce com um alvo que o portão sempre recusa", () => {
    expect(sementesImpossiveis()).toEqual([]);
  });

  it("o Maker limpa o pedágio do SPOT MAKER, que é 0,40% de ida e volta", () => {
    const maker = agentePor("maker_de_faixa")!;
    const v = sementeAbreAlgumaVez(maker);
    expect(v.pedagioIdaEVoltaPct).toBeCloseTo(0.40, 6);
    expect(v.alvoMinimoPct).toBeCloseTo(2.40, 6);
    expect(v.abre).toBe(true);
  });

  it("⚠️ o alvo de 1,50% de 31/08 é REPROVADO — o defeito não volta calado", () => {
    const maker = agentePor("maker_de_faixa")!;
    const v = sementeAbreAlgumaVez(maker, {
      alvoPct: 1.5, stopPct: 1.5, horasLimite: 24, multiploDoPedagio: MULTIPLO_DO_PEDAGIO,
    });
    expect(v.abre).toBe(false);
    expect(v.porque).toContain("2.40");
  });

  it("⚠️ e o de ±0,6% de agosto também — o bracket que o matou", () => {
    const maker = agentePor("maker_de_faixa")!;
    expect(sementeAbreAlgumaVez(maker, { alvoPct: 0.6, stopPct: 0.6 }).abre).toBe(false);
  });
});

describe("o pedágio é do AGENTE, não da arena", () => {
  /**
   * ⚠️ A ARMADILHA EXATA DE 31/08: o comentário do cron citava 0,225% (o legado
   * da arena) enquanto o portão cobrava 0,40% (spot maker). Se a trava usasse o
   * número legado ela CONCORDARIA com o defeito.
   */
  it("o mesmo alvo passa em futuros e reprova no spot", () => {
    const spot = agentePor("maker_de_faixa")!;              // spot_gate / maker → 0,40%
    const futuros = agentePor("cacador_de_tendencia")!;     // futuros_gate

    const semente = { alvoPct: 1.0, stopPct: 1.0 };
    expect(sementeAbreAlgumaVez(spot, semente).abre).toBe(false);
    expect(sementeAbreAlgumaVez(futuros, semente).abre).toBe(true);
  });

  it("o pedágio lido bate com a tabela de taxas, por praça E por papel", () => {
    for (const id of Object.keys(SEMENTES)) {
      if (id === "padrao") continue;
      const ag = agentePor(id);
      if (!ag) continue;
      const esperado = 2 * taxaPorPerna(ag.modalidade, ag.execucao);
      expect(sementeAbreAlgumaVez(ag).pedagioIdaEVoltaPct).toBeCloseTo(esperado, 9);
    }
  });

  it("⚠️ NÃO usa o pedágio legado da arena (0,225%) para ninguém", () => {
    const maker = agentePor("maker_de_faixa")!;
    expect(sementeAbreAlgumaVez(maker).pedagioIdaEVoltaPct).not.toBeCloseTo(0.225, 6);
  });
});

describe("o stop entra na conta do portão", () => {
  /**
   * I3 (`alvoAcompanhaOStop`) sobe o alvo até o stop efetivo e nunca o desce.
   * Julgar só o `alvoPct` declarado erraria para o lado otimista.
   */
  it("um stop mais largo que o alvo é o que o portão julga", () => {
    const maker = agentePor("maker_de_faixa")!;
    const v = sementeAbreAlgumaVez(maker, { alvoPct: 1.0, stopPct: 3.0 });
    expect(v.alvoPct).toBe(3.0);
    expect(v.abre).toBe(true);   // 3,0% > 2,40%, mesmo com alvo declarado de 1,0%
  });

  it("stop ausente não vira zero nem derruba o alvo", () => {
    const maker = agentePor("maker_de_faixa")!;
    expect(sementeAbreAlgumaVez(maker, { alvoPct: 2.5 }).alvoPct).toBe(2.5);
  });
});

describe("semente sem alvo não é semente reprovada", () => {
  it("⚠️ o convergencia_base não usa o portão de alvo — e isso é 'não se aplica'", () => {
    const base = agentePor("convergencia_base")!;
    const v = sementeAbreAlgumaVez(base);
    expect(v.abre).toBe(true);
    expect(v.alvoPct).toBeNull();      // null, nunca 0
    expect(v.porque).toContain("não passa pelo portão");
  });
});

describe("sementeDe", () => {
  it("cada agente com semente própria recebe a dele", () => {
    expect(sementeDe("maker_de_faixa").alvoPct).toBe(2.5);
    expect(sementeDe("convergencia_base").margemPp).toBe(0.15);
  });

  it("quem não tem semente própria cai no padrão dos de tendência", () => {
    expect(sementeDe("cacador_de_tendencia")).toBe(SEMENTES.padrao);
    expect(sementeDe("alavancado_de_tendencia").alvoPct).toBe(2.0);
    expect(sementeDe("um_agente_que_nao_existe").alvoPct).toBe(2.0);
  });

  it("⚠️ o padrão NÃO é o do Maker — trocar os dois seria silencioso", () => {
    expect(sementeDe("cacador_de_tendencia").alvoPct)
      .not.toBe(sementeDe("maker_de_faixa").alvoPct);
  });
});


describe("⚠️⚠️ genomaAbre: a trava do lado certo da porta (05/09)", () => {
  /**
   * A trava das SEMENTES ficou do lado errado: ela percorre o código, e o
   * flywheel escreve genoma no BANCO. Em 03/09 o modelo aplicou
   * `multiploDoPedagio` 6 → 12 no Maker — múltiplo 12 sobre pedágio de 0,40%
   * exige alvo de 4,80%, e o genoma declarava 2,50%.
   *
   * Medido dois dias depois: 0 posições do v4, 0 fluxos no braço da mutação,
   * 9 no controle. O braço sob teste NUNCA operou, e o A/B ia concluir que a
   * mutação "não pagou".
   */
  it("⚠️ O v4 REAL de 03/09 é recusado — múltiplo 12 com alvo 2,5", () => {
    const v = genomaAbre("maker_de_faixa", {
      alvoPct: 2.5, stopPct: 2.5, horasLimite: 24, multiploDoPedagio: 12,
    });
    expect(v).not.toBeNull();
    expect(v!.abre).toBe(false);
    expect(v!.alvoMinimoPct).toBeCloseTo(4.8, 6);
  });

  it("⚠️ e o v3, que está no ar, passa", () => {
    const v = genomaAbre("maker_de_faixa", {
      alvoPct: 2.5, stopPct: 2.5, horasLimite: 24, multiploDoPedagio: 6,
    });
    expect(v!.abre).toBe(true);
  });

  it("⚠️ o v2 (alvo 1,5) continua recusado por este caminho também", () => {
    expect(genomaAbre("maker_de_faixa", { alvoPct: 1.5, stopPct: 1.5, multiploDoPedagio: 6 })!.abre)
      .toBe(false);
  });

  /**
   * ⚠️ `params` é jsonb: o banco devolve o que gravaram, e nem sempre é número.
   * `Number(null)` é 0 e passa em `isFinite` — seria um alvo de 0% aprovado
   * como "medido".
   */
  it("⚠️ número em string (jsonb) é lido, não descartado", () => {
    const v = genomaAbre("maker_de_faixa", { alvoPct: "2.5", stopPct: "2.5", multiploDoPedagio: "6" });
    expect(v!.abre).toBe(true);
    expect(v!.alvoPct).toBe(2.5);
  });

  it("⚠️ null NÃO vira zero — vira ausente, e ausente não usa o portão", () => {
    const v = genomaAbre("maker_de_faixa", { alvoPct: null, stopPct: null });
    expect(v!.alvoPct).toBeNull();       // não 0
    expect(v!.abre).toBe(true);          // "não se aplica", nunca "reprovado"
  });

  it("⚠️ lixo não numérico também é ausente", () => {
    expect(genomaAbre("maker_de_faixa", { alvoPct: "abc" })!.alvoPct).toBeNull();
  });

  it("agente que não existe devolve null — e quem chama decide", () => {
    expect(genomaAbre("agente_fantasma", { alvoPct: 2.5 })).toBeNull();
  });

  it("⚠️ o pedágio continua sendo o DO AGENTE: futuros aceita alvo que o spot recusa", () => {
    const params = { alvoPct: 1.0, stopPct: 1.0, multiploDoPedagio: 6 };
    expect(genomaAbre("maker_de_faixa", params)!.abre).toBe(false);       // spot: mín 2,40
    expect(genomaAbre("cacador_de_tendencia", params)!.abre).toBe(true);  // futuros: mín 0,60
  });
});
