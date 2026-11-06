import { afterEach, describe, expect, it, vi } from "vitest";
import * as indicadores from "@/lib/api/market-indicators";
import * as playbooks from "@/lib/zion/playbooks";
import { agregar, rodarMesa, type VelasDaMesa } from "./mesa-real";
const H = 3_600_000;
const serie = (n: number, passo = H) => Array.from({ length: n }, (_, i) =>
  ({ t: i * passo, close: 100, high: 101, low: 99, volume: 100 }));
const mundo = (): VelasDaMesa => ({ h1: serie(210), h4: serie(55, 4 * H), d1: serie(10, 24 * H), w1: serie(3, 168 * H) });
function plano(horas = 2) {
  return { def: { label: "fixture" }, plan: { entry: 100, stop: 95, target: 110, horizonHours: horas, playbook: "fixture" }, reason: "" };
}
afterEach(() => vi.restoreAllMocks());

describe("replay usa o instante em que a vela ficou conhecida", () => {
  it("não lê o OHLC final de 4h/dia/semana ainda abertos na primeira decisão", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([]);
    const espiao = vi.spyOn(indicadores.RetratoPorPrefixo.prototype, "at");
    rodarMesa(mundo(), "TST", 0.4);
    expect(espiao).toHaveBeenCalled();
    expect(espiao.mock.calls[0]).toEqual([201, 50, 8, 1]);
  });
  it("entrada no fechamento do sinal; saída no fechamento da vela que tocou o alvo", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValueOnce([plano()] as never).mockReturnValue([]);
    const v = mundo(); v.h1[201].high = 111;
    const r = rodarMesa(v, "TST", 0.4);
    expect(r.operacoes).toHaveLength(1);
    expect(r.operacoes[0]).toMatchObject({ abriuEm: 201 * H, fechouEm: 202 * H, entrada: 100, saida: 110, desfecho: "alvo", brutoPct: 10, liquidoPct: 9.6 });
  });
  it("extremos da vela do sinal não são toques depois da entrada", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValueOnce([plano()] as never).mockReturnValue([]);
    const v = mundo(); v.h1[200].high = 120; v.h1[200].low = 80;
    expect(rodarMesa(v, "TST", 0.4).operacoes[0]).toMatchObject({ desfecho: "expirada", fechouEm: 203 * H, saida: 100 });
  });
  it("só reabre no fechamento que tornou a saída conhecida, sem sobrepor posições", () => {
    vi.spyOn(playbooks, "candidateAttempts")
      .mockReturnValueOnce([plano()] as never)
      .mockReturnValueOnce([plano()] as never)
      .mockReturnValue([]);
    const v = mundo(); v.h1[201].high = 111; v.h1[202].high = 111;
    const r = rodarMesa(v, "TST", 0.4);
    expect(r.operacoes.map(({ abriuEm, fechouEm }) => ({ abriuEm, fechouEm })))
      .toEqual([
        { abriuEm: 201 * H, fechouEm: 202 * H },
        { abriuEm: 202 * H, fechouEm: 203 * H },
      ]);
  });
  it("não usa máxima da vela que só fecha depois do horizonte fracionário", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValueOnce([plano(1.5)] as never).mockReturnValue([]);
    const v = mundo(); v.h1[202].high = 120;
    const r = rodarMesa(v, "TST", 0.4);
    expect(r.operacoes).toHaveLength(0);
    expect(r.aindaAbertas).toBe(1);
  });
  it("não atravessa buraco histórico para inventar qual toque veio primeiro", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValueOnce([plano()] as never).mockReturnValue([]);
    const v = mundo(); v.h1.splice(201, 1); v.h1[201].high = 120;
    const r = rodarMesa(v, "TST", 0.4);
    expect(r.operacoes).toHaveLength(0);
    expect(r.aindaAbertas).toBe(1);
  });
  it("continua stop-first quando alvo e stop ocorrem na mesma vela", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValueOnce([plano()] as never).mockReturnValue([]);
    const v = mundo(); v.h1[201].high = 120; v.h1[201].low = 90;
    expect(rodarMesa(v, "TST", 0.4).operacoes[0]).toMatchObject({ desfecho: "stop", fechouEm: 202 * H, saida: 95, liquidoPct: -5.4 });
  });
  it("não monta semana com sete diárias que atravessam dia ausente", () => {
    const d = serie(8, 24 * H); d.splice(3, 1);
    expect(agregar(d, 7)).toHaveLength(0);
  });
});
