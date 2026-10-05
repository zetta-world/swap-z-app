/**
 * RM-04 (audit remediation) — a ROTA do backtest não declara sucesso que o banco não confirmou.
 *
 * Achado da auditoria independente sobre 14e5a20: a rota chamava `fecharRodada` e IGNORAVA o
 * retorno. Um UPDATE recusado deixava a rodada `rodando` (contando na cota de 24h) e a resposta
 * saía `ok: true`. Aqui o store é substituído por respostas roteirizadas; o contrato do próprio
 * `fecharRodada` (retry, replay, coluna ausente) é provado em `remediacao-auditoria.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const estado = vi.hoisted(() => ({
  fechar: [] as Array<unknown>,
  fechamentos: [] as Array<{ id: string; status: string; porque?: string }>,
  explodirNoMotor: false,
}));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: "0xAAAA1111", chain: "evm" })) }));
vi.mock("@/lib/tier/check", () => ({ getTierForWallet: vi.fn(async () => ({ tier: "pilot", source: "cache", expiresAt: 0 })) }));
vi.mock("@/lib/tier/enforce", () => ({
  checkFeatureTier: vi.fn(async () => null),
  denialResponse: vi.fn(() => new Response("negado", { status: 401 })),
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitDurable: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: vi.fn(() => ({})) }));
vi.mock("@/lib/mercado/store", async (original) => ({
  ...(await original<typeof import("@/lib/mercado/store")>()),
  velasFechadasDoIntervalo: vi.fn(async (_db: unknown, _s: string, _i: string, de: number) => {
    if (estado.explodirNoMotor) throw new Error("leitura explodiu");
    const velas = Array.from({ length: 60 }, (_, k) => {
      const c = 100 + 5 * Math.sin(k / 3);
      return { t: de + k * 86_400_000, high: c * 1.01, low: c * 0.99, close: c, volume: 1 };
    });
    return { velas, daFonte: 0, doCache: velas.length, porqueIncompleta: null };
  }),
}));
vi.mock("@/lib/bancada/store", async (original) => ({
  ...(await original<typeof import("@/lib/bancada/store")>()),
  reservarRodada: vi.fn(async () => ({ ok: true, id: "rodada-1", rodadas: 1, unidades: 60 })),
  gravarResultado: vi.fn(async () => ({ ok: true, valor: true })),
  gravarOperacoes: vi.fn(async () => ({ ok: true, valor: 0 })),
  fecharRodada: vi.fn(async (_d: unknown, _db: unknown, id: string, status: string, porque?: string) => {
    estado.fechamentos.push({ id, status, porque });
    return estado.fechar.shift() ?? { ok: false, porque: "roteiro esgotado" };
  }),
}));

const { POST } = await import("@/app/api/bancada/backtest/route");

function pedido() {
  return new NextRequest("http://local/api/bancada/backtest", {
    method: "POST",
    body: JSON.stringify({
      estrategia: { entrada: { tipo: "media", n: 5 }, direcao: "compra", alvoPct: 3, stopPct: 1.5, horasLimite: 96,
                    praca: "spot_gate", papel: "taker" },
      simbolos: ["BTC"], intervalo: "1d", capitalUsd: 1000, janelaDias: 60,
    }),
  });
}

beforeEach(() => { estado.fechar = []; estado.fechamentos = []; estado.explodirNoMotor = false; });

describe("RM-04 · a rota do backtest e o fechamento da rodada", () => {
  it("fechamento confirmado → 200 ok:true, registrada:true, rodada fechada como concluida", async () => {
    estado.fechar = [{ ok: true, valor: { fechou: true, metricasGravadas: true, tentativas: 1 } }];
    const r = await POST(pedido());
    const j = await r.json();
    expect(r.status).toBe(200);
    expect(j).toMatchObject({ ok: true, rodadaId: "rodada-1", registrada: true });
    expect(estado.fechamentos).toEqual([{ id: "rodada-1", status: "concluida", porque: undefined }]);
  });

  it("⚠️⚠️ fechamento RECUSADO pelo banco → 503 rodada_nao_persistida, NUNCA ok:true", async () => {
    estado.fechar = [{ ok: false, porque: "fechar rodada: connection reset" }];
    const r = await POST(pedido());
    const j = await r.json();
    expect(r.status).toBe(503);
    expect(j.ok).toBe(false);
    expect(j.error).toBe("rodada_nao_persistida");
    expect(j.rodadaId).toBe("rodada-1");
    expect(j).not.toHaveProperty("veredito");          // o resultado não é apresentado como registrado
    expect(typeof j.porque).toBe("string");            // a tela mostra o `porque`
  });

  it("schema sem a 0075: fecha, responde ok, e DECLARA que as métricas não foram gravadas", async () => {
    estado.fechar = [{ ok: true, valor: { fechou: true, metricasGravadas: false, tentativas: 2 } }];
    const j = await (await POST(pedido())).json();
    expect(j.ok).toBe(true);
    expect(j.veredito.naoMedidoTexto.join(" ")).toMatch(/métricas de custo desta rodada não foram gravadas/);
  });

  it("⚠️ exceção no meio da rodada → fecha como 'falhou' com o motivo, responde 500 com `porque`", async () => {
    estado.explodirNoMotor = true;
    estado.fechar = [{ ok: true, valor: { fechou: true, metricasGravadas: false, tentativas: 1 } }];
    const r = await POST(pedido());
    const j = await r.json();
    expect(r.status).toBe(500);
    expect(j).toMatchObject({ ok: false, error: "erro_interno", rodadaId: "rodada-1", registrada: true });
    expect(estado.fechamentos[0].status).toBe("falhou");
    expect(estado.fechamentos[0].porque).toMatch(/leitura explodiu/);
  });

  it("exceção E fechamento recusado → 500 com registrada:false (não finge ter registrado)", async () => {
    estado.explodirNoMotor = true;
    estado.fechar = [{ ok: false, porque: "x" }];
    const j = await (await POST(pedido())).json();
    expect(j).toMatchObject({ ok: false, error: "erro_interno", registrada: false });
  });
});
