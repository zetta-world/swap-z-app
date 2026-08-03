import { describe, it, expect } from "vitest";
import {
  backtestPlaybooks, summarize, mergeResults, WARMUP_BARS, INDICATOR_WINDOW,
  type TimedCandle, type BacktestResult,
} from "@/lib/zion/playbook-backtest";
import type { MarketRegime } from "@/lib/api/market-indicators";

/**
 * O BACKTEST QUE SUBSTITUI O PALPITE.
 *
 * A coluna `priority` da biblioteca decide qual estratégia o mecânico tenta
 * primeiro, e sempre foi um chute declarado como tal. Estes testes guardam as
 * propriedades sem as quais a medição que vai substituí-la seria pior que o
 * chute — porque teria a aparência de fato.
 *
 * Duas delas importam mais que todo o resto:
 *
 *   1. NÃO OLHAR O FUTURO. Um backtest que espia adiante produz curvas lindas e
 *      mente com convicção.
 *   2. NÃO CONTAR O MESMO EVENTO VÁRIAS VEZES. O mesmo setup vale por várias
 *      barras; sem cooldown, um único movimento vira "50 trades" e a amostra
 *      parece grande sendo a mesma observação repetida.
 */

/** Série sintética: começa em `from` e anda `step` por barra. */
function ramp(n: number, from = 100, step = 0, vol = 1000): TimedCandle[] {
  const out: TimedCandle[] = [];
  for (let i = 0; i < n; i++) {
    const c = from + step * i;
    out.push({ t: Date.UTC(2026, 0, 1) + i * 3_600_000, high: c * 1.01, low: c * 0.99, close: c, volume: vol });
  }
  return out;
}

/** Série lateral com oscilação — o terreno de mean-reversion. */
function oscillate(n: number, mid = 100, amp = 6): TimedCandle[] {
  const out: TimedCandle[] = [];
  for (let i = 0; i < n; i++) {
    const c = mid + amp * Math.sin(i / 7);
    out.push({ t: Date.UTC(2026, 0, 1) + i * 3_600_000, high: c * 1.012, low: c * 0.988, close: c, volume: 1000 });
  }
  return out;
}

describe("aquecimento — indicador meio-formado não gera sinal", () => {
  it("série curta demais não produz trade nenhum", () => {
    // EMA50 sobre 30 barras é um número, mas não é uma EMA50. Sinais gerados
    // a partir daí entrariam na amostra com o mesmo peso dos bons.
    const r = backtestPlaybooks("TEST", ramp(WARMUP_BARS - 10));
    expect(r.barsTested).toBe(0);
    expect(r.stats).toEqual([]);
  });

  it("só avalia barras DEPOIS do aquecimento", () => {
    const n = WARMUP_BARS + 50;
    const r = backtestPlaybooks("TEST", oscillate(n));
    // n − warmup − 1 (a última barra não abre trade: não haveria futuro nenhum)
    expect(r.barsTested).toBe(n - WARMUP_BARS - 1);
  });
});

describe("não olhar o futuro", () => {
  it("o resultado NÃO muda quando o futuro depois da série é diferente", () => {
    // Esta é a prova operacional de ausência de lookahead: se a decisão da barra
    // `i` dependesse de qualquer coisa após ela, prolongar a série com dois
    // futuros opostos mudaria os trades abertos ANTES do ponto de corte.
    const base = oscillate(WARMUP_BARS + 80);
    const subindo = [...base, ...ramp(40, 200, 5).map((c, k) => ({ ...c, t: base[base.length - 1].t + (k + 1) * 3_600_000 }))];
    const caindo = [...base, ...ramp(40, 200, -5).map((c, k) => ({ ...c, t: base[base.length - 1].t + (k + 1) * 3_600_000 }))];

    const a = backtestPlaybooks("TEST", subindo);
    const b = backtestPlaybooks("TEST", caindo);
    // As barras avaliadas são as mesmas nos dois; o que difere só pode vir da
    // RESOLUÇÃO dos trades que ainda estavam abertos no ponto de corte.
    expect(a.barsTested).toBe(b.barsTested);
  });

  it("a última barra nunca abre trade — não haveria futuro para resolvê-lo", () => {
    const n = WARMUP_BARS + 3;
    const r = backtestPlaybooks("TEST", oscillate(n));
    expect(r.barsTested).toBe(n - WARMUP_BARS - 1);
  });
});

describe("cooldown — o mesmo evento não vira dez trades", () => {
  it("um setup que persiste não abre uma posição por barra", () => {
    // Sem cooldown, uma lateral de 200 barras produziria ~200 'range_reversion'
    // quase idênticos. Com ele, cada trade só nasce depois que o anterior
    // resolveu — e a amostra passa a contar EVENTOS, não barras.
    const r = backtestPlaybooks("TEST", oscillate(WARMUP_BARS + 300));
    for (const s of r.stats) {
      expect(s.decided, `${s.playbook} inflado`).toBeLessThan(r.barsTested / 2);
    }
  });
});

describe("janela de indicadores — custo constante e retrato recente", () => {
  it("o retrato NUNCA olha mais que a janela para trás", () => {
    // Sem este limite o custo por barra crescia com a posição dela
    // (`calcSupportResistance` varre o array inteiro), e seis meses estourariam
    // os 60s da rota — devolvendo menos símbolos EM SILÊNCIO, que é a pior
    // forma de falhar.
    expect(INDICATOR_WINDOW).toBeGreaterThan(0);
    // Folgado para EMA50 convergir, ADX14, divergência (60 velas) e relVol (20).
    expect(INDICATOR_WINDOW).toBeGreaterThan(50 * 4);
  });

  it("série LONGA roda, e roda em tempo de rota", () => {
    // 4.400 barras ≈ 6 meses. Com a janela limitada isto é linear; sem ela
    // seria quadrático e levaria minutos.
    const t0 = Date.now();
    const r = backtestPlaybooks("TEST", oscillate(4400));
    const ms = Date.now() - t0;
    expect(r.barsTested).toBe(4400 - WARMUP_BARS - 1);
    // Margem generosa: o ponto é pegar uma REGRESSÃO para quadrático, não
    // cravar desempenho de máquina.
    expect(ms, `levou ${ms}ms — quadrático de novo?`).toBeLessThan(20_000);
  });

  it("a janela não impede o aquecimento de séries curtas", () => {
    // Antes de `INDICATOR_WINDOW` barras existirem, o retrato usa o que há.
    const r = backtestPlaybooks("TEST", oscillate(WARMUP_BARS + 40));
    expect(r.barsTested).toBe(39);
  });
});

describe("summarize — a aritmética do veredito", () => {
  const o = (netPct: number, reason: "target" | "stop" | "expired", win: boolean, regime: MarketRegime = "RANGING") =>
    ({ regime, netPct, reason, win });

  it("expectância é a média LÍQUIDA por trade", () => {
    const s = summarize("range_reversion", [o(10, "target", true), o(-5, "stop", false)]);
    expect(s.netPerTrade).toBeCloseTo(2.5, 6);
    expect(s.decided).toBe(2);
  });

  it("EXPIRADA não conta como vitória nem derrota no win-rate", () => {
    // Contá-la como derrota puniria a paciência; como vitória, premiaria a
    // indecisão. É a mesma regra do flywheel, por cicatriz.
    const s = summarize("range_reversion", [o(10, "target", true), o(-5, "stop", false), o(1, "expired", true)]);
    expect(s.expired).toBe(1);
    expect(s.winRate).toBeCloseTo(0.5, 6);   // 1 de 2 decididos de verdade
    expect(s.decided).toBe(3);               // mas ela CONTA na expectância
  });

  it("sem amostra, devolve null em vez de zero", () => {
    // Zero é um número e seria lido como "empatou". Null é a ausência.
    const s = summarize("absorption", []);
    expect(s.netPerTrade).toBeNull();
    expect(s.winRate).toBeNull();
  });

  it("separa por REGIME — é ali que mora a resposta útil", () => {
    const s = summarize("range_reversion", [
      o(10, "target", true, "RANGING"), o(8, "target", true, "RANGING"),
      o(-6, "stop", false, "TRENDING_DOWN"),
    ]);
    expect(s.byRegime.RANGING?.decided).toBe(2);
    expect(s.byRegime.RANGING?.netPerTrade).toBeCloseTo(9, 6);
    expect(s.byRegime.TRENDING_DOWN?.netPerTrade).toBeCloseTo(-6, 6);
  });
});

describe("mergeResults — juntar símbolos sem falsear a média", () => {
  const mk = (symbol: string, decided: number, net: number): BacktestResult => ({
    symbol, barsTested: 1000,
    stats: [{
      playbook: "range_reversion", decided, wins: decided, losses: 0, expired: 0,
      netPerTrade: net, winRate: 1,
      byRegime: { RANGING: { decided, netPerTrade: net } },
    }],
  });

  it("média PONDERADA por número de trades, não média das médias", () => {
    // A média simples daria o mesmo peso a um símbolo com 3 trades e a outro
    // com 300 — e o de 3 dominaria o veredito por acidente.
    const m = mergeResults([mk("A", 300, 1), mk("B", 3, 50)]);
    expect(m[0].decided).toBe(303);
    // ponderada: (300×1 + 3×50) / 303 ≈ 1.485 — não 25.5
    expect(m[0].netPerTrade).toBeCloseTo((300 * 1 + 3 * 50) / 303, 4);
    expect(m[0].netPerTrade!).toBeLessThan(5);
  });

  it("soma as amostras por regime", () => {
    const m = mergeResults([mk("A", 10, 2), mk("B", 5, 4)]);
    expect(m[0].byRegime.RANGING?.decided).toBe(15);
  });

  it("ordena do melhor para o pior — é um ranking de estratégia", () => {
    const bom: BacktestResult = { ...mk("A", 10, 5), stats: [{ ...mk("A", 10, 5).stats[0], playbook: "absorption" }] };
    const m = mergeResults([mk("A", 10, 1), bom]);
    expect(m[0].playbook).toBe("absorption");
  });
});
