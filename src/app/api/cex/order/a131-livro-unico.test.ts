/**
 * ⚠️⚠️⚠️ A131 PELA ROTA — O LIVRO DO SERVIDOR MANDA.
 *
 * O ataque que nomeia o achado, em três linhas:
 *
 *     posição do bot no servidor:  0,01 BTC
 *     saldo do cliente na conta:   1,00 BTC
 *     cartão do piloto pede:       VENDER 0,50 BTC
 *
 * O cron limitava a 0,01 (`quantoPodeVender`, chamado só por ele). Esta rota
 * mandava 0,50 — e 0,49 BTC do PATRIMÔNIO DO DONO sairiam por um mandato que
 * o autopilot não tem.
 *
 * Aqui os testes medem o que chega ao EXECUTOR: a quantidade que sai, não o
 * texto da recusa.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { CexId, CexCredentials } from "@/lib/cex/types";

const estado = vi.hoisted(() => {
  const utcDayKey = (d = new Date()) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return {
    utcDayKey,
    sessao: {
      id: "S1", conexao_id: "C1" as string | null,
      strategy_id: "e1", strategy_version: 1,
      allowed_symbols: null as string[] | null, strategy_hash: "h1",
      is_active: true,
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      frozen_until_day: null as string | null,
      last_reset_day: utcDayKey(),
      trades_today: 0, max_trades_per_day: 5, max_trade_usd: 1_000,
      quarentena_em: null as string | null,
      risk_mode: "moderado",
    },
    /** O LIVRO DO SERVIDOR. `null` = o bot não tem posição nesta base. */
    posicao: null as Record<string, unknown> | null,
    /** Erro de leitura do livro (A133). */
    livroFalha: null as string | null,
    posicoes: [] as Array<Record<string, unknown>>,
    /** Chamadas de projeção: [intentId, jaAplicado?] */
    projecoes: [] as Array<{ intentId: string; jaAplicado?: unknown }>,
    projecaoOk: true,
  };
});

type EnviarNaVenue = (
  id: CexId, creds: CexCredentials,
  req: { symbol: string; side: "buy" | "sell"; type: "market" | "limit";
         amount: number; price?: number | null; clientOrderId: string },
) => Promise<RespostaDaVenue>;
const spies = vi.hoisted(() => ({
  enviar: vi.fn<EnviarNaVenue>(async (_id, _creds, req) => ({
    tipo: "aceita",
    ordem: { id: "EXT", filled: req.amount, status: "closed",
             cost: req.amount * 100, average: 100 } as never,
  })),
}));
let bancoAtual: ReturnType<typeof bancoFalso> | null = null;

vi.mock("@/lib/rate-limit", () => ({
  rateLimitDurable: async () => ({ ok: true }), getClientId: () => "teste",
}));
vi.mock("@/lib/tier/enforce", () => ({
  checkFeatureTier: async () => null,
  denialResponse: () => new Response("negado", { status: 403 }),
}));
vi.mock("@/lib/admin/kill-switches", () => ({
  checarKillSwitches: async () => ({ bloqueado: false }),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ sub: "0xA131" }) }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => bancoAtual?.cliente ?? null }));
vi.mock("@/lib/admin/track", () => ({
  logSecurity: () => {}, logError: () => {}, recordEvent: async () => {},
}));
vi.mock("@/lib/cex/execucao/venue-primitivo", () => ({ enviarOrdemNaVenue: spies.enviar }));
vi.mock("@/lib/autopilot/liberacao", () => ({
  podeAutomatizar: async () => ({ permitido: true, causa: "aberto" }),
}));
vi.mock("@/lib/autopilot/price-guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/autopilot/price-guard")>();
  return { ...real, getReferencePriceUsd: async () => 100 };
});
vi.mock("@/lib/autopilot/sessions", () => ({
  utcDayKey: estado.utcDayKey,
  getSessionStatus: async () => estado.sessao,
  reservarTradeDaSessao: async () => ({ ok: true as const, tradesDepois: 1 }),
  liberarTradeDaSessao: async () => true,
}));
vi.mock("@/lib/autopilot/certificado", () => ({ certificadoVivo: async () => null }));
vi.mock("@/lib/autopilot/regime", () => ({ regimeDaBase: async () => "TRENDING_UP" }));
vi.mock("@/lib/autopilot/politica", () => ({
  avaliarDecisaoDeEstrategia: () => ({
    permite: true, versao: 1, tetoEfetivoUsd: 1_000, certificadoId: "CERT-A131",
  }),
}));
vi.mock("@/lib/cex/conexoes", () => ({
  conexaoParaExecucao: async () => ({ ok: true, conexao: { id: "C1" } }),
  decifrarConexao: () => ({ apiKey: "K", apiSecret: "S" }),
}));

/** ⚠️ O LIVRO DO SERVIDOR — a única autoridade sobre o que o bot possui. */
vi.mock("@/lib/autopilot/positions-server", () => ({
  lerPosicaoDoBot: async () => estado.livroFalha
    ? { ok: false as const, porque: estado.livroFalha }
    : { ok: true as const, posicao: estado.posicao },
  getOpenServerPositions: async () => estado.livroFalha
    ? { ok: false as const, porque: estado.livroFalha }
    : { ok: true as const, posicoes: estado.posicoes },
}));
vi.mock("@/lib/autopilot/projecao-de-posicao", () => ({
  projetarEfeitoDoIntent: async (intentId: string, opts?: { jaAplicado?: unknown }) => {
    estado.projecoes.push({ intentId, jaAplicado: opts?.jaAplicado });
    return estado.projecaoOk
      ? { ok: true as const, motivo: "aplicado" as const, aplicadoQty: 1,
          aplicadoQuote: 100, custoRemovido: 0, fechou: false }
      : { ok: false as const, motivo: "erro" as const, porque: "rpc fora" };
  },
}));

import { POST } from "@/app/api/cex/order/route";

function req(over: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/cex/order", {
    method: "POST",
    body: JSON.stringify({
      exchange: "binance", symbol: "BTC/USDT", side: "sell", type: "market",
      amount: 0.5, confirm: "I-CONFIRM-REAL-ORDER", autopilot: true,
      apiKey: "BODY-KEY-12345", apiSecret: "BODY-SECRET-12345", ...over,
    }),
    headers: { "content-type": "application/json" },
  });
}

const POSICAO_DO_BOT = (over: Record<string, unknown> = {}) => ({
  id: "P1", session_id: "S1", base: "BTC", pair: "BTC/USDT",
  base_amount: 0.01, cost_usd: 1, status: "open",
  exit_order_id: null, exit_armed_at: null, ...over,
});

beforeEach(() => {
  bancoAtual = bancoFalso();
  spies.enviar.mockClear();
  estado.posicao = POSICAO_DO_BOT();
  estado.posicoes = [];
  estado.livroFalha = null;
  estado.projecoes = [];
  estado.projecaoOk = true;
  estado.sessao.risk_mode = "moderado";
  estado.sessao.max_trade_usd = 1_000;
  // A120: o ramo MANUAL calcula o fingerprint da credencial antes de chamar o
  // executor — sem a env de HMAC ele falha FECHADO, de propósito.
  process.env.CEX_RECOVERY_HMAC_KEY = "chave-hmac-de-teste-a131";
});

/**
 * ⚠️ POR QUE OS CASOS POSITIVOS DE COMPRA NÃO AFIRMAM 200.
 *
 * Uma COMPRA autônoma real ainda atravessa a autorização final do A110 no
 * banco (RPC 0060) — certificado, envelope, hash — que este fixture não monta.
 * Exigir 200 aqui faria o teste medir aquela cadeia, e não esta. O que ele
 * precisa provar é que a recusa DEIXOU de ser a exposição.
 */
async function recusaNaoEhExposicao(r: Response) {
  const corpo = await r.json().catch(() => ({}));
  expect(corpo.error).not.toBe("exposicao_do_bot");
}

/** A quantidade que REALMENTE chegou à corretora. */
function qtdEnviada(): number {
  expect(spies.enviar).toHaveBeenCalledTimes(1);
  return spies.enviar.mock.calls[0][2].amount;
}

describe("A131.1 — pedido de 0,50 com posição de 0,01", () => {
  it("⚠️⚠️ o efeito externo é 0,01 — NUNCA 0,50", async () => {
    const r = await POST(req({ side: "sell", amount: 0.5 }));
    expect(r.status).toBe(200);
    expect(qtdEnviada()).toBeCloseTo(0.01, 12);
  });

  it("⚠️ e o intent gravado carrega a quantidade LIMITADA, não a pedida", async () => {
    await POST(req({ side: "sell", amount: 0.5 }));
    expect(bancoAtual!.intents).toHaveLength(1);
    expect(Number(bancoAtual!.intents[0].requested_qty)).toBeCloseTo(0.01, 12);
  });

  it("⚠️ pedido MENOR que a posição sai inteiro", async () => {
    const r = await POST(req({ side: "sell", amount: 0.004 }));
    expect(r.status).toBe(200);
    expect(qtdEnviada()).toBeCloseTo(0.004, 12);
  });
});

describe("A131.2 — o store local não é autoridade", () => {
  it("⚠️⚠️ servidor sem posição: venda autônoma RECUSADA, zero ordem", async () => {
    /**
     * O `localStorage` do navegador pode jurar que há 0,50 BTC. Ele não é
     * consultado por esta rota, e não existe caminho em que ele autorize.
     */
    estado.posicao = null;
    const r = await POST(req({ side: "sell", amount: 0.5 }));
    expect(r.status).toBe(403);
    const corpo = await r.json();
    expect(corpo.error).toBe("posse_do_bot");
    expect(corpo.motivo).toBe("sem_posicao");
    expect(spies.enviar).not.toHaveBeenCalled();
    expect(bancoAtual!.intents).toHaveLength(0);
  });

  it("⚠️ posição FECHADA é o mesmo que não ter", async () => {
    estado.posicao = POSICAO_DO_BOT({ status: "closed" });
    const r = await POST(req({ side: "sell", amount: 0.001 }));
    expect(r.status).toBe(403);
    expect(spies.enviar).not.toHaveBeenCalled();
  });
});

describe("A131.3 — o livro do servidor vale mesmo com a tela desatualizada", () => {
  it("⚠️ store local vazio e servidor com posição: a venda legítima SAI", async () => {
    // A segurança não pode depender de a aba estar em dia.
    estado.posicao = POSICAO_DO_BOT({ base_amount: 0.01 });
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    expect(r.status).toBe(200);
    expect(qtdEnviada()).toBeCloseTo(0.005, 12);
  });
});

describe("A131.4 — livro ilegível fecha os DOIS lados (A133)", () => {
  it("⚠️⚠️ erro de leitura: venda RECUSADA", async () => {
    estado.livroFalha = "connection reset";
    const r = await POST(req({ side: "sell", amount: 0.001 }));
    expect(r.status).toBe(403);
    expect((await r.json()).motivo).toBe("livro_ilegivel");
    expect(spies.enviar).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ erro de leitura: compra RECUSADA", async () => {
    estado.livroFalha = "connection reset";
    const r = await POST(req({ side: "buy", amount: 0.5 }));
    expect(r.status).toBe(403);
    const corpo = await r.json();
    expect(corpo.error).toBe("exposicao_do_bot");
    expect(corpo.motivo).toBe("livro_ilegivel");
    expect(spies.enviar).not.toHaveBeenCalled();
    expect(bancoAtual!.intents).toHaveLength(0);
  });
});

describe("A131.9 — saída já armada não aceita segunda venda", () => {
  it("⚠️⚠️ exit_armed: RECUSADO, zero segunda ordem", async () => {
    estado.posicao = POSICAO_DO_BOT({ status: "exit_armed", exit_order_id: "EXT-1" });
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    expect(r.status).toBe(403);
    expect((await r.json()).motivo).toBe("saida_ja_armada");
    expect(spies.enviar).not.toHaveBeenCalled();
  });
});

describe("A131.10 — a exposição é a do servidor", () => {
  it("⚠️⚠️ livro com US$ 190 e teto US$ 200: compra de US$ 20 RECUSADA", async () => {
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 190, status: "open" }];
    const r = await POST(req({ side: "buy", amount: 0.2 }));   // 0,2 × 100 = 20
    expect(r.status).toBe(403);
    const corpo = await r.json();
    expect(corpo.error).toBe("exposicao_do_bot");
    expect(corpo.motivo).toBe("teto_estourado");
    expect(spies.enviar).not.toHaveBeenCalled();
  });

  it("⚠️ o gêmeo: com folga no livro, a recusa DEIXA de ser a exposição", async () => {
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 100, status: "open" }];
    await recusaNaoEhExposicao(await POST(req({ side: "buy", amount: 0.2 })));
  });

  it("⚠️⚠️ store local vazio NÃO zera a exposição do servidor", async () => {
    // É o cenário do achado: a aba nova acha que não há nada, e compraria.
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 195, status: "open" }];
    const r = await POST(req({ side: "buy", amount: 0.1 }));
    expect(r.status).toBe(403);
    expect(spies.enviar).not.toHaveBeenCalled();
  });

  it("⚠️ posição FECHADA não conta na exposição", async () => {
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 190, status: "closed" }];
    await recusaNaoEhExposicao(await POST(req({ side: "buy", amount: 0.2 })));
  });
});

describe("A131.5/A131.6 — o que o navegador executou entra no livro", () => {
  it("⚠️⚠️ execução preenchida: a projeção é chamada com o id do INTENT", async () => {
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    expect(r.status).toBe(200);
    expect(estado.projecoes).toHaveLength(1);
    expect(estado.projecoes[0].intentId).toBe(bancoAtual!.intents[0].id);
    // ⚠️ Nada de quantidade: a RPC lê `filled_qty` do livro (§21/§32).
    expect(estado.projecoes[0].jaAplicado).toBeUndefined();
  });

  it("⚠️⚠️ a VENDA projeta — senão o livro segue dizendo que a bolsa ficou", async () => {
    await POST(req({ side: "sell", amount: 0.01 }));
    expect(estado.projecoes).toHaveLength(1);
    expect(qtdEnviada()).toBeCloseTo(0.01, 12);
  });

  it("⚠️ e a COMPRA passa pela MESMA porta — trava estrutural", async () => {
    // O caminho de compra não chega a 200 neste fixture (A110/RPC 0060), então
    // a convergência é fixada onde ela mora: uma chamada só, para os dois lados.
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(FONTE).toMatch(/if \(ehAutopilot && r\.filledQty > 0\) \{/);
    expect([...FONTE.matchAll(/projetarEfeitoDoIntent\(/g)]).toHaveLength(1);
  });

  it("⚠️⚠️ ACK sem preenchimento NÃO projeta posição nenhuma", async () => {
    spies.enviar.mockResolvedValueOnce({
      tipo: "aceita", ordem: { id: "EXT", filled: 0, status: "open" } as never,
    });
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    expect(r.status).toBe(200);
    expect(estado.projecoes).toHaveLength(0);
  });

  it("⚠️⚠️ ordem MANUAL não vira posse do bot", async () => {
    // Sem `autopilot: true` não há sessão, nem posse, nem projeção.
    const r = await POST(req({ autopilot: false, side: "sell", amount: 0.5 }));
    expect(r.status).toBe(200);
    expect(qtdEnviada()).toBeCloseTo(0.5, 12);   // o dono vende o que é dele
    expect(estado.projecoes).toHaveLength(0);
  });

  it("⚠️ projeção que falha NÃO inventa sucesso silencioso", async () => {
    estado.projecaoOk = false;
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    // A ordem já saiu — não dá para desfazer. O que não pode é passar calado.
    expect(r.status).toBe(200);
    expect(estado.projecoes).toHaveLength(1);
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8");
    expect(FONTE).toMatch(/autopilot_projecao_de_posicao_falhou/);
    expect(FONTE).toMatch(/a131_projecao_falhou/);
  });
});
