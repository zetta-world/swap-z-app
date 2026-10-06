/**
 * ⚠️⚠️ TRAVA DE COMPLEXIDADE DO MOTOR (CE-01) — o RSI O(N²) não volta.
 *
 * Wall-clock depende da máquina, então esta trava NÃO compara milissegundos
 * com um número da máquina de quem escreveu. Ela usa duas coisas que não
 * dependem dela:
 *
 *   1. RAZÃO: dobrar N dobra o tempo de um algoritmo linear (~2×) e
 *      quadruplica o de um quadrático (~4×). O limite é 3,2×.
 *   2. TETO com margem de ~100× para os dois lados: 40 mil velas de RSI
 *      levam ~10 ms aqui e levavam ~20 s no motor antigo. 1,5 s só falha se
 *      o algoritmo mudou de classe — ou se a máquina for 150× mais lenta.
 *
 * ⚠️ AUDIT REMEDIATION (05/10/2026): a medida era a MEDIANA de 5 rodadas de `a` e DEPOIS a de `b`.
 * Com a suíte inteira em paralelo (310 arquivos, máquina de 3,7 GB), as duas séries caíam sob
 * cargas diferentes de CPU/GC e a razão de um algoritmo linear chegou a 3,30 — falhou na
 * recertificação do C1 sem o motor ter mudado (o motor é o mesmo do HEAD auditado). Agora as
 * amostras de `a` e `b` são INTERCALADAS (a mesma carga para as duas) e vale o MÍNIMO (o tempo
 * sem interferência, o estimador padrão contra ruído de agendamento). O limite (3,2×) e o teto
 * (1,5 s) NÃO mudaram: um O(N²) continua dando ~4× e falhando.
 */
import { describe, it, expect } from "vitest";
import { rodar } from "@/lib/bancada/motor";
import type { EstrategiaDoCliente, Entrada } from "@/lib/bancada/vocabulario";
import type { VelaComTempo } from "@/lib/mercado/velas";

function serie(n: number): VelaComTempo[] {
  let s = 12345 >>> 0;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  let p = 100;
  const out: VelaComTempo[] = new Array(n);
  for (let i = 0; i < n; i++) {
    p = Math.max(0.01, p * (1 + (r() - 0.5) * 0.01));
    out[i] = { t: i * 3_600_000, close: p, high: p * (1 + r() * 0.004), low: p * (1 - r() * 0.004), volume: 1 };
  }
  return out;
}

/** Mínimo de `vezes` medidas de CADA função, intercaladas (a, b, a, b…), depois de um aquecimento. */
function minimosIntercalados(fa: () => void, fb: () => void, vezes = 7): [number, number] {
  fa(); fb();
  let ma = Infinity, mb = Infinity;
  for (let i = 0; i < vezes; i++) {
    let t0 = performance.now(); fa(); ma = Math.min(ma, performance.now() - t0);
    t0 = performance.now(); fb(); mb = Math.min(mb, performance.now() - t0);
  }
  return [ma, mb];
}

const e = (entrada: Entrada): EstrategiaDoCliente => ({
  // alvo/stop curtos: MUITAS operações — o caso que a fatia longa tornava quadrático.
  entrada, direcao: "compra", alvoPct: 0.3, stopPct: 0.3, horasLimite: 24 * 30, praca: "futuros_gate", papel: "taker",
});

describe("motor da bancada: linear em N (trava de regressão CE-01)", () => {
  const casos: Array<[string, Entrada]> = [
    ["rsi14", { tipo: "rsi", n: 14, nivel: 45 }],
    ["media2 (operação densa)", { tipo: "media", n: 2 }],
    ["canal400", { tipo: "canal", n: 400 }],
  ];
  for (const [nome, entrada] of casos) {
    it(`${nome}: dobrar N não quadruplica o tempo, e 40 mil velas ficam abaixo de 1,5 s`, { timeout: 60_000 }, () => {
      const a = serie(20_000), b = serie(40_000);
      const est = e(entrada);
      expect(rodar(b, est).operacoes.length).toBeGreaterThan(0);
      const [ta, tb] = minimosIntercalados(() => { rodar(a, est); }, () => { rodar(b, est); });
      expect(tb).toBeLessThan(1_500);
      // Abaixo de ~2 ms o ruído do relógio domina a razão; o teto acima já cobre.
      if (ta > 2) expect(tb / ta).toBeLessThan(3.2);
    });
  }
});
