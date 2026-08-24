import { describe, it, expect } from "vitest";
import {
  sizePosition, canEnter, computeExit, computeExitPath, convictionFactor,
  simbolosAbertos, chaveSimbolo, tendencia24h, permiteEntrada,
} from "@/lib/paper/engine";
import { CUSTO_IDA_E_VOLTA_PCT } from "@/lib/zion/custo";

describe("paper engine — position sizing", () => {
  it("deploys 5% of starting capital, capped by available cash", () => {
    expect(sizePosition(1000, 1000)).toBeCloseTo(50);   // 5% of 1000
    expect(sizePosition(30, 1000)).toBeCloseTo(30);      // cash-limited
  });
  it("returns 0 when below the min-cash floor (out of capital)", () => {
    expect(sizePosition(10, 1000)).toBe(0);              // 10 < 25 floor
    expect(sizePosition(0, 1000)).toBe(0);
  });
});

describe("paper engine — entry guard", () => {
  it("enters a buy only when fill sits inside the bracket", () => {
    expect(canEnter("buy", 100, 110, 95)).toBe(true);    // stop < fill < target
    expect(canEnter("buy", 112, 110, 95)).toBe(false);   // already past target
    expect(canEnter("buy", 94,  110, 95)).toBe(false);   // already past stop
  });
  it("enters a sell (short) only when fill sits inside the inverted bracket", () => {
    expect(canEnter("sell", 100, 90, 105)).toBe(true);   // target < fill < stop
    expect(canEnter("sell", 88,  90, 105)).toBe(false);  // already past target
  });
  it("refuses without a bracket or with a non-positive fill", () => {
    expect(canEnter("buy", 100, null, 95)).toBe(false);
    expect(canEnter("buy", 0,   110, 95)).toBe(false);
  });
});

describe("paper engine — exit + P&L (net of cost, stop-first)", () => {
  const base = { side: "buy", entry_price: 100, cost_usd: 50, target_price: 110, stop_price: 95, opened_at: "2026-07-01T00:00:00Z", horizon_hours: 72 };
  const t0 = Date.parse("2026-07-01T00:00:00Z");

  it("books a win at target, net of round-trip cost", () => {
    const v = computeExit(base, 111, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
    expect(v.win).toBe(true);
    // gross +10%, net +9.8% on $50 = +$4.90
    // ⚠️ Da FONTE, não digitado: este `0.2` cru confirmava, verdinho, a
    // meia-taxa que `engine.ts` cobrava até 16/08.
    expect(v.pnlUsd).toBeCloseTo(50 * (10 - CUSTO_IDA_E_VOLTA_PCT) / 100, 6);
  });

  it("books a loss at stop", () => {
    const v = computeExit(base, 94, t0 + 3_600_000)!;
    expect(v.reason).toBe("stop");
    expect(v.win).toBe(false);
    expect(v.pnlUsd).toBeLessThan(0);
  });

  it("stop-first pessimism when a tick shows both crossed", () => {
    const v = computeExit(base, 90, t0 + 3_600_000)!; // below stop AND (if it were) — books stop
    expect(v.reason).toBe("stop");
  });

  it("expires at the current price after the horizon", () => {
    const v = computeExit(base, 103, t0 + 73 * 3_600_000)!;
    expect(v.reason).toBe("expired");
    expect(v.win).toBe(true); // +3% gross → net positive
  });

  it("stays in-flight (null) before any level or the horizon", () => {
    expect(computeExit(base, 103, t0 + 3_600_000)).toBeNull();
  });

  it("prices a short correctly (profit when price falls)", () => {
    const short = { ...base, side: "sell", target_price: 90, stop_price: 105 };
    const v = computeExit(short, 89, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
    expect(v.pnlUsd).toBeGreaterThan(0);
  });
});

describe("paper engine — conviction sizing (F3)", () => {
  it("scales the multiplier by probability, clamped to [0.5, 1.5]", () => {
    // Neutralized (auditoria 25/07): stated probability is anti-calibrated,
    // so sizing is flat regardless of the model's self-reported confidence.
    expect(convictionFactor(50)).toBe(1);
    expect(convictionFactor(70)).toBe(1);
    expect(convictionFactor(30)).toBe(1);
    expect(convictionFactor(200)).toBe(1);
    expect(convictionFactor(0)).toBe(1);
    expect(convictionFactor(null)).toBe(1);
  });
  it("a high-conviction signal deploys more capital", () => {
    expect(sizePosition(1000, 1000, 1.4)).toBeCloseTo(70); // 5% × 1.4
    expect(sizePosition(1000, 1000, 0.8)).toBeCloseTo(40); // 5% × 0.8
  });
});

describe("paper engine — path-aware exit (F3)", () => {
  const base = { side: "buy", entry_price: 100, cost_usd: 50, target_price: 110, stop_price: 95, opened_at: "2026-07-01T00:00:00Z", horizon_hours: 72 };
  const t0 = Date.parse("2026-07-01T00:00:00Z");
  const candle = (min: number, high: number, low: number, close: number) => ({ t: t0 + min * 60_000, high, low, close });

  it("books the target when an intra-window candle wicks through it", () => {
    // spot is back at 102 now, but a candle at :20 wicked to 111 → target hit
    const v = computeExitPath(base, [candle(10, 105, 99, 104), candle(20, 111, 103, 106)], 102, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
  });

  it("stop-first when one candle straddles both levels", () => {
    const v = computeExitPath(base, [candle(10, 112, 94, 100)], 100, t0 + 3_600_000)!;
    expect(v.reason).toBe("stop");
  });

  it("falls back to the spot check when no candles are available", () => {
    const v = computeExitPath(base, [], 111, t0 + 3_600_000)!;
    expect(v.reason).toBe("target");
  });

  it("stays in-flight when no candle touched a level and horizon is open", () => {
    expect(computeExitPath(base, [candle(10, 104, 98, 101)], 101, t0 + 3_600_000)).toBeNull();
  });
});

/**
 * UMA POSIÇÃO POR SÍMBOLO POR MESA — o caso real de 13/08.
 *
 * A sugestão de ADA das 18:00 ficou encalhada na fila; a das 19:30 chegou por
 * cima; às 19:31:07 as DUAS viraram posição, ao mesmo preço, com o mesmo
 * playbook e o mesmo alvo. VÖLUNDR, SKAÐI e URÐR fizeram idêntico no mesmo
 * segundo — $300 de exposição onde o mandato manda $150, e seis trades no
 * ledger carregando a informação de três.
 */
describe("guarda-duplicata por símbolo", () => {
  const pos = (account_id: string, symbol: string, status = "open", archived_at: string | null = null) =>
    ({ account_id, symbol, status, archived_at });

  it("posição aberta bloqueia uma segunda no mesmo símbolo", () => {
    const abertos = simbolosAbertos([pos("a1", "ADA")]);
    expect(abertos.has(chaveSimbolo("a1", "ADA"))).toBe(true);
  });

  it("outra mesa no mesmo símbolo NÃO é bloqueada — a comparação entre mesas é o experimento", () => {
    const abertos = simbolosAbertos([pos("a1", "ADA")]);
    expect(abertos.has(chaveSimbolo("a2", "ADA"))).toBe(false);
  });

  /**
   * ⚠️ SEM `status === "open"` o guarda vira LISTA NEGRA PERMANENTE: a mesa
   * que já operou ADA uma vez nunca mais poderia operar ADA.
   */
  it("posição FECHADA não bloqueia — senão o guarda vira lista negra", () => {
    expect(simbolosAbertos([pos("a1", "ADA", "closed")]).size).toBe(0);
  });

  /** Sem `archived_at == null`, exposição que saiu da medição segue bloqueando. */
  it("posição ARQUIVADA não bloqueia — ela não é exposição", () => {
    expect(simbolosAbertos([pos("a1", "ADA", "open", "2026-08-03T10:25:03Z")]).size).toBe(0);
  });

  it("a chave é insensível a caixa — 'ada' e 'ADA' são o mesmo símbolo", () => {
    const abertos = simbolosAbertos([pos("a1", "ada")]);
    expect(abertos.has(chaveSimbolo("a1", "ADA"))).toBe(true);
    expect(chaveSimbolo("a1", "AdA")).toBe(chaveSimbolo("a1", "ada"));
  });

  /**
   * O caso do mesmo tick: duas sugestões do mesmo símbolo chegam juntas e o
   * banco não conhece nenhuma das duas. Ler só o estado inicial deixaria as
   * duas passarem — por isso o conjunto CRESCE dentro do laço.
   */
  it("duas sugestões do mesmo símbolo no MESMO tick: só a primeira passa", () => {
    const jaDentro = simbolosAbertos([]);
    const fila = [{ acc: "a1", symbol: "ADA" }, { acc: "a1", symbol: "ADA" }, { acc: "a1", symbol: "OP" }];
    const abertas = fila.filter((s) => {
      if (jaDentro.has(chaveSimbolo(s.acc, s.symbol))) return false;
      jaDentro.add(chaveSimbolo(s.acc, s.symbol));
      return true;
    });
    expect(abertas.map((a) => a.symbol)).toEqual(["ADA", "OP"]);
  });
});

/**
 * O FILTRO DE REGIME (docs/PLANO-TAMANHO-E-REGIME.md).
 *
 * Medido em 206 posicoes reais: filtrar entradas contra a tendencia valia
 * +$5,45 com posicao de $50 — e +$30,06 depois de o tamanho subir. O sinal
 * olha para TRAS, e e isso que estes testes protegem.
 */
const H = 3_600_000;
const vela = (t: number, close: number) => ({ t, high: close, low: close, close });

describe("filtro de regime — a tendencia de 24h", () => {
  const agora = 100 * H;

  it("mede do fechamento de 24h atras ate a vela mais recente", () => {
    const c = [vela(agora - 24 * H, 100), vela(agora - 12 * H, 105), vela(agora, 110)];
    expect(tendencia24h(c, agora)).toBeCloseTo(10, 6);   // 100 -> 110
  });

  it("NUNCA usa vela posterior ao instante da decisao", () => {
    // ⚠️ O teste central: a vela de +6h existe na serie e valeria +50%.
    // Se ela entrar, o filtro decide com o futuro e todo o numero medido cai.
    const c = [vela(agora - 24 * H, 100), vela(agora, 90), vela(agora + 6 * H, 150)];
    const t = tendencia24h(c, agora);
    expect(t).toBeCloseTo(-10, 6);       // 100 -> 90, e nao 100 -> 150
    expect(permiteEntrada(t)).toBe(false);
  });

  it("sem vela de 24h atras devolve null, nunca 0", () => {
    // ⚠️ 0 seria "de lado" (uma afirmacao); null e "nao sei". Serie de 3h nao
    // vira tendencia de 24h com outro nome.
    const c = [vela(agora - 3 * H, 100), vela(agora, 100)];
    expect(tendencia24h(c, agora)).toBeNull();
  });

  it("escolhe a vela mais RECENTE dentro do corte, nao a primeira da serie", () => {
    // Assimetrico de proposito: a primeira (48h) daria +100%, a do corte
    // (24h) da +10%. Trocar `<=` por um `find` derruba esta assercao.
    const c = [vela(agora - 48 * H, 50), vela(agora - 24 * H, 100), vela(agora, 110)];
    expect(tendencia24h(c, agora)).toBeCloseTo(10, 6);
  });

  it("ignora fechamento nao positivo e serie curta demais", () => {
    expect(tendencia24h([vela(agora - 24 * H, 0), vela(agora, 110)], agora)).toBeNull();
    expect(tendencia24h([vela(agora, 110)], agora)).toBeNull();
    expect(tendencia24h([], agora)).toBeNull();
  });
});

describe("filtro de regime — o portao", () => {
  it("FALHA ABERTO: sem sinal, deixa passar", () => {
    // ⚠️ Ao contrario do caminho do dinheiro. Filtro sem sinal nao protege
    // capital, so impede a mesa de operar — provedor de velas fora do ar nao
    // pode desligar o laboratorio em silencio.
    expect(permiteEntrada(null)).toBe(true);
  });

  it("passa na alta e barra na queda", () => {
    expect(permiteEntrada(0.01)).toBe(true);
    expect(permiteEntrada(-0.01)).toBe(false);
  });

  it("empate BARRA — preco parado nao e tendencia de alta", () => {
    expect(permiteEntrada(0)).toBe(false);
  });
});
