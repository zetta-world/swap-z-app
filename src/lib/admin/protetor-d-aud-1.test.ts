/**
 * D-AUD-1 (decisão do dono, 31/10/2026) — nas ROTAS: com a trilha de auditoria FORA, só o comando
 * PROTETOR executa (ligar kill switch/gate, remover piloto, fechar a liberação), com alerta alto e
 * `auditoria: "intencao_nao_gravada"` na resposta. O permissivo (desligar, autorizar, liberar) segue 503.
 * Banco falso em memória; nenhum acesso real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({
  trilhaFora: true, kv: new Map<string, string>(), eventos: [] as unknown[],
  pilotos: [{ wallet: "0xpiloto000000000000000000000000000000001", nota: "n", at: "t" }],
  gravouPilotos: null as unknown, liberacao: null as boolean | null,
}));
vi.mock("@/lib/admin/authz", () => ({ autorizarAdmin: async () => ({ wallet: "0xadmin" }) }));
vi.mock("@/lib/admin/realtime", () => ({ broadcastAdminRefresh: () => {} }));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: () => {}, notifyTelegram: () => {},
  recordEvent: async (_t: string, e: unknown) => { s.eventos.push(e); },
}));
vi.mock("@/lib/admin/kill-switches", async (orig) => ({
  ...(await orig<typeof import("./kill-switches")>()),
  lerInterruptores: async (keys: string[]) => ({
    lido: true, asOf: "x",
    linhas: new Map(keys.filter((k) => s.kv.has(k)).map((k) => [k, { key: k, value: s.kv.get(k)!, updated_at: null }])),
  }),
}));
vi.mock("@/lib/autopilot/liberacao", () => ({
  MIN_MOTIVO: 10,
  lerLiberacao: async () => ({ liberado: s.liberacao }),
  registrarLiberacao: async (v: boolean) => { s.liberacao = v; return { ok: true }; },
  lerPilotosConferido: async () => ({ ok: true, lista: s.pilotos, versao: "v1" }),
  gravarPilotos: async (nova: unknown) => { s.gravouPilotos = nova; return { ok: true }; },
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      if (t === "admin_audit_log") {
        return {
          insert: async () => ({ error: s.trilhaFora ? { message: "trilha fora" } : null }),
          select: () => { const q = { eq: () => q, limit: async () => ({ data: [], error: s.trilhaFora ? { message: "fora" } : null }) }; return q; },
        };
      }
      // admin_kv
      const escrever = (row: { key?: string; value: string }) => {
        const q = {
          eq: (c: string, v: string) => { if (c === "key") (q as { k?: string }).k = v; return q; },
          select: async () => { const k = (q as { k?: string }).k ?? row.key!; s.kv.set(k, row.value); return { data: [{ key: k }], error: null }; },
        };
        return q;
      };
      return { update: escrever, upsert: (row: { key: string; value: string }) => escrever(row) };
    },
  }),
}));

import { POST as postKill } from "@/app/admin/api/killswitch/route";
import { POST as postLib } from "@/app/admin/api/autopilot-liberacao/route";

const req = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { s.trilhaFora = true; s.kv = new Map([["disable_swap", "false"]]); s.eventos = []; s.gravouPilotos = null; s.liberacao = null; });

describe("D-AUD-1 · kill switch / gate com a trilha fora", () => {
  it("LIGAR (protetor) → executa: grava true, 200, `intencao_nao_gravada`, alerta alto", async () => {
    const r = await postKill(req("http://x/admin/api/killswitch", { key: "disable_swap", enabled: true, esperado: false, idem: "c1" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, enabled: true, auditoria: "intencao_nao_gravada" });
    expect(s.kv.get("disable_swap")).toBe("true");
    expect(JSON.stringify(s.eventos)).toContain("auditoria_indisponivel_protetor_executa");
  });

  it("gate `pause_*` ligando também é protetor", async () => {
    s.kv.set("pause_dca", "false");
    const r = await postKill(req("http://x/admin/api/killswitch", { key: "pause_dca", enabled: true, esperado: false }));
    expect(r.status).toBe(200);
    expect(s.kv.get("pause_dca")).toBe("true");
  });

  it("⚠️ DESLIGAR (permissivo) → 503 e NADA muda", async () => {
    s.kv.set("disable_swap", "true");
    const r = await postKill(req("http://x/admin/api/killswitch", { key: "disable_swap", enabled: false, esperado: true, idem: "c2" }));
    expect(r.status).toBe(503);
    expect(s.kv.get("disable_swap")).toBe("true");
  });

  it("com a trilha funcionando, ligar volta a `completa` (sem marca)", async () => {
    s.trilhaFora = false;
    const j = await (await postKill(req("http://x/admin/api/killswitch", { key: "disable_swap", enabled: true, esperado: false }))).json();
    expect(j.ok).toBe(true);
    expect(j.auditoria).toBeUndefined();
  });
});

describe("D-AUD-1 · automação com a trilha fora", () => {
  it("REMOVER piloto (protetor) → executa", async () => {
    const r = await postLib(req("http://x/admin/api/autopilot-liberacao", { remover: s.pilotos[0].wallet }));
    expect(r.status).toBe(200);
    expect(s.gravouPilotos).toEqual([]);
  });
  it("⚠️ AUTORIZAR piloto (permissivo) → 503, nada gravado", async () => {
    const r = await postLib(req("http://x/admin/api/autopilot-liberacao", { piloto: "0xnovo0000000000000000000000000000000002", motivo: "teste de autorização" }));
    expect(r.status).toBe(503);
    expect(s.gravouPilotos).toBeNull();
  });
  it("FECHAR a liberação (protetor) → executa; ⚠️ LIBERAR (permissivo) → 503", async () => {
    expect((await postLib(req("http://x/admin/api/autopilot-liberacao", { liberar: false }))).status).toBe(200);
    expect(s.liberacao).toBe(false);
    s.liberacao = null;
    expect((await postLib(req("http://x/admin/api/autopilot-liberacao", { liberar: true, motivo: "abrir para teste real" }))).status).toBe(503);
    expect(s.liberacao).toBeNull();
  });
});
