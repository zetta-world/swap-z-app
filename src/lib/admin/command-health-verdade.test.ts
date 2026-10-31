/**
 * R0-verdade — COMMAND não diz "ALL CLEAR" e HEALTH não diz "Supabase ok"
 * sem ter lido o banco. Banco falso; nada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const s = vi.hoisted(() => ({ quebrado: false, pendurado: false }));
vi.mock("@/lib/admin/require", () => ({ requireAdmin: async () => ({ wallet: "0xA" }) }));
vi.mock("@/lib/admin/deps", () => ({
  checkExternalDeps: async () => [],
  summarizeDeps: () => ({ criticalDown: [], verdict: "ok" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const r = () => s.pendurado ? new Promise(() => {})
        : Promise.resolve(s.quebrado ? { data: null, count: null, error: { message: "x" } } : { data: [], count: 0, error: null });
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "neq", "is", "like", "order", "limit"]) q[m] = () => q;
      q.range = r;
      q.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => r().then(ok, err);
      return q;
    },
  }),
}));

beforeEach(() => { s.quebrado = false; s.pendurado = false; });

describe("GET /admin/api/command", () => {
  it("banco recusando → falhas listadas e KPIs null (nunca 0)", async () => {
    s.quebrado = true;
    const { GET } = await import("@/app/admin/api/command/route");
    const j = await (await GET()).json();
    expect(j.state).toBe("partial");
    expect(j.falhas).toEqual(expect.arrayContaining(["users", "operations", "security_24h", "cron_heartbeats"]));
    expect(j.users).toBeNull();
    expect(j.volume24h).toBeNull();
    expect(j.alerts.highSecurity24h).toBeNull();
    expect(j.alerts.staleCrons).toEqual([]);
  });

  it("banco ok e vazio → zeros LIDOS, falhas vazio", async () => {
    const { GET } = await import("@/app/admin/api/command/route");
    const j = await (await GET()).json();
    expect(j.falhas).toEqual([]);
    expect(j.users).toBe(0);
  });

  it("o painel só diz ALL CLEAR com `falhas` vazio", () => {
    const src = readFileSync("src/components/admin/panels/CommandPanel.tsx", "utf8");
    expect(src).toMatch(/incompleto \? `DADOS INCOMPLETOS/);
    expect(src).toMatch(/\|\| "ALL CLEAR"/);
  });
});

describe("GET /admin/api/health", () => {
  it("banco recusando → Supabase DOWN, crons DESCONHECIDOS (não 'never'), ok=false", async () => {
    s.quebrado = true;
    const { GET } = await import("@/app/admin/api/health/route");
    const j = await (await GET()).json();
    expect(j.ok).toBe(false);
    expect(j.batimentosLidos).toBe(false);
    expect(j.deps.find((d: { name: string }) => d.name === "Supabase").ok).toBe(false);
    expect(new Set(j.crons.map((c: { estado: string }) => c.estado))).toEqual(new Set(["desconhecido"]));
  });

  it("ping do banco tem teto: pendurado → DOWN em vez de pendurar a tela", async () => {
    s.pendurado = true;
    const { pingBanco } = await import("@/lib/admin/health");
    const p = await pingBanco(20);
    expect(p.ok).toBe(false);
    expect(p.note).toContain("sem resposta");
  });
});
