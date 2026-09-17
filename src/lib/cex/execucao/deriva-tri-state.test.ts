/**
 * ⚠️⚠️ A128 (round 8) — O VEREDITO TRI-STATE DA DERIVA DE TRADES.
 *
 * O buraco: `if (!t.orderId) continue` — um trade desconhecido SEM id de
 * ordem sumia da análise e o veredito saía `derivou:false`, um "sem drift"
 * fabricado sobre um trade que ninguém atribuiu. Agora a decisão por trade é
 * exata e nesta ordem (§38):
 *
 *   (0) anterior à janela           → explicado;
 *   (1) `tradeId` já no livro       → explicado (orderId dispensado, §38.1);
 *   (2) `orderId` ausente           → NÃO ATRIBUÍDO (não acusa nem absolve);
 *   (3) `orderId` conhecido         → explicado;
 *   (4) senão                       → ÓRFÃO (deriva).
 *
 * Agregação (§40): órfão > não-atribuído > ok.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import {
  detectarDeriva, type TradeObservado,
} from "@/lib/cex/execucao/deriva";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { TradeDaVenue } from "@/lib/cex/execucao/venue-leitura";

const JANELA = { ordensConhecidas: new Set<string>(), tradesNoLivro: new Set<string>(),
                 desdeMs: 1000 };

const t = (o: Partial<TradeObservado> & Pick<TradeObservado, "tradeId">): TradeObservado => ({
  orderId: o.orderId === undefined ? "ORD-X" : o.orderId,
  symbol: o.symbol ?? "BTC/USDT",
  qty: o.qty ?? 1, executedAtMs: o.executedAtMs ?? 2000, tradeId: o.tradeId,
});

describe("A128.1 — a ordem de decisão por trade e a agregação tri-state", () => {
  it("(0) trade ANTERIOR à janela é explicado mesmo sem orderId e sem estar no livro", () => {
    const v = detectarDeriva([t({ tradeId: "T-VELHO", orderId: null, executedAtMs: 500 })],
      JANELA);
    expect(v.tipo).toBe("ok");
  });

  it("(1) tradeId NO LIVRO dispensa o orderId — mesmo null, mesmo desconhecido", () => {
    const v = detectarDeriva([t({ tradeId: "T1", orderId: null })],
      { ...JANELA, tradesNoLivro: new Set(["T1"]) });
    expect(v.tipo).toBe("ok");
    const v2 = detectarDeriva([t({ tradeId: "T1", orderId: "ORD-DE-FORA" })],
      { ...JANELA, tradesNoLivro: new Set(["T1"]) });
    expect(v2.tipo).toBe("ok");
  });

  it("(2) orderId ausente → INDETERMINADO com os não-atribuídos nomeados", () => {
    const v = detectarDeriva([t({ tradeId: "T-S1", orderId: null }),
                              t({ tradeId: "T-S2", orderId: "" })], JANELA);
    expect(v.tipo).toBe("indeterminado");
    if (v.tipo === "indeterminado") {
      expect(v.naoAtribuidos.map((x) => x.tradeId)).toEqual(["T-S1", "T-S2"]);
      expect(v.motivo).toContain("2 trade(s)");
    }
  });

  it("(3) orderId conhecido → ok; (4) orderId alheio → DERIVA com o achado", () => {
    const ok = detectarDeriva([t({ tradeId: "T1", orderId: "ORD-NOSSA" })],
      { ...JANELA, ordensConhecidas: new Set(["ORD-NOSSA"]) });
    expect(ok.tipo).toBe("ok");
    const v = detectarDeriva([t({ tradeId: "T2", orderId: "ORD-ALHEIA" })], JANELA);
    expect(v.tipo).toBe("deriva");
    if (v.tipo === "deriva") {
      expect(v.achado.motivo).toBe("trade_nao_atribuivel");
      expect(v.achado.tradesOrfaos.map((x) => x.tradeId)).toEqual(["T2"]);
    }
  });

  it("⚠️⚠️ agregação (§40): órfão VENCE o não-atribuído — deriva, nunca indeterminado", () => {
    const v = detectarDeriva([t({ tradeId: "T-SEM", orderId: null }),
                              t({ tradeId: "T-ORF", orderId: "ORD-ALHEIA" })], JANELA);
    expect(v.tipo).toBe("deriva");
  });

  it("⚠️ misto explicado + não-atribuído, sem órfão → indeterminado", () => {
    const v = detectarDeriva([t({ tradeId: "T1", orderId: "ORD-NOSSA" }),
                              t({ tradeId: "T-SEM", orderId: null })],
      { ...JANELA, ordensConhecidas: new Set(["ORD-NOSSA"]) });
    expect(v.tipo).toBe("indeterminado");
  });
});

/** Um intent de conexão C1, como o cron o gravaria. */
function plantarIntent(b: BancoFalso, extra: Record<string, unknown> = {}): IntentRow {
  const linha = {
    id: `i${b.intents.length + 1}`, client_order_id: "zsA128",
    origin: "dca_cron", autonomous: true,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 10, limit_price: null,
    requested_notional_usd: 100, simulated: false, state: "UNKNOWN",
    state_reason: null, external_order_id: null,
    filled_qty: 0, filled_quote: 0, canceled_qty: 0,
    fee_total: null, fee_currency: null,
    wallet_address: null, session_id: null, plan_id: null, cycle_number: null,
    conexao_id: "C1", strategy_id: null, strategy_version: null,
    strategy_hash: null, certificate_id: null, credential_fingerprint: null,
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    submitted_at: null, last_reconciled_at: null, reconcile_attempts: 0,
    ...extra,
  };
  b.intents.push(linha);
  return linha as unknown as IntentRow;
}

const trade = (tradeId: string, orderId: string | null): TradeDaVenue =>
  ({ tradeId, orderId, qty: 1, price: 100, quote: 100,
     fee: null, feeCurrency: null, executedAt: null });

const HIST_LIMPO = { possivelmenteIncompleto: false,
                     registrosInvalidos: { total: 0, porMotivo: {} } };

function reconciliar(b: BancoFalso, intent: IntentRow, trades: TradeDaVenue[],
                     tradesDaOrdem: TradeDaVenue[]) {
  return reconciliarIntent({
    db: b.cliente, credenciais: async () => ({ apiKey: "k", apiSecret: "s" }),
    ler: vi.fn(async () => ({ tipo: "so_trades" as const, tradesDaOrdem,
                              historico: { trades, ...HIST_LIMPO } })),
  }, intent);
}

describe("A128.2 — tri-state NO RECONCILIADOR, com escopo de conta (cross-account)", () => {
  it("⚠️⚠️ trade sem orderId na conta → INDETERMINADO: RECONCILIATION_REQUIRED, nunca verde nem deriva", async () => {
    const b = bancoFalso();
    const i1 = plantarIntent(b, { id: "i1" });
    const r = await reconciliar(b, i1,
      [trade("T-B", "ORD-B"), trade("T-SEM", null)], [trade("T-B", "ORD-B")]);
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("sem id de ordem");
    // Nada foi liquidado por cima do "não sei".
    expect(b.fills).toHaveLength(0);
    expect(String(b.intents[0].state)).toBe("RECONCILIATION_REQUIRED");
  });

  it("⚠️⚠️ cross-account segue P0: orderId de OUTRA conta é órfão → QUARENTENA (tri-state não abriu brecha)", async () => {
    const b = bancoFalso();
    // A ordem ORD-123 existe no livro — mas na conexão C-A, não em C1.
    plantarIntent(b, { id: "iA", conexao_id: "C-A", external_order_id: "ORD-123" });
    const i1 = plantarIntent(b, { id: "i1" });
    const r = await reconciliar(b, i1,
      [trade("T-X", "ORD-123")], []);
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT");
    expect(String(b.intents.find((i) => i.id === "i1")?.state)).toBe("QUARANTINED");
  });
});

describe("A128.3 — guarda estrutural: o descarte silencioso não volta", () => {
  const DERIVA = readFileSync("src/lib/cex/execucao/deriva.ts", "utf8");
  const RECONC = readFileSync("src/lib/cex/execucao/reconciliador.ts", "utf8");
  const semComentarios = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
     .replace(/^(\s*)\/\/.*$/gm, "$1");

  it("⚠️⚠️ `if (!t.orderId) continue;` não existe mais — orderId null alimenta naoAtribuidos", () => {
    const codigo = semComentarios(DERIVA);
    expect(codigo).not.toMatch(/if \(!t\.orderId\) continue;/);
    expect(codigo).toMatch(/if \(!t\.orderId\) \{ naoAtribuidos\.push\(t\); continue; \}/);
    expect(codigo).toMatch(/VereditoDeDerivaDeTrades/);
  });

  it("⚠️⚠️ o reconciliador consome o TRI-STATE (`v.tipo`), nunca o binário (`v.derivou`)", () => {
    const codigo = semComentarios(RECONC);
    expect(codigo).toMatch(/v\.tipo === "deriva"/);
    expect(codigo).toMatch(/v\.tipo === "indeterminado"/);
    expect(codigo).not.toMatch(/v\.derivou/);
    // E o bloco indeterminado é UM helper compartilhado pelos caminhos 1/2/3.
    const chamadas = codigo.match(/aplicarAtribuicaoIndeterminada\(db, intent, tentativas/g) ?? [];
    expect(chamadas.length).toBeGreaterThanOrEqual(2);
  });
});
