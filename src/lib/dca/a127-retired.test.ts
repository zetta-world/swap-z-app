/** A127 Módulo C — DCA distingue CURRENT, RETIRED e REVOKED. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FONTE = readFileSync("src/app/api/dca/cron/route.ts", "utf8");
const CODIGO = FONTE
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/^(\s*)\/\/.*$/gm, "$1");

describe("A127 DCA — pending histórico antes do gate RETIRED", () => {
  it("retired + pending: procura intent e recovery usa intent.conexao_id", () => {
    const iVivo = CODIGO.indexOf("intentVivoDoPlano(dbExec, p.id)");
    const iRec = CODIGO.indexOf("reconciliarIntent(", iVivo);
    const iCred = CODIGO.indexOf("credenciaisDoIntentParaRecovery(dbExec, intent)", iRec);
    const iRetired = CODIGO.indexOf("!conexao.is_current", iCred);
    expect(iVivo).toBeGreaterThan(0);
    expect(iRec).toBeGreaterThan(iVivo);
    expect(iCred).toBeGreaterThan(iRec);
    expect(iRetired).toBeGreaterThan(iCred);
  });

  it("retired sem pending: adia/requer_reconexao antes de decidir ciclo ou executar", () => {
    const iRetired = CODIGO.indexOf("!conexao.is_current");
    const iDetalhe = CODIGO.indexOf("conexao_substituida — requer_reconexao", iRetired);
    const iDecidir = CODIGO.indexOf("decidirCiclo(", iRetired);
    const iExec = CODIGO.indexOf("executarOrdemCex(", iRetired);
    expect(iRetired).toBeGreaterThan(0);
    expect(iDetalhe).toBeGreaterThan(iRetired);
    expect(iDecidir).toBeGreaterThan(iDetalhe);
    expect(iExec).toBeGreaterThan(iDecidir);
  });

  it("REVOKED preserva encerramento; falha de leitura preserva adiamento", () => {
    expect(CODIGO).toMatch(/if \(conexao === undefined\)[\s\S]{0,260}acao: "adiado"/);
    expect(CODIGO).toMatch(/if \(conexao === null \|\| !conexao\.is_active\)[\s\S]{0,260}conexao_revogada/);
  });

  it("nova ordem continua usando o conexao_id fixo do plano; não remapeia para current alheia", () => {
    expect(CODIGO).toMatch(/conexaoId: p\.conexao_id/);
    expect(CODIGO).not.toMatch(/lerConexao\(p\.wallet_address/);
  });
});
