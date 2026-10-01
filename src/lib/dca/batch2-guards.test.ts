import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const semComentarios = (c: string) => c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const CRON = semComentarios(leia("src/app/api/dca/cron/route.ts"));
const PLANOS = semComentarios(leia("src/app/api/dca/planos/route.ts"));
const STORE = semComentarios(leia("src/lib/dca/store.ts"));
const SALDO = semComentarios(leia("src/lib/dca/saldo.ts"));
const FILA = semComentarios(leia("src/lib/dca/fila.ts"));
const MIG = semComentarios(leia("supabase/migrations/0066_dca_safety_accounting.sql"));

describe("Batch 2 revisão / A58", () => {
  it("final auth continua lockando/rele o plano e exige ativo antes de SUBMITTING", () => {
    const iGate = MIG.indexOf("v_intent.origin = 'dca_cron'");
    const iLock = MIG.indexOf("from public.dca_planos", iGate);
    const iStatus = MIG.indexOf("v_plano.status <> 'ativo'", iLock);
    const iSubmitting = MIG.indexOf("set state         = 'SUBMITTING'", iStatus);
    expect(iGate).toBeGreaterThan(0);
    expect(MIG.slice(iLock, iStatus + 200)).toMatch(/for update/);
    expect(iStatus).toBeGreaterThan(iLock);
    expect(iSubmitting).toBeGreaterThan(iStatus);
  });

  it("há fila de recovery independente de status com todos os estados vivos + quarentena", () => {
    expect(MIG).toMatch(/dca_planos_com_intent_vivo_para_recovery/);
    for (const estado of [
      "SUBMITTING", "SUBMITTED", "PARTIALLY_FILLED", "CANCEL_PENDING",
      "UNKNOWN", "RECONCILIATION_REQUIRED", "QUARANTINED",
    ]) expect(MIG).toContain(`'${estado}'`);
    expect(STORE).toMatch(/planosComIntentVivoParaRecovery[\s\S]*dca_planos_com_intent_vivo_para_recovery/);
  });

  it("recovery roda antes dos gates de nova entrada e status não-ativo nunca vira nova entrada", () => {
    const iRec = CRON.indexOf("recuperarIntentDoPlano(p, dbExec)");
    const iStatus = CRON.indexOf('p.status !== "ativo"', iRec);
    const iCap = CRON.indexOf("decidirCapacidade(", iStatus);
    const iExec = CRON.indexOf("executarOrdemCex(", iCap);
    expect(iRec).toBeGreaterThan(0);
    expect(iStatus).toBeGreaterThan(iRec);
    expect(iCap).toBeGreaterThan(iStatus);
    expect(iExec).toBeGreaterThan(iCap);
    expect(CRON).toMatch(/if \(p\.status === "ativo"\)[\s\S]*patch\.status = "completo"/);
  });

  it("fila ativa + recovery são deduplicadas antes de processar", () => {
    expect(FILA).toMatch(/new Map<string, ItemFilaDca/);
    expect(FILA).toMatch(/if \(!unicos\.has\(plano\.id\)\)/);
  });
});

describe("Batch 2 revisão / A59", () => {
  it("teto real usa intents/fills e inconclusivo usa MAX(requested, fill conhecido)", () => {
    expect(STORE).toMatch(/modo === "real"[\s\S]*dca_gasto_real_comprometido_hoje/);
    expect(MIG).toMatch(/cex_execution_intents/);
    expect(MIG).toMatch(/cex_fills/);
    expect(MIG).toMatch(/greatest\(r\.requested_notional_usd, v_realizado\)/);
  });

  it("fill inconclusivo não-USD ou custo não afirmável falha fechado", () => {
    expect(MIG).toMatch(/inconclusivo %[\s\S]*quote nao USD-like/);
    expect(MIG).toMatch(/tem fill sem custo afirmavel/);
  });

  it("FAILED_PRE_SUBMIT continua fora do compromisso pós-submit", () => {
    // O ramo comprometido é uma lista positiva de estados pós-ponto-sem-volta.
    const ramo = MIG.slice(MIG.indexOf("if r.state in ('SUBMITTING'"), MIG.indexOf("if r.state in ('FILLED'"));
    expect(ramo).not.toContain("FAILED_PRE_SUBMIT");
  });
});

describe("Batch 2 / A96", () => {
  it("criação verifica unidade antes do cofre", () => {
    const iUnidade = PLANOS.indexOf("const unidade = unidadeDca(symbol)");
    const iCofre = PLANOS.indexOf("guardarConexao(");
    expect(iUnidade).toBeGreaterThan(0);
    expect(iCofre).toBeGreaterThan(iUnidade);
  });

  it("execução real bloqueia quote não USD-like depois do recovery e antes da nova ordem", () => {
    const iRec = CRON.indexOf("recuperarIntentDoPlano(p, dbExec)");
    const iGate = CRON.indexOf("const unidade = unidadeDca(p.symbol)", iRec);
    const iExec = CRON.indexOf("executarOrdemCex(", iGate);
    expect(iGate).toBeGreaterThan(iRec);
    expect(iExec).toBeGreaterThan(iGate);
  });
});

describe("Batch 2 revisão / A97", () => {
  it("gate assíncrono chama continuar somente depois de FREE válido", () => {
    expect(SALDO).toMatch(/comSaldoLivreDca/);
    const iAvalia = SALDO.indexOf("avaliarSaldoLivreDca(");
    const iContinua = SALDO.indexOf("await p.continuar()", iAvalia);
    expect(iAvalia).toBeGreaterThan(0);
    expect(iContinua).toBeGreaterThan(iAvalia);
  });

  it("cron coloca reservarCiclo dentro do callback autorizado pelo precheck", () => {
    const iGate = CRON.indexOf("comSaldoLivreDca({");
    const iReserva = CRON.indexOf("continuar: () => reservarCiclo(", iGate);
    const iExec = CRON.indexOf("executarOrdemCex(", iReserva);
    expect(iGate).toBeGreaterThan(0);
    expect(iReserva).toBeGreaterThan(iGate);
    expect(iExec).toBeGreaterThan(iReserva);
    expect(CRON.slice(iGate, iReserva)).toMatch(/fetchCexBalance\([\s\S]*false/);
  });
});

describe("Batch 2 revisão / A86", () => {
  it("qualquer fila com erro retorna status 503/processed=0 antes de processar", () => {
    expect(FILA).toMatch(/status: 503/);
    expect(FILA).toMatch(/processed: 0/);
    const iAtivos = FILA.indexOf("const ativos = await deps.lerAtivos()");
    const iRecovery = FILA.indexOf("const recovery = await deps.lerRecovery()");
    const iProcessa = FILA.indexOf("deps.processar(item)");
    expect(iAtivos).toBeGreaterThan(0);
    expect(iRecovery).toBeGreaterThan(iAtivos);
    expect(iProcessa).toBeGreaterThan(iRecovery);
  });

  it("cron propaga o status do harness e registra fila normal/recovery como unhealthy", () => {
    expect(CRON).toMatch(/if \(!rodada\.ok\)[\s\S]*status: rodada\.status/);
    expect(CRON).toMatch(/origem: rodada\.origem/);
  });
});
