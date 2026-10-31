/**
 * R0 — comandos administrativos sensíveis: sem trilha não executam, e falha de
 * banco não vira "ok"/"vazio". Banco e auditoria falsos; nada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  auditoriaRecusa: false,
  paginas: [] as Array<{ data: unknown[] | null; error: unknown }>,
  ranges: [] as Array<[number, number]>,
  upsertErro: null as unknown,
  reset: vi.fn(async () => [{ source: "a", ok: true, realizedUsd: 1 }]),
  acoes: [] as string[],
}));

vi.mock("@/lib/admin/require", () => ({ requireAdmin: async () => ({ wallet: "0xadmin" }) }));
vi.mock("@/lib/admin/auditoria-duravel", () => ({
  PORQUE_AUDITORIA_INDISPONIVEL: "sem trilha",
  avisoDeAuditoria: () => ({}),
  comandoAuditado: async (c: { acao: string; ator: string; executar: () => Promise<{ ok: boolean; valor?: unknown; codigo?: string }> }) => {
    s.acoes.push(`${c.acao}@${c.ator}`);
    if (s.auditoriaRecusa) return { estado: "recusado", erro: "auditoria_indisponivel", detalhe: "x", req: "r" };
    const r = await c.executar();
    return r.ok ? { estado: "executado", valor: r.valor, auditoria: "completa", req: "r" }
                : { estado: "falhou", codigo: r.codigo, valor: r.valor, auditoria: "completa", req: "r" };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q, order: () => q,
        range: async (a: number, b: number) => { s.ranges.push([a, b]); return s.paginas.shift() ?? { data: [], error: null }; },
        upsert: async () => ({ error: s.upsertErro }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/paper/reset", () => ({ planReset: vi.fn(), lastReset: vi.fn(), resetLedgers: s.reset }));

beforeEach(() => {
  s.auditoriaRecusa = false; s.paginas = []; s.ranges = []; s.upsertErro = null; s.acoes = [];
  s.reset.mockClear();
});

const linhas = (n: number) => Array.from({ length: n }, (_, i) => ({ created_at: `t${i}`, kind: "swap" }));
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

describe("ledger/export", () => {
  it("leitura falha → 503, NUNCA um CSV só com cabeçalho", async () => {
    s.paginas = [{ data: null, error: { message: "boom" } }];
    const { GET } = await import("@/app/admin/api/ledger/export/route");
    const r = await GET();
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).not.toContain("text/csv");
  });

  it("pagina de 1.000 em 1.000 (db-max-rows) e marca truncado no teto", async () => {
    s.paginas = Array.from({ length: 10 }, () => ({ data: linhas(1000), error: null }));
    const { GET } = await import("@/app/admin/api/ledger/export/route");
    const r = await GET();
    expect(r.status).toBe(200);
    expect(s.ranges[0]).toEqual([0, 999]);
    expect(s.ranges).toHaveLength(10);
    expect(r.headers.get("x-export-linhas")).toBe("10000");
    expect(r.headers.get("x-export-truncado")).toBe("1");
  });

  it("menos de uma página → não truncado; e quem baixou fica na trilha", async () => {
    s.paginas = [{ data: linhas(3), error: null }];
    const { GET } = await import("@/app/admin/api/ledger/export/route");
    const r = await GET();
    expect(r.headers.get("x-export-truncado")).toBe("0");
    expect((await r.text()).split("\n")).toHaveLength(4);
    expect(s.acoes).toContain("ledger.export@0xadmin");
  });

  it("sem trilha → sem arquivo", async () => {
    s.auditoriaRecusa = true;
    const { GET } = await import("@/app/admin/api/ledger/export/route");
    expect((await GET()).status).toBe(503);
    expect(s.ranges).toHaveLength(0);
  });
});

describe("margin POST", () => {
  it("upsert recusado → 503 (antes: ok com o valor não gravado)", async () => {
    s.upsertErro = { message: "denied" };
    const { POST } = await import("@/app/admin/api/margin/route");
    const r = await POST(post({ key: "cash_reserve_usd", usd: 10 }) as never);
    expect(r.status).toBe(503);
    expect((await r.json()).ok).toBeUndefined();
  });
});

describe("paper-reset POST", () => {
  it("sem trilha → o reset NÃO roda", async () => {
    s.auditoriaRecusa = true;
    const { POST } = await import("@/app/admin/api/paper-reset/route");
    const r = await POST(post({ sources: ["a"], reason: "motivo suficiente aqui" }));
    expect(r.status).toBe(503);
    expect(s.reset).not.toHaveBeenCalled();
  });

  it("com trilha → roda, e o ator real fica registrado", async () => {
    const { POST } = await import("@/app/admin/api/paper-reset/route");
    const r = await POST(post({ sources: ["a"], reason: "motivo suficiente aqui" }));
    expect(r.status).toBe(200);
    expect(s.reset).toHaveBeenCalledOnce();
    expect(s.acoes).toContain("paper.reset@0xadmin");
  });
});
