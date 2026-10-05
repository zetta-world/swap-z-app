/**
 * Utilidades dos benchmarks: séries determinísticas e estatística honesta.
 */
import type { VelaComTempo } from "@/lib/mercado/velas";

/** PRNG determinístico (mulberry32). */
export function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const MS = { "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 } as const;

/**
 * Passeio geométrico com volatilidade proporcional à raiz do prazo — o formato
 * de uma série cripto real (vol diária ~3%), sem depender de rede.
 */
export function serieSintetica(
  semente: number, n: number, passoMs: number, fim = 1_790_000_000_000,
): VelaComTempo[] {
  const r = prng(semente);
  const volPorVela = 0.03 * Math.sqrt(passoMs / MS["1d"]);
  let p = 50 + semente % 1000;
  const inicio = fim - n * passoMs;
  const out: VelaComTempo[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const choque = (r() + r() + r() - 1.5) * 2 * volPorVela;
    const abre = p;
    p = Math.max(0.0001, p * (1 + choque));
    const high = Math.max(abre, p) * (1 + r() * volPorVela * 0.6);
    const low = Math.min(abre, p) * (1 - r() * volPorVela * 0.6);
    out[i] = { t: inicio + i * passoMs, close: p, high, low, volume: 1000 + r() * 5000 };
  }
  return out;
}

export interface Medida {
  amostras: number;
  medianaMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  cpuMedianaMs: number;
  heapPicoMb: number;
}

function quantil(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  // Nearest-rank: com poucas amostras o p95 é o máximo — declarado, não interpolado.
  const k = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[k];
}

/**
 * Mede `fn` `amostras` vezes (depois de `aquecer` execuções descartadas).
 * Wall-clock por `performance.now`, CPU por `process.cpuUsage` (user+system).
 */
export function medir(fn: () => unknown, amostras: number, aquecer = 1): Medida {
  for (let i = 0; i < aquecer; i++) fn();
  const wall: number[] = [];
  const cpu: number[] = [];
  let heapPico = 0;
  for (let i = 0; i < amostras; i++) {
    const c0 = process.cpuUsage();
    const t0 = performance.now();
    fn();
    const t1 = performance.now();
    const c1 = process.cpuUsage(c0);
    wall.push(t1 - t0);
    cpu.push((c1.user + c1.system) / 1000);
    heapPico = Math.max(heapPico, process.memoryUsage().heapUsed);
  }
  return {
    amostras,
    medianaMs: quantil(wall, 0.5),
    p95Ms: quantil(wall, 0.95),
    minMs: Math.min(...wall),
    maxMs: Math.max(...wall),
    cpuMedianaMs: quantil(cpu, 0.5),
    heapPicoMb: heapPico / 1_048_576,
  };
}

export function fmt(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(3)} ms`;
}
