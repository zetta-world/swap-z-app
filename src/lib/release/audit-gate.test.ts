import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avaliar, cadeiaAtual } from "../../../scripts/release/lib/audit-gate.mjs";

/**
 * R-03 — exceção ESTREITA do `npm audit` (decisão do dono 04/10/2026). Fixture = `npm audit --json` real da
 * lane B (lock 8e9b5227…, 25 high, todos do advisory braces 1240992). Cada teste muda UMA coisa e o portão
 * tem de reprovar — exceto o relatório idêntico ao registrado.
 */
const RAIZ = process.cwd();
const base = () => JSON.parse(readFileSync(join(RAIZ, "src/lib/release/fixtures/npm-audit-r03-20261004.json"), "utf8"));
const excecoes = JSON.parse(readFileSync(join(RAIZ, "scripts/release/audit-exceptions.json"), "utf8"));

describe("portão R-03 do npm audit", () => {
  it("passa SÓ com a cadeia registrada, e avisa que não está corrigido", () => {
    const r = avaliar(base(), excecoes);
    expect(r.falhas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.avisos.join()).toMatch(/NÃO corrigida.*antes da seleção de RC/);
  });

  it("a exceção é temporária, marcada para revisão antes do RC e não diz que corrigiu", () => {
    expect(excecoes.status).toBe("TEMPORARIA");
    expect(excecoes.revisar_antes_do_rc).toBe(true);
    expect(excecoes.excecoes).toHaveLength(1);
    expect(excecoes.excecoes[0].corrigido).toBe(false);
    expect(excecoes.excecoes[0].advisory).toMatchObject({ source: 1240992, name: "braces", severity: "high", range: "<=3.0.3" });
    expect(cadeiaAtual(base())).toEqual(excecoes.excecoes[0].cadeia);
  });

  it("CRITICAL reprova — inclusive se for o próprio braces", () => {
    const a = base();
    a.vulnerabilities.braces.severity = "critical";
    a.vulnerabilities.braces.via[0].severity = "critical";
    a.metadata.vulnerabilities.critical = 1;
    expect(avaliar(a, excecoes).falhas.join()).toMatch(/CRITICAL/);
    const b = base();
    b.vulnerabilities["left-pad"] = { name: "left-pad", severity: "critical", isDirect: false, via: [{ source: 9, name: "left-pad", severity: "critical", range: "*", url: "x" }], nodes: ["node_modules/left-pad"] };
    expect(avaliar(b, excecoes).ok).toBe(false);
  });

  it("HIGH novo (advisory não registrado) reprova", () => {
    const a = base();
    a.vulnerabilities.micromatch.via.push({ source: 999999, name: "micromatch", severity: "high", range: "<5", url: "https://github.com/advisories/GHSA-novo" });
    const r = avaliar(a, excecoes);
    expect(r.ok).toBe(false);
    expect(r.falhas.join()).toMatch(/NOVO_HIGH: advisory 999999/);
  });

  it("advisory registrado com faixa/severidade alterada reprova", () => {
    const a = base();
    a.vulnerabilities.braces.via[0].range = "<=3.0.4";
    expect(avaliar(a, excecoes).falhas.join()).toMatch(/ADVISORY_MUDOU/);
  });

  it("deriva da cadeia reprova: pacote novo, caminho novo, pacote que saiu, isDirect", () => {
    const novo = base();
    novo.vulnerabilities["rollup-plugin-x"] = { name: "rollup-plugin-x", severity: "high", isDirect: true, via: ["micromatch"], nodes: ["node_modules/rollup-plugin-x"], range: "*" };
    expect(avaliar(novo, excecoes).falhas.join()).toMatch(/pacote novo na cadeia high: rollup-plugin-x/);

    const caminho = base();
    caminho.vulnerabilities.braces.nodes.push("node_modules/outro/node_modules/braces");
    expect(avaliar(caminho, excecoes).falhas.join()).toMatch(/DERIVA_CADEIA: braces mudou/);

    const saiu = base();
    delete saiu.vulnerabilities.tailwindcss;
    expect(avaliar(saiu, excecoes).falhas.join()).toMatch(/tailwindcss saiu da cadeia/);

    const direto = base();
    direto.vulnerabilities.micromatch.isDirect = true;
    expect(avaliar(direto, excecoes).ok).toBe(false);
  });

  it("moderate novo não entra no portão (mesmo nível de antes: high)", () => {
    const a = base();
    a.vulnerabilities["algo"] = { name: "algo", severity: "moderate", isDirect: false, via: [{ source: 5, name: "algo", severity: "moderate", range: "*", url: "x" }], nodes: ["node_modules/algo"] };
    expect(avaliar(a, excecoes).ok).toBe(true);
  });

  it("relatório inválido ou exceção mal formada falham fechado", () => {
    expect(avaliar(null, excecoes).ok).toBe(false);
    expect(avaliar({ error: { code: "ENOTFOUND" } }, excecoes).ok).toBe(false);
    expect(avaliar(base(), { ...excecoes, revisar_antes_do_rc: false }).falhas.join()).toMatch(/EXCECAO_MAL_FORMADA/);
    expect(avaliar(base(), { ...excecoes, status: "PERMANENTE" }).ok).toBe(false);
  });

  it("o CI usa o portão, bloqueante (sem continue-on-error) e sem audit global desligado", () => {
    const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
    const passo = ci.slice(ci.indexOf("name: npm audit"));
    const bloco = passo.slice(0, passo.indexOf("\n      - ") > 0 ? passo.indexOf("\n      - ") : undefined);
    expect(bloco).toMatch(/npm audit --json/);
    expect(bloco).toMatch(/node scripts\/release\/audit-gate\.mjs/);
    expect(bloco).not.toMatch(/continue-on-error/);
    expect(ci).not.toMatch(/--audit-level=(none|critical)|npm audit --audit-level[^\n]*\|\|\s*true/);
  });
});
