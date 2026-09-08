/**
 * ⚠️⚠️ O AGENDADOR PAUSADO NÃO PODE APARECER COMO VIVO.
 *
 * É dinheiro real do cliente: ele vê "vivo", entende que as compras estão
 * saindo, e não sai nenhuma. A trava está em `estadoDoAgendador`, e este
 * arquivo existe para que ela quebre no dia em que alguém a "simplificar".
 */
import { describe, it, expect } from "vitest";
import {
  estadoDoAgendador, agendadorExecuta, MINUTOS_ATE_PARADO,
} from "@/lib/dca/agendador";

describe("estadoDoAgendador", () => {
  it("pausado com heartbeat FRESCO — o caso real, e o que enganava a tela", () => {
    // O cron carimba ANTES de ler o gate: pausado, ele passa e volta sem nada.
    // Três minutos de "última passada" e ZERO execução.
    expect(estadoDoAgendador({ haMinutos: 3, pausado: true })).toBe("pausado");
    expect(agendadorExecuta(estadoDoAgendador({ haMinutos: 3, pausado: true }))).toBe(false);
  });

  it("a pausa ganha do relógio quando as duas coisas são verdade", () => {
    // Pausado E sem passar há horas: o que muda o que o cliente faz agora é a
    // trava da casa, não o atraso.
    expect(estadoDoAgendador({ haMinutos: 600, pausado: true })).toBe("pausado");
    expect(estadoDoAgendador({ haMinutos: null, pausado: true })).toBe("pausado");
  });

  it("`null` de minutos é NUNCA, nunca zero — `Number(null)` diria 'passou agora'", () => {
    expect(estadoDoAgendador({ haMinutos: null })).toBe("nunca");
    expect(estadoDoAgendador({ haMinutos: 0 })).toBe("vivo");
  });

  it("o limiar é 20 min, e a fronteira é fechada do lado do vivo", () => {
    expect(estadoDoAgendador({ haMinutos: MINUTOS_ATE_PARADO })).toBe("vivo");
    expect(estadoDoAgendador({ haMinutos: MINUTOS_ATE_PARADO + 1 })).toBe("parado");
  });

  it("sem resposta da rota, `null` — carregando não é 'vivo' nem 'parado'", () => {
    expect(estadoDoAgendador(null)).toBeNull();
    expect(agendadorExecuta(null)).toBe(false);
  });

  it("`pausado` ausente ou falso não inventa pausa", () => {
    expect(estadoDoAgendador({ haMinutos: 3 })).toBe("vivo");
    expect(estadoDoAgendador({ haMinutos: 3, pausado: false })).toBe("vivo");
    expect(agendadorExecuta(estadoDoAgendador({ haMinutos: 3 }))).toBe(true);
  });
});
