/**
 * R3/P2 (Admin CC 2.0) — o GET do laboratório sincroniza o registro do código com o banco a cada
 * sondagem. Só pode ESCREVER o que mudou; sem mudança, nenhuma escrita.
 */
import { describe, expect, it } from "vitest";
import { syncRegistry } from "@/lib/lab/store";
import { LAB_STRATEGIES } from "@/lib/lab/registry";

function bancoCom(gravadas: Record<string, unknown>[] | null, erro = false) {
  const escritas: unknown[][] = [];
  const db = {
    from: () => ({
      select: () => ({ limit: async () => (erro ? { data: null, error: { message: "fora" } } : { data: gravadas, error: null }) }),
      upsert: async (rows: unknown[]) => { escritas.push(rows); return { error: null }; },
    }),
  };
  return { db: db as never, escritas };
}
const comoGravado = () => LAB_STRATEGIES.map((s) => ({
  slug: s.slug, name: s.name, subtitle: s.subtitle, family: s.family, capital_required_usd: s.capitalRequiredUsd,
  capital_why: s.capitalWhy, status: s.status, hypothesis: s.hypothesis ?? null, killed_why: s.killedWhy ?? null,
  not_measurable_why: s.notMeasurableWhy ?? null, measured_elsewhere: s.measuredElsewhere ?? null,
  disagrees_with_ledger_why: s.discordaDoLivroPorque ?? null,
}));

describe("syncRegistry só escreve o que mudou", () => {
  it("banco igual ao código → NENHUMA escrita", async () => {
    const { db, escritas } = bancoCom(comoGravado());
    expect(await syncRegistry(db)).toEqual({ synced: 0 });
    expect(escritas).toHaveLength(0);
  });
  it("uma estratégia com status diferente → escreve só ela", async () => {
    const g: Record<string, unknown>[] = comoGravado(); g[0] = { ...g[0], status: "outro" };
    const { db, escritas } = bancoCom(g);
    expect(await syncRegistry(db)).toEqual({ synced: 1 });
    expect((escritas[0] as { slug: string }[]).map((r) => r.slug)).toEqual([LAB_STRATEGIES[0].slug]);
  });
  it("estratégia nova no código (ausente no banco) → escreve", async () => {
    const g = comoGravado().slice(1);
    const { db } = bancoCom(g);
    expect((await syncRegistry(db)).synced).toBe(1);
  });
  it("leitura falhou → grava tudo (comportamento anterior; o código é a fonte)", async () => {
    const { db } = bancoCom(null, true);
    expect((await syncRegistry(db)).synced).toBe(LAB_STRATEGIES.length);
  });
  it("número vindo do banco como texto (numeric) não conta como mudança", async () => {
    const g = comoGravado().map((r) => ({ ...r, capital_required_usd: String(r.capital_required_usd) }));
    const { db, escritas } = bancoCom(g);
    expect((await syncRegistry(db)).synced).toBe(0);
    expect(escritas).toHaveLength(0);
  });
});
