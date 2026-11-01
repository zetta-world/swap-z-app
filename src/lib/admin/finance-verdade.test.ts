/**
 * ADM-006/007 — a tela de custo/receita não transforma "não li" em "$0", nem
 * conta a mesma chamada duas vezes. Banco falso; nada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agregarUsoDeIa } from "./ai-cost";
import { exibirMetrica, estadoGeral, deBatimento } from "./metrica";

const AGORA = Date.parse("2026-10-25T12:00:00Z");

describe("agregarUsoDeIa (ADM-007)", () => {
  it("resposta do cache não é chamada nem custo; modelo desconhecido é contado; token lixo não vira NaN", () => {
    const a = agregarUsoDeIa([
      { created_at: "2026-10-25T10:00:00Z", metadata: { model: "claude-sonnet-4-5", inTokens: 1000, outTokens: 100 } },
      { created_at: "2026-10-25T10:00:00Z", metadata: { cacheHit: true, model: "claude-sonnet-4-5", inTokens: 1000, outTokens: 100 } },
      { created_at: "2026-10-25T10:00:00Z", metadata: { model: "modelo-inexistente", inTokens: 10 } },
      { created_at: "2026-10-25T10:00:00Z", metadata: { model: "claude-sonnet-4-5", inTokens: "abc" } },
    ], AGORA);
    expect(a.calls.all).toBe(3);
    expect(a.respostasDoCache).toBe(1);
    expect(a.semPrecoProprio).toBe(1);
    expect(a.tokensIlegiveis).toBe(1);
    expect(Number.isFinite(a.all)).toBe(true);
    expect(a.tokens.input).toBe(1010);
    expect(a.daily).toHaveLength(14);
  });
});

describe("projeção do mês pelo tempo decorrido (C12)", () => {
  it("1 chamada/hora desde 00:00 do dia 1º, às 06:00 → ritmo real, não 4× menor", () => {
    const agora = Date.parse("2026-11-01T06:00:00Z");
    const linhas = Array.from({ length: 6 }, (_, h) => ({
      created_at: `2026-11-01T0${h}:00:00Z`, metadata: { model: "claude-sonnet-4-5", inTokens: 1_000_000 },
    }));
    const a = agregarUsoDeIa(linhas, agora);
    expect(a.monthProjection).toBeCloseTo((a.month / 0.25) * 30, 6);
    expect(a.projecaoInstavel).toBe(true);
  });
});

describe("deLeitura mantém o porquê (C13)", () => {
  it("estouro de tempo ≠ consulta recusada", async () => {
    const { deLeitura } = await import("./metrica");
    const m = deLeitura({ linhas: [], erro: "tempo_esgotado", truncado: false, paginas: 0 }, "x", () => 0);
    expect(m).toMatchObject({ state: "unavailable", errorCode: "tempo_esgotado" });
    const n = deLeitura({ linhas: [], erro: "permission denied", truncado: false, paginas: 0 }, "x", () => 0);
    expect(n.errorCode).toBe("leitura_falhou");
  });
});

describe("metrica — os quatro casos que a tela confundia", () => {
  it("indisponível ≠ zero ≠ vazio ≠ parcial", () => {
    const base = { quality: "measured" as const, source: "x", asOf: null };
    expect(exibirMetrica({ ...base, state: "unavailable", value: null }, String).texto).toBe("—");
    expect(exibirMetrica({ ...base, state: "zero", value: 0 }, String).selo).toBe("ZERO");
    expect(exibirMetrica({ ...base, state: "empty", value: 0 }, String).selo).toBe("SEM REGISTROS");
    expect(exibirMetrica({ ...base, state: "partial", value: 5 }, String).selo).toBe("PARCIAL");
    expect(exibirMetrica(undefined, String).selo).toBe("INDISPONÍVEL");
    expect(estadoGeral([{ ...base, state: "ok", value: 1 }, { ...base, state: "unavailable", value: null }])).toBe("parcial");
  });

  it("batimento: leitura falha = unavailable (não 'nunca rodou'); ausente = empty; velho = stale", () => {
    expect(deBatimento({ lido: false } as never, 60, AGORA, "k").state).toBe("unavailable");
    expect(deBatimento({ lido: true, valor: null } as never, 60, AGORA, "k").state).toBe("empty");
    expect(deBatimento({ lido: true, valor: "2026-10-25T11:00:00Z" } as never, 60, AGORA, "k").state).toBe("stale");
  });
});

// ── rota /admin/api/finance ──
const s = vi.hoisted(() => ({ erroEm: new Set<string>(), linhas: {} as Record<string, unknown[]> }));
vi.mock("@/lib/admin/require", () => ({ requireAdmin: async () => ({ wallet: "0xA" }) }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      let depois: string | null = null;
      const q = {
        select: () => q, eq: () => q, order: () => q,
        gt: (_c: string, v: string) => { depois = v; return q; },
        limit: async () => s.erroEm.has(t)
          ? { data: null, error: { message: "falhou" } }
          : { data: depois == null ? (s.linhas[t] ?? []) : [], error: null },
      };
      return q;
    },
  }),
}));

beforeEach(() => {
  s.erroEm = new Set();
  s.linhas = {
    platform_events: [{ id: "e1", created_at: "2026-10-25T10:00:00Z", metadata: { model: "claude-sonnet-4-5", inTokens: 10 } }],
    operations: [{ id: "o1", volume_usd: 100, created_at: new Date().toISOString() }],
    tier_cache: [{ wallet_address: "w1", tier: "pro" }],
  };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
});

describe("GET /admin/api/finance (ADM-006)", () => {
  it("operations falha → volume null + fontes.volume unavailable; o resto segue, estado parcial", async () => {
    s.erroEm.add("operations");
    const { GET } = await import("@/app/admin/api/finance/route");
    const r = await GET();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.volume).toBeNull();
    expect(j.fontes.volume.state).toBe("unavailable");
    expect(j.estado).toBe("parcial");
    expect(j.ai.calls.all).toBe(1);
    expect(j.fontes.ai.quality).toBe("estimated");
  });

  it("todas as fontes falham → 503, sem bloco de zeros", async () => {
    ["platform_events", "operations", "tier_cache"].forEach((t) => s.erroEm.add(t));
    const { GET } = await import("@/app/admin/api/finance/route");
    const r = await GET();
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.ai).toBeNull();
    expect(j.revenue).toBeNull();
    expect(j.errorCode).toBe("leitura_falhou");   // C13: o 503 diz o porquê
  });
});
