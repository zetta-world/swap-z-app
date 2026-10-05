/**
 * ⚠️⚠️ O MOTOR OTIMIZADO TEM DE DEVOLVER EXATAMENTE O QUE O ANTIGO DEVOLVIA (CE-01).
 *
 * Igualdade EXATA, por `Object.is`, campo a campo e operação a operação — não
 * `toBeCloseTo`. Um backtest que muda na quarta casa decimal depois de uma
 * otimização é um backtest que mudou, e o cliente veria o mesmo teste dar outro
 * número sem ninguém ter mexido na regra.
 *
 * A referência é `__referencia__/motor-legado.ts`, cópia congelada da base 0afa841.
 */
import { describe, it, expect } from "vitest";
import { rodar, sinais } from "@/lib/bancada/motor";
import { rodarLegado, sinaisLegado } from "@/lib/bancada/__referencia__/motor-legado";
import type { EstrategiaDoCliente, Entrada } from "@/lib/bancada/vocabulario";
import type { VelaComTempo } from "@/lib/mercado/velas";

/** PRNG determinístico (mulberry32): a mesma semente gera a mesma série sempre. */
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

/** Passeio aleatório com velas de `passoMs`. `degrau` arredonda o preço (gera empates exatos). */
function serie(semente: number, n: number, opts: { passoMs?: number; degrau?: number; vol?: number } = {}): VelaComTempo[] {
  const r = prng(semente);
  const passo = opts.passoMs ?? H;
  const vol = opts.vol ?? 0.02;
  let p = 100;
  const out: VelaComTempo[] = [];
  for (let i = 0; i < n; i++) {
    p = Math.max(0.01, p * (1 + (r() - 0.5) * vol));
    let close = p;
    if (opts.degrau) close = Math.round(close / opts.degrau) * opts.degrau;
    const high = close * (1 + r() * vol / 2);
    const low = close * (1 - r() * vol / 2);
    out.push({ t: 1_700_000_000_000 + i * passo, close, high, low, volume: r() * 1000 });
  }
  return out;
}

function estrategias(): EstrategiaDoCliente[] {
  const entradas: Entrada[] = [
    { tipo: "media", n: 2 }, { tipo: "media", n: 7 }, { tipo: "media", n: 50 }, { tipo: "media", n: 400 },
    { tipo: "canal", n: 2 }, { tipo: "canal", n: 20 }, { tipo: "canal", n: 400 },
    { tipo: "rsi", n: 2, nivel: 30 }, { tipo: "rsi", n: 14, nivel: 30 }, { tipo: "rsi", n: 14, nivel: 70 },
    { tipo: "rsi", n: 100, nivel: 45 },
  ];
  const out: EstrategiaDoCliente[] = [];
  for (const entrada of entradas) {
    for (const direcao of ["compra", "venda"] as const) {
      for (const [alvoPct, stopPct, horasLimite] of [[0.5, 0.5, 4], [2, 1, 48], [10, 5, 24 * 90]] as const) {
        out.push({ entrada, direcao, alvoPct, stopPct, horasLimite, praca: "futuros_gate", papel: "taker" });
      }
    }
  }
  return out;
}

/** Igualdade exata recursiva: `Object.is` em todo número (distingue -0/+0, aceita NaN = NaN). */
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

function confere(velas: VelaComTempo[], e: EstrategiaDoCliente) {
  const ds = exatamenteIgual(sinais(velas, e), sinaisLegado(velas, e));
  expect(ds, `sinais divergiram (${JSON.stringify(e.entrada)} ${e.direcao})`).toBeNull();
  const dr = exatamenteIgual(rodar(velas, e), rodarLegado(velas, e));
  expect(dr, `rodar divergiu (${JSON.stringify(e)})`).toBeNull();
}

describe("motor otimizado ≡ motor legado (igualdade exata)", () => {
  // ⚠️ O tempo explícito é por causa do LEGADO: ele é o O(N²) que este round corrige.
  it("passeios aleatórios: 4 sementes × 66 estratégias", { timeout: 60_000 }, () => {
    let operacoes = 0;
    for (const s of [1, 42, 1337, 9001]) {
      const velas = serie(s, 900);
      for (const e of estrategias()) {
        confere(velas, e);
        operacoes += rodar(velas, e).operacoes.length;
      }
    }
    // A comparação só vale se houve operação para comparar.
    expect(operacoes).toBeGreaterThan(500);
  });

  it("platôs com empate exato (preço em degraus de 0,5): a média não pode virar o sinal", () => {
    for (const s of [7, 8]) {
      const velas = serie(s, 800, { degrau: 0.5, vol: 0.01 });
      for (const e of estrategias()) confere(velas, e);
    }
  });

  it("série curta, menor que o período, e vazia", () => {
    for (const n of [0, 1, 2, 3, 15]) {
      const velas = serie(5, n);
      for (const e of estrategias()) confere(velas, e);
    }
  });

  it("NaN e infinito no meio da série (canal e média tratam igual)", () => {
    const velas = serie(11, 300);
    velas[50] = { ...velas[50], high: NaN, low: NaN, close: NaN };
    velas[120] = { ...velas[120], high: Infinity };
    velas[121] = { ...velas[121], low: -Infinity };
    velas[200] = { ...velas[200], high: -0, low: -0, close: 0 };
    for (const e of estrategias()) confere(velas, e);
  });

  it("tempo repetido ou voltando: cai no caminho antigo e continua igual", () => {
    const velas = serie(13, 400);
    velas[100] = { ...velas[100], t: velas[99].t };          // repetido
    velas[250] = { ...velas[250], t: velas[249].t - 10 };    // voltando
    for (const e of estrategias()) confere(velas, e);
  });

  it("velas de 1 minuto e de 1 dia (horizonte longo cruzando a janela)", { timeout: 60_000 }, () => {
    for (const passoMs of [60_000, 24 * H]) {
      const velas = serie(21, 1200, { passoMs });
      for (const e of estrategias()) confere(velas, e);
    }
  });
});
