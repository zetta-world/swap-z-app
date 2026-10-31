/**
 * R0 — comandos administrativos sensíveis: sem trilha não executam, e falha de
 * banco não vira "ok"/"vazio". Banco e auditoria falsos; nada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  auditoriaRecusa: false,
  paginas: [] as Array<{ data: unknown[] | null; error: unknown }>,
  ranges: [] as Array<[number, number]>,
  /** chamadas de página por chave: [depoisDe (gt id), limite, lte created_at] */
  chaves: [] as Array<{ gt: string | null; limite: number; lte: string | null }>,
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
      let gt: string | null = null, lte: string | null = null;
      const q = {
        select: () => q, order: () => q,
        gt: (_c: string, v: string) => { gt = v; return q; },
        lte: (_c: string, v: string) => { lte = v; return q; },
        limit: async (n: number) => { s.chaves.push({ gt, limite: n, lte }); return s.paginas.shift() ?? { data: [], error: null }; },
        range: async (a: number, b: number) => { s.ranges.push([a, b]); return s.paginas.shift() ?? { data: [], error: null }; },
        upsert: async () => ({ error: s.upsertErro }),
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/paper/reset", () => ({ planReset: vi.fn(), lastReset: vi.fn(), resetLedgers: s.reset }));

beforeEach(() => {
  s.auditoriaRecusa = false; s.paginas = []; s.ranges = []; s.chaves = []; s.upsertErro = null; s.acoes = [];
  s.reset.mockClear();
});

const linhas = (n: number, de = 0) => Array.from({ length: n }, (_, i) => ({
  id: String(de + i).padStart(8, "0"), created_at: `2026-10-25T00:00:${String((de + i) % 60).padStart(2, "0")}Z`, kind: "swap",
}));
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

describe("ledger/export", () => {
  it("leitura falha → 503, NUNCA um CSV só com cabeçalho", async () => {
    s.paginas = [{ data: null, error: { message: "boom" } }];
    const { GET } = await import("@/app/admin/api/ledger/export/route");
    const r = await GET();
    expect(r.status).toBe(503);
    expect(r.headers.get("content-type")).not.toContain("text/csv");
  });

  it("fotografia: todas as páginas com o MESMO t0, por chave (gt id), 1.000 por página", async () => {
    s.paginas = [{ data: linhas(1000), error: null }, { data: linhas(500, 1000), error: null }];
    const { GET } = await import("@/app/admin/api/ledger/export/route");
    const r = await GET();
    expect(r.status).toBe(200);
    expect(s.chaves[0]).toMatchObject({ gt: null, limite: 1000 });
    expect(s.chaves[1].gt).toBe("00000999");
    expect(new Set(s.chaves.map((c) => c.lte)).size).toBe(1);   // um único t0
    expect(s.ranges).toHaveLength(0);                            // nada de offset
    expect(r.headers.get("x-export-linhas")).toBe("1500");
    expect(r.headers.get("x-export-ate")).toBe(s.chaves[0].lte);
  });

  it("exatamente 10.000 NÃO é cortado; acima do teto → 413 e nenhum CSV parcial", async () => {
    s.paginas = Array.from({ length: 10 }, (_, i) => ({ data: linhas(1000, i * 1000), error: null }));
    let { GET } = await import("@/app/admin/api/ledger/export/route");
    let r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("x-export-linhas")).toBe("10000");
    expect(r.headers.get("x-export-truncado")).toBe("0");
    s.paginas = Array.from({ length: 11 }, (_, i) => ({ data: linhas(1000, i * 1000), error: null }));
    ({ GET } = await import("@/app/admin/api/ledger/export/route"));
    r = await GET();
    expect(r.status).toBe(413);
    expect(r.headers.get("content-type")).not.toContain("text/csv");
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
    expect(s.chaves).toHaveLength(0);
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
