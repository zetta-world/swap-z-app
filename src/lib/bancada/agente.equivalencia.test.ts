/**
 * ⚠️⚠️ CE-09 — a análise compartilhada por símbolo dá, a CADA instância, a
 * decisão que ela teria sozinha.
 *
 * Para cada símbolo e instante, UM preparo (`prepararAgente`) é reusado por
 * vários estados de instância — exatamente o que o tique faz — e cada decisão é
 * comparada por igualdade exata com a cópia congelada da base
 * (`__referencia__/agente-legado.ts`).
 */
import { describe, it, expect } from "vitest";
import { decidirAberturaDoAgente, prepararAgente, type EstadoDaInstancia } from "@/lib/bancada/agente";
import { decidirAberturaDoAgenteLegado } from "@/lib/bancada/__referencia__/agente-legado";
import { agregar } from "@/lib/bancada/mesa-real";
import type { VelaComTempo } from "@/lib/mercado/velas";

const H = 3_600_000;

function serie(semente: number, n: number, passo: number, fim: number, vol: number): VelaComTempo[] {
  let a = semente >>> 0;
  const r = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
  let p = 50 + (semente % 100);
  const out: VelaComTempo[] = [];
  for (let i = 0; i < n; i++) {
    p = Math.max(0.01, p * (1 + Math.sin(i / 40 + semente) * vol * 0.3 + (r() - 0.5) * vol));
    out.push({ t: fim - (n - 1 - i) * passo, close: p, high: p * (1 + r() * vol), low: p * (1 - r() * vol), volume: 100 + r() * 900 });
  }
  return out;
}

function exatamenteIgual(a: unknown, b: unknown, c = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Object.is(a, b) ? null : `${c}: ${a} ≠ ${b}`;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${c}: chaves ${ka} ≠ ${kb}`;
    for (const k of ka) {
      const d = exatamenteIgual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${c}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return Object.is(a, b) ? null : `${c}: ${String(a)} ≠ ${String(b)}`;
}

describe("prepararAgente compartilhado ≡ decisão individual da base", () => {
  it("40 símbolos × vários instantes × 7 estados de instância", { timeout: 60_000 }, () => {
    const fim = 1_790_000_000_000 - (1_790_000_000_000 % H);
    let abriu = 0, recusou = 0, comparadas = 0;
    for (let s = 0; s < 40; s++) {
      const vol = 0.004 + (s % 5) * 0.004;
      const velas = {
        h1: serie(s * 3 + 1, 420, H, fim, vol),
        h4: serie(s * 3 + 2, 300, 4 * H, fim, vol * 2),
        d1: serie(s * 3 + 3, 400, 24 * H, fim, vol * 4),
      };
      const comW1 = { ...velas, w1: agregar(velas.d1, 7) };
      for (const v of [velas, comW1]) {
        for (const agora of [fim + 61 * 60_000, fim + 30 * 60_000, fim - 230 * H, fim - 419 * H]) {
          const preparo = prepararAgente(`S${s}`, v, agora);
          const ultimaT = preparo.pronto ? preparo.ultimaT : fim;
          const estados: EstadoDaInstancia[] = [
            { temPosicaoAberta: false, ultimaAberturaMs: null },
            { temPosicaoAberta: true, ultimaAberturaMs: null },
            { temPosicaoAberta: false, ultimaAberturaMs: ultimaT },          // a mesma vela
            { temPosicaoAberta: false, ultimaAberturaMs: ultimaT - H },      // a anterior
            { temPosicaoAberta: false, ultimaAberturaMs: ultimaT + H },      // "do futuro"
            { temPosicaoAberta: true, ultimaAberturaMs: ultimaT },
            { temPosicaoAberta: false, ultimaAberturaMs: 0 },
          ];
          for (const e of estados) {
            const novo = decidirAberturaDoAgente(e, `S${s}`, v, agora, preparo);
            const velho = decidirAberturaDoAgenteLegado(e, `S${s}`, v, agora);
            const d = exatamenteIgual(novo, velho);
            if (d) throw new Error(`S${s} agora=${agora} estado=${JSON.stringify(e)}: ${d}`);
            comparadas++;
            if (novo.abre) abriu++; else recusou++;
          }
        }
      }
    }
    // Os dois ramos têm de ter acontecido de verdade.
    expect(comparadas).toBe(40 * 2 * 4 * 7);
    expect(abriu).toBeGreaterThan(20);
    expect(recusou).toBeGreaterThan(200);
  });

  it("a decisão devolvida é uma CÓPIA: mexer nela não contamina a próxima instância", () => {
    const fim = 1_790_000_000_000 - (1_790_000_000_000 % H);
    const v = { h1: serie(9, 420, H, fim, 0.01), h4: serie(10, 300, 4 * H, fim, 0.02), d1: serie(11, 400, 24 * H, fim, 0.04) };
    const preparo = prepararAgente("X", v, fim + 61 * 60_000);
    const a = decidirAberturaDoAgente({ temPosicaoAberta: false, ultimaAberturaMs: null }, "X", v, fim + 61 * 60_000, preparo);
    (a as { porque?: string; regime?: string | null }).regime = "MEXIDO";
    const b = decidirAberturaDoAgente({ temPosicaoAberta: false, ultimaAberturaMs: null }, "X", v, fim + 61 * 60_000, preparo);
    expect(b.regime).not.toBe("MEXIDO");
  });
});
