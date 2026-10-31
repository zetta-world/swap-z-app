/**
 * P0 do Admin CC 2.0 (25/10): autorizar/remover piloto com a lista ILEGÍVEL
 * regravava a lista só com a carteira nova — apagando os outros pilotos.
 *
 * Aqui a rota é exercida com `lerPilotosConferido`/`gravarPilotos` falsos:
 *   · leitura falhou → 503 e NENHUMA gravação, nem trilha de execução;
 *   · conflito na gravação (outro admin mudou) → 409, nada sobrescrito;
 *   · GET com leitura falha → `pilotosLidos:false`, nunca "nenhum piloto" mudo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  leitura: { ok: true, lista: [] as unknown[], bruto: null as string | null, versao: { existe: false, updatedAt: null as string | null } } as
    { ok: true; lista: unknown[]; bruto: string | null; versao: { existe: boolean; updatedAt: string | null } } | { ok: false; erro: string },
  gravar: vi.fn(async (..._a: unknown[]) => ({ ok: true }) as { ok: true } | { ok: false; erro: string }),
  comando: vi.fn(),
}));

vi.mock("@/lib/admin/require", () => ({ requireAdmin: async () => ({ wallet: "0xadmin" }) }));
vi.mock("@/lib/admin/realtime", () => ({ broadcastAdminRefresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => null }));
vi.mock("@/lib/admin/auditoria-duravel", () => ({
  PORQUE_AUDITORIA_INDISPONIVEL: "x",
  avisoDeAuditoria: () => ({}),
  comandoAuditado: async (c: { executar: () => Promise<{ ok: boolean; valor?: unknown; codigo?: string }> }) => {
    s.comando(c);
    const r = await c.executar();
    return r.ok ? { estado: "executado", valor: r.valor, auditoria: "completa" }
                : { estado: "falhou", codigo: r.codigo, auditoria: "completa" };
  },
}));
vi.mock("@/lib/autopilot/liberacao", async (orig) => ({
  ...(await orig<typeof import("./liberacao")>()),
  lerLiberacao: async () => ({ liberado: false, causa: "sem_registro", motivo: null, desde: null }),
  lerPilotosConferido: async () => s.leitura,
  gravarPilotos: (...a: unknown[]) => s.gravar(...a),
}));

const { GET, POST } = await import("@/app/admin/api/autopilot-liberacao/route");
const req = (body: unknown) =>
  new Request("http://x/admin/api/autopilot-liberacao", { method: "POST", body: JSON.stringify(body) });

const NOTA = "carteira de teste do dono, valor pequeno";

beforeEach(() => {
  s.leitura = { ok: true, lista: [{ wallet: "0xaaaaaaaaaa", nota: "n", at: "t" }], bruto: "[raw]", versao: { existe: true, updatedAt: "2026-10-25T12:00:00.000Z" } };
  s.gravar.mockReset().mockResolvedValue({ ok: true });
  s.comando.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("pilotos — leitura falha NÃO apaga ninguém", () => {
  it("autorizar com a lista ilegível → 503, sem gravar e sem executar comando", async () => {
    s.leitura = { ok: false, erro: "leitura_falhou" };
    const r = await POST(req({ piloto: "0xbbbbbbbbbb", motivo: NOTA }) as never);
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe("pilotos_ilegiveis");
    expect(s.gravar).not.toHaveBeenCalled();
    expect(s.comando).not.toHaveBeenCalled();
  });

  it("remover com a lista ilegível → 503, sem gravar", async () => {
    s.leitura = { ok: false, erro: "valor_ilegivel" };
    const r = await POST(req({ remover: "0xaaaaaaaaaa" }) as never);
    expect(r.status).toBe(503);
    expect(s.gravar).not.toHaveBeenCalled();
  });

  it("autorizar com lista lida → grava a lista ANTIGA + a nova, condicionada ao valor lido", async () => {
    const r = await POST(req({ piloto: "0xBBBBBBBBBB", motivo: NOTA }) as never);
    expect(r.status).toBe(200);
    const [lista, anterior] = s.gravar.mock.calls[0] as [Array<{ wallet: string }>, { existe: boolean; updatedAt: string }];
    expect(lista.map((p) => p.wallet)).toEqual(["0xaaaaaaaaaa", "0xbbbbbbbbbb"]);
    // CAS pela VERSÃO lida (updated_at), nunca pela lista inteira na URL
    expect(anterior).toEqual({ existe: true, updatedAt: "2026-10-25T12:00:00.000Z" });
  });

  it("outro admin mudou a lista entre leitura e gravação → 409", async () => {
    s.gravar.mockResolvedValue({ ok: false, erro: "conflito" });
    const r = await POST(req({ remover: "0xaaaaaaaaaa" }) as never);
    expect(r.status).toBe(409);
  });

  it("GET com leitura falha → pilotosLidos:false + erro (não 'nenhum piloto')", async () => {
    s.leitura = { ok: false, erro: "leitura_falhou" };
    const j = await (await GET()).json();
    expect(j.pilotosLidos).toBe(false);
    expect(j.pilotosErro).toBe("leitura_falhou");
  });
});
