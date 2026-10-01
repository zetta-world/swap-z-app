import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  planosVencidos: vi.fn(),
  planosRecovery: vi.fn(),
  executarOrdemCex: vi.fn(),
  intentVivoDoPlano: vi.fn(),
  intentPorId: vi.fn(),
  reconciliarIntent: vi.fn(),
  decidirPeloIntent: vi.fn(),
  recordEvent: vi.fn(async () => undefined),
  notifyTelegram: vi.fn(),
  soltarATrava: vi.fn(async () => undefined),
  gates: vi.fn(async () => ({ pause_dca: false })),
  decidirCapacidade: vi.fn(),
  db: null as unknown,
}));

vi.mock("@/lib/dca/store", () => ({
  planosVencidos: h.planosVencidos,
  planosComIntentVivoParaRecovery: h.planosRecovery,
  reservarCiclo: vi.fn(), fecharCiclo: vi.fn(), gravarPulo: vi.fn(),
  avancarPlano: vi.fn(), gastoHojeDaCarteira: vi.fn(),
}));
vi.mock("@/lib/cex/execucao/executor", () => ({ executarOrdemCex: h.executarOrdemCex }));
vi.mock("@/lib/cex/conexoes", () => ({
  lerConexaoPorId: vi.fn(), decifrarConexao: vi.fn(), credenciaisDoIntentParaRecovery: vi.fn(),
}));
vi.mock("@/lib/cex/execucao/intents", () => ({
  intentVivoDoPlano: h.intentVivoDoPlano,
  intentPorId: h.intentPorId,
}));
vi.mock("@/lib/cex/execucao/reconciliador", () => ({ reconciliarIntent: h.reconciliarIntent }));
vi.mock("@/lib/dca/liquidacao", () => ({ decidirPeloIntent: h.decidirPeloIntent }));
vi.mock("@/lib/dca/capacidade", () => ({ decidirCapacidade: h.decidirCapacidade, lerCapacidades: vi.fn() }));
vi.mock("@/lib/api/cex-spot", () => ({ getCexSpotPrices: vi.fn() }));
vi.mock("@/lib/cex/server", () => ({ fetchCexBalance: vi.fn() }));
vi.mock("@/lib/autopilot/liberacao", () => ({
  lerLiberacao: vi.fn(), lerPilotos: vi.fn(), decidirAutomacao: vi.fn(),
}));
vi.mock("@/lib/admin/gates", () => ({ getFlywheelGates: h.gates }));
vi.mock("@/lib/admin/health", () => ({ setCronHeartbeat: vi.fn(async () => undefined) }));
vi.mock("@/lib/dca/trava", () => ({
  pegarATrava: vi.fn(async () => "peguei"),
  soltarATrava: h.soltarATrava,
}));
vi.mock("@/lib/admin/track", () => ({ recordEvent: h.recordEvent, notifyTelegram: h.notifyTelegram }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: vi.fn(() => h.db) }));
vi.mock("@/lib/cex/taxa", () => ({ taxaEmUsd: vi.fn() }));

import { POST } from "@/app/api/dca/cron/route";

function req(): Parameters<typeof POST>[0] {
  return new Request("http://localhost/api/dca/cron", {
    method: "POST",
    headers: { authorization: "Bearer batch2-a86-test" },
  }) as Parameters<typeof POST>[0];
}

const planoPausado = {
  id: "plano-pausado",
  conexao_id: "cx-historica",
  wallet_address: "0xowner",
  exchange_id: "binance",
  symbol: "BTC/USDT",
  orcamento_total_usd: 1000,
  por_ciclo_usd: 100,
  ciclos_total: 10,
  intervalo: "daily",
  next_run_at: "2026-09-25T00:00:00.000Z",
  ciclos_feitos: 1,
  ciclos_pulados: 0,
  gasto_acumulado_usd: 100,
  status: "pausado",
  encerrado_por: null,
  modo: "real",
} as const;

const intentUnknown = {
  id: "intent-unknown",
  client_order_id: "coid",
  wallet_address: "0xowner",
  origin: "dca_cron",
  autonomous: true,
  session_id: null,
  plan_id: planoPausado.id,
  cycle_number: 2,
  conexao_id: "cx-historica",
  strategy_id: "dca",
  strategy_version: 1,
  strategy_hash: "hash",
  certificate_id: "cert",
  credential_fingerprint: null,
  exchange_id: "binance",
  symbol: "BTC/USDT",
  side: "buy",
  order_type: "market",
  requested_qty: 1,
  limit_price: null,
  requested_notional_usd: 100,
  simulated: false,
  state: "UNKNOWN",
  state_reason: null,
  external_order_id: null,
  filled_qty: 0,
  filled_quote: 0,
  fee_total: null,
  fee_currency: null,
  canceled_qty: 0,
  created_at: "2026-09-25T00:00:00.000Z",
  submitted_at: null,
  last_reconciled_at: null,
  reconcile_attempts: 0,
} as const;

describe("Batch 2 revisão / A58+A86 — integração HTTP do cron", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "batch2-a86-test";
    h.db = {};
    vi.clearAllMocks();
    h.gates.mockResolvedValue({ pause_dca: false });
  });

  it("passada seguinte: plano pausado + UNKNOWN entra por recovery e não cria ordem nova", async () => {
    h.planosVencidos.mockResolvedValue({ ok: true, planos: [], truncado: false });
    h.planosRecovery.mockResolvedValue({ ok: true, planos: [planoPausado], truncado: false });
    h.intentVivoDoPlano.mockResolvedValue(intentUnknown);
    h.reconciliarIntent.mockResolvedValue({ estado: "UNKNOWN" });
    h.intentPorId.mockResolvedValue(intentUnknown);
    h.decidirPeloIntent.mockReturnValue({ acao: "esperar", porque: "ainda_em_duvida" });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      ok: true, processed: 1,
      resumo: [{ plano: planoPausado.id, acao: "em_duvida", detalhe: "ainda_em_duvida" }],
    });
    expect(h.intentVivoDoPlano).toHaveBeenCalledWith(h.db, planoPausado.id);
    expect(h.reconciliarIntent).toHaveBeenCalledTimes(1);
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
    expect(planoPausado.status).toBe("pausado");
  });

  it("erro da fila ativa => HTTP 503, processed=0 e zero executarOrdemCex", async () => {
    h.planosVencidos.mockResolvedValue({ ok: false, erro: "consulta_falhou", detalhe: "db down" });
    h.planosRecovery.mockResolvedValue({ ok: true, planos: [], truncado: false });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      ok: false, error: "fila_indisponivel", origem: "ativa",
      motivo: "consulta_falhou", processed: 0,
    });
    expect(h.planosRecovery).not.toHaveBeenCalled();
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
    expect(h.soltarATrava).toHaveBeenCalledTimes(1);
  });

  it("erro da fila de recovery => HTTP 503, processed=0 e zero executarOrdemCex", async () => {
    h.planosVencidos.mockResolvedValue({ ok: true, planos: [], truncado: false });
    h.planosRecovery.mockResolvedValue({ ok: false, erro: "sem_banco" });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toMatchObject({
      ok: false, error: "fila_indisponivel", origem: "recovery",
      motivo: "sem_banco", processed: 0,
    });
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
    expect(h.soltarATrava).toHaveBeenCalledTimes(1);
  });

  /**
   * Observação 7 do relatório do Batch 2: o primeiro teste de
   * `fila-passada.test.ts` simula o estado dentro do próprio callback. Aqui a
   * mesma propriedade é medida na ROTA REAL: plano pausado vindo SÓ da fila
   * de recovery, sem intent vivo, não chega a nenhum gate de entrada.
   */
  it("plano pausado na fila de recovery SEM intent vivo => sem_recovery, zero entrada", async () => {
    h.planosVencidos.mockResolvedValue({ ok: true, planos: [], truncado: false });
    h.planosRecovery.mockResolvedValue({ ok: true, planos: [planoPausado], truncado: false });
    h.intentVivoDoPlano.mockResolvedValue(null);

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.resumo).toEqual([{ plano: planoPausado.id, acao: "sem_recovery", detalhe: "status_pausado" }]);
    expect(h.reconciliarIntent).not.toHaveBeenCalled();
    expect(h.decidirCapacidade).not.toHaveBeenCalled();
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
  });

  it("⚠️ pause_dca: o recovery RODA, a fila ativa nem é lida e nenhuma ordem nasce", async () => {
    h.gates.mockResolvedValue({ pause_dca: true });
    const planoAtivo = { ...planoPausado, id: "plano-ativo", status: "ativo" };
    h.planosVencidos.mockResolvedValue({ ok: true, planos: [planoAtivo], truncado: false });
    h.planosRecovery.mockResolvedValue({ ok: true, planos: [planoAtivo], truncado: false });
    h.intentVivoDoPlano.mockResolvedValue({ ...intentUnknown, plan_id: planoAtivo.id });
    h.reconciliarIntent.mockResolvedValue({ estado: "UNKNOWN" });
    h.intentPorId.mockResolvedValue({ ...intentUnknown, plan_id: planoAtivo.id });
    h.decidirPeloIntent.mockReturnValue({ acao: "esperar", porque: "ainda_em_duvida" });

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, paused: true, processed: 1 });
    expect(h.planosVencidos).not.toHaveBeenCalled();
    expect(h.reconciliarIntent).toHaveBeenCalledTimes(1);
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
  });

  it("⚠️ pause_dca + plano ATIVO sem intent vivo => sem_recovery; nunca entrada nova", async () => {
    h.gates.mockResolvedValue({ pause_dca: true });
    const planoAtivo = { ...planoPausado, id: "plano-ativo", status: "ativo" };
    h.planosRecovery.mockResolvedValue({ ok: true, planos: [planoAtivo], truncado: false });
    h.intentVivoDoPlano.mockResolvedValue(null);

    const res = await POST(req());
    const body = await res.json();

    expect(body.resumo).toEqual([{ plano: "plano-ativo", acao: "sem_recovery", detalhe: "status_ativo" }]);
    expect(h.decidirCapacidade).not.toHaveBeenCalled();
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
  });

  it("pause_dca + fila de recovery ilegível => 503, como sem pausa (A86)", async () => {
    h.gates.mockResolvedValue({ pause_dca: true });
    h.planosRecovery.mockResolvedValue({ ok: false, erro: "consulta_falhou" });

    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(h.executarOrdemCex).not.toHaveBeenCalled();
    expect(h.soltarATrava).toHaveBeenCalledTimes(1);
  });
});
