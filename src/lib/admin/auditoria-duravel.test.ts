/**
 * ADM-005 — comando sensível sem trilha não executa (Desenho A, sem migration).
 * Banco falso em memória; nenhum acesso real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const b = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  falharInsert: [] as boolean[],         // fila: true = esta inserção falha
  pendurarInsert: false,
  leituraIdem: { data: [] as unknown[], error: null as unknown },
  semBanco: false,
  eventos: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => b.semBanco ? null : {
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        if (b.pendurarInsert) return new Promise(() => {});
        const falha = b.falharInsert.shift() ?? false;
        if (!falha) b.linhas.push(row);
        return Promise.resolve({ error: falha ? { message: "insert recusado" } : null });
      },
      select: () => {
        const q = { eq: () => q, limit: async () => b.leituraIdem };
        return q;
      },
    }),
  },
}));
vi.mock("@/lib/admin/track", () => ({
  recordEvent: vi.fn(async (_t: string, e: unknown) => { b.eventos.push(e); }),
  notifyTelegram: vi.fn(),
}));

import { comandoAuditado, registrarAuditoria } from "./auditoria-duravel";

beforeEach(() => {
  b.linhas = []; b.falharInsert = []; b.pendurarInsert = false; b.semBanco = false; b.eventos = [];
  b.leituraIdem = { data: [], error: null };
});
afterEach(() => vi.clearAllMocks());

const fase = (i: number) => (b.linhas[i]?.payload as { fase?: string } | undefined)?.fase;

describe("ADM-005 · sem a intenção gravada, o comando NÃO roda", () => {
  it("insert da intenção recusado → recusado, e executar nunca é chamado", async () => {
    b.falharInsert = [true];
    const executar = vi.fn(async () => ({ ok: true as const, valor: 1 }));
    const r = await comandoAuditado({ acao: "killswitch.disable_cex", ator: "0xA", executar });
    expect(r).toMatchObject({ estado: "recusado", erro: "auditoria_indisponivel" });
    expect(executar).not.toHaveBeenCalled();
    expect(JSON.stringify(b.eventos)).toContain("auditoria_indisponivel");
  });

  it("sem banco → recusado; banco pendurado → recusado no teto, nunca executa", async () => {
    b.semBanco = true;
    const executar = vi.fn(async () => ({ ok: true as const, valor: 1 }));
    expect(await comandoAuditado({ acao: "x", ator: "a", executar })).toMatchObject({ estado: "recusado" });
    b.semBanco = false; b.pendurarInsert = true;
    expect(await registrarAuditoria({ ator: "a", acao: "x", fase: "intencao", req: "r" }, 20))
      .toEqual({ ok: false, erro: "tempo_esgotado" });
    expect(executar).not.toHaveBeenCalled();
  });
});

describe("intenção → execução → desfecho", () => {
  it("caminho feliz: intenção e executado, com a mesma correlação", async () => {
    const r = await comandoAuditado({ acao: "admin.grant", ator: "0xA", alvo: "0xB", executar: async () => ({ ok: true, valor: "ok" }) });
    expect(r).toMatchObject({ estado: "executado", valor: "ok", auditoria: "completa" });
    expect([fase(0), fase(1)]).toEqual(["intencao", "executado"]);
    expect((b.linhas[0].payload as { req: string }).req).toBe((b.linhas[1].payload as { req: string }).req);
  });

  it("execução que falha ou LANÇA vira `falhou` registrado — nunca sucesso", async () => {
    const r1 = await comandoAuditado({ acao: "a", ator: "x", executar: async () => ({ ok: false, codigo: "escrita_recusada" }) });
    expect(r1).toMatchObject({ estado: "falhou", codigo: "escrita_recusada" });
    const r2 = await comandoAuditado({ acao: "a", ator: "x", executar: async () => { throw new Error("boom"); } });
    expect(r2).toMatchObject({ estado: "falhou", codigo: "excecao" });
    expect(b.linhas.map((_, i) => fase(i))).toEqual(["intencao", "falhou", "intencao", "falhou"]);
  });

  it("desfecho que não grava: o resultado REAL volta, marcado, e vira alerta alto", async () => {
    b.falharInsert = [false, true];
    const r = await comandoAuditado({ acao: "a", ator: "x", executar: async () => ({ ok: true, valor: 7 }) });
    expect(r).toMatchObject({ estado: "executado", valor: 7, auditoria: "desfecho_nao_gravado" });
    expect(JSON.stringify(b.eventos)).toContain("auditoria_desfecho_nao_gravado");
  });
});

describe("idempotência", () => {
  it("chave já executada → `repetido` e não executa de novo", async () => {
    b.leituraIdem = { data: [{ id: "anterior" }], error: null };
    const executar = vi.fn(async () => ({ ok: true as const, valor: 1 }));
    expect(await comandoAuditado({ acao: "a", ator: "x", idem: "k1", executar }))
      .toMatchObject({ estado: "repetido", anterior: "anterior" });
    expect(executar).not.toHaveBeenCalled();
  });

  it("leitura da idempotência falhou → recusado (falha de leitura não é 'nunca rodou')", async () => {
    b.leituraIdem = { data: [], error: { message: "x" } };
    const executar = vi.fn(async () => ({ ok: true as const, valor: 1 }));
    expect(await comandoAuditado({ acao: "a", ator: "x", idem: "k1", executar })).toMatchObject({ estado: "recusado" });
    expect(executar).not.toHaveBeenCalled();
  });
});
