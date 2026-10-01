import { describe, expect, it, vi } from "vitest";
import { executarFilasDca, type ItemFilaDca } from "@/lib/dca/fila";

type Plano = { id: string; status: "ativo" | "pausado" | "encerrado" | "completo" };

const ok = (planos: Plano[]) => ({ ok: true as const, planos, truncado: false });
const erro = (motivo: string) => ({ ok: false as const, erro: motivo });

describe("Batch 2 revisão / A58 — recovery atravessa passadas", () => {
  it("auth -> pause -> UNKNOWN -> passada seguinte continua elegível a recovery e não cria ordem nova", async () => {
    /**
     * ⚠️ Esta versão contava `novosIntents`/`novasOrdens` incrementados pelo
     * PRÓPRIO callback do teste — o resultado era comparado com ele mesmo.
     * Agora mede só o que o orquestrador decide: em qual fila o plano chega,
     * com qual bandeira, e quantas vezes. Que `somenteRecovery` nunca vira
     * ordem é medido na rota real (`cron-queue-health.test.ts`).
     */
    const plano: Plano = { id: "p1", status: "ativo" };

    // Passada 1: plano ativo e vencido, só na fila ativa.
    const p1 = vi.fn(async (_item: ItemFilaDca<Plano>) => "primeira");
    const primeira = await executarFilasDca({
      lerAtivos: async () => ok([plano]),
      lerRecovery: async () => ok([]),
      processar: p1,
      aoFalharProcessamento: () => "erro",
    });
    expect(primeira).toMatchObject({ ok: true, processed: 1 });
    expect(p1).toHaveBeenCalledTimes(1);
    expect(p1.mock.calls[0]?.[0]).toEqual({ plano, somenteRecovery: false });

    // Entre as passadas: a auth marcou SUBMITTING, o dono pausou, a venue
    // ficou UNKNOWN. O plano sai da fila ativa e fica só na de recovery.
    plano.status = "pausado";

    const p2 = vi.fn(async (_item: ItemFilaDca<Plano>) => "reconciliado");
    const segunda = await executarFilasDca({
      lerAtivos: async () => ok([]),
      lerRecovery: async () => ok([plano]),
      processar: p2,
      aoFalharProcessamento: () => "erro",
    });
    expect(segunda).toMatchObject({ ok: true, status: 200, processed: 1, resumo: ["reconciliado"] });
    expect(p2).toHaveBeenCalledTimes(1);
    expect(p2.mock.calls[0]?.[0]).toEqual({ plano: { id: "p1", status: "pausado" }, somenteRecovery: true });
  });

  it("deduplica plano que aparece simultaneamente na fila ativa e de recovery", async () => {
    const plano: Plano = { id: "p1", status: "ativo" };
    // O parâmetro é declarado para o `tsc`: sem ele o `vi.fn` nasce
    // `() => Promise<string>`, `mock.calls` vira `[][]` e a leitura de
    // `calls[0][0]` abaixo não compila (TS2493/TS2532).
    const processar = vi.fn(async (_item: ItemFilaDca<Plano>) => "ok");
    const r = await executarFilasDca({
      lerAtivos: async () => ok([plano]),
      lerRecovery: async () => ok([plano]),
      processar,
      aoFalharProcessamento: () => "erro",
    });
    expect(r).toMatchObject({ ok: true, processed: 1 });
    expect(processar).toHaveBeenCalledTimes(1);
    expect(processar.mock.calls[0]?.[0].somenteRecovery).toBe(false);
  });
});

describe("Batch 2 revisão / A86 — integração da fila com status HTTP", () => {
  it("erro da fila ativa => 503/unhealthy, processed=0 e zero processamento", async () => {
    const processar = vi.fn(async () => "nunca");
    const r = await executarFilasDca({
      lerAtivos: async () => erro("consulta_falhou"),
      lerRecovery: async () => ok([]),
      processar,
      aoFalharProcessamento: () => "erro",
    });
    expect(r).toEqual({
      ok: false, status: 503, error: "fila_indisponivel", origem: "ativa",
      motivo: "consulta_falhou", detalhe: undefined,
      processed: 0, truncado: false, resumo: [],
    });
    expect(processar).not.toHaveBeenCalled();
  });

  it("erro da fila de recovery também => 503 e zero processamento", async () => {
    const processar = vi.fn(async () => "nunca");
    const r = await executarFilasDca({
      lerAtivos: async () => ok([]),
      lerRecovery: async () => erro("sem_banco"),
      processar,
      aoFalharProcessamento: () => "erro",
    });
    expect(r).toMatchObject({
      ok: false, status: 503, error: "fila_indisponivel", origem: "recovery", processed: 0,
    });
    expect(processar).not.toHaveBeenCalled();
  });

  it("duas filas vazias legítimas continuam healthy", async () => {
    const processar = vi.fn(async () => "nunca");
    const r = await executarFilasDca({
      lerAtivos: async () => ok([]),
      lerRecovery: async () => ok([]),
      processar,
      aoFalharProcessamento: () => "erro",
    });
    expect(r).toEqual({ ok: true, status: 200, processed: 0, truncado: false, resumo: [] });
    expect(processar).not.toHaveBeenCalled();
  });
});
