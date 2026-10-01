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
    /**
     * ⚠️⚠️ COM QUE SESSÃO O LIVRO FOI CONSULTADO.
     *
     * A revisão adversarial achou que a rota lia o livro com `session_id = ""`
     * — e NENHUM teste podia ver, porque todos os mocks ignoravam os
     * argumentos. Medir o veredito sem medir a PERGUNTA deixa passar
     * exatamente isto.
     */
    consultas: [] as Array<{ fn: string; sessionId: unknown; base?: unknown }>,
    /** O que já está PROMETIDO a ordens em voo (A134/A135). */
    reservadoQty: 0,
    reservadoUsd: 0,
    reservasPorIntent: new Map<string, number>(),
    tradesToday: 3,
    devolucaoDaVagaFalha: false,
    eventos: [] as Array<{ nome: string; payload?: unknown }>,
    devolucoes: [] as Array<{ tipo: string; valor: number }>,
    /** Saídas marcadas como armadas NO SERVIDOR, e P&L realizado nele. */
    armadas: [] as unknown[][],
    pnl: [] as unknown[][],
    pnlOk: true,
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
  logSecurity: () => {},
  logError: () => {},
  /**
   * ⚠️ `vi.fn()`, NÃO uma lambda vazia — achado da revisão adversarial. Com a
   * lambda, o único jeito de "provar" a telemetria era grep no fonte, e um
   * comentário com as mesmas palavras mantinha o teste verde.
   */
  recordEvent: vi.fn(async (nome: string, payload?: unknown) => {
    estado.eventos.push({ nome, payload });
  }),
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
  /**
   * ⚠️ A141: a VAGA DIÁRIA é contabilizada aqui porque o que o achado mede é
   * ela voltar quando a segunda etapa da reserva recusa. `trades_today` é o
   * número que o usuário configurou — uma ordem que nunca existiu não pode
   * comê-lo.
   */
  reservarTradeDaSessao: async () => {
    estado.tradesToday += 1;
    return { ok: true as const, tradesDepois: estado.tradesToday };
  },
  liberarTradeDaSessao: async () => {
    if (!estado.devolucaoDaVagaFalha) estado.tradesToday -= 1;
    estado.devolucoes.push({ tipo: "vaga", valor: 1 });
    return !estado.devolucaoDaVagaFalha;
  },
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

/**
 * ⚠️ O LIVRO DO SERVIDOR — a única autoridade sobre o que o bot possui.
 *
 * ⚠️⚠️ A LEITURA É O PRÉ-VOO; A RESERVA É A AUTORIZAÇÃO (A134/A137). A rota
 * lê para DIMENSIONAR a ordem (a quantidade precisa existir antes do intent) e
 * reserva DEPOIS, na costura do executor, com o id do intent na mão. Este
 * falso reproduz as duas metades — e é por isso que duas requisições
 * simultâneas disputam de verdade aqui.
 */
vi.mock("@/lib/autopilot/positions-server", () => ({
  lerPosicaoDoBot: async (sessionId: unknown, base: unknown) => {
    estado.consultas.push({ fn: "lerPosicaoDoBot", sessionId, base });
    return estado.livroFalha
      ? { ok: false as const, porque: estado.livroFalha }
      : { ok: true as const, posicao: estado.posicao };
  },
  getOpenServerPositions: async (sessionId: unknown) => {
    estado.consultas.push({ fn: "getOpenServerPositions", sessionId });
    return estado.livroFalha
      ? { ok: false as const, porque: estado.livroFalha }
      : { ok: true as const, posicoes: estado.posicoes };
  },
  markServerExitArmed: async (...args: unknown[]) => {
    estado.armadas.push(args);
    return { ok: true as const };
  },
}));

vi.mock("@/lib/autopilot/reserva-de-inventario", () => ({
  reservarVendaDoBot: async (intentId: string, pedido: number) => {
    estado.consultas.push({ fn: "reservarVendaDoBot", sessionId: intentId });
    const pos = estado.posicao as Record<string, unknown> | null;
    if (!pos) return { ok: false as const, motivo: "sem_posicao" as const, porque: "sem posicao" };
    const disponivel = Number(pos.base_amount) - estado.reservadoQty;
    if (disponivel <= 0) {
      return { ok: false as const, motivo: "quantidade_ja_reservada" as const,
               porque: "a bolsa ja esta prometida a outra venda em voo" };
    }
    const qtd = Math.min(pedido, disponivel);
    estado.reservadoQty += qtd;
    estado.reservasPorIntent.set(intentId, qtd);
    return { ok: true as const, qtd, limitada: qtd < pedido, naPosicao: Number(pos.base_amount) };
  },
  reservarExposicaoDoBot: async (intentId: string, usd: number, teto: number) => {
    estado.consultas.push({ fn: "reservarExposicaoDoBot", sessionId: intentId });
    const exposicao = estado.posicoes
      .filter((p) => p.status !== "closed")
      .reduce((soma, p) => soma + Number(p.cost_usd ?? 0), 0);
    if (exposicao + estado.reservadoUsd + usd > teto) {
      return { ok: false as const, motivo: "teto_estourado" as const, porque: "teto" };
    }
    estado.reservadoUsd += usd;
    estado.reservasPorIntent.set(intentId, usd);
    return { ok: true as const, exposicaoUsd: exposicao,
             comprometidoUsd: estado.reservadoUsd, tetoUsd: teto };
  },
  liberarReservaDoIntent: async (intentId: string) => {
    const valor = estado.reservasPorIntent.get(intentId) ?? 0;
    estado.devolucoes.push({ tipo: "intent", valor });
    // ⚠️ Devolve o DESTE intent, e de nenhum outro — era isso que o contador
    // agregado não sabia fazer (A137).
    if (estado.posicao && estado.reservadoQty >= valor) estado.reservadoQty -= valor;
    if (estado.reservadoUsd >= valor) estado.reservadoUsd -= valor;
    estado.reservasPorIntent.delete(intentId);
  },
}));

vi.mock("@/lib/autopilot/projecao-de-posicao", () => ({
  projetarEfeitoDoIntent: async (intentId: string, opts?: Record<string, unknown>) => {
    estado.projecoes.push({ intentId, jaAplicado: opts?.jaAplicado });
    return estado.projecaoOk
      ? { ok: true as const, motivo: "aplicado" as const, aplicadoQty: 1,
          aplicadoQuote: 100, custoRemovido: 0, fechou: false, realizado: 100 }
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

/** Espelha `estado.sessao` na tabela que o portão financeiro relê. */
function semearSessao(over: Record<string, unknown> = {}) {
  if (!bancoAtual) return;
  bancoAtual.sessoes.length = 0;
  bancoAtual.sessoes.push({
    id: estado.sessao.id,
    wallet_address: "0xA131", exchange_id: "binance",
    is_active: estado.sessao.is_active,
    expires_at: estado.sessao.expires_at,
    pnl_today: 0, daily_loss_stop_usd: 500,
    frozen_until_day: estado.sessao.frozen_until_day,
    last_reset_day: estado.sessao.last_reset_day,
    trades_today: estado.sessao.trades_today,
    max_trades_per_day: estado.sessao.max_trades_per_day,
    max_trade_usd: estado.sessao.max_trade_usd,
    conexao_id: estado.sessao.conexao_id,
    quarentena_em: estado.sessao.quarentena_em,
    contabilidade_incompleta_em: null,
    risk_mode: estado.sessao.risk_mode,
    ...over,
  });
}

beforeEach(() => {
  bancoAtual = bancoFalso();
  /**
   * ⚠️⚠️ A SESSÃO TAMBÉM VIVE NO BANCO, e não só no mock de
   * `getSessionStatus`. O portão financeiro do último instante RELÊ a linha
   * antes de reservar — deixar o banco sem ela faria o arnês representar um
   * mundo impossível (a rota enxerga a sessão, o banco não).
   *
   * `semearSessao` é chamado de novo pelos testes que mexem em `estado.sessao`
   * depois do `beforeEach`.
   */
  semearSessao();
  spies.enviar.mockClear();
  estado.posicao = POSICAO_DO_BOT();
  estado.posicoes = [];
  estado.livroFalha = null;
  estado.projecoes = [];
  estado.consultas = [];
  estado.reservadoQty = 0;
  estado.reservadoUsd = 0;
  estado.reservasPorIntent.clear();
  estado.tradesToday = 3;
  estado.devolucaoDaVagaFalha = false;
  estado.eventos = [];
  estado.devolucoes = [];
  estado.armadas = [];
  estado.pnl = [];
  estado.pnlOk = true;
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
    // ⚠️ O pré-voo lê o livro e recusa por ele; a reserva (A134) é a segunda
    // tranca, na costura do executor. As duas fecham a venda.
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
    /**
     * O caminho de compra não chega a 200 neste fixture (A110/RPC 0060), então
     * a convergência é fixada onde ela mora.
     *
     * ⚠️ E A TRAVA MUDOU DE FORMA: a revisão adversarial achou um SEGUNDO
     * caminho que termina com dinheiro movido — o INCERTO que a reconciliação
     * imediata prova ter executado — e que não projetava nada. Agora os dois
     * chamam `projetarOuAvisar`, e `projetarEfeitoDoIntent` aparece uma vez só,
     * dentro dela.
     */
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ");
    expect([...FONTE.matchAll(/projetarEfeitoDoIntent\(/g)]).toHaveLength(1);
    expect([...FONTE.matchAll(/await projetarOuAvisar\(/g)].length,
      "o preenchimento direto e o incerto-depois-provado").toBe(2);
    expect(FONTE).toMatch(/if \(ehAutopilot && r\.filledQty > 0\) \{\s*await projetarOuAvisar/);
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

describe("⚠️⚠️ a PERGUNTA, não só o veredito — achado da revisão adversarial", () => {
  /**
   * A rota lia o livro com `sessaoDoPilotoId ?? ""`, e a variável só era
   * atribuída DEPOIS dos dois portões. Com `session_id = ""` numa coluna
   * `uuid not null`, toda consulta erra — então o canal inteiro do navegador
   * respondia `livro_ilegivel`, e a posse que o A131 mede nunca foi medida
   * contra a sessão real.
   *
   * Nenhum teste via: todos os mocks ignoravam os argumentos. Estes não.
   */
  it("⚠️⚠️ a VENDA consulta o livro com o id REAL da sessão", async () => {
    await POST(req({ side: "sell", amount: 0.005 }));
    const c = estado.consultas.find((x) => x.fn === "lerPosicaoDoBot");
    expect(c, "a rota precisa consultar o livro na venda").toBeDefined();
    expect(c!.sessionId).toBe("S1");
    expect(c!.base).toBe("BTC");
  });

  it("⚠️⚠️ a COMPRA consulta a exposição com o id REAL da sessão", async () => {
    await POST(req({ side: "buy", amount: 0.2 }));
    const c = estado.consultas.find((x) => x.fn === "getOpenServerPositions");
    expect(c, "a rota precisa consultar a exposição na compra").toBeDefined();
    expect(c!.sessionId).toBe("S1");
  });

  it("⚠️⚠️ e NUNCA com string vazia — o disfarce era o `?? \"\"`", async () => {
    await POST(req({ side: "sell", amount: 0.005 }));
    await POST(req({ side: "buy", amount: 0.2 }));
    for (const c of estado.consultas) {
      expect(c.sessionId, `${c.fn} recebeu um id vazio`).not.toBe("");
      expect(c.sessionId).toBeTruthy();
    }
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8");
    expect(FONTE).not.toMatch(/sessaoDoPilotoId \?\? ""/);
  });

  it("⚠️ sem id de sessão, nada é consultado e nada sai", async () => {
    (estado.sessao as { id?: string }).id = undefined;
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    expect(r.status).toBe(403);
    expect((await r.json()).motivo).toBe("sessao_inexistente");
    expect(estado.consultas).toHaveLength(0);
    expect(spies.enviar).not.toHaveBeenCalled();
    estado.sessao.id = "S1";
  });
});

describe("a saída do navegador fica armada NO SERVIDOR — achado da revisão", () => {
  it("⚠️⚠️ limitada aceita e ainda viva: `markServerExitArmed` no livro", async () => {
    /**
     * O navegador marcava só no `localStorage`. O livro do servidor seguia
     * `open` com a bolsa inteira — e tanto o cron quanto uma segunda aba
     * podiam mandar outra venda da MESMA posição, que é o desfecho que
     * `markServerExitArmed` teme por escrito.
     */
    spies.enviar.mockResolvedValueOnce({
      tipo: "aceita", ordem: { id: "EXT-LIMIT", filled: 0, status: "open" } as never,
    });
    const r = await POST(req({ side: "sell", type: "limit", amount: 0.005, price: 100 }));
    expect(r.status).toBe(200);
    expect(estado.armadas).toHaveLength(1);
    expect(estado.armadas[0][0]).toBe("S1");
    expect(estado.armadas[0][1]).toBe("BTC");
    expect(estado.armadas[0][2]).toBe("EXT-LIMIT");
    // ⚠️ A139: o INTENT da saída vai junto — é ele que carrega a conexão
    // histórica com que a liquidação vai perguntar à corretora.
    expect(String(estado.armadas[0][3] ?? "")).toBeTruthy();
  });

  it("⚠️ venda a MERCADO preenchida não arma nada — ela já reduziu", async () => {
    await POST(req({ side: "sell", amount: 0.005 }));
    expect(estado.armadas).toHaveLength(0);
  });
});

describe("o P&L da venda do navegador conta no stop do SERVIDOR", () => {
  it("⚠️⚠️ venda projetada realiza P&L na sessão — recebido − custo − taxa", async () => {
    /**
     * Antes, a venda do navegador REDUZIA a posição no servidor e registrava o
     * resultado só no `localStorage`: a sessão que congela nunca via a perda.
     * Pior que antes do Round 9, quando a posição ficava no livro e o cron
     * acabava realizando.
     */
    await POST(req({ side: "sell", amount: 0.005 }));
    /**
     * ⚠️ A138: o P&L deixou de ser uma segunda escrita. Ele entra na MESMA
     * transação da projeção, e a rota só registra o fato. O mock devolve
     * `realizado: 100`.
     */
    expect(estado.projecoes).toHaveLength(1);
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8");
    // ⚠️ Sem comentários: a cicatriz CITA a função que saiu, e deve citar.
    const codigo = FONTE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    expect(codigo).not.toMatch(/applySessionPnl/);
    expect(FONTE).toMatch(/autopilot_pnl_realizado/);
  });

  it("⚠️⚠️ projeção que falha leva o P&L junto — e ela é retentável", async () => {
    /**
     * ⚠️ A138: não existe mais o caso "posição reduziu e o P&L não entrou".
     * Ou a transação aplica os dois, ou não aplica nenhum — e a varredura de
     * pendências volta nela.
     */
    estado.projecaoOk = false;
    const r = await POST(req({ side: "sell", amount: 0.005 }));
    expect(r.status).toBe(200);   // a ordem já saiu; não dá para desfazer
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8");
    expect(FONTE).toMatch(/autopilot_projecao_de_posicao_falhou/);
    expect(FONTE).toMatch(/pendencias_financeiras|pendenciasFinanceiras|recupera/);
  });

  it("⚠️⚠️ COMPRA não realiza P&L nenhum", async () => {
    // A RPC só realiza em venda; aqui a trava é estrutural.
    const SQL = (await import("node:fs")).readFileSync(
      "supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");
    // ⚠️ A142: a guarda virou `side = 'sell'` — o recebido tardio precisa
    // entrar, e quem decide se há resultado é a conta acumulada.
    expect(SQL).toMatch(/if v_i\.side = 'sell' then/);
    expect(SQL).toMatch(/if v_quote_novo > 0 then/);
  });

  it("⚠️⚠️ saída em liquidação NÃO realiza aqui — quem realiza é o settle", async () => {
    // Contar dos dois lados seria contar o mesmo prejuízo duas vezes.
    const FONTE = (await import("node:fs")).readFileSync(
      "src/app/api/cex/order/route.ts", "utf8");
    expect(FONTE).toMatch(/projecao\.motivo === "aplicado"/);
  });
});

describe("A134/A135 pela rota — duas ordens não cabem na mesma reserva", () => {
  it("⚠️⚠️ posição 0,01 · DUAS vendas simultâneas de 0,01: UMA chega à corretora", async () => {
    /**
     * O teste que o auditor pediu, medido onde importa: quantas ordens
     * atravessam até `enviarOrdemNaVenue`. Antes do A134 as duas atravessavam
     * — as duas liam `base_amount = 0,01` e nenhuma reservava nada.
     */
    const [a, b] = await Promise.all([
      POST(req({ side: "sell", amount: 0.01 })),
      POST(req({ side: "sell", amount: 0.01 })),
    ]);
    expect(spies.enviar).toHaveBeenCalledTimes(1);
    const vitoriosas = [a, b].filter((r) => r.status === 200);
    expect(vitoriosas).toHaveLength(1);
    /**
     * ⚠️ A PERDEDORA CAI NA RESERVA, não no pré-voo — A137.
     *
     * As duas passam pelo pré-voo (que só dimensiona) e disputam a reserva
     * dentro da costura do executor, já com intent gravado. Quem perde recebe
     * `reserva_negada` do executor: nada foi enviado, e o 409 diz que é
     * conflito de estado, não erro do servidor.
     */
    const perdedora = [a, b].find((r) => r.status !== 200)!;
    expect(perdedora.status).toBe(409);
    const corpo = await perdedora.json();
    expect(corpo.error).toBe("reserva_negada");
    expect(String(corpo.detail ?? "")).toMatch(/posse|prometida/);
  });

  it("⚠️⚠️ exposição 190, teto 200 · DUAS compras simultâneas de 20: nenhuma passa", async () => {
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 190, status: "open" }];
    const [a, b] = await Promise.all([
      POST(req({ side: "buy", amount: 0.2 })),
      POST(req({ side: "buy", amount: 0.2 })),
    ]);
    for (const r of [a, b]) {
      expect(r.status).toBe(403);
      expect((await r.json()).error).toBe("exposicao_do_bot");
    }
    expect(spies.enviar).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ exposição 170, teto 200 · DUAS compras de 20: só UMA reserva", async () => {
    // 170 + 20 cabe; 170 + 20 + 20 não. A segunda vê o que a primeira
    // prometeu, não só o que está no livro.
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 170, status: "open" }];
    const [a, b] = await Promise.all([
      POST(req({ side: "buy", amount: 0.2 })),
      POST(req({ side: "buy", amount: 0.2 })),
    ]);
    // ⚠️ Uma cai no pré-voo (403) ou na reserva (409) — o que importa é que
    // exatamente UMA das duas fica autorizada a gastar o teto.
    const recusadas = (await Promise.all([a, b].map(async (r) => {
      if (r.status === 200) return false;
      const corpo = await r.json();
      return corpo.error === "exposicao_do_bot" || corpo.error === "reserva_negada";
    }))).filter(Boolean);
    expect(recusadas).toHaveLength(1);
    /**
     * ⚠️ E a vencedora acaba DEVOLVENDO: a compra autônoma ainda atravessa a
     * autorização final do A110 no banco (RPC 0060), que este fixture não
     * monta, e a recusa é PROVADA — nada saiu. Devolver aí é o comportamento
     * certo: a reserva não pode sobreviver a uma ordem que não existiu.
     */
    expect(estado.devolucoes.some((d) => d.tipo === "intent")).toBe(true);
    expect(estado.reservadoUsd).toBeCloseTo(0, 9);
  });

  it("⚠️⚠️ recusa PROVADA devolve a reserva — a próxima venda passa", async () => {
    // Sem isto, uma ordem recusada trancaria a posição até a reserva expirar.
    spies.enviar.mockResolvedValueOnce({
      tipo: "recusada", porque: "insufficient balance", codigo: "40004",
    } as never);
    const r = await POST(req({ side: "sell", amount: 0.01 }));
    expect(r.status).not.toBe(200);
    expect(estado.devolucoes.some((d) => d.tipo === "intent")).toBe(true);
    expect(estado.reservadoQty).toBeCloseTo(0, 12);

    // E a próxima venda passa, porque a bolsa voltou a estar livre.
    const segunda = await POST(req({ side: "sell", amount: 0.01 }));
    expect(segunda.status).toBe(200);
  });

  it("⚠️⚠️ DÚVIDA não devolve — devolver autorizaria a segunda venda", async () => {
    /**
     * INVARIANTE 4, agora também para o inventário: `incerta` significa que a
     * ordem PODE estar viva na corretora. Soltar a bolsa aqui deixaria uma
     * segunda venda sair para uma posição que talvez já esteja vendida.
     */
    spies.enviar.mockResolvedValueOnce({ tipo: "incerta", porque: "timeout" } as never);
    await POST(req({ side: "sell", amount: 0.01 }));
    expect(estado.devolucoes.some((d) => d.tipo === "intent")).toBe(false);
    expect(estado.reservadoQty).toBeCloseTo(0.01, 12);
  });
});

describe("A141 — a reserva composta não deixa meia reserva de pé", () => {
  /**
   * ⚠️ O ataque: a vaga diária é consumida, a segunda etapa recusa, e o
   * executor NÃO chama `liberar` — do ponto de vista dele nada foi reservado.
   * O caller devolvia só o inventário. ZERO ordem enviada e `trades_today` um
   * a mais: um trade do dia comido por uma ordem que nunca existiu.
   */
  it("⚠️⚠️ A141.1 — compra: vaga passa, exposição recusa, vaga VOLTA", async () => {
    /**
     * ⚠️ O PRÉ-VOO PRECISA PASSAR para o achado existir: é a reserva DENTRO
     * da costura que recusa, depois de a vaga diária já ter sido gasta.
     * Livro com 170 (o pré-voo vê 170 + 20 = 190 ≤ 200) e outra ordem em voo
     * segurando 20 (a reserva vê 210 > 200).
     */
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 170, status: "open" }];
    estado.reservadoUsd = 20;
    const r = await POST(req({ side: "buy", amount: 0.2 }));
    expect(r.status).not.toBe(200);
    expect(estado.tradesToday, "3, nunca 4").toBe(3);
    expect(estado.devolucoes.some((d) => d.tipo === "vaga")).toBe(true);
  });

  it("⚠️⚠️ A141.2 — venda: vaga passa, posse recusa, vaga VOLTA", async () => {
    // A bolsa inteira já está prometida a outra venda em voo.
    estado.reservadoQty = 0.01;
    const r = await POST(req({ side: "sell", amount: 0.01 }));
    expect(r.status).not.toBe(200);
    expect(estado.tradesToday).toBe(3);
  });

  it("⚠️⚠️ A141.3 — recusa PROVADA da corretora devolve tudo", async () => {
    spies.enviar.mockResolvedValueOnce({
      tipo: "recusada", porque: "insufficient balance", codigo: "40004",
    } as never);
    const r = await POST(req({ side: "sell", amount: 0.01 }));
    expect(r.status).not.toBe(200);
    expect(estado.tradesToday).toBe(3);
    expect(estado.reservadoQty).toBeCloseTo(0, 12);
  });

  it("⚠️⚠️ A141.4 — UNKNOWN não devolve NADA", async () => {
    spies.enviar.mockResolvedValueOnce({ tipo: "incerta", porque: "timeout" } as never);
    await POST(req({ side: "sell", amount: 0.01 }));
    expect(estado.tradesToday, "a vaga fica gasta: a ordem pode estar viva").toBe(4);
    expect(estado.reservadoQty).toBeCloseTo(0.01, 12);
  });

  it("⚠️⚠️ A141.6 — rollback que falha no banco é BARULHENTO, não fingido", async () => {
    estado.devolucaoDaVagaFalha = true;
    estado.posicoes = [{ id: "P9", base: "ETH", cost_usd: 170, status: "open" }];
    estado.reservadoUsd = 20;
    const r = await POST(req({ side: "buy", amount: 0.2 }));
    expect(r.status).not.toBe(200);
    // A vaga NÃO voltou — e isso tem nome, severidade e EVENTO EMITIDO.
    expect(estado.tradesToday).toBe(4);
    const aviso = estado.eventos.find((e) => e.nome === "autopilot_rollback_da_vaga_falhou");
    expect(aviso, "o evento precisa SAIR, não só existir no fonte").toBeDefined();
    const meta = (aviso!.payload as { meta?: Record<string, unknown> })?.meta ?? {};
    expect(meta.severity).toBe("high");
    expect(String(meta.why ?? "")).toMatch(/perdeu um trade do dia/);
  });

  it("⚠️ A141.5 — vaga negada nem chega a reservar inventário", async () => {
    estado.sessao.trades_today = 5;
    estado.sessao.max_trades_per_day = 5;
    const r = await POST(req({ side: "sell", amount: 0.01 }));
    expect(r.status).not.toBe(200);
    expect(estado.consultas.some((c) => c.fn === "reservarVendaDoBot")).toBe(false);
    estado.sessao.trades_today = 0;
  });
});

/**
 * ⚠️⚠️⚠️ O NAVEGADOR LIA UM SNAPSHOT — inconsistência do HEAD anterior.
 *
 * O relatório afirmava que `autorizarAumentoDeExposicao` lia o estado
 * financeiro no instante de cada COMPRA "nos dois canais". Era verdade no
 * cron e FALSO aqui: a rota chamava `avaliarRisco(estadoDaLinha(...))` sobre
 * a linha capturada no começo da requisição, e entre aquela leitura e o envio
 * passam preço, exposição, certificado, política, cofre, decrypt, gravação do
 * intent e as reservas — todos com `await`.
 *
 * Nesse intervalo o cron ou o recovery podem aplicar P&L, congelar o dia ou
 * levantar a contabilidade incompleta. Os testes abaixo mudam o BANCO no meio
 * da requisição (pela costura de reserva, que roda entre AUTHORIZED e
 * SUBMITTING) e exigem ZERO chamada à corretora.
 */
describe("o navegador relê o estado financeiro no instante da COMPRA", () => {
  /**
   * Muda o banco DEPOIS que a requisição começou e ANTES do portão financeiro.
   * `cex_transicionar` (para AUTHORIZED) roda entre a gravação do intent e a
   * costura de reserva — que é onde o portão vive.
   */
  function mudarOBancoDuranteARequisicao(patch: Record<string, unknown>) {
    let jaMudou = false;
    const original = bancoAtual!.cliente.rpc.bind(bancoAtual!.cliente);
    (bancoAtual!.cliente as unknown as { rpc: unknown }).rpc =
      async (nome: string, args: Record<string, unknown>) => {
        if (!jaMudou && nome === "cex_transicionar") {
          jaMudou = true;
          Object.assign(bancoAtual!.sessoes[0], patch);
        }
        return original(nome as never, args as never);
      };
    return () => jaMudou;
  }
  const bloqueada = () =>
    estado.eventos.some((e) => e.nome === "autopilot_entrada_bloqueada_no_instante");

  it("browser_stale_session_recovery_freeze_blocks_buy", async () => {
    // T0 — a requisição começa com a sessão saudável: −49, sem freeze.
    semearSessao({ pnl_today: -49, daily_loss_stop_usd: 50, frozen_until_day: null });
    // T1 — no meio da requisição, o recovery aplica −2 e congela o dia.
    const mudou = mudarOBancoDuranteARequisicao({
      pnl_today: -51, frozen_until_day: estado.utcDayKey(),
    });

    const r = await POST(req({ side: "buy", amount: 0.2 }));
    expect(mudou(), "a corrida precisa ter acontecido").toBe(true);
    // ⚠️ T2 — ZERO chamada à corretora, e o motivo é o estado de AGORA.
    expect(spies.enviar).not.toHaveBeenCalled();
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(bloqueada(), "o portão do último instante tem de ter recusado").toBe(true);
  });

  it("browser_stale_session_contabilidade_incompleta_blocks_buy", async () => {
    semearSessao({ pnl_today: 0, daily_loss_stop_usd: 500,
                   contabilidade_incompleta_em: null });
    const mudou = mudarOBancoDuranteARequisicao({
      contabilidade_incompleta_em: new Date().toISOString(),
    });

    const r = await POST(req({ side: "buy", amount: 0.2 }));
    expect(mudou()).toBe(true);
    expect(spies.enviar).not.toHaveBeenCalled();
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(bloqueada()).toBe(true);
  });

  it("⚠️ controle positivo: estado saudável, a COMPRA ATRAVESSA o portão", async () => {
    /**
     * ⚠️ Neste fixture uma COMPRA nunca chega à venue: ela para na autorização
     * final do A110 no banco (RPC 0060), que o arnês não monta. O que se mede
     * aqui é que o portão financeiro NÃO é um "não" universal — a ordem
     * saudável passa por ele e segue até a reserva e a autorização.
     */
    semearSessao({ pnl_today: 0, daily_loss_stop_usd: 500,
                   frozen_until_day: null, contabilidade_incompleta_em: null });
    await POST(req({ side: "buy", amount: 0.2 }));
    expect(bloqueada(), "o portão não pode recusar um estado saudável").toBe(false);
    // ⚠️ E ela avançou: a reserva foi tomada e depois devolvida pela recusa
    // PROVADA da autorização — prova de que passou do portão.
    expect(estado.devolucoes.some((d) => d.tipo === "intent")).toBe(true);
  });

  it("⚠️⚠️ a VENDA não é presa pelo portão — ela reduz risco", async () => {
    semearSessao({ pnl_today: -49, daily_loss_stop_usd: 50,
                   frozen_until_day: estado.utcDayKey(),
                   contabilidade_incompleta_em: new Date().toISOString() });
    // Congelada E com contabilidade incompleta; a saída não é barrada por ELE.
    await POST(req({ side: "sell", amount: 0.005 }));
    expect(bloqueada()).toBe(false);
  });
});
