import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { abrirPosicao, fecharPosicao, varrerAbertas, aplicarMutacao, type PosicaoAberta } from "./store";
import { investigar } from "./investigar";
import { medicaoComparavel, limitacaoDaMedicao } from "./validade-medicao";
import { runTournamentCull } from "@/lib/zion/cull";

vi.mock("@/lib/admin/track", () => ({ recordEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => {
  throw new Error("no database during calibration");
} }));

describe("incomplete model containment", () => {
  const access = vi.fn(() => { throw new Error("unexpected DB access"); });
  const db = { from: access, rpc: access } as unknown as SupabaseClient;
  it.each(["colheita_funding", "convergencia_base", "pool_novo"])("contains %s at the writer as well as the cron", async agente => {
    access.mockClear();
    const pos = { agente } as PosicaoAberta;
    expect(await abrirPosicao(db, pos, 1)).toBeNull();
    expect(await fecharPosicao(db, pos, {} as Parameters<typeof fecharPosicao>[2]))
      .toMatchObject({ fechou: false, porque: limitacaoDaMedicao(agente) });
    expect(await varrerAbertas(db, agente, () => 120, Date.now())).toEqual([]);
    expect(await aplicarMutacao(db, "test", agente, {}, "test", "test"))
      .toMatchObject({ ok: false, motivo: "impossivel" });
    expect(access).not.toHaveBeenCalled();
  });
  it("continues to distinguish the remaining simulated models", () => {
    expect(medicaoComparavel("cacador_de_tendencia")).toBe(true);
    expect(medicaoComparavel("aluguel_ocioso")).toBe(true);
  });
  it("does not judge, mutate or call paid models during calibration", async () => {
    access.mockClear();
    const result = await investigar(db);
    expect(result.agentes.length).toBeGreaterThan(0);
    expect(result.agentes.every(a => Boolean(a.pulou))).toBe(true);
    expect(result.placar).toEqual([]);
    expect(access).not.toHaveBeenCalled();
  });
  it("does not crown or cull based on the mixed historical round", async () => {
    await expect(runTournamentCull()).resolves.toEqual({ culled: [], champion: null });
  });
});
