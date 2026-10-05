/**
 * CE-03 — benchmark END-TO-END do Workbench, modo MESA (o seletor real da casa).
 *
 * Mede `rodarMesa` por símbolo — o laço de CPU da rota no modo mesa — sobre
 * 1h/4h/1d/1w sintéticos. ANTES = `__referencia__/mesa-real-legado.ts`
 * (`computeIndicators` sobre o prefixo a cada barra, base 0afa841);
 * DEPOIS = `mesa-real.ts` com `RetratoPorPrefixo`. Cada cenário confere que os
 * dois devolvem o MESMO resultado antes de medir.
 *
 * Janelas: o modo mesa avalia até MAX_BARRAS_AVALIADAS (4.000) barras de 1h por
 * símbolo depois de 200 de aquecimento — 180 dias já batem no teto.
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { rodarMesa, agregar, type VelasDaMesa } from "@/lib/bancada/mesa-real";
import { rodarMesaLegado } from "@/lib/bancada/__referencia__/mesa-real-legado";
import { serieSintetica, medir, fmt, MS, type Medida } from "./lib";

function mundo(semente: number, dias: number): VelasDaMesa {
  const fim = 1_790_000_000_000;
  const h1 = serieSintetica(semente, dias * 24, MS["1h"], fim);
  const h4 = serieSintetica(semente + 7, dias * 6, MS["4h"], fim);
  const d1 = serieSintetica(semente + 13, dias, MS["1d"], fim);
  return { h1, h4, d1, w1: agregar(d1, 7) };
}

const CENARIOS = [
  { nome: "SMALL",  simbolos: 1,  dias: 30 },
  { nome: "MEDIUM", simbolos: 3,  dias: 90 },
  { nome: "LARGE",  simbolos: 1,  dias: 180 },
  { nome: "HEAVY",  simbolos: 10, dias: 180 },
] as const;

interface Linha {
  cenario: string; simbolos: number; barrasPorSimbolo: number; operacoes: number;
  antes: Medida; depois: Medida; ganhoMediana: number;
}

describe("CE-03 · Workbench end-to-end (modo mesa)", () => {
  it("antes × depois", () => {
    const linhas: Linha[] = [];
    for (const c of CENARIOS) {
      const mundos = Array.from({ length: c.simbolos }, (_, k) => mundo(2000 + k * 31, c.dias));
      const novo = () => mundos.map((m, k) => rodarMesa(m, `S${k}`, 0.2));
      const velho = () => mundos.map((m, k) => rodarMesaLegado(m, `S${k}`, 0.2));
      const rn = novo();
      expect(JSON.stringify(rn)).toBe(JSON.stringify(velho()));
      const depois = medir(novo, c.nome === "HEAVY" ? 5 : 11, 1);
      const antes = medir(velho, c.nome === "HEAVY" ? 1 : 3, c.nome === "HEAVY" ? 0 : 1);
      const l: Linha = {
        cenario: c.nome, simbolos: c.simbolos, barrasPorSimbolo: c.dias * 24,
        operacoes: rn.reduce((s, r) => s + r.operacoes.length, 0),
        antes, depois, ganhoMediana: antes.medianaMs / depois.medianaMs,
      };
      linhas.push(l);
      console.log(`${c.nome.padEnd(6)} simb=${c.simbolos} barras=${l.barrasPorSimbolo} ops=${l.operacoes} `
        + `antes=${fmt(antes.medianaMs)} (n=${antes.amostras}) depois=${fmt(depois.medianaMs)} `
        + `p95=${fmt(depois.p95Ms)} ganho=${l.ganhoMediana.toFixed(0)}×`);
    }
    const out = process.env.BENCH_OUT;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/workbench-mesa.json`, JSON.stringify({ node: process.version, linhas }, null, 2));
      const md = [
        "| cenário | símbolos × barras 1h | operações | antes mediana (n) | antes CPU | depois mediana | depois p95 | depois CPU | ganho (mediana) |",
        "|---|---|---|---|---|---|---|---|---|",
        ...linhas.map((l) => `| ${l.cenario} | ${l.simbolos} × ${l.barrasPorSimbolo} | ${l.operacoes} | `
          + `${fmt(l.antes.medianaMs)} (${l.antes.amostras}) | ${fmt(l.antes.cpuMedianaMs)} | ${fmt(l.depois.medianaMs)} | `
          + `${fmt(l.depois.p95Ms)} | ${fmt(l.depois.cpuMedianaMs)} | ${l.ganhoMediana.toFixed(1)}× |`),
      ].join("\n");
      writeFileSync(`${out}/workbench-mesa.md`, md + "\n");
    }
  });
});
