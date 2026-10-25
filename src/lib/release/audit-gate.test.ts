import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { avaliar, cadeiaAtual } from "../../../scripts/release/lib/audit-gate.mjs";

/**
 * R-03 — exceção ESTREITA do `npm audit` (decisão do dono 04/10/2026). Fixture = `npm audit --json` real da
 * lane B (lock 8969d550…, 25 high, todos do advisory braces 1240992). Cada teste muda UMA coisa e o portão
 * tem de reprovar — exceto o relatório idêntico ao registrado.
 *
 * 25/10/2026: a R-03 foi RETIRADA (o npm deixou de reportar o advisory do braces) e substituída pela R-04 (zod).
 * A lógica do portão continua provada contra a R-03 CONGELADA (`fixtures/audit-exceptions-r03-20261007.json`);
 * a exceção VIVA é provada contra o `npm audit --json` real do lock que a criou (bloco R-04 abaixo).
 */
const RAIZ = process.cwd();
const base = () => JSON.parse(readFileSync(join(RAIZ, "src/lib/release/fixtures/npm-audit-r03-20261004.json"), "utf8"));
const excecoes = JSON.parse(readFileSync(join(RAIZ, "src/lib/release/fixtures/audit-exceptions-r03-20261007.json"), "utf8"));

describe("portão R-03 do npm audit (exceção congelada)", () => {
  it("passa SÓ com a cadeia registrada, e avisa que não está corrigido", () => {
    const r = avaliar(base(), excecoes);
    expect(r.falhas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.avisos.join()).toMatch(/NÃO corrigida.*antes da seleção de RC/);
  });

  it("a exceção é temporária, marcada para revisão antes do RC e não diz que corrigiu", () => {
    expect(excecoes.status).toBe("TEMPORARIA");
    expect(excecoes.revisado_em).toBe("2026-10-07");
    expect(excecoes.lockfile_sha256_na_revisao).toBe("8969d5501b2e52f46ef0a1c2e14fe0b4dcaad9979448683fe507094ee8334f17");
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

describe("portão R-04 do npm audit — a exceção VIVA (zod, decisão do dono 25/10/2026)", () => {
  const viva = JSON.parse(readFileSync(join(RAIZ, "scripts/release/audit-exceptions.json"), "utf8"));
  const real = () => JSON.parse(readFileSync(join(RAIZ, "src/lib/release/fixtures/npm-audit-r04-20261025.json"), "utf8"));

  it("o audit real do lock que a criou passa, avisando que NÃO está corrigido", () => {
    const r = avaliar(real(), viva);
    expect(r.falhas).toEqual([]);
    expect(r.avisos.join()).toMatch(/R-04.*NÃO corrigida.*antes da seleção de RC/);
  });

  it("é temporária, só o advisory do zod, cadeia idêntica, sem a R-03 e sem dizer que corrigiu", () => {
    expect(viva).toMatchObject({ status: "TEMPORARIA", revisar_antes_do_rc: true });
    expect(viva.decisao).toMatch(/^dono, 2026-10-25/);
    expect(viva.excecoes).toHaveLength(1);
    expect(viva.excecoes[0]).toMatchObject({ id: "R-04", corrigido: false });
    expect(viva.excecoes[0].advisory).toEqual({ source: 1243066, name: "zod", severity: "high", range: "<4.6.6",
      url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5" });
    expect(cadeiaAtual(real())).toEqual(viva.excecoes[0].cadeia);
    expect(JSON.stringify(viva.excecoes)).not.toMatch(/1240992|braces/);
  });

  it("a R-03 não volta escondida: o relatório antigo do braces REPROVA contra a exceção viva", () => {
    expect(avaliar(base(), viva).falhas.join()).toMatch(/NOVO_HIGH: advisory 1240992/);
  });

  it("critical (inclusive no zod) e high novo continuam reprovando", () => {
    const a = real();
    a.vulnerabilities.zod.severity = "critical";
    a.metadata.vulnerabilities.critical = 1;
    expect(avaliar(a, viva).falhas.join()).toMatch(/CRITICAL/);
    const b = real();
    b.vulnerabilities.viem.via.push({ source: 999998, name: "viem", severity: "high", range: "<3", url: "https://github.com/advisories/GHSA-novo2" });
    expect(avaliar(b, viva).falhas.join()).toMatch(/NOVO_HIGH: advisory 999998/);
  });

  it("o próprio next que motivou a troca (16.3.8, crítico) reprovaria", () => {
    const a = real();
    a.vulnerabilities.next = { name: "next", severity: "critical", isDirect: true, nodes: ["node_modules/next"], range: "16.0.0 - 16.4.0",
      via: [{ source: 1242816, name: "next", severity: "critical", range: ">=16.0.0 <=16.4.0", url: "https://github.com/advisories/GHSA-2464-fhr4-w9xw" }] };
    a.metadata.vulnerabilities.critical = 1;
    expect(avaliar(a, viva).ok).toBe(false);
  });
});
