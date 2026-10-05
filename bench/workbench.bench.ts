/**
 * CE-03 — benchmark END-TO-END do Workbench (modo "estratégia própria").
 *
 * Mede o caminho de CPU da rota `/api/bancada/backtest` por inteiro, sem banco:
 * para cada símbolo `rodar(velas, estratégia)`, depois `resumir` e `julgar` —
 * exatamente a sequência da rota. ANTES = `__referencia__/motor-legado.ts`
 * (cópia congelada de 0afa841); DEPOIS = `motor.ts`. Mesma máquina, mesma
 * execução, mesmas velas. Cada cenário confere que os dois devolvem o MESMO
 * resultado antes de medir — benchmark de resultado diferente não vale nada.
 *
 * A busca de velas (banco/fonte) NÃO está aqui: é I/O, medido à parte.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { rodar } from "@/lib/bancada/motor";
import { rodarLegado } from "@/lib/bancada/__referencia__/motor-legado";
import { resumir, julgar } from "@/lib/bancada/veredito";
import type { EstrategiaDoCliente, Entrada } from "@/lib/bancada/vocabulario";
import type { VelaComTempo } from "@/lib/mercado/velas";
import { serieSintetica, medir, fmt, MS, type Medida } from "./lib";

type Rodar = (v: ReadonlyArray<VelaComTempo>, e: EstrategiaDoCliente) => ReturnType<typeof rodar>;

/** O fluxo de CPU da rota, para N símbolos. */
function fluxo(motor: Rodar, series: VelaComTempo[][], e: EstrategiaDoCliente) {
  const operacoes = [];
  const segurar: number[] = [];
  for (const velas of series) {
    operacoes.push(...motor(velas, e).operacoes);
    const p0 = velas[0].close, pN = velas[velas.length - 1].close;
    if (p0 > 0) segurar.push(((pN - p0) / p0) * 100);
  }
  const resumo = resumir({ operacoes, velasLidas: 0, aindaAbertas: 0 }, e);
  const comp = segurar.reduce((s, x) => s + x, 0) / segurar.length;
  return { resumo, veredito: julgar(resumo, e, comp, []) };
}

/**
 * Cenários dentro das cotas reais (`BANCADA_COTAS`): o teto por rodada é
 * símbolos × dias × 24 velas — HEAVY é exatamente o teto do Pro/Trader/Pilot
 * (10 símbolos × 730 dias em 1h = 175.200 velas).
 */
const CENARIOS = [
  { nome: "SMALL",  simbolos: 1,  intervalo: "1d", dias: 365 },
  { nome: "MEDIUM", simbolos: 3,  intervalo: "4h", dias: 365 },
  { nome: "LARGE",  simbolos: 10, intervalo: "1h", dias: 365 },
  { nome: "HEAVY",  simbolos: 10, intervalo: "1h", dias: 730 },
] as const;

const FAMILIAS: Array<{ nome: string; entrada: Entrada }> = [
  { nome: "media20", entrada: { tipo: "media", n: 20 } },
  { nome: "canal20", entrada: { tipo: "canal", n: 20 } },
  { nome: "rsi14",   entrada: { tipo: "rsi", n: 14, nivel: 30 } },
];

function estrategia(entrada: Entrada): EstrategiaDoCliente {
  return { entrada, direcao: "compra", alvoPct: 3, stopPct: 2, horasLimite: 72, praca: "spot_gate", papel: "taker" };
}

/** Amostras por cenário: o LEGADO pesado leva dezenas de segundos por execução — declarado. */
function amostras(cenario: string, legado: boolean): number {
  if (!legado) return 15;
  return cenario === "HEAVY" ? 1 : cenario === "LARGE" ? 3 : 7;
}

interface Linha {
  cenario: string; familia: string; simbolos: number; velasPorSimbolo: number; velasTotal: number;
  operacoes: number; antes: Medida; depois: Medida; ganhoMediana: number;
}

describe("CE-03 · Workbench end-to-end (estratégia própria)", () => {
  it("antes × depois, SMALL → HEAVY", () => {
    const linhas: Linha[] = [];
    for (const c of CENARIOS) {
      const passo = MS[c.intervalo];
      const n = Math.round((c.dias * MS["1d"]) / passo);
      const series = Array.from({ length: c.simbolos }, (_, k) => serieSintetica(1000 + k, n, passo));
      for (const f of FAMILIAS) {
        const e = estrategia(f.entrada);
        const novo = fluxo(rodar, series, e);
        const velho = fluxo(rodarLegado, series, e);
        // ⚠️ Mesmo resultado, ou o número abaixo não significa nada.
        expect(JSON.stringify(novo)).toBe(JSON.stringify(velho));
        const depois = medir(() => fluxo(rodar, series, e), amostras(c.nome, false), 2);
        const antes = medir(() => fluxo(rodarLegado, series, e), amostras(c.nome, true), c.nome === "HEAVY" ? 0 : 1);
        const l: Linha = {
          cenario: c.nome, familia: f.nome, simbolos: c.simbolos, velasPorSimbolo: n, velasTotal: n * c.simbolos,
          operacoes: novo.resumo.n, antes, depois, ganhoMediana: antes.medianaMs / depois.medianaMs,
        };
        linhas.push(l);
        console.log(`${c.nome.padEnd(6)} ${f.nome.padEnd(8)} velas=${l.velasTotal} ops=${l.operacoes} `
          + `antes=${fmt(antes.medianaMs)} (n=${antes.amostras}) depois=${fmt(depois.medianaMs)} p95=${fmt(depois.p95Ms)} `
          + `ganho=${l.ganhoMediana.toFixed(0)}×`);
      }
    }
    const out = process.env.BENCH_OUT;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/workbench-propria.json`, JSON.stringify({ node: process.version, linhas }, null, 2));
      const md = [
        "| cenário | gatilho | símbolos × velas | operações | antes mediana (n) | antes CPU | depois mediana | depois p95 | depois CPU | ganho (mediana) |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...linhas.map((l) => `| ${l.cenario} | ${l.familia} | ${l.simbolos} × ${l.velasPorSimbolo} | ${l.operacoes} | `
          + `${fmt(l.antes.medianaMs)} (${l.antes.amostras}) | ${fmt(l.antes.cpuMedianaMs)} | ${fmt(l.depois.medianaMs)} | `
          + `${fmt(l.depois.p95Ms)} | ${fmt(l.depois.cpuMedianaMs)} | ${l.ganhoMediana.toFixed(1)}× |`),
      ].join("\n");
      writeFileSync(`${out}/workbench-propria.md`, md + "\n");
    }
  });
});
