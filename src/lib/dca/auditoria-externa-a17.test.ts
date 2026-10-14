/**
 * AUDITORIA EXTERNA (13/09) — A17, reproduzido pelo cron REAL, de ponta a ponta.
 *
 * Fonte recuperada em 14/10 do histórico local da sessão do auditor
 * (`ACHADOS-EM-VALIDACAO.md`): *"ordem DCA recusada bloqueia a janela seguinte
 * por reutilizar número de ciclo"*. O teste original dele (`dca-failed-cycle.test.ts`)
 * chamava `POST` duas vezes — dia 13 a corretora recusa, dia 14 a mesma
 * passada saía em `ja_em_curso` sem chamar a corretora. Corrigido no #421
 * (`a165d73`); `ciclo-falho-conta.test.ts` trava a aritmética e o texto, e este
 * arquivo trava o COMPORTAMENTO pela rota.
 *
 * Plano simulado, banco e corretora falsos. Nenhuma ordem real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  plano: {} as Record<string, unknown>,
  reservados: new Set<number>(),
  executarOrdemCex: vi.fn(),
  fecharCiclo: vi.fn(async (..._args: unknown[]) => true),
}));

vi.mock("@/lib/dca/store", () => ({
  planosVencidos: async () => ({ ok: true, planos: [{ ...h.plano }], truncado: false }),
  planosComIntentVivoParaRecovery: async () => ({ ok: true, planos: [], truncado: false }),
  reservarCiclo: async (_id: string, n: number) => {
    if (h.reservados.has(n)) return "ja_reservado";
    h.reservados.add(n); return "reservado";
  },
  fecharCiclo: h.fecharCiclo,
  gravarPulo: async () => true,
  gastoHojeDaCarteira: async () => 0,
  avancarPlano: async (_id: string, patch: Record<string, unknown>) => {
    const coluna: Record<string, string> = {
      nextRunAt: "next_run_at", ciclosFeitos: "ciclos_feitos", ciclosPulados: "ciclos_pulados",
      gastoAcumulado: "gasto_acumulado_usd", encerradoPor: "encerrado_por",
    };
    for (const [k, v] of Object.entries(patch)) h.plano[coluna[k] ?? k] = v;
    return true;
  },
}));
vi.mock("@/lib/cex/execucao/executor", () => ({ executarOrdemCex: h.executarOrdemCex }));
vi.mock("@/lib/cex/conexoes", () => ({
  lerConexaoPorId: vi.fn(), decifrarConexao: vi.fn(), credenciaisDoIntentParaRecovery: vi.fn(),
}));
vi.mock("@/lib/cex/execucao/intents", () => ({ intentVivoDoPlano: async () => null, intentPorId: vi.fn() }));
vi.mock("@/lib/cex/execucao/reconciliador", () => ({ reconciliarIntent: vi.fn() }));
vi.mock("@/lib/dca/capacidade", () => ({
  decidirCapacidade: () => ({ permitido: true }), lerCapacidades: async () => ({}),
}));
vi.mock("@/lib/api/cex-spot", () => ({ getCexSpotPrices: async () => new Map([["BTC", { priceUsd: 100 }]]) }));
vi.mock("@/lib/cex/server", () => ({ fetchCexBalance: vi.fn() }));
vi.mock("@/lib/autopilot/liberacao", () => ({
  lerLiberacao: async () => ({}), lerPilotos: async () => [], decidirAutomacao: () => ({ permitido: true }),
}));
vi.mock("@/lib/admin/gates", () => ({ getFlywheelGates: async () => ({ pause_dca: false }) }));
vi.mock("@/lib/admin/health", () => ({ setCronHeartbeat: async () => undefined }));
vi.mock("@/lib/dca/trava", () => ({ pegarATrava: async () => "peguei", soltarATrava: async () => undefined }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: async () => undefined, notifyTelegram: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({}) }));
vi.mock("@/lib/cex/taxa", () => ({ taxaEmUsd: vi.fn() }));

import { POST } from "@/app/api/dca/cron/route";

const req = () => new Request("http://localhost/api/dca/cron", {
  method: "POST", headers: { authorization: "Bearer a17-sintetico" },
}) as Parameters<typeof POST>[0];

describe("A17 · ordem DCA recusada não bloqueia a janela seguinte", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "a17-sintetico";
    vi.clearAllMocks();
    h.reservados.clear();
  });

  it("dia 13 a corretora recusa; dia 14 o cron tenta o CICLO SEGUINTE, não sai em ja_em_curso", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
      h.plano = {
        id: "a17", wallet_address: "0xa", exchange_id: "binance", symbol: "BTC/USDT", modo: "simulado",
        conexao_id: null, intervalo: "daily", next_run_at: new Date().toISOString(),
        ciclos_feitos: 0, ciclos_pulados: 0, ciclos_total: 3, por_ciclo_usd: 100,
        orcamento_total_usd: 300, gasto_acumulado_usd: 0, status: "ativo", encerrado_por: null,
      };
      h.executarOrdemCex.mockResolvedValue({ desfecho: "recusado", porque: "synthetic insufficient balance" });

      const dia13 = await (await POST(req())).json();
      expect(dia13.resumo[0].acao).toBe("falhou");
      expect(h.fecharCiclo.mock.calls[0][2]).toMatchObject({ status: "falhou" });
      // A falha CONSOME o ciclo: o relógio tem de andar.
      expect(h.plano.ciclos_pulados).toBe(1);

      vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
      const dia14 = await (await POST(req())).json();
      expect(dia14.resumo[0].acao).not.toBe("ja_em_curso");
      expect(h.executarOrdemCex).toHaveBeenCalledTimes(2);
      expect(h.executarOrdemCex.mock.calls[0][1].cycleNumber).toBe(1);
      expect(h.executarOrdemCex.mock.calls[1][1].cycleNumber).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
