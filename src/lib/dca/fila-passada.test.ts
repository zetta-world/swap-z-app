import { describe, expect, it, vi } from "vitest";
import { executarFilasDca, type ItemFilaDca } from "@/lib/dca/fila";

type Plano = { id: string; status: "ativo" | "pausado" | "encerrado" | "completo" };

const ok = (planos: Plano[]) => ({ ok: true as const, planos, truncado: false });
const erro = (motivo: string) => ({ ok: false as const, erro: motivo });

describe("Batch 2 revisão / A58 — recovery atravessa passadas", () => {
  it("auth -> pause -> UNKNOWN -> passada seguinte continua elegível a recovery e não cria ordem nova", async () => {
    const plano: Plano = { id: "p1", status: "ativo" };
    let intent: "nenhum" | "SUBMITTING" | "UNKNOWN" = "nenhum";
    let novosIntents = 0;
    let novasOrdens = 0;
    let recoveries = 0;

    // Passada 1: o plano estava ativo, a final auth venceu a corrida e marcou
    // SUBMITTING; depois disso o usuário pausou e a chamada externa ficou UNKNOWN.
    const primeira = await executarFilasDca({
      lerAtivos: async () => ok([plano]),
      lerRecovery: async () => ok([]),
      processar: async ({ somenteRecovery }) => {
        expect(somenteRecovery).toBe(false);
        novosIntents += 1;
        intent = "SUBMITTING";
        novasOrdens += 1;
        plano.status = "pausado";
        intent = "UNKNOWN";
        return "primeira";
      },
      aoFalharProcessamento: () => "erro",
    });
    expect(primeira.ok).toBe(true);
    expect(novosIntents).toBe(1);
    expect(novasOrdens).toBe(1);
    expect(plano.status).toBe("pausado");
    expect(intent).toBe("UNKNOWN");

    // Passada 2: a fila normal está vazia porque o plano está pausado, mas a
    // fila independente de recovery ainda o entrega. O processamento é marcado
    // `somenteRecovery`, então nenhuma nova ordem pode nascer.
    const segunda = await executarFilasDca({
      lerAtivos: async () => ok([]),
      lerRecovery: async () => ok(intent === "UNKNOWN" ? [plano] : []),
      processar: async ({ plano: recebido, somenteRecovery }) => {
        expect(recebido.status).toBe("pausado");
        expect(somenteRecovery).toBe(true);
        recoveries += 1;
        intent = "nenhum";
        return "reconciliado";
      },
      aoFalharProcessamento: () => "erro",
    });

    expect(segunda).toMatchObject({ ok: true, status: 200, processed: 1 });
    expect(recoveries).toBe(1);
    expect(novosIntents).toBe(1); // nenhum intent novo na segunda passada
    expect(novasOrdens).toBe(1);  // nenhuma ordem nova na segunda passada
    expect(plano.status).toBe("pausado");
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
