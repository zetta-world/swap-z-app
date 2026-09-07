import { describe, it, expect } from "vitest";
import {
  identidadeDaRodada, identidadeDaMesa, identidadeDaPropria, janelaEmDias,
} from "@/lib/bancada/identidade";
import type { EstrategiaDoCliente } from "@/lib/bancada/vocabulario";

/**
 * ⚠️⚠️ ESTE ARQUIVO EXISTE POR UMA FRASE (07/09): *"cada teste que rodo sobrepõe
 * o outro, e não mostra qual agente está rodando"*.
 *
 * O que se trava aqui não é formatação — é que a rodada SAIBA DIZER quem é, do
 * jeito certo, vindo dos dois caminhos: o do POST que acabou de responder e o
 * da releitura do banco. É a divergência entre esses dois que faria o cartão
 * mudar de nome depois de um F5.
 */

describe("uma mesa da casa se apresenta pelo nome", () => {
  it("lê `mesa` e `mesaNome` dos params congelados", () => {
    const id = identidadeDaRodada("casa", {
      mesa: "freyja", mesaNome: "FREYJA", alvoPct: 0, stopPct: 0,
    });
    expect(id).toEqual({ tipo: "mesa", mesa: "freyja", nome: "FREYJA" });
  });

  it("sem `mesaNome`, o id da mesa serve de nome — um rótulo feio é melhor que nenhum", () => {
    const id = identidadeDaRodada("casa", { mesa: "freyja" });
    expect(id).toEqual({ tipo: "mesa", mesa: "freyja", nome: "freyja" });
  });

  /**
   * ⚠️ A CICATRIZ DE #401. Antes daquela entrega, uma corrida da FREYJA ficou
   * gravada como `propria` com `intervalo: "1d"` — a mesa não punha o próprio
   * nome nos params. Essas linhas ainda estão no banco do dono.
   */
  it("rodada antiga sem `mesa` não some da tela: volta como própria", () => {
    const id = identidadeDaRodada("casa", { entrada: { tipo: "canal", n: 20 }, alvoPct: 2.5, stopPct: 2.5 });
    expect(id.tipo).toBe("propria");
  });
});

describe("uma estratégia própria se apresenta pelos números que ela É", () => {
  it("carrega gatilho, direção, alvo, stop e horizonte", () => {
    const id = identidadeDaRodada("propria", {
      entrada: { tipo: "rsi", n: 14, nivel: 30 },
      direcao: "venda", alvoPct: 2.5, stopPct: 1.2, horasLimite: 72,
    });
    expect(id).toEqual({
      tipo: "propria",
      entrada: { tipo: "rsi", n: 14, nivel: 30 },
      direcao: "venda", alvoPct: 2.5, stopPct: 1.2, horasLimite: 72,
    });
  });

  it("params corrompidos não derrubam a leitura — o histórico não pode sumir", () => {
    const id = identidadeDaRodada("propria", { entrada: "lixo", direcao: 7, alvoPct: "x" });
    expect(id).toEqual({
      tipo: "propria", entrada: { tipo: "media", n: 20 },
      direcao: "compra", alvoPct: 0, stopPct: 0, horasLimite: 48,
    });
  });

  /**
   * ⚠️⚠️ `Number(null)` É 0 E PASSA EM `isFinite` — a cicatriz mais barata de
   * repetir nesta base. Se `alvoPct: null` virasse um zero convincente sem
   * checagem de tipo, um alvo AUSENTE apareceria na tela como "alvo 0,0%", que
   * é uma afirmação, não uma falta.
   */
  it("null não vira número por acidente: cai no padrão declarado", () => {
    const id = identidadeDaRodada("propria", { alvoPct: null, stopPct: null, horasLimite: null });
    expect(id).toMatchObject({ alvoPct: 0, stopPct: 0, horasLimite: 48 });
  });
});

describe("o cartão que nasce ANTES da resposta usa as mesmas formas", () => {
  it("identidadeDaMesa e identidadeDaRodada('casa') concordam", () => {
    const antes = identidadeDaMesa("freyja", "FREYJA");
    const depois = identidadeDaRodada("casa", { mesa: "freyja", mesaNome: "FREYJA" });
    expect(antes).toEqual(depois);
  });

  it("identidadeDaPropria e identidadeDaRodada('propria') concordam", () => {
    const e: EstrategiaDoCliente = {
      entrada: { tipo: "canal", n: 20 }, direcao: "compra",
      alvoPct: 2.5, stopPct: 2.5, horasLimite: 48, praca: "dex", papel: "taker",
    };
    // ⚠️ Os params congelados da rota SÃO a estratégia espalhada — é essa a
    // igualdade que impede o cartão de mudar de nome depois do F5.
    expect(identidadeDaPropria(e)).toEqual(identidadeDaRodada("propria", { ...e }));
  });
});

describe("a janela em dias sai dos dois carimbos", () => {
  const D = 86_400_000;
  it("365 dias são 365 dias", () => {
    const ate = Date.parse("2026-09-07T00:00:00Z");
    expect(janelaEmDias(ate - 365 * D, ate)).toBe(365);
  });
  it("nunca negativa — carimbos invertidos devolvem 0, não um número absurdo", () => {
    expect(janelaEmDias(1_000, 0)).toBe(0);
  });
});
