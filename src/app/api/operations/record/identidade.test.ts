/**
 * W3 · revisão independente (21/10) — ISOLAMENTO DE IDENTIDADE no livro de operações.
 *
 * Antes: o servidor gravava toda operação na carteira da SESSÃO, e o navegador sincronizava com
 * "a carteira atual" (Solana primeiro) — registro legado, ou EVM com as duas conectadas, ia para a
 * identidade errada. Agora a identidade vem da ORIGEM do registro, conferida contra a sessão.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ sessao: null as null | { sub: string }, gravados: [] as Record<string, unknown>[] }));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => s.sessao }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ ok: true }), getClientId: () => "ip" }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ upsert: async (row: Record<string, unknown>) => { s.gravados.push(row); return { error: null }; } }) }),
}));

import { POST } from "@/app/api/operations/record/route";
import { pendentesParaSincronizar } from "@/lib/hooks/useOperationSync";
import type { TxHistoryEntry } from "@/lib/store/txHistory";

const A = "H7zwzP8PDfcp6ZQ4bd4zmXFRSpgwAYxjU7voJXMCKL5T";
const B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EVM = "0x" + "a".repeat(40);
const enviar = (corpo: Record<string, unknown>) => POST(new NextRequest("http://localhost/api/operations/record", {
  method: "POST", body: JSON.stringify({ kind: "dex_swap", status: "confirmed", ref: "r1", volumeUsd: 10, ...corpo }),
}));
beforeEach(() => { s.sessao = null; s.gravados = []; });

describe("servidor · /api/operations/record", () => {
  it("registro da carteira A com sessão de A → atribuído a A", async () => {
    s.sessao = { sub: A };
    expect((await enviar({ wallet: A })).status).toBe(200);
    expect(s.gravados[0].wallet_address).toBe(A);
  });

  it("⚠️ registro da carteira A com sessão de B → NÃO grava (409); nunca vira operação de B", async () => {
    s.sessao = { sub: B };
    const r = await enviar({ wallet: A });
    expect(r.status).toBe(409);
    expect(s.gravados).toHaveLength(0);
  });

  it("⚠️ registro LEGADO sem carteira, com sessão de A → grava SEM atribuição (não vira de A)", async () => {
    s.sessao = { sub: A };
    expect((await enviar({})).status).toBe(200);
    expect(s.gravados[0].wallet_address).toBeNull();
  });

  it("sem sessão (logout) → grava sem atribuição, mesmo declarando carteira", async () => {
    expect((await enviar({ wallet: A })).status).toBe(200);
    expect(s.gravados[0].wallet_address).toBeNull();
  });

  it("EVM: endereço com maiúsculas/minúsculas diferentes da sessão → mesma identidade", async () => {
    s.sessao = { sub: EVM.toUpperCase().replace("0X", "0x") };
    expect((await enviar({ wallet: EVM })).status).toBe(200);
    expect(s.gravados[0].wallet_address).toBe(s.sessao.sub);
  });
});

const reg = (id: string, wallet?: string, status: TxHistoryEntry["status"] = "confirmed") =>
  ({ id, ts: 1, type: "dex_swap", status, wallet, fromSymbol: "SOL", fromChain: "solana", fromAmount: "1", toSymbol: "USDC", toChain: "solana" }) as TxHistoryEntry;

describe("navegador · o que sobe e com qual identidade", () => {
  const entradas = [reg("a1", A), reg("b1", B), reg("e1", EVM), reg("leg"), reg("pend", A, "pending")];

  it("só A conectada → A e legado (sem identidade); B e EVM esperam", () => {
    expect(pendentesParaSincronizar(entradas, new Set(), [A]).map((e) => e.id)).toEqual(["a1", "leg"]);
  });

  it("⚠️ Solana A + EVM conectadas → a operação EVM sobe como EVM (não como Solana) e a de A como A", async () => {
    const sobem = pendentesParaSincronizar(entradas, new Set(), [A, EVM]);
    expect(sobem.map((e) => [e.id, e.wallet ?? null])).toEqual([["a1", A], ["e1", EVM], ["leg", null]]);
  });

  it("troca para B → só B (e A fica guardada, sem ser apagada)", () => {
    expect(pendentesParaSincronizar(entradas, new Set(["leg"]), [B]).map((e) => e.id)).toEqual(["b1"]);
    expect(entradas.find((e) => e.id === "a1")).toBeDefined();
  });

  it("logout (nada conectado) → só registros sem identidade; nunca pending; já sincronizados não repetem", () => {
    expect(pendentesParaSincronizar(entradas, new Set(), []).map((e) => e.id)).toEqual(["leg"]);
    expect(pendentesParaSincronizar(entradas, new Set(["a1", "leg"]), [A]).map((e) => e.id)).toEqual([]);
  });

  it("reconexão de A depois → o registro de A sobe nessa hora", () => {
    expect(pendentesParaSincronizar(entradas, new Set(["leg"]), [A]).map((e) => e.id)).toEqual(["a1"]);
  });
});
