import { afterEach, describe, expect, it, vi } from "vitest";
import * as indicadores from "@/lib/api/market-indicators";
import * as playbooks from "@/lib/zion/playbooks";
import { decidirAberturaDoAgente, prepararAgente, type VelasDoAgente } from "./agente";
import type { VelaComTempo } from "@/lib/mercado/velas";

const H = 3_600_000;
const FECHAMENTO = 336 * H; // Duas semanas: 4h, dia e semana fecham juntos.
const PARADO = { temPosicaoAberta: false, ultimaAberturaMs: null };
const serie = (n: number, passo = H): VelaComTempo[] => Array.from({ length: n }, (_, i) => ({
  t: i * passo, close: 100 + i, high: 101 + i, low: 99 + i, volume: i + 1,
}));
const ohlc = (v: ReadonlyArray<VelaComTempo>) => v.map(({ high, low, close, volume }) => ({ high, low, close, volume }));
const mundo = () => ({ h1: serie(400), h4: serie(101, 4 * H), d1: serie(18, 24 * H), w1: serie(4, 168 * H) });

afterEach(() => vi.restoreAllMocks());

describe("o agente só lê OHLC disponível no fechamento da última 1h", () => {
  it.each([
    { quando: "antes", agora: FECHAMENTO - 1, h1: 335, h4: 83, d1: 13, w1: 1 },
    { quando: "exatamente", agora: FECHAMENTO, h1: 336, h4: 84, d1: 14, w1: 2 },
  ])("inclui os prazos maiores corretos $quando do fechamento", ({ agora, h1, h4, d1, w1 }) => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([]);
    const espiao = vi.spyOn(indicadores, "computeIndicators");
    const v = mundo();

    decidirAberturaDoAgente(PARADO, "BTC", v, agora);

    expect(espiao).toHaveBeenCalledExactlyOnceWith(
      "BTC", ohlc(v.h1.slice(0, h1)), ohlc(v.h4.slice(0, h4)),
      ohlc(v.d1.slice(0, d1)), ohlc(v.w1.slice(0, w1)),
    );
  });

  it("um tick atrasado usa o fechamento da última 1h observada como limite", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([]);
    const espiao = vi.spyOn(indicadores, "computeIndicators");
    const v = mundo();
    v.h1 = v.h1.slice(0, 336);

    decidirAberturaDoAgente(PARADO, "BTC", v, 500 * H);

    expect(espiao).toHaveBeenCalledExactlyOnceWith(
      "BTC", ohlc(v.h1), ohlc(v.h4.slice(0, 84)), ohlc(v.d1.slice(0, 14)), ohlc(v.w1.slice(0, 2)),
    );
  });

  it("alterar extremos e fechamento dos prazos ainda abertos não muda a análise", () => {
    const seletor = vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([]);
    const espiao = vi.spyOn(indicadores, "computeIndicators");
    const original = mundo();
    const alterado = mundo();
    // Estas primeiras velas já abriram ANTES da última 1h, mas só fecham
    // às 336h. A antiga comparação pela abertura deixava todas vazarem.
    for (const [prazo, inicio] of [["h4", 83], ["d1", 13], ["w1", 1]] as const) {
      for (const vela of alterado[prazo].slice(inicio)) {
        Object.assign(vela, { close: 999_999, high: 1_000_000, low: 0.01, volume: 1_000_000 });
      }
    }

    const a = decidirAberturaDoAgente(PARADO, "BTC", original, FECHAMENTO - 1);
    const b = decidirAberturaDoAgente(PARADO, "BTC", alterado, FECHAMENTO - 1);

    expect(espiao).toHaveBeenCalledTimes(2);
    expect(espiao.mock.calls[1]).toEqual(espiao.mock.calls[0]);
    expect(seletor.mock.calls[1]).toEqual(seletor.mock.calls[0]);
    expect(b).toEqual(a);
  });

  it("o fallback semanal espera fechar a sétima diária e conserva seu OHLC", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([]);
    const espiao = vi.spyOn(indicadores, "computeIndicators");
    const v: VelasDoAgente = { h1: serie(400), h4: serie(101, 4 * H), d1: serie(14, 24 * H) };
    const primeiraSemana = { close: 106, high: 107, low: 99, volume: 28 };
    const segundaSemana = { close: 113, high: 114, low: 106, volume: 77 };

    decidirAberturaDoAgente(PARADO, "BTC", v, FECHAMENTO - 1);
    decidirAberturaDoAgente(PARADO, "BTC", v, FECHAMENTO);

    expect(espiao.mock.calls[0][4]).toEqual([primeiraSemana]);
    expect(espiao.mock.calls[1][4]).toEqual([primeiraSemana, segundaSemana]);
  });

  it("os identificadores de deduplicação continuam sendo a abertura da 1h", () => {
    vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([{
      def: { label: "teste" },
      plan: { entry: 100, target: 106, stop: 97, horizonHours: 48, playbook: "pullback_ema" },
      reason: null,
    }] as never);
    const v = mundo();
    const preparo = prepararAgente("BTC", v, FECHAMENTO);

    expect(preparo).toMatchObject({ pronto: true, ultimaT: 335 * H });
    expect(decidirAberturaDoAgente(PARADO, "BTC", v, FECHAMENTO, preparo))
      .toMatchObject({ abre: true, velaMs: 335 * H, entrada: 435 });
    expect(decidirAberturaDoAgente({ ...PARADO, ultimaAberturaMs: 335 * H }, "BTC", v, FECHAMENTO, preparo))
      .toEqual({ abre: false, porque: "vela_ja_avaliada", regime: null });
  });

  it("o preparo calcula os indicadores fechados uma vez e só quando necessário", () => {
    const seletor = vi.spyOn(playbooks, "candidateAttempts").mockReturnValue([]);
    const espiao = vi.spyOn(indicadores, "computeIndicators");
    const v = mundo();
    const preparo = prepararAgente("BTC", v, FECHAMENTO);

    decidirAberturaDoAgente({ ...PARADO, temPosicaoAberta: true }, "BTC", v, FECHAMENTO, preparo);
    decidirAberturaDoAgente({ ...PARADO, ultimaAberturaMs: 335 * H }, "BTC", v, FECHAMENTO, preparo);
    expect(espiao).not.toHaveBeenCalled();
    expect(seletor).not.toHaveBeenCalled();

    const primeira = decidirAberturaDoAgente(PARADO, "BTC", v, FECHAMENTO, preparo);
    const segunda = decidirAberturaDoAgente({ ...PARADO, ultimaAberturaMs: 334 * H }, "BTC", v, FECHAMENTO, preparo);
    expect(segunda).toEqual(primeira);
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(seletor).toHaveBeenCalledTimes(1);
  });
});
