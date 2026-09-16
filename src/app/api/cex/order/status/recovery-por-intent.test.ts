/**
 * ⚠️⚠️ A80/A102 — RECOVERY REAL POR intentId em /api/cex/order/status.
 *
 * A rota era um proxy de leitura por `orderId`+`symbol`: não conhecia intent,
 * não reconciliava, e depois de um timeout o cliente não tinha ONDE perguntar
 * "a minha ordem existe?". A saída insegura era reenviar (compra dobrada) ou
 * desistir (venda perdida).
 *
 * Estes testes invocam o POST real da rota sobre banco e venue falsos:
 *
 *   · a autoridade é o INTENT (venue/símbolo/ordem do livro, não do body);
 *   · a credencial do body só LÊ — `createOrder` tem spy e NUNCA é chamado;
 *   · FILLED responde os números reais; terminal responde o estado; dúvida
 *     responde 202 "não reenvie"; leitura falha é ERRO honesto, nunca FAILED,
 *     nunca "a ordem não existe".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { bancoFalso } from "@/lib/cex/execucao/banco-falso";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import { impressaoDaCredencial } from "@/lib/cex/fingerprint";

/** A120: a env de HMAC em TODOS os testes deste arquivo (vitest isola por
 *  arquivo; o beforeEach garante mesmo sob reuso de processo). */
const HMAC_DE_TESTE = "chave-hmac-de-teste-a120-nao-e-real";

// ── venue falsa: um objeto ccxt-like com spy de createOrder ──────────────
class OrderNotFound extends Error {}

const estadoDaVenue = vi.hoisted(() => ({
  createOrder: vi.fn(async () => { throw new Error("createOrder NAO PODE ser chamado no recovery"); }),
  /** A120: contagem de TODA leitura na venue — o gate de fingerprint tem de
   *  zerar estas contagens, não só a de escrita. */
  chamadas: { fetchOrder: 0, fetchMyTrades: 0, fetchClosedOrders: 0 },
  fetchOrderImpl: async (..._a: unknown[]): Promise<Record<string, unknown>> => {
    throw new OrderNotFound("order does not exist");
  },
  fetchMyTradesImpl: async (..._a: unknown[]): Promise<Array<Record<string, unknown>>> => [],
  fetchClosedOrdersImpl: async (..._a: unknown[]): Promise<Array<Record<string, unknown>>> => [],
}));

let bancoAtual: ReturnType<typeof bancoFalso> | null = null;

vi.mock("@/lib/rate-limit", () => ({
  rateLimitDurable: async () => ({ ok: true }),
  getClientId: () => "teste",
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => bancoAtual?.cliente ?? null,
}));
vi.mock("@/lib/cex/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cex/server")>();
  return {
    ...real,
    instanciarExchange: async () => ({
      createOrder: estadoDaVenue.createOrder,
      fetchOrder: (...a: unknown[]) => {
        estadoDaVenue.chamadas.fetchOrder++;
        return estadoDaVenue.fetchOrderImpl(...a);
      },
      fetchMyTrades: (...a: unknown[]) => {
        estadoDaVenue.chamadas.fetchMyTrades++;
        return estadoDaVenue.fetchMyTradesImpl(...a);
      },
      fetchClosedOrders: (...a: unknown[]) => {
        estadoDaVenue.chamadas.fetchClosedOrders++;
        return estadoDaVenue.fetchClosedOrdersImpl(...a);
      },
    }),
  };
});

import { POST } from "@/app/api/cex/order/status/route";

const CREDS = { apiKey: "k12345678", apiSecret: "s12345678" };
const VELHO = new Date(Date.now() - 10 * 60_000).toISOString();
const AGORA = new Date().toISOString();

function reqDe(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/cex/order/status", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function plantarIntent(extra: Record<string, unknown> = {}): Promise<IntentRow> {
  const { data } = await bancoAtual!.cliente.from("cex_execution_intents").insert({
    id: crypto.randomUUID(),
    client_order_id: `zswap_recovery_${Math.random().toString(36).slice(2)}`,
    origin: "cex_order_manual", autonomous: false, wallet_address: null,
    session_id: null, conexao_id: null,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 0.01,
    simulated: false, state: "UNKNOWN", created_at: VELHO,
    /**
     * ⚠️ A120: o fixture nasce VINCULADO à credencial CREDS, como a ordem
     * manual real nasce depois da 0061 — o fluxo feliz do Round 3 só existe
     * agora COM o fingerprint coerente. Os testes de legado/sessão sobrescrevem
     * com `credential_fingerprint: null` via `extra`.
     */
    credential_fingerprint: impressaoDaCredencial("binance", CREDS.apiKey),
    ...extra,
  }).select("*").limit(1);
  return (data as IntentRow[])[0];
}

/** A venue confirma: 0.01 BTC a 61.000, fee 0.61 USDT. */
function venueComFill() {
  estadoDaVenue.fetchOrderImpl = async () => ({
    id: "ext-9", status: "closed", filled: 0.01, average: 61_000, cost: 610,
    fee: { cost: 0.61, currency: "USDT" }, timestamp: Date.now(),
  });
  estadoDaVenue.fetchMyTradesImpl = async () => [{
    id: "t9", order: "ext-9", amount: 0.01, price: 61_000, cost: 610,
    fee: { cost: 0.61, currency: "USDT" }, timestamp: Date.now(),
  }];
  estadoDaVenue.fetchClosedOrdersImpl = async () => [];
}

/** A venue NEGA a ordem em todos os caminhos. */
function venueQueNega() {
  estadoDaVenue.fetchOrderImpl = async () => { throw new OrderNotFound("no such order"); };
  estadoDaVenue.fetchMyTradesImpl = async () => [];
  estadoDaVenue.fetchClosedOrdersImpl = async () => [];
}

/** A venue NÃO RESPONDE (credencial recusada / rede). */
function venueQuebrada(msg = "binance Invalid API-key, IP, or permissions for action") {
  estadoDaVenue.fetchOrderImpl = async () => { throw new Error(msg); };
  estadoDaVenue.fetchMyTradesImpl = async () => { throw new Error(msg); };
  estadoDaVenue.fetchClosedOrdersImpl = async () => { throw new Error(msg); };
}

beforeEach(() => {
  process.env.CEX_RECOVERY_HMAC_KEY = HMAC_DE_TESTE;
  bancoAtual = bancoFalso();
  estadoDaVenue.createOrder.mockClear();
  estadoDaVenue.chamadas.fetchOrder = 0;
  estadoDaVenue.chamadas.fetchMyTrades = 0;
  estadoDaVenue.chamadas.fetchClosedOrders = 0;
  venueQueNega();
});

describe("A80/A102 — recovery por intentId", () => {
  it("⚠️⚠️ fill confirmado → 200 FILLED com qty/quote/fee REAIS, zero createOrder", async () => {
    const intent = await plantarIntent();
    venueComFill();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.state).toBe("FILLED");
    expect(j.filledQty).toBeCloseTo(0.01, 10);
    expect(j.filledQuote).toBeCloseTo(610, 6);
    expect(j.feeTotal).toBeCloseTo(0.61, 10);
    expect(j.feeCurrency).toBe("USDT");
    // Resposta mínima: nada de segredo, carteira ou intents alheios.
    expect(JSON.stringify(j)).not.toContain("s12345678");
    expect(JSON.stringify(j)).not.toContain("k12345678");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ cancelamento confirmado (ausente em todos, intent velho) → 200 terminal CANCELED", async () => {
    const intent = await plantarIntent();
    venueQueNega();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.state).toBe("CANCELED");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ inconclusivo (ausente mas CEDO demais) → 202 'não reenvie'", async () => {
    const intent = await plantarIntent({ created_at: AGORA });
    venueQueNega();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(j.state).toBe("UNKNOWN");
    expect(j.mensagem).toMatch(/NAO reenvie/i);
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️⚠️ credencial inválida → erro honesto, intent NÃO vira FAILED e ninguém diz 'não existe'", async () => {
    const intent = await plantarIntent();
    venueQuebrada();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect([400, 401, 502, 504]).toContain(res.status);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).not.toBe("order_not_found");
    expect(JSON.stringify(j)).not.toMatch(/ordem nao existe|order does not exist/i);
    // ⚠️ O intent NÃO foi marcado FAILED — nada foi concluído sobre a ordem.
    const { data } = await bancoAtual!.cliente.from("cex_execution_intents")
      .select("*").eq("id", intent.id).limit(1);
    const depois = (data as IntentRow[])[0];
    expect(depois.state).not.toBe("FAILED_PRE_SUBMIT");
    expect(depois.state).toBe("UNKNOWN");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("intent inexistente → 404 seguro", async () => {
    const res = await POST(reqDe({ intentId: crypto.randomUUID(), ...CREDS }));
    expect(res.status).toBe(404);
    const j = await res.json();
    expect(j.error).toBe("intent_nao_encontrado");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("intentId malformado → 400", async () => {
    const res = await POST(reqDe({ intentId: "nao-e-uuid", ...CREDS }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_intent_id");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ intent de PILOTO (com session_id) → recusa use_a_sessao, sem tocar na venue", async () => {
    // Piloto/DCA NÃO têm fingerprint (credencial no cofre) — e a recusa é
    // `use_a_sessao`, não `recovery_not_bound`: o caminho deles é a sessão.
    const intent = await plantarIntent({ session_id: "sess-1", credential_fingerprint: null });
    venueComFill();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("use_a_sessao");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ intent de conexão (conexao_id) → mesma recusa", async () => {
    const intent = await plantarIntent({ conexao_id: "cx-1" });
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("use_a_sessao");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("⚠️⚠️ exchange do body DIVERGENTE da do intent → recusa; o body não sobrepõe o livro", async () => {
    const intent = await plantarIntent();
    venueComFill();
    const res = await POST(reqDe({ intentId: intent.id, exchange: "bybit", ...CREDS }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("exchange_divergente");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("exchange do body IGUAL à do intent é aceita (redundância ok, divergência não)", async () => {
    const intent = await plantarIntent();
    venueComFill();
    const res = await POST(reqDe({ intentId: intent.id, exchange: "Binance", ...CREDS }));
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("FILLED");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("sem credencial utilizável → 400, sem venue e sem escrita", async () => {
    const intent = await plantarIntent();
    const res = await POST(reqDe({ intentId: intent.id, apiKey: "curta" }));
    expect(res.status).toBe(400);
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });
});

describe("A120 — o gate de fingerprint no recovery (ANTES de venue/livro)", () => {
  /** Lê o intent como ele ficou DEPOIS da chamada. */
  async function depois(intentId: string): Promise<IntentRow> {
    const { data } = await bancoAtual!.cliente.from("cex_execution_intents")
      .select("*").eq("id", intentId).limit(1);
    return (data as IntentRow[])[0];
  }
  const zeroVenue = () => {
    expect(estadoDaVenue.chamadas.fetchOrder).toBe(0);
    expect(estadoDaVenue.chamadas.fetchMyTrades).toBe(0);
    expect(estadoDaVenue.chamadas.fetchClosedOrders).toBe(0);
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  };

  it("A120.2 ⚠️⚠️ a MESMA key reconcilia — o fluxo feliz do Round 3 segue intacto", async () => {
    const intent = await plantarIntent();
    venueComFill();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("FILLED");
    expect((await depois(intent.id)).state).toBe("FILLED");
  });

  it("A120.3 ⚠️⚠️⚠️ ATACANTE: mesma exchange, OUTRA key → 403, ZERO venue/reconciliação, intent intacto", async () => {
    const intent = await plantarIntent();
    venueComFill(); // sem o gate, a venue ENCHERIA o livro alheio aqui
    const res = await POST(reqDe({
      intentId: intent.id, apiKey: "k-do-atacante-1", apiSecret: "s-do-atacante-1",
    }));
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.error).toBe("credential_mismatch");
    // ZERO venue, ZERO reconciliarIntent, ZERO UPDATE, ZERO reconcile_attempt:
    zeroVenue();
    const intacto = await depois(intent.id);
    expect(intacto.state).toBe("UNKNOWN");
    expect(intacto.external_order_id).toBeNull();
    expect(Number(intacto.reconcile_attempts)).toBe(0);
    expect(Number(intacto.filled_qty)).toBe(0);
    // E a resposta não vaza a impressão gravada.
    expect(JSON.stringify(j)).not.toContain(String(intent.credential_fingerprint));
  });

  it("A120.4 ⚠️⚠️ key CERTA + secret ERRADA → erro honesto da venue, intent segue UNKNOWN (nunca CANCELED por auth)", async () => {
    const intent = await plantarIntent();
    venueQuebrada("binance Invalid API-key, IP, or permissions for action");
    const res = await POST(reqDe({
      intentId: intent.id, apiKey: CREDS.apiKey, apiSecret: "s-errado-999",
    }));
    // Passou no fingerprint (a key é a mesma) e a VENUE recusou: erro honesto.
    expect([400, 401, 502, 504]).toContain(res.status);
    const j = await res.json();
    expect(j.ok).toBe(false);
    expect(j.error).not.toBe("credential_mismatch");
    const dep = await depois(intent.id);
    expect(dep.state).toBe("UNKNOWN");
    expect(dep.state).not.toBe("CANCELED");
    expect(estadoDaVenue.createOrder).not.toHaveBeenCalled();
  });

  it("A120.5 ⚠️⚠️ intent LEGADO (fingerprint null) → 409 recovery_not_bound, fail-closed, zero venue", async () => {
    const intent = await plantarIntent({ credential_fingerprint: null });
    venueComFill(); // mesmo com fill esperando, o legado NÃO reconcilia às cegas
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("recovery_not_bound");
    zeroVenue();
    const intacto = await depois(intent.id);
    expect(intacto.state).toBe("UNKNOWN");
    expect(Number(intacto.reconcile_attempts)).toBe(0);
  });

  it("A120.9 ⚠️⚠️ a apiKey é EXATA: 'AbC…' ≠ 'abc…' — caixa diferente → 403", async () => {
    const intent = await plantarIntent({
      credential_fingerprint: impressaoDaCredencial("binance", "AbCdefgh123"),
    });
    venueComFill();
    const res = await POST(reqDe({
      intentId: intent.id, apiKey: "abcdefgh123", apiSecret: "s12345678",
    }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("credential_mismatch");
    zeroVenue();
  });

  it("A120.7 ⚠️ o fingerprint NUNCA aparece na resposta — nem no sucesso", async () => {
    const intent = await plantarIntent();
    venueComFill();
    const res = await POST(reqDe({ intentId: intent.id, ...CREDS }));
    expect(res.status).toBe(200);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain(String(intent.credential_fingerprint));
    expect(texto).not.toContain("credential_fingerprint");
    expect(texto).not.toContain(CREDS.apiKey);
    expect(texto).not.toContain(CREDS.apiSecret);
  });
});

describe("A80/A102 — guarda estrutural do caminho novo", () => {
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
  const ROTA = semComentarios(
    readFileSync("src/app/api/cex/order/status/route.ts", "utf8"));

  it("o modo antigo (orderId+symbol) continua intacto", () => {
    expect(ROTA).toContain("fetchCexOrderStatus(exchange, creds, body.orderId!, body.symbol!)");
    expect(ROTA).toMatch(/error: "invalid_order_id"/);
  });

  it("⚠️⚠️ o caminho intentId reconcilia pelo LIVRO e relê antes de responder", () => {
    expect(ROTA).toContain("intentPorId(db, intentId)");
    expect(ROTA).toMatch(/reconciliarIntent\(\{ db, credenciais: async \(\) => creds \}, intent\)/);
    // E responde 202 com a proibição explícita de reenvio.
    expect(ROTA).toMatch(/status: 202/);
    expect(ROTA).toMatch(/NAO reenvie a ordem/);
  });

  it("⚠️⚠️⚠️ nada nesta rota envia ordem — a palavra de escrita não existe aqui", () => {
    expect(ROTA).not.toMatch(/\.\s*createOrder\s*\(/);
    expect(ROTA).not.toMatch(/executarOrdemCex|venue-primitivo/);
  });

  it("A120 ⚠️⚠️⚠️ GUARDA ESTRUTURAL: impressaoConfere ANTES de reconciliarIntent, e o fingerprint NUNCA vem do body", () => {
    const iConfere = ROTA.indexOf("impressaoConfere(");
    const iReconcilia = ROTA.indexOf("reconciliarIntent(");
    expect(iConfere).toBeGreaterThan(-1);
    expect(iReconcilia).toBeGreaterThan(-1);
    expect(iConfere).toBeLessThan(iReconcilia);
    // O gate existe e fecha os dois lados: null → 409, divergente → 403.
    expect(ROTA).toContain("recovery_not_bound");
    expect(ROTA).toContain("credential_mismatch");
    expect(ROTA).toMatch(/intent\.credential_fingerprint == null/);
    // O fingerprint é calculado do (intent, body.apiKey) — JAMAIS lido do body.
    expect(ROTA).not.toMatch(/body\.credentialFingerprint/);
    expect(ROTA).not.toMatch(/body\.credential_fingerprint/);
    // E a rota de CRIAÇÃO também não aceita fingerprint apresentado pelo cliente.
    const ROTA_CRIACAO = semComentarios(
      readFileSync("src/app/api/cex/order/route.ts", "utf8"));
    expect(ROTA_CRIACAO).not.toMatch(/body\.credentialFingerprint/);
    expect(ROTA_CRIACAO).not.toMatch(/body\.credential_fingerprint/);
    expect(ROTA_CRIACAO).toMatch(/impressaoDaCredencial\(exchange, body\.apiKey\)/);
  });
});
