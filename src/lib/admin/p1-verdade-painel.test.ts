/**
 * R3 · P1 restantes (Admin CC 2.0, 31/10) — /operations, /ledger e /stats não transformam falha em
 * zero nem recorte em total. Banco falso em memória (com o corte de 1.000 do PostgREST); nada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ tabelas: {} as Record<string, Record<string, unknown>[]>, falhar: new Set<string>(), maxRows: 1000 }));

vi.mock("@/lib/admin/authz", () => ({ autorizarAdmin: async () => ({ wallet: "0xadmin" }) }));
vi.mock("@/lib/supabase/server", () => {
  class Q {
    filtros: ((r: Record<string, unknown>) => boolean)[] = [];
    ordem: { c: string; asc: boolean } | null = null; lim: number | null = null; head = false;
    constructor(public t: string) {}
    select(_c: string, o?: { head?: boolean }) { this.head = !!o?.head; return this; }
    eq(c: string, v: unknown) { this.filtros.push((r) => r[c] === v); return this; }
    neq(c: string, v: unknown) { this.filtros.push((r) => r[c] !== v); return this; }
    gte(c: string, v: string) { this.filtros.push((r) => String(r[c]) >= v); return this; }
    gt(c: string, v: string) { this.filtros.push((r) => String(r[c]) > v); return this; }
    order(c: string, o: { ascending: boolean }) { this.ordem = { c, asc: o.ascending }; return this; }
    limit(n: number) { this.lim = n; return this; }
    then(ok: (v: unknown) => unknown, no?: (e: unknown) => unknown) {
      const r = (() => {
        if (s.falhar.has(this.t)) return this.head ? { count: null, error: { message: "fora" } } : { data: null, error: { message: "fora" } };
        let ls = (s.tabelas[this.t] ?? []).filter((x) => this.filtros.every((f) => f(x)));
        if (this.head) return { count: ls.length, error: null };
        if (this.ordem) { const { c, asc } = this.ordem; ls = [...ls].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (asc ? 1 : -1)); }
        ls = ls.slice(0, Math.min(this.lim ?? Infinity, s.maxRows));
        return { data: ls, error: null };
      })();
      return Promise.resolve(r).then(ok, no);
    }
  }
  return { getSupabaseAdmin: () => ({ from: (t: string) => new Q(t) }) };
});

import { GET as getOps } from "@/app/admin/api/operations/route";
import { GET as getLedger } from "@/app/admin/api/ledger/route";
import { GET as getStats } from "@/app/admin/api/stats/route";

const id = (i: number) => `id-${String(i).padStart(6, "0")}`;
beforeEach(() => { s.tabelas = {}; s.falhar = new Set(); });

describe("P1-10 · /operations — exposição de TODAS as posições abertas", () => {
  it("120 posições abertas: exposição soma as 120 (antes: só as 50 da lista); lista = 50", async () => {
    s.tabelas.autopilot_positions = Array.from({ length: 120 }, (_, i) => ({ id: id(i), cost_usd: 10, status: "open", entry_ts: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}` }));
    s.tabelas.autopilot_positions.push({ id: id(999), cost_usd: 1_000_000, status: "closed", entry_ts: "x" });
    const j = await (await getOps()).json();
    expect(j.openExposure).toBe(1200);
    expect(j.positionsTotal).toBe(120);
    expect(j.positions).toHaveLength(50);
  });
  it("⚠️ posições ilegíveis → 503 e NENHUMA exposição (antes: $0 + 'No open positions')", async () => {
    s.falhar.add("autopilot_positions");
    const r = await getOps();
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.openExposure).toBeUndefined();
    expect(j.openExposureMetrica.state).toBe("unavailable");
  });
  it("runs ilegíveis não derrubam posições: `runs: null` + métrica indisponível, estado parcial", async () => {
    s.tabelas.autopilot_positions = [{ id: id(1), cost_usd: 5, status: "open", entry_ts: "t" }];
    s.falhar.add("autopilot_runs");
    const j = await (await getOps()).json();
    expect(j.runs).toBeNull();
    expect(j.runsMetrica.state).toBe("unavailable");
    expect(j.state).toBe("partial");
    expect(j.openExposure).toBe(5);
  });
});

describe("P1-11 · /ledger — contagem exata e somas sobre TODAS as linhas", () => {
  it("2.500 operações (acima do corte de 1.000): somas cobrem as 2.500, iguais à contagem", async () => {
    s.tabelas.operations = Array.from({ length: 2500 }, (_, i) => ({ id: id(i), kind: i % 2 ? "dex_swap" : "cex", volume_usd: 2, pnl_usd: 1, created_at: `t${i}` }));
    const j = await (await getLedger()).json();
    expect(j.total.value).toBe(2500);
    expect(j.agregado.value.totalVolume).toBe(5000);
    expect(j.agregado.value.byKind.dex_swap.count + j.agregado.value.byKind.cex.count).toBe(2500);
    expect(j.agregado.state).toBe("ok");
    expect(j.agregado.quality).toBe("declared");
  });
  it("⚠️ banco fora → 503, sem 'No operations recorded yet.' de zero", async () => {
    s.falhar.add("operations");
    const r = await getLedger();
    expect(r.status).toBe(503);
    expect((await r.json()).total.state).toBe("unavailable");
  });
  it("livro vazio de verdade → total ZERO (não indisponível)", async () => {
    s.tabelas.operations = [];
    const j = await (await getLedger()).json();
    expect(j.total.state).toBe("zero");
    expect(j.agregado.state).toBe("empty");
  });
});

describe("P1-15/16 · /stats — quatro painéis sem `?? 0`", () => {
  it("1.500 sessões: PNL e corretoras somam todas (antes: recorte de 1.000)", async () => {
    s.tabelas.autopilot_sessions = Array.from({ length: 1500 }, (_, i) => ({ id: id(i), pnl_today: 1, exchange_id: i < 1200 ? "binance" : "okx", is_active: i === 1499 }));
    s.tabelas.users = []; s.tabelas.tier_cache = []; s.tabelas.autopilot_runs = [];
    const j = await (await getStats()).json();
    expect(j.autopilot.pnlToday.value).toBe(1500);
    expect(j.cex.byExchange.value.okx).toEqual({ total: 300, active: 1 });
    expect(j.autopilot.sessionsActive.value).toBe(1);
  });
  it("⚠️ autopilot_sessions fora → sessões/PNL/corretoras INDISPONÍVEIS (null), resto segue; estado parcial", async () => {
    s.tabelas.users = [{ id: id(1), wallet_chain: "solana", last_seen_at: "2099" }];
    s.tabelas.tier_cache = []; s.tabelas.autopilot_runs = [];
    s.falhar.add("autopilot_sessions");
    const r = await getStats();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.estado).toBe("parcial");
    for (const m of [j.autopilot.sessions, j.autopilot.sessionsActive, j.autopilot.pnlToday, j.cex.byExchange]) {
      expect(m.state).toBe("unavailable");
      expect(m.value).toBeNull();
    }
    expect(j.wallets.total.value).toBe(1);
  });
  it("tudo fora → 503 com estado indisponível", async () => {
    for (const t of ["users", "tier_cache", "autopilot_sessions", "autopilot_runs"]) s.falhar.add(t);
    const r = await getStats();
    expect(r.status).toBe(503);
    expect((await r.json()).estado).toBe("indisponivel");
  });
});
