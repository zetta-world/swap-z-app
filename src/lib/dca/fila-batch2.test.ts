import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: mocks.getSupabaseAdmin }));

import { planosComIntentVivoParaRecovery, planosVencidos } from "@/lib/dca/store";

function dbComResposta(resposta: { data: unknown; error: null | { message: string; code?: string } }) {
  const chain: Record<string, unknown> = {};
  for (const nome of ["select", "eq", "lte", "order"]) {
    chain[nome] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(async () => resposta);
  return { from: vi.fn(() => chain), rpc: vi.fn() };
}

function dbComRpc(resposta: { data: unknown; error: null | { message: string; code?: string } }) {
  return { from: vi.fn(), rpc: vi.fn(async () => resposta) };
}

describe("Batch 2 / A86 — EMPTY != READ ERROR na fila ativa", () => {
  beforeEach(() => mocks.getSupabaseAdmin.mockReset());

  it("zero planos legítimo é sucesso vazio", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(dbComResposta({ data: [], error: null }));
    expect(await planosVencidos(new Date().toISOString())).toEqual({ ok: true, planos: [], truncado: false });
  });

  it("DB ausente é erro", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(null);
    expect(await planosVencidos(new Date().toISOString())).toEqual({ ok: false, erro: "sem_banco" });
  });

  it("PostgREST error é erro", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(dbComResposta({ data: null, error: { message: "boom" } }));
    expect(await planosVencidos(new Date().toISOString())).toEqual({
      ok: false, erro: "consulta_falhou", detalhe: "boom",
    });
  });

  it("retorno inválido é erro", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(dbComResposta({ data: { nope: true }, error: null }));
    expect(await planosVencidos(new Date().toISOString())).toEqual({ ok: false, erro: "retorno_invalido" });
  });

  it("continua declarando truncamento quando a leitura foi válida", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(dbComResposta({ data: [{ id: "1" }, { id: "2" }], error: null }));
    const r = await planosVencidos(new Date().toISOString(), 1);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.truncado).toBe(true);
  });
});

describe("Batch 2 revisão / A58+A86 — fila de recovery independe do status", () => {
  beforeEach(() => mocks.getSupabaseAdmin.mockReset());

  it("retorna plano pausado/encerrado entregue pela RPC de recovery", async () => {
    const pausado = { id: "p1", status: "pausado" };
    mocks.getSupabaseAdmin.mockReturnValue(dbComRpc({ data: [pausado], error: null }));
    expect(await planosComIntentVivoParaRecovery()).toEqual({
      ok: true, planos: [pausado], truncado: false,
    });
  });

  it("DB ausente/erro/retorno inválido nunca viram fila vazia saudável", async () => {
    mocks.getSupabaseAdmin.mockReturnValue(null);
    expect(await planosComIntentVivoParaRecovery()).toEqual({ ok: false, erro: "sem_banco" });

    mocks.getSupabaseAdmin.mockReturnValue(dbComRpc({ data: null, error: { message: "recovery boom" } }));
    expect(await planosComIntentVivoParaRecovery()).toEqual({
      ok: false, erro: "consulta_falhou", detalhe: "recovery boom",
    });

    mocks.getSupabaseAdmin.mockReturnValue(dbComRpc({ data: { nope: true }, error: null }));
    expect(await planosComIntentVivoParaRecovery()).toEqual({ ok: false, erro: "retorno_invalido" });
  });
});
