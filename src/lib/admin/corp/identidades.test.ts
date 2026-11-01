/**
 * R1 — /admin/api/identidades: convite, revogação e papéis com as invariantes do desenho §4.8/§7.
 * Repositório falso; trilha durável mockada (gravando). Nada real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const s = vi.hoisted(() => ({
  ator: { wallet: "corp:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fonte: "corp" as string },
  ids: [] as Record<string, unknown>[], papeis: [] as Record<string, unknown>[], trilha: [] as string[], fora: false,
}));
vi.mock("@/lib/admin/authz", () => ({ autorizarAdmin: async () => s.ator }));
vi.mock("@/lib/admin/auditoria-duravel", () => ({
  PORQUE_AUDITORIA_INDISPONIVEL: "x", avisoDeAuditoria: () => ({}),
  comandoAuditado: async (c: { acao: string; executar: () => Promise<{ ok: boolean; valor?: unknown; codigo?: string }> }) => {
    s.trilha.push(c.acao);
    const d = await c.executar();
    return d.ok ? { estado: "executado", valor: d.valor, auditoria: "completa", req: "r" } : { estado: "falhou", codigo: d.codigo, auditoria: "completa", req: "r" };
  },
}));
vi.mock("@/lib/admin/corp/repo", () => ({
  repoCorp: () => ({
    listarIdentidades: async () => (s.fora ? { ok: false, erro: "fora" } : { ok: true, valor: s.ids.map((i) => ({ ...i, papeis: s.papeis.filter((p) => p.identity_id === i.id && !p.revoked_at) })) }),
    convidar: async (i: { email: string; codigoHash: Buffer }) => { const id = crypto.randomUUID(); s.ids.push({ id, status: "invited", email_normalized: i.email, hash: i.codigoHash.toString("hex") }); return { ok: true, valor: id }; },
    revogarIdentidade: async (id: string) => { const i = s.ids.find((x) => x.id === id); if (i) i.status = "revoked"; return { ok: true, valor: !!i }; },
    revogarTodasDaIdentidade: async () => ({ ok: true, valor: 1 }),
    concederPapel: async (iid: string, role: string) => { const id = crypto.randomUUID(); s.papeis.push({ id, identity_id: iid, role }); return { ok: true, valor: id }; },
    revogarPapel: async (aid: string) => { const p = s.papeis.find((x) => x.id === aid); if (p) p.revoked_at = "t"; return { ok: true, valor: !!p }; },
  }),
}));

import { GET, POST } from "@/app/admin/api/identidades/route";

const EU = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OUTRO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const post = (b: unknown) => POST(new NextRequest("https://z.test/admin/api/identidades", { method: "POST", body: JSON.stringify(b) }));
beforeEach(() => {
  s.ator = { wallet: `corp:${EU}`, fonte: "corp" }; s.trilha = []; s.fora = false;
  s.ids = [{ id: EU, status: "active", email_normalized: "eu@e.com" }, { id: OUTRO, status: "active", email_normalized: "outro@e.com" }];
  s.papeis = [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", identity_id: EU, role: "superadmin" }];
});

describe("convite", () => {
  it("devolve o código de ativação UMA vez; o banco guarda só o sha256", async () => {
    const r = await post({ acao: "convidar", email: " Nova@Empresa.com ", provider: "google", issuer: "https://accounts.google.com", tenant: "empresa.com" });
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(typeof j.codigoAtivacao).toBe("string");
    const linha = s.ids.find((i) => i.email_normalized === "nova@empresa.com")!;
    expect(linha.hash).toBe(createHash("sha256").update(j.codigoAtivacao).digest("hex"));
    expect(JSON.stringify(await (await GET()).json())).not.toContain(j.codigoAtivacao);
  });
  it("legado que não é ADMIN_WALLETS (fonte panel/tier) NÃO convida; env (bootstrap) convida", async () => {
    s.ator = { wallet: "0xpanel", fonte: "panel" };
    expect((await post({ acao: "convidar", email: "x@e.com", provider: "google", issuer: "https://accounts.google.com", tenant: "e.com" })).status).toBe(403);
    s.ator = { wallet: "0xenv", fonte: "env" };
    expect((await post({ acao: "convidar", email: "x@e.com", provider: "google", issuer: "https://accounts.google.com", tenant: "e.com" })).status).toBe(200);
  });
});

describe("papéis — sem autoelevação, dupla autorização e último superadmin (ADM-009)", () => {
  it("ninguém concede papel a si", async () => {
    expect((await post({ acao: "conceder", id: EU, papel: "operations" })).status).toBe(409);
  });
  it("superadmin/security_admin exigem segunda pessoa → 409 (runbook SQL)", async () => {
    for (const papel of ["superadmin", "security_admin"]) {
      const r = await post({ acao: "conceder", id: OUTRO, papel });
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe("dupla_autorizacao");
    }
    expect(s.papeis.filter((p) => p.identity_id === OUTRO)).toHaveLength(0);
  });
  it("papel comum para outra pessoa → concedido com trilha", async () => {
    expect((await post({ acao: "conceder", id: OUTRO, papel: "auditor" })).status).toBe(200);
    expect(s.trilha).toContain("roles.grant");
  });
  it("⚠️ não tira o ÚLTIMO superadmin nem o próprio superadmin; não revoga a si", async () => {
    expect((await post({ acao: "revogar_papel", atribuicao: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", motivo: "teste longo" })).status).toBe(409);
    expect((await post({ acao: "revogar", id: EU, motivo: "teste longo" })).status).toBe(409);
    s.ator = { wallet: `corp:${OUTRO}`, fonte: "corp" };
    const r = await post({ acao: "revogar", id: EU, motivo: "teste longo" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("ultimo_superadmin");
  });
  it("banco ilegível ao conferir superadmins → 503 e NADA muda", async () => {
    s.fora = true;
    expect((await post({ acao: "revogar", id: OUTRO, motivo: "teste longo" })).status).toBe(503);
    expect(s.ids.find((i) => i.id === OUTRO)?.status).toBe("active");
  });
});
