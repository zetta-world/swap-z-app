/**
 * MÁQUINA DE ESTADOS — a cópia TS e a verdade SQL não podem divergir.
 *
 * O teste lê `0068_early_access.sql`, extrai o CASE de
 * `early_access_transicao_permitida` e compara par a par com `TRANSICOES`.
 * Mudar um sem o outro quebra aqui — e não em produção, com o painel
 * oferecendo um botão que o banco recusa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ESTADOS, TRANSICOES, transicaoPermitida, exigeMotivo, transicoesDisponiveis, type Estado } from "./estados";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0068_early_access.sql"), "utf8");

function matrizDoSql(): Record<string, string[]> {
  const corpo = SQL.slice(SQL.indexOf("function public.early_access_transicao_permitida"));
  const fim = corpo.indexOf("$$;");
  const out: Record<string, string[]> = {};
  for (const m of corpo.slice(0, fim).matchAll(/when '(\w+)'\s+then p_para in \(([^)]*)\)/g)) {
    out[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort();
  }
  return out;
}

describe("① paridade TS ↔ SQL", () => {
  it("o SQL foi lido (senão a paridade passaria vazia)", () => {
    expect(Object.keys(matrizDoSql()).sort()).toEqual([...ESTADOS].sort());
  });
  it("⚠️⚠️ as duas matrizes são idênticas", () => {
    const sql = matrizDoSql();
    for (const de of ESTADOS) expect([...TRANSICOES[de]].sort(), de).toEqual(sql[de]);
  });
  it("a regra de motivo também é a mesma", () => {
    expect(SQL).toMatch(/select p_para in \('rejected','blocked'\) or p_de in \('rejected','blocked'\);/);
  });
});

describe("② a matriz exigida", () => {
  const PERMITIDAS = new Set([
    "pending>approved", "pending>rejected", "pending>blocked",
    "approved>rejected", "approved>blocked",
    "rejected>pending", "rejected>blocked",
    "blocked>pending",
  ]);
  it("os 16 pares batem com a especificação", () => {
    for (const de of ESTADOS) for (const para of ESTADOS) {
      expect(transicaoPermitida(de, para), `${de}→${para}`).toBe(PERMITIDAS.has(`${de}>${para}`));
    }
  });
  it("⚠️ blocked→approved e rejected→approved NÃO existem", () => {
    expect(transicaoPermitida("blocked", "approved")).toBe(false);
    expect(transicaoPermitida("rejected", "approved")).toBe(false);
  });
  it("⚠️ verified e converted não são estados", () => {
    expect(ESTADOS as readonly string[]).not.toContain("verified");
    expect(ESTADOS as readonly string[]).not.toContain("converted");
  });
  it("motivo obrigatório para rejeitar, bloquear, reconsiderar e desbloquear", () => {
    const casos: Array<[Estado, Estado, boolean]> = [
      ["pending", "approved", false], ["pending", "rejected", true], ["pending", "blocked", true],
      ["approved", "rejected", true], ["approved", "blocked", true],
      ["rejected", "pending", true], ["rejected", "blocked", true], ["blocked", "pending", true],
    ];
    for (const [de, para, quer] of casos) expect(exigeMotivo(de, para), `${de}→${para}`).toBe(quer);
  });
  it("convertido: approved→rejected some do painel; approved→blocked continua", () => {
    expect(transicoesDisponiveis("approved", true)).toEqual(["blocked"]);
    expect(transicoesDisponiveis("approved", false)).toEqual(["rejected", "blocked"]);
  });
});
