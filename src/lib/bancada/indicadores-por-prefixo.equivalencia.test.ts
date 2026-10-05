/**
 * ⚠️⚠️ O RETRATO PRÉ-CALCULADO TEM DE SER O MESMO RETRATO (CE-02).
 *
 * Três níveis, todos por igualdade EXATA (`Object.is` em todo número):
 *   1. `RetratoPorPrefixo.at(...)` ≡ `computeIndicators(prefixos)` congelado,
 *      em TODA barra da série — não uma amostra;
 *   2. `computeIndicators` refatorado (montagem compartilhada) ≡ o congelado;
 *   3. `rodarMesa` inteiro ≡ `rodarMesaLegado` — operações, playbooks, motivos.
 *
 * Referências: `__referencia__/indicadores-legado.ts` e `mesa-real-legado.ts`,
 * cópias da base 0afa841.
 */
import { describe, it, expect } from "vitest";
import { computeIndicators, RetratoPorPrefixo, type Candle } from "@/lib/api/market-indicators";
import { computeIndicatorsLegado } from "@/lib/bancada/__referencia__/indicadores-legado";
import { rodarMesa, agregar } from "@/lib/bancada/mesa-real";
import { rodarMesaLegado } from "@/lib/bancada/__referencia__/mesa-real-legado";
import type { VelaComTempo } from "@/lib/mercado/velas";

function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const H = 3_600_000;

function serie(semente: number, n: number, passo: number, fim: number, vol = 0.01): VelaComTempo[] {
  const r = prng(semente);
  let p = 100 + (semente % 50);
  const out: VelaComTempo[] = [];
  for (let i = 0; i < n; i++) {
    // Deriva lenta + ruído: produz regimes de tendência E de lateralidade (ADX dos dois lados).
    const deriva = Math.sin(i / 90) * vol * 0.4;
    p = Math.max(0.01, p * (1 + deriva + (r() - 0.5) * vol * 2));
    const high = p * (1 + r() * vol);
    const low = p * (1 - r() * vol);
    out.push({ t: fim - (n - 1 - i) * passo, close: p, high, low, volume: r() < 0.05 ? 0 : 100 + r() * 1000 });
  }
  return out;
}

const candle = (v: VelaComTempo): Candle => ({ high: v.high, low: v.low, close: v.close, volume: v.volume });

function exatamenteIgual(a: unknown, b: unknown, caminho = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) ? null : `${caminho}: ${a} ≠ ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${caminho}.length: ${a.length} ≠ ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = exatamenteIgual(a[i], b[i], `${caminho}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${caminho}: chaves ${ka} ≠ ${kb}`;
    for (const k of ka) {
      const d = exatamenteIgual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${caminho}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${caminho}: ${String(a)} ≠ ${String(b)}`;
}

interface Mundo { h1: VelaComTempo[]; h4: VelaComTempo[]; d1: VelaComTempo[]; w1: VelaComTempo[] }

/** h1 da janela + prazos maiores com histórico ANTERIOR (para htf4h/1d/1w existirem). */
function mundo(semente: number, nH1: number): Mundo {
  const fim = 1_790_000_000_000;
  const h1 = serie(semente, nH1, H, fim);
  const h4 = serie(semente + 1, Math.ceil(nH1 / 4) + 300, 4 * H, fim);
  const d1 = serie(semente + 2, Math.ceil(nH1 / 24) + 400, 24 * H, fim, 0.03);
  const w1 = agregar(d1, 7);
  return { h1, h4, d1, w1 };
}

function conferePorBarra(m: Mundo) {
  const c = { h1: m.h1.map(candle), h4: m.h4.map(candle), d1: m.d1.map(candle), w1: m.w1.map(candle) };
  const retrato = new RetratoPorPrefixo("TST", c.h1, c.h4, c.d1, c.w1);
  let n4 = 0, nd = 0, nw = 0, comHtf = 0, comRegime = 0;
  for (let L = 0; L <= m.h1.length; L++) {
    const t = L > 0 ? m.h1[L - 1].t : -Infinity;
    while (n4 < m.h4.length && m.h4[n4].t <= t) n4++;
    while (nd < m.d1.length && m.d1[nd].t <= t) nd++;
    while (nw < m.w1.length && m.w1[nw].t <= t) nw++;
    const esperado = computeIndicatorsLegado("TST", c.h1.slice(0, L), c.h4.slice(0, n4), c.d1.slice(0, nd), c.w1.slice(0, nw));
    const obtido = retrato.at(L, n4, nd, nw);
    const d = exatamenteIgual(obtido, esperado);
    if (d) throw new Error(`barra L=${L} (n4h=${n4} n1d=${nd} n1w=${nw}): ${d}`);
    if (esperado.htf4h && esperado.htf1d && esperado.htf1w) comHtf++;
    if (esperado.regime !== "TRANSITIONING") comRegime++;
  }
  return { comHtf, comRegime };
}

describe("RetratoPorPrefixo ≡ computeIndicators(prefixo) congelado — TODA barra", () => {
  it("3 sementes × 700 barras de 1h, com 4h/1d/1w vivos", { timeout: 120_000 }, () => {
    for (const s of [3, 77, 2024]) {
      const { comHtf, comRegime } = conferePorBarra(mundo(s, 700));
      // A comparação só vale se os ramos caros existiram de fato.
      expect(comHtf).toBeGreaterThan(500);
      expect(comRegime).toBeGreaterThan(100);
    }
  });

  it("preço parado (RSI 50/100, ADX zero), volume zero, NaN e ±0", { timeout: 60_000 }, () => {
    const m = mundo(9, 260);
    for (let i = 60; i < 120; i++) m.h1[i] = { ...m.h1[i], close: 100, high: 100, low: 100, volume: 0 };
    m.h1[150] = { ...m.h1[150], close: NaN };
    m.h1[151] = { ...m.h1[151], high: NaN, volume: NaN };
    m.h1[200] = { ...m.h1[200], close: -0, low: -0 };
    m.d1[10] = { ...m.d1[10], high: NaN };
    m.d1[20] = { ...m.d1[20], low: -0, high: 0 };
    conferePorBarra(m);
  });

  it("séries curtas: abaixo de 52 velas, entre 52 e o aquecimento do MACD/ADX", () => {
    for (const n of [0, 1, 15, 16, 29, 30, 36, 37, 51, 52, 53, 60]) conferePorBarra(mundo(100 + n, n));
  });
});

describe("computeIndicators refatorado ≡ o congelado", () => {
  it("40 séries aleatórias de tamanhos variados", () => {
    for (let s = 0; s < 40; s++) {
      const m = mundo(500 + s, 20 + s * 13);
      const args = [m.h1.map(candle), m.h4.map(candle), m.d1.map(candle), m.w1.map(candle)] as const;
      const d = exatamenteIgual(computeIndicators("TST", ...args), computeIndicatorsLegado("TST", ...args));
      expect(d, `semente ${s}`).toBeNull();
    }
  });
});

describe("rodarMesa ≡ rodarMesaLegado — a rodada inteira", () => {
  it("2 sementes × 1.200 barras (1.000 avaliadas), dois custos", { timeout: 240_000 }, () => {
    let operacoes = 0;
    for (const s of [5, 31]) {
      const m = mundo(s, 1200);
      for (const custo of [0.1, 0.4]) {
        const novo = rodarMesa(m, "TST", custo);
        const velho = rodarMesaLegado(m, "TST", custo);
        expect(exatamenteIgual(novo, velho)).toBeNull();
        operacoes += novo.operacoes.length;
      }
    }
    expect(operacoes).toBeGreaterThan(0);
  });
});
