import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { reconciliar, relatorioMarkdown, type Exportacao, type LinhaRelatorio } from "./reconciliacao";
import { atribuirPreliminar, validarAtribuicao, ROTULOS_PERDA } from "./atribuicao";
import { verificarSomenteLeitura, embrulharSomenteLeitura } from "../../../scripts/strategy/somente-leitura.mjs";

const T = "2026-08-01T00:00:00Z";
function vazio(): Exportacao {
  return { capturado_em: T, fonte: "teste", paper_accounts: [], paper_positions: [], zion_suggestions: [], celeiro_posicoes: [],
    celeiro_fluxos: [], celeiro_genoma: [], bancada_rodada: [], bancada_operacao: [], bancada_resultado: [], lab_runs: [], lab_results: [], mercado: [] };
}
const conta = (id: string, realized: number | null, extra: Partial<Exportacao["paper_accounts"][number]> = {}) =>
  ({ id, source: id, starting_usd: 1000, cash_usd: 1000, realized_pnl_usd: realized, wins: 0, losses: 0, created_at: T, updated_at: T, ...extra });
let seq = 0;
const pos = (conta: string, pnl: number | null, extra: Partial<Exportacao["paper_positions"][number]> = {}) =>
  ({ id: `p${++seq}`, account_id: conta, suggestion_id: `s${seq}`, source: conta, symbol: "BTC", side: "buy", cost_usd: 100, status: "closed",
     exit_reason: "target", pnl_usd: pnl, opened_at: T, closed_at: "2026-08-02T00:00:00Z", archived_at: null, ...extra });
const linha = (r: ReturnType<typeof reconciliar>, ds: string): LinhaRelatorio => r.linhas.find((l) => l.dataset === ds)!;

describe("Fase A — paper_accounts × paper_positions", () => {
  it("EXPLAINED quando o contador bate com as fechadas vivas", () => {
    const e = vazio(); e.paper_accounts.push(conta("a", 15)); e.paper_positions.push(pos("a", 10), pos("a", 5));
    const l = linha(reconciliar(e), "paper_accounts.realized_pnl_usd:a");
    expect([l.classification, l.confidence, l.accounting_total, l.position_total, l.delta]).toEqual(["EXPLAINED", "HIGH", 15, 15, 0]);
  });
  it("ARCHIVAL_EFFECT: contador = vida inteira (guarda rodada arquivada)", () => {
    const e = vazio(); e.paper_accounts.push(conta("a", 30)); e.paper_positions.push(pos("a", 10), pos("a", 20, { archived_at: T }));
    expect(linha(reconciliar(e), "paper_accounts.realized_pnl_usd:a").classification).toBe("ARCHIVAL_EFFECT");
  });
  it("ARCHIVAL_EFFECT: contador = só arquivadas (reset parcial, caso radar)", () => {
    const e = vazio(); e.paper_accounts.push(conta("radar", -13.37)); e.paper_positions.push(pos("radar", -13.37, { archived_at: T }));
    const l = linha(reconciliar(e), "paper_accounts.realized_pnl_usd:radar");
    expect(l.classification).toBe("ARCHIVAL_EFFECT"); expect(l.notes.join()).toContain("ARQUIVADAS");
  });
  it("RESET_EFFECT HIGH com evento datado; LOW sem evento (padrão arbiter)", () => {
    const e = vazio(); e.paper_accounts.push(conta("arb", 5, { wins: 1 }));
    e.paper_positions.push(pos("arb", 199.43, { closed_at: "2026-08-01T00:00:00Z" }), pos("arb", 5, { closed_at: "2026-09-01T00:00:00Z" }));
    e.eventos_conhecidos = [{ tipo: "reset", em: "2026-08-15T00:00:00Z", descricao: "reset de teste" }];
    expect(linha(reconciliar(e), "paper_accounts.realized_pnl_usd:arb")).toMatchObject({ classification: "RESET_EFFECT", confidence: "HIGH" });
    const z = vazio(); z.paper_accounts.push(conta("arb", 0)); z.paper_positions.push(pos("arb", 199.43));
    expect(linha(reconciliar(z), "paper_accounts.realized_pnl_usd:arb")).toMatchObject({ classification: "RESET_EFFECT", confidence: "LOW", delta: -199.43 });
  });
  it("VERSIONED_SEMANTICS com troca de semântica datada; escopo respeitado", () => {
    const e = vazio(); e.paper_accounts.push(conta("k", 7, { wins: 1 }), conta("m", 7, { wins: 1 }));
    for (const c of ["k", "m"]) e.paper_positions.push(pos(c, 3, { closed_at: "2026-08-01T00:00:00Z" }), pos(c, 7, { closed_at: "2026-09-01T00:00:00Z" }));
    e.eventos_conhecidos = [{ tipo: "semantica", em: "2026-08-20T00:00:00Z", escopo: ["k"], descricao: "custo passou a líquido" }];
    const r = reconciliar(e);
    expect(linha(r, "paper_accounts.realized_pnl_usd:k").classification).toBe("VERSIONED_SEMANTICS");
    expect(linha(r, "paper_accounts.realized_pnl_usd:m").classification).toBe("UNKNOWN");
  });
  it("DATA_GAP com pnl nulo; UNKNOWN nunca vira 'corrupção'", () => {
    const e = vazio(); e.paper_accounts.push(conta("g", 1, { wins: 2 }), conta("u", 99, { wins: 1 }));
    e.paper_positions.push(pos("g", null), pos("u", 1));
    const r = reconciliar(e);
    expect(linha(r, "paper_accounts.realized_pnl_usd:g").classification).toBe("DATA_GAP");
    const u = linha(r, "paper_accounts.realized_pnl_usd:u");
    expect(u.classification).toBe("UNKNOWN"); expect(u.notes.join()).toContain("não rotular corrupção");
  });
  it("caixa: mesma fórmula do detector; contadores com arquivamento", () => {
    const e = vazio(); e.paper_accounts.push(conta("c", 10, { cash_usd: 810, wins: 3 }));
    e.paper_positions.push(pos("c", 10), pos("c", null, { status: "open", exit_reason: null, cost_usd: 200 }), pos("c", 0, { archived_at: T, exit_reason: "stop" }));
    const r = reconciliar(e);
    expect(linha(r, "paper_accounts.cash_usd:c")).toMatchObject({ position_total: 810, delta: 0, classification: "EXPLAINED" });
    expect(linha(r, "paper_accounts.wins+losses:c")).toMatchObject({ accounting_total: 3, position_total: 1, classification: "ARCHIVAL_EFFECT" });
  });
  it("órfã de sugestão = DATA_GAP; rodada 1 não arquivada aparece", () => {
    const e = vazio(); e.paper_accounts.push(conta("a", 0)); e.paper_positions.push(pos("a", 0));
    e.zion_suggestions.push({ id: "x", source: "a", symbol: "BTC", side: "buy", status: "win", created_at: "2026-07-01T00:00:00Z", resolved_at: null, archived_at: null });
    const r = reconciliar(e);
    expect(linha(r, "paper_positions→zion_suggestions")).toMatchObject({ classification: "DATA_GAP", delta: 1 });
    expect(linha(r, "zion_suggestions")).toMatchObject({ classification: "UNKNOWN", delta: 1 });
  });
});

describe("Fase A — Celeiro, Bancada, Lab, mercado", () => {
  const cel = (id: string, lado: string, ent: number, sai: number | null, extra = {}) =>
    ({ id, agente: "ag", lado, usd: 100, preco_entrada: ent, preco_saida: sai, motivo_saida: sai ? "alvo" : null, aberta_em: T, fechada_em: sai ? T : null, genoma_versao: 1, meta: {}, ...extra });
  const flu = (ref: string, usdt: number, causa = "preco") => ({ id: ref + causa + usdt, agente: "ag", causa, usdt, ref, ocorreu_em: T, genoma_versao: 1 });
  it("fluxo de preço bate com usd × movimento assinado (vendido ganha na queda)", () => {
    const e = vazio(); e.celeiro_genoma.push({ agente: "ag", versao: 1, ativo: true, criado_em: T });
    e.celeiro_posicoes.push(cel("c1", "buy", 100, 110), cel("c2", "sell", 100, 90));
    e.celeiro_fluxos.push(flu("fechamento:c1", 10), flu("fechamento:c2", 10), flu("fechamento:c1", -0.1, "taxa"));
    const r = reconciliar(e);
    expect(linha(r, "celeiro_fluxos.preco:ag")).toMatchObject({ accounting_total: 20, position_total: 20, classification: "EXPLAINED" });
    expect(linha(r, "celeiro_genoma").classification).toBe("EXPLAINED");
  });
  it("fechada sem fluxo = DATA_GAP; genoma referenciado ausente = DATA_GAP", () => {
    const e = vazio(); e.celeiro_posicoes.push(cel("c1", "buy", 100, 110, { genoma_versao: 9 }));
    const r = reconciliar(e);
    expect(linha(r, "celeiro_fluxos.preco:ag").classification).toBe("DATA_GAP");
    expect(linha(r, "celeiro_genoma")).toMatchObject({ classification: "DATA_GAP" });
  });
  it("bancada: n × operações, concluída sem resultado, rodada própria sem estratégia", () => {
    const e = vazio();
    e.bancada_rodada.push({ id: "r1", origem: "propria", estrategia_id: null, status: "concluida", criada_em: T, terminada_em: T },
      { id: "r2", origem: "casa", estrategia_id: null, status: "concluida", criada_em: T, terminada_em: T });
    e.bancada_operacao.push({ id: "o1", rodada_id: "r1", desfecho: "alvo", liquido_pct: 1 });
    e.bancada_resultado.push({ rodada_id: "r1", n: 1, acertos: 1, liquido_pct: 1 });
    const l = linha(reconciliar(e), "bancada_resultado↔bancada_operacao");
    expect(l.classification).toBe("DATA_GAP"); expect(l.notes.join()).toContain("sem estrategia_id (DATA_GAP de vínculo, FSL-10)=1");
  });
  it("lab: ok sem resultado = DATA_GAP; aritmética divergente = VERSIONED_SEMANTICS", () => {
    const e = vazio(); e.lab_runs.push({ id: "l1", strategy_id: "s", status: "ok", started_at: T, finished_at: T });
    e.lab_results.push({ id: "x", run_id: "l1", net_pct: 1.5, gross_pct: 2, cost_pct: 0.4, trades: 3, sample_n: 3 });
    expect(linha(reconciliar(e), "lab_runs↔lab_results").classification).toBe("VERSIONED_SEMANTICS");
    e.lab_runs.push({ id: "l2", strategy_id: "s", status: "ok", started_at: T, finished_at: T });
    expect(linha(reconciliar(e), "lab_runs↔lab_results").classification).toBe("DATA_GAP");
  });
  it("relatório canônico: campos obrigatórios, determinístico, markdown", () => {
    const e = vazio(); e.paper_accounts.push(conta("a", 0)); e.mercado.push({ tabela: "mercado_vela", linhas: 3, chaves: 1, de: T, ate: T });
    const r1 = reconciliar(e), r2 = reconciliar(JSON.parse(JSON.stringify(e)));
    expect(r1).toEqual(r2);
    const campos = ["dataset", "row_count", "identity_key", "time_range", "authoritative_fields", "derived_fields", "known_semantic_versions",
      "accounting_total", "position_total", "delta", "classification", "confidence", "notes"];
    for (const l of r1.linhas) expect(Object.keys(l).sort()).toEqual([...campos].sort());
    expect(relatorioMarkdown(r1)).toContain("| mercado:mercado_vela | 3 |");
  });
});

describe("atribuição de perda — esquema, sem gravação", () => {
  const base = { dataset: "paper_positions" as const, ref: "p1", lado: "buy" as const };
  it("só atribui o que tem evidência direta", () => {
    expect(atribuirPreliminar({ ...base, motivo: "target", brutoPct: 2, liquidoPct: 1 })).toBeNull();
    expect(atribuirPreliminar({ ...base, motivo: "target", brutoPct: 0.1, liquidoPct: -0.2 })!.primaria).toBe("cost_over_edge");
    expect(atribuirPreliminar({ ...base, motivo: "expired", brutoPct: -1, liquidoPct: -1.2 })!.primaria).toBe("time_expiry");
    const stop = atribuirPreliminar({ ...base, motivo: "stop", brutoPct: -2, liquidoPct: -2.2 })!;
    expect([stop.primaria, stop.confianca, stop.evidencias.falta]).toEqual(["unknown", "LOW", "trajetoria_pos_stop"]);
    expect(atribuirPreliminar({ ...base, motivo: "stop", brutoPct: -2, liquidoPct: -2.2, trajetoria: { alvoTocadoAposStop: true, seguiuContra: false } })!.primaria).toBe("stop_geometry");
    expect(atribuirPreliminar({ ...base, motivo: "stop", brutoPct: -2, liquidoPct: -2.2, trajetoria: { alvoTocadoAposStop: false, seguiuContra: true } })!.primaria).toBe("wrong_direction");
  });
  it("low_confidence/wrong_regime só com parâmetro pré-registrado vindo de fora", () => {
    const p = { ...base, motivo: "stop" as const, brutoPct: -2, liquidoPct: -2.2, probabilidade: 55, regime: "DOWN" };
    expect(atribuirPreliminar(p)!.secundarias).toEqual([]);
    expect(atribuirPreliminar(p, { limiarConfianca: 60, regimeCompativel: (r, l) => !(r === "DOWN" && l === "buy") })!.secundarias).toEqual(["low_confidence", "wrong_regime"]);
  });
  it("validador recusa destino de produção e rótulo fora da taxonomia", () => {
    const a = atribuirPreliminar({ ...base, motivo: "expired", brutoPct: -1, liquidoPct: -1 })!;
    expect(validarAtribuicao(a)).toEqual([]);
    expect(validarAtribuicao({ ...a, destino: "producao" })).toContain("destino diferente de local_somente (gravação em produção não autorizada)");
    expect(validarAtribuicao({ ...a, primaria: "azar" })).toContain("primaria fora da taxonomia");
    expect(ROTULOS_PERDA).toHaveLength(10);
  });
});

describe("prova de só leitura (estática)", () => {
  const RAIZ = process.cwd();
  it("a exportação passa na trava; escrita, multi-comando e efeitos colaterais não", () => {
    expect(verificarSomenteLeitura(readFileSync(join(RAIZ, "scripts/strategy/sql/exportar.sql"), "utf8"))).toEqual([]);
    for (const ruim of [
      "update paper_accounts set cash_usd = 0", "select 1; delete from paper_positions", "with x as (delete from lab_runs returning *) select * from x",
      "select * into t from paper_accounts", "select nextval('s')", "select * from paper_accounts for update", "select pg_advisory_lock(1)",
      "insert into admin_kv values ('a','b')", "copy paper_accounts to '/tmp/x'", "select set_config('a','b',false)", "truncate lab_runs",
    ]) expect(verificarSomenteLeitura(ruim).length, ruim).toBeGreaterThan(0);
    expect(verificarSomenteLeitura("select 'insert into x' as texto -- update\n")).toEqual([]);
  });
  it("o embrulho é transação READ ONLY que termina em ROLLBACK", () => {
    const s = embrulharSomenteLeitura("select 1");
    expect(s).toMatch(/begin transaction isolation level repeatable read read only;/);
    expect(s.trim().endsWith("rollback;")).toBe(true);
    expect(() => embrulharSomenteLeitura("delete from x")).toThrow(/recusado/);
  });
  it("motor puro: sem import, sem rede, sem cliente de banco; scripts sem supabase-js", () => {
    for (const f of readdirSync(join(RAIZ, "src/lib/strategy-truth")).filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))) {
      const s = readFileSync(join(RAIZ, "src/lib/strategy-truth", f), "utf8");
      expect(/^\s*import\s/m.test(s), `${f} importa`).toBe(false);
      expect(/\bfetch\s*\(|supabase|XMLHttpRequest|WebSocket|process\.env/.test(s), `${f} rede/banco`).toBe(false);
    }
    for (const f of readdirSync(join(RAIZ, "scripts/strategy")).filter((n) => n.endsWith(".mjs"))) {
      expect(readFileSync(join(RAIZ, "scripts/strategy", f), "utf8")).not.toMatch(/@supabase|fetch\s*\(|SERVICE_ROLE/);
    }
  });
});
