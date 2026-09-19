/**
 * ⚠️⚠️⚠️ A130 + A130-B PELA ROTA, PONTA A PONTA — §20, §24, §27, §28.
 *
 * O `a130-sessao-autoriza.test.ts` prova a DECISÃO. Este prova o EFEITO: com a
 * sessão parada, expirada ou congelada, a rota não grava intent, não decifra o
 * cofre e não chega à corretora.
 *
 * ⚠️ O cenário §28 é o que nomeia o achado: sessão PARADA com conexão ATIVA e
 * CURRENT. A conexão continuar viva está CERTO — ela serve DCA e reconciliação
 * histórica. Ela só não autoriza o piloto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import type { RespostaDaVenue } from "@/lib/cex/execucao/venue-primitivo";
import type { CexId, CexCredentials } from "@/lib/cex/types";

const estado = vi.hoisted(() => {
  const utcDayKey = (d = new Date()) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return {
    utcDayKey,
    /** A linha da sessão, mutável por teste. */
    sessao: {
      id: "S1", conexao_id: "C1" as string | null,
      strategy_id: "e1", strategy_version: 1,
      allowed_symbols: null as string[] | null, strategy_hash: "h1",
      is_active: true,
      expires_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      frozen_until_day: null as string | null,
      last_reset_day: utcDayKey(),
      trades_today: 0,
      max_trades_per_day: 5,
      max_trade_usd: 100,
    },
    /** Quantas vezes o cofre foi DECIFRADO — §20 quer zero nas recusas. */
    decifrou: 0,
    /** A reserva concede? E quantas vezes foi pedida? */
    reservaConcede: true,
    reservas: 0,
  };
});

type EnviarNaVenue = (
  id: CexId, creds: CexCredentials,
  req: { symbol: string; side: "buy" | "sell"; type: "market" | "limit";
         amount: number; price?: number | null; clientOrderId: string },
) => Promise<RespostaDaVenue>;
const spies = vi.hoisted(() => ({
  enviar: vi.fn<EnviarNaVenue>(async () => ({
    tipo: "aceita", ordem: { id: "EXT", filled: 0, status: "open" } as never,
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
vi.mock("@/lib/auth/session", () => ({ getSession: async () => ({ sub: "0xA130" }) }));
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
  reservarTradeDaSessao: async () => {
    estado.reservas++;
    return estado.reservaConcede
      ? { ok: true as const, tradesDepois: estado.sessao.trades_today + 1 }
      : { ok: false as const, motivo: "limite_diario" as const, porque: "teto" };
  },
  liberarTradeDaSessao: async () => true,
}));
vi.mock("@/lib/autopilot/certificado", () => ({ certificadoVivo: async () => null }));
vi.mock("@/lib/autopilot/regime", () => ({ regimeDaBase: async () => "TRENDING_UP" }));
vi.mock("@/lib/autopilot/politica", () => ({
  /**
   * ⚠️ O CERTIFICADO NÃO É NULO AQUI DE PROPÓSITO. Compra autônoma REAL sem
   * certificado é recusada pelo banco (A110, migration 0052) — e os casos de
   * COMPRA deste arquivo existem para exercitar o teto do A130-B, não aquela
   * regra, que tem testes próprios.
   */
  avaliarDecisaoDeEstrategia: () => ({
    permite: true, versao: 1, tetoEfetivoUsd: 1_000, certificadoId: "CERT-A130",
  }),
}));
vi.mock("@/lib/cex/conexoes", () => ({
  // ⚠️ A conexão está SEMPRE viva nestes testes — é o ponto do §28.
  conexaoParaExecucao: async () => ({ ok: true, conexao: { id: "C1" } }),
  decifrarConexao: () => { estado.decifrou++; return { apiKey: "K", apiSecret: "S" }; },
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

beforeEach(() => {
  bancoAtual = bancoFalso();
  spies.enviar.mockClear();
  estado.decifrou = 0;
  estado.reservas = 0;
  estado.reservaConcede = true;
  estado.sessao.is_active = true;
  estado.sessao.conexao_id = "C1";
  estado.sessao.frozen_until_day = null;
  estado.sessao.expires_at = new Date(Date.now() + 6 * 3_600_000).toISOString();
  estado.sessao.trades_today = 0;
  estado.sessao.max_trades_per_day = 5;
  estado.sessao.max_trade_usd = 100;
  estado.sessao.last_reset_day = estado.utcDayKey();
});

/** Recusou de verdade: nada gravado, nada enviado, cofre intocado. */
async function esperaRecusaTotal(r: Response, motivo: string) {
  expect(r.status).not.toBe(200);
  const corpo = await r.json();
  expect(corpo.error).toBe("sessao_nao_autorizada");
  expect(corpo.motivo).toBe(motivo);
  expect(bancoAtual!.intents).toHaveLength(0);
  expect(spies.enviar).not.toHaveBeenCalled();
  // ⚠️ §20: a credencial NEM DEVE ser desencriptada numa sessão sem autorização.
  expect(estado.decifrou).toBe(0);
  // E nenhuma vaga do teto diário foi consumida por uma ordem que não saiu.
  expect(estado.reservas).toBe(0);
}

describe("§28 — PARAR com conexão ainda ATIVA", () => {
  it("⚠️⚠️ sessão parada + conexão CURRENT: ZERO ordem", async () => {
    estado.sessao.is_active = false;
    await esperaRecusaTotal(await POST(req()), "sessao_inativa");
  });
});

describe("A130.3/A130.4 — expirada e congelada", () => {
  it("⚠️⚠️ expirada: ZERO ordem", async () => {
    estado.sessao.expires_at = new Date(Date.now() - 1_000).toISOString();
    await esperaRecusaTotal(await POST(req()), "sessao_expirada");
  });

  it("⚠️⚠️ congelada hoje: ZERO ordem", async () => {
    estado.sessao.frozen_until_day = estado.utcDayKey();
    await esperaRecusaTotal(await POST(req()), "sessao_congelada");
  });

  it("⚠️⚠️ teto diário atingido: ZERO ordem", async () => {
    estado.sessao.trades_today = 5;
    estado.sessao.max_trades_per_day = 5;
    await esperaRecusaTotal(await POST(req()), "limite_diario");
  });

  it("⚠️ sessão legada sem conexão: ZERO ordem", async () => {
    estado.sessao.conexao_id = null;
    await esperaRecusaTotal(await POST(req()), "conexao_ausente");
  });
});

describe("A130.2 — o gêmeo positivo: sessão válida SEGUE", () => {
  it("⚠️ ativa, no prazo, sem freeze, com vaga: a ordem sai", async () => {
    // Sem isto, uma rota que recusasse sempre passaria em todo o resto.
    const r = await POST(req());
    expect(r.status).toBe(200);
    expect(bancoAtual!.intents).toHaveLength(1);
    expect(spies.enviar).toHaveBeenCalledTimes(1);
    expect(estado.decifrou).toBe(1);
    expect(estado.reservas).toBe(1);
  });
});

describe("A130-B.1 — o corpo não amplia o teto", () => {
  /**
   * ⚠️ AS ORDENS AQUI SÃO DE COMPRA, e isso não é detalhe.
   *
   * `checkRealNotional` aplica o teto POR TRADE só a compras — vendas são
   * isentas por decisão PRÉ-EXISTENTE ("são naturalmente limitadas pela bolsa
   * do usuário"). O §15 manda preservar a lógica de preço/referência e trocar
   * apenas a FONTE do teto inseguro, então essa isenção fica como está — e o
   * teste logo abaixo a FIXA, para ela ser visível em vez de silenciosa.
   */
  it("⚠️⚠️ sessão 50, corpo 1000, compra de ~600: RECUSADA", async () => {
    // 6 × $100 de referência = $600 de nocional, contra teto de sessão de 50.
    estado.sessao.max_trade_usd = 50;
    const r = await POST(req({ side: "buy", amount: 6, maxNotionalUsd: 1_000 }));
    expect(r.status).not.toBe(200);
    expect((await r.json()).error).toBe("notional_guard");
    expect(bancoAtual!.intents).toHaveLength(0);
    expect(spies.enviar).not.toHaveBeenCalled();
    expect(estado.decifrou).toBe(0);
  });

  it("⚠️ o gêmeo: com a sessão autorizando, a recusa DEIXA de ser o nocional", async () => {
    /**
     * ⚠️ ELE NÃO AFIRMA 200, e a razão é honesta: uma COMPRA autônoma real
     * ainda precisa atravessar a autorização final do A110 no banco (RPC
     * 0060), que este fixture não monta — certificado com envelope, limites,
     * hash. Exigir 200 aqui faria o teste medir aquela cadeia, não esta.
     *
     * O que ele precisa provar é que a recusa do teste anterior veio do teto
     * da SESSÃO, e não do tamanho da ordem. Mudando SÓ o teto da sessão, o
     * `notional_guard` some — e isso isola a causa.
     */
    estado.sessao.max_trade_usd = 1_000;
    const r = await POST(req({ side: "buy", amount: 6, maxNotionalUsd: 1_000 }));
    const corpo = await r.json().catch(() => ({}));
    expect(corpo.error).not.toBe("notional_guard");
  });

  it("⚠️ corpo MENOR que a sessão reduz de verdade", async () => {
    estado.sessao.max_trade_usd = 1_000;
    const r = await POST(req({ side: "buy", amount: 6, maxNotionalUsd: 50 }));
    expect(r.status).not.toBe(200);
    expect((await r.json()).error).toBe("notional_guard");
  });

  it("⚠️⚠️ LIMITAÇÃO CONHECIDA: a VENDA não é limitada pelo teto por trade", () => {
    /**
     * Este teste não celebra o comportamento — ele o DOCUMENTA onde dá para
     * ver. `checkRealNotional` isenta `side === "sell"` do teto por trade desde
     * antes do A130; o teto GLOBAL (`AUTOPILOT_HARD_CEILING_USD`) continua
     * valendo para os dois lados.
     *
     * Mudar isso é decisão de produto, fora do escopo do A130-B (§15), e está
     * relatado como limitação conhecida na entrega.
     */
    const GUARDA = readFileSync("src/lib/autopilot/price-guard.ts", "utf8");
    expect(GUARDA).toMatch(/side === "buy" && realNotionalUsd > maxTradeUsd/);
    expect(GUARDA).toMatch(/realNotionalUsd > AUTOPILOT_HARD_CEILING_USD/);
  });
});

describe("§17 — a vaga é reservada antes do efeito externo", () => {
  it("⚠️⚠️ reserva negada: ZERO createOrder", async () => {
    estado.reservaConcede = false;
    const r = await POST(req());
    expect(r.status).not.toBe(200);
    expect(spies.enviar).not.toHaveBeenCalled();
    expect(estado.reservas).toBe(1);
  });
});
