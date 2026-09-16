/**
 * ⚠️⚠️ A124 — ESCOPO DE CONTA NA ATRIBUIÇÃO (cross-account CEX).
 *
 * Antes deste round, os conjuntos "ordens conhecidas" e "trades no livro" da
 * checagem de deriva eram por CORRETORA, sem conta: duas contas do mesmo
 * cliente na mesma exchange se absolviam mutuamente. Estes testes provam, por
 * cenário, que a atribuição agora é POR CONTA (conexão / sessão / fingerprint)
 * e que o indeterminado NUNCA vira verde.
 *
 * Mapa: A124.1–A124.12 + §19/§34 (a recuperação do A80/A102 segue resolvendo)
 * + a guarda estrutural (§42) + A126.1–A126.6 (o escopo conexão materializa
 * as sessões da conexão) + a guarda §45.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  reconciliarIntent, TENTATIVAS_ATE_QUARENTENA,
} from "@/lib/cex/execucao/reconciliador";
import {
  resolverEscopoDaConta, ordensConhecidasNoEscopo, tradesNoLivroNoEscopo,
  idsDeSessoesDaConexao,
} from "@/lib/cex/execucao/escopo-de-conta";
import type { IntentRow } from "@/lib/cex/execucao/intents";
import type { LeituraDaOrdem, TradeDaVenue } from "@/lib/cex/execucao/venue-leitura";

const VELHO = new Date(Date.now() - 10 * 60_000).toISOString();
const CREDS = { apiKey: "k", apiSecret: "s" };

/** Um intent completo no banco falso; `extra` carrega o que o cenário manda. */
function plantarIntent(b: BancoFalso, extra: Record<string, unknown>): IntentRow {
  const linha = {
    id: `i${b.intents.length + 1}`, client_order_id: "zsA124",
    origin: "dca_cron", autonomous: true,
    exchange_id: "binance", symbol: "BTC/USDT", side: "buy",
    order_type: "market", requested_qty: 10, limit_price: null,
    requested_notional_usd: 100, simulated: false, state: "UNKNOWN",
    state_reason: null, external_order_id: null,
    filled_qty: 0, filled_quote: 0, canceled_qty: 0,
    fee_total: null, fee_currency: null,
    wallet_address: null, session_id: null, plan_id: null, cycle_number: null,
    conexao_id: null, strategy_id: null, strategy_version: null,
    strategy_hash: null, certificate_id: null, credential_fingerprint: null,
    created_at: VELHO, submitted_at: null, last_reconciled_at: null,
    reconcile_attempts: 0,
    ...extra,
  };
  b.intents.push(linha);
  return linha as unknown as IntentRow;
}

function plantarFill(b: BancoFalso, extra: Record<string, unknown>): void {
  b.fills.push({
    id: `f${b.fills.length + 1}`, intent_id: "?", exchange_id: "binance",
    external_order_id: null, external_trade_id: null, client_order_id: null,
    symbol: "BTC/USDT", side: "buy", qty: 1, price: 100, quote_amount: 100,
    fee: null, fee_currency: null, executed_at: VELHO, sintetico: false,
    dedupe_key: `k${b.fills.length + 1}`, raw_hash: null, created_at: VELHO,
    ...extra,
  });
}

function trade(tradeId: string, orderId: string | null): TradeDaVenue {
  return { tradeId, orderId, qty: 1, price: 100, quote: 100,
           fee: null, feeCurrency: null, executedAt: null };
}

function reconciliar(b: BancoFalso, intent: IntentRow, leitura: LeituraDaOrdem,
                     tentativas = 0) {
  return reconciliarIntent({
    db: b.cliente, credenciais: async () => CREDS,
    ler: vi.fn(async () => leitura),
  }, { ...intent, reconcile_attempts: tentativas } as IntentRow);
}

const estadoDe = (b: BancoFalso, id: string) =>
  String(b.intents.find((i) => i.id === id)?.state);

describe("A124.1 — trade de OUTRA CONTA não absolve (cross-account por trade_id)", () => {
  it("⚠️⚠️ o fill 777 é da conexão C-A; a reconciliação de C-B NÃO o conhece → deriva", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iA", conexao_id: "C-A", external_order_id: "ORD-A",
                       state: "FILLED" });
    plantarFill(b, { intent_id: "iA", external_order_id: "ORD-A",
                     external_trade_id: "777" });
    // No baseline, tradesNoLivro(exchange) continha 777 e absolvia C-B.
    const iB = plantarIntent(b, { id: "iB", conexao_id: "C-B" });
    const r = await reconciliar(b, iB, { tipo: "achada",
      ordem: { id: "ORD-B", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("777", "MANUAL-B")] });
    expect(r.desfecho).toBe("quarentena");
    expect(r.detalhe).toContain("ACCOUNT_DRIFT");
    expect(estadoDe(b, "iB")).toBe("QUARANTINED");
  });
});

describe("A124.2 — colisão de order id entre contas (cross-account por ordem)", () => {
  it("⚠️⚠️ ORD-123 é da conexão C-A; na reconciliação de C-B é ordem ALHEIA → deriva", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iA", conexao_id: "C-A", external_order_id: "ORD-123" });
    // No baseline, ordensConhecidas(exchange) continha ORD-123 e absolvia.
    const iB = plantarIntent(b, { id: "iB", conexao_id: "C-B" });
    const r = await reconciliar(b, iB, { tipo: "achada",
      ordem: { id: "ORD-B", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("T-X", "ORD-123")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iB")).toBe("QUARANTINED");
  });
});

describe("A124.3 — mesma conexão, sessões diferentes: SEM falso drift", () => {
  it("⚠️ a ordem de S1 é reconhecida na reconciliação de S2 (escopo = conexão C1)", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iS1", conexao_id: "C1", session_id: "S1",
                       external_order_id: "ORD-S1" });
    const iS2 = plantarIntent(b, { id: "iS2", conexao_id: "C1", session_id: "S2" });
    const r = await reconciliar(b, iS2, { tipo: "so_trades",
      trades: [trade("T-S1", "ORD-S1")] });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iS2")).not.toBe("QUARANTINED");
  });
});

describe("A124.4 — autopilot_browser: a sessão resolve para a conexão", () => {
  it("⚠️ intent com session_id (conexao_id null) herda o escopo da conexão da sessão", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S-browser", conexao_id: "C1" });
    const iBrowser = plantarIntent(b, { id: "iBr", session_id: "S-browser",
                                        origin: "autopilot_browser" });
    // O resolver sozinho já prova a precedência: sessão → conexão C1.
    const r0 = await resolverEscopoDaConta(b.cliente, iBrowser);
    expect(r0).toEqual({ ok: true, escopo: { tipo: "conexao", conexaoId: "C1" } });

    plantarIntent(b, { id: "iC1", conexao_id: "C1", external_order_id: "ORD-C1" });
    const ok = await reconciliar(b, iBrowser, { tipo: "so_trades",
      trades: [trade("T-C1", "ORD-C1")] });
    expect(ok.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iBr")).not.toBe("QUARANTINED");
  });

  it("⚠️⚠️ mas ordem de OUTRA conexão (C2) segue alheia para o browser de C1", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S-browser", conexao_id: "C1" });
    const iBrowser = plantarIntent(b, { id: "iBr", session_id: "S-browser",
                                        origin: "autopilot_browser" });
    plantarIntent(b, { id: "iC2", conexao_id: "C2", external_order_id: "ORD-C2" });
    const r = await reconciliar(b, iBrowser, { tipo: "achada",
      ordem: { id: "ORD-BR", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("T-C2", "ORD-C2")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iBr")).toBe("QUARANTINED");
  });
});

describe("A124.5 — sessão antiga sem conexao_id: fallback ESTREITO de sessão", () => {
  it("⚠️ sessão inexistente no banco → escopo sessão; intent de S2 não explica S1", async () => {
    const b = bancoFalso();
    const iS1 = plantarIntent(b, { id: "iS1", session_id: "S-old" });
    const r0 = await resolverEscopoDaConta(b.cliente, iS1);
    expect(r0).toEqual({ ok: true, escopo: { tipo: "sessao", sessionId: "S-old" } });

    plantarIntent(b, { id: "iS2", session_id: "S2", external_order_id: "ORD-S2" });
    const r = await reconciliar(b, iS1, { tipo: "achada",
      ordem: { id: "ORD-S1", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("T-S2", "ORD-S2")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iS1")).toBe("QUARANTINED");
  });

  it("⚠️ sessão existente com conexao_id NULL → o mesmo fallback estreito", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S-old", conexao_id: null });
    const iS1 = plantarIntent(b, { id: "iS1", session_id: "S-old" });
    const r0 = await resolverEscopoDaConta(b.cliente, iS1);
    expect(r0).toEqual({ ok: true, escopo: { tipo: "sessao", sessionId: "S-old" } });
  });
});

describe("A124.6 — manual: o fingerprint F1 vê F1, não vê F2", () => {
  it("⚠️ mesma wallet/corretora/símbolo, credenciais diferentes: contas diferentes", async () => {
    const b = bancoFalso();
    const iF1a = plantarIntent(b, { id: "iF1a", origin: "manual", autonomous: false,
      credential_fingerprint: "F1", wallet_address: "0xW",
      external_order_id: "ORD-F1" });
    plantarIntent(b, { id: "iF2", origin: "manual", autonomous: false,
      credential_fingerprint: "F2", wallet_address: "0xW",
      external_order_id: "ORD-F2" });

    // F1 reconhece a própria ordem (mesmo símbolo).
    const ok = await reconciliar(b, iF1a, { tipo: "so_trades",
      trades: [trade("T-F1", "ORD-F1")] });
    expect(ok.desfecho).toBe("resolvido");

    // F1 NÃO é absolvido pela ordem de F2 — nem dividindo a mesma wallet.
    const iF1b = plantarIntent(b, { id: "iF1b", origin: "manual", autonomous: false,
      credential_fingerprint: "F1", wallet_address: "0xW" });
    const r = await reconciliar(b, iF1b, { tipo: "achada",
      ordem: { id: "ORD-F1B", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("T-F2", "ORD-F2")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iF1b")).toBe("QUARANTINED");
  });
});

describe("A124.7 — wallet NÃO é conta", () => {
  it("⚠️⚠️ C1 e C2 com a MESMA wallet_address não se absolvem", async () => {
    const b = bancoFalso();
    const iC1 = plantarIntent(b, { id: "iC1", conexao_id: "C1", wallet_address: "0xW" });
    plantarIntent(b, { id: "iC2", conexao_id: "C2", wallet_address: "0xW",
                       external_order_id: "ORD-C2" });
    const r = await reconciliar(b, iC1, { tipo: "achada",
      ordem: { id: "ORD-C1", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("T-C2", "ORD-C2")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iC1")).toBe("QUARANTINED");
  });
});

describe("A124.8 — cross-symbol NÃO absolve", () => {
  it("⚠️⚠️ o fill 999 de BTC/USDT não absolve o trade 999 de ETH/USDT (mesma conexão)", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iBtc", conexao_id: "C1", symbol: "BTC/USDT",
                       external_order_id: "ORD-BTC", state: "FILLED" });
    plantarFill(b, { intent_id: "iBtc", symbol: "BTC/USDT",
                     external_order_id: "ORD-BTC", external_trade_id: "999" });
    const iEth = plantarIntent(b, { id: "iEth", conexao_id: "C1", symbol: "ETH/USDT" });
    // No baseline, tradesNoLivro não filtrava símbolo: 999 absolvia.
    const r = await reconciliar(b, iEth, { tipo: "achada",
      ordem: { id: "ORD-E", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("999", "ORD-EXT-ETH")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iEth")).toBe("QUARANTINED");
  });
});

describe("A124.9 — DCA e autopilot na MESMA conexão compartilham atribuição", () => {
  it("⚠️ origin não separa conta: a ordem do dca_cron explica o trade na reconciliação do autopilot", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iDca", origin: "dca_cron", conexao_id: "C1",
                       external_order_id: "ORD-DCA" });
    const iAp = plantarIntent(b, { id: "iAp", origin: "autopilot_cron",
                                   conexao_id: "C1", session_id: "S9" });
    const r = await reconciliar(b, iAp, { tipo: "so_trades",
      trades: [trade("T-DCA", "ORD-DCA")] });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iAp")).not.toBe("QUARANTINED");
  });
});

describe("A124.10 — sem identidade nenhuma: INDETERMINADO, nunca verde", () => {
  const semIdentidade = { conexao_id: null, session_id: null,
                          credential_fingerprint: null };

  it("⚠️⚠️ NÃO consulta exchange-wide, NÃO 'sem drift', NÃO CANCELED → RECONCILIATION_REQUIRED", async () => {
    const b = bancoFalso();
    // Planta um fill que ABSOLVERIA num fallback exchange-wide — a prova de
    // que o fallback não existe é o intent continuar sem concluir.
    plantarIntent(b, { id: "iX", conexao_id: "C9", external_order_id: "ORD-ORB",
                       state: "FILLED" });
    plantarFill(b, { intent_id: "iX", external_order_id: "ORD-ORB",
                     external_trade_id: "T-ORB" });
    const iSem = plantarIntent(b, { id: "iSem", origin: "manual", ...semIdentidade });
    const r = await reconciliar(b, iSem, { tipo: "so_trades",
      trades: [trade("T-ORB", "ORD-ORB")] });
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(estadoDe(b, "iSem")).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("sem identidade de conta");
  });

  it("⚠️ esgotadas as tentativas, o indeterminado vira QUARENTENA (fail-closed), nunca CANCELED", async () => {
    const b = bancoFalso();
    const iSem = plantarIntent(b, { id: "iSem", origin: "manual", ...semIdentidade });
    const r = await reconciliar(b, iSem, { tipo: "so_trades",
      trades: [trade("T-ORB", "ORD-ORB")] }, TENTATIVAS_ATE_QUARENTENA - 1);
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iSem")).toBe("QUARANTINED");
    expect(String(b.intents.find((i) => i.id === "iSem")?.state_reason))
      .toContain("atribuicao_indeterminada");
  });
});

describe("A124.11 — falha de leitura é INDETERMINADO, nunca Set vazio + verde", () => {
  it("⚠️ erro ao ler a sessão → indeterminado (o intent não conclui nada)", async () => {
    const b = bancoFalso();
    const iS = plantarIntent(b, { id: "iS", session_id: "S-x" });
    b.falhas.select = "banco fora do ar";
    // O resolver sozinho já fecha: erro de leitura NUNCA vira escopo vazio.
    const r0 = await resolverEscopoDaConta(b.cliente, iS);
    expect(r0).toEqual({ ok: false, porque: "falha ao resolver sessao" });

    const r = await reconciliar(b, iS, { tipo: "so_trades",
      trades: [trade("T1", "ORD-Q")] });
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(estadoDe(b, "iS")).toBe("RECONCILIATION_REQUIRED");
  });

  it("⚠️⚠️ erro ao ler os intents do escopo → indeterminado, não 'conheço zero ordens'", async () => {
    const b = bancoFalso();
    const iC = plantarIntent(b, { id: "iC", conexao_id: "C1" });
    b.falhas.select = "leitura quebrada";
    // Se a falha virasse Set VAZIO + verde, o trade seria explicado pelo
    // idDescoberto e o intent sairia "resolvido" — o que NÃO pode acontecer.
    const r = await reconciliar(b, iC, { tipo: "so_trades",
      trades: [trade("T1", "ORD-Q")] });
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(estadoDe(b, "iC")).toBe("RECONCILIATION_REQUIRED");
    expect(estadoDe(b, "iC")).not.toBe("QUARANTINED");
  });

  it("⚠️ erro ao ler os fills do escopo → tradesNoLivroNoEscopo devolve undefined", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iC", conexao_id: "C1", external_order_id: "ORD-1" });
    plantarFill(b, { intent_id: "iC", external_trade_id: "T1" });
    // As leituras de intents (sessões da conexão + braços) passam; a leitura
    // dos FILLS quebra. (A126: a falha é por tabela — a contagem global de
    // chamadas mudaria com o braço de sessão; a tabela alvo não.)
    b.falhas.selectNaTabela = { tabela: "cex_fills", naChamada: 1,
                                mensagem: "pagina quebrada" };
    const r = await tradesNoLivroNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(r).toBeUndefined();
  });
});

describe("A124.12 — paginação: página cheia NÃO é fim de tabela", () => {
  it("⚠️ com pagina=2 e 5 ordens no escopo, TODAS voltam (pagina até esgotar)", async () => {
    const b = bancoFalso();
    for (let n = 1; n <= 5; n++) {
      plantarIntent(b, { id: `i${n}`, conexao_id: "C1",
                         external_order_id: `ORD-${n}` });
    }
    // Ruído fora do escopo: outra conexão não entra nem paginando.
    plantarIntent(b, { id: "iX", conexao_id: "C2", external_order_id: "ORD-X" });
    const r = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO, 2);
    expect(r).toEqual(new Set(["ORD-1", "ORD-2", "ORD-3", "ORD-4", "ORD-5"]));
  });

  it("⚠️⚠️ erro na 2ª página → undefined (indeterminado), NUNCA a 1ª página como completa", async () => {
    const b = bancoFalso();
    for (let n = 1; n <= 5; n++) {
      plantarIntent(b, { id: `i${n}`, conexao_id: "C1",
                         external_order_id: `ORD-${n}` });
    }
    // Erro na 2ª leitura DA TABELA DE INTENTS = erro na 2ª página do braço
    // (A126: a contagem global incluiria a listagem de sessões; a falha por
    // tabela mantém o cenário fiel: a 1ª página passa, a 2ª quebra).
    b.falhas.selectNaTabela = { tabela: "cex_execution_intents", naChamada: 2,
                                mensagem: "caiu na 2a pagina" };
    const r = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO, 2);
    expect(r).toBeUndefined();
  });
});

/**
 * Grava os valores de cada `.in("intent_id", ...)` feito sobre `cex_fills` —
 * a prova COMPORTAMENTAL do dedup por intent.id (A126.4): sem dedup, o id do
 * intent que bate nos dois braços entraria duas vezes no IN dos fills.
 */
function espiarChunksDeIntentsDosFills(b: BancoFalso): string[][] {
  const chunks: string[][] = [];
  type Consulta = { in: (c: string, vs: unknown[]) => unknown };
  type Entrada = { select: (c: string) => Consulta };
  const cliente = b.cliente as unknown as { from: (t: string) => Entrada };
  const fromOriginal = cliente.from.bind(cliente);
  cliente.from = ((tabela: string): Entrada => {
    const f = fromOriginal(tabela);
    if (tabela !== "cex_fills") return f;
    const selectOriginal = f.select.bind(f);
    f.select = (c: string): Consulta => {
      const q = selectOriginal(c);
      const inOriginal = q.in.bind(q);
      q.in = (coluna: string, valores: unknown[]) => {
        if (coluna === "intent_id") chunks.push(valores.map(String));
        return inOriginal(coluna, valores);
      };
      return q;
    };
    return f;
  }) as typeof cliente.from;
  return chunks;
}

describe("A126.1 — browser da MESMA conexão se reconhece (escopo conexão inclui sessões)", () => {
  it("⚠️⚠️ o intent A (S1→C1, conexao NULL) explica o trade na reconciliação de B (S2→C1) — sem falso drift", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S1", conexao_id: "C1" }, { id: "S2", conexao_id: "C1" });
    // O browser grava session_id com conexao_id NULL (api/cex/order/route.ts).
    // No baseline, o escopo de C1 era só `conexao_id = C1`: O-A sumia e a
    // reconciliação de B acusava ACCOUNT_DRIFT na própria conta.
    plantarIntent(b, { id: "iA", origin: "autopilot_browser", session_id: "S1",
                       conexao_id: null, external_order_id: "O-A", state: "FILLED" });
    const iB = plantarIntent(b, { id: "iB", origin: "autopilot_browser",
                                  session_id: "S2", conexao_id: null });
    // T-B (da ordem ORD-B que B acabou de descobrir) é explicado pelo
    // idDescoberto; T-A (ordem O-A, do irmão A) SÓ é explicado se O-A entrar
    // no escopo de C1 pelo braço de sessão — é ele que o break §43 derruba.
    const r = await reconciliar(b, iB, { tipo: "so_trades",
      trades: [trade("T-B", "ORD-B"), trade("T-A", "O-A")] });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iB")).not.toBe("QUARANTINED");
  });
});

describe("A126.2 — browser de C1 NÃO enxerga a sessão de C2", () => {
  it("⚠️⚠️ S1→C1 e S2→C2: a ordem O-A segue alheia na reconciliação de B → deriva", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S1", conexao_id: "C1" }, { id: "S2", conexao_id: "C2" });
    plantarIntent(b, { id: "iA", origin: "autopilot_browser", session_id: "S1",
                       conexao_id: null, external_order_id: "O-A" });
    const iB = plantarIntent(b, { id: "iB", origin: "autopilot_browser",
                                  session_id: "S2", conexao_id: null });
    const r = await reconciliar(b, iB, { tipo: "achada",
      ordem: { id: "ORD-B", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      trades: [trade("T-A", "O-A")] });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iB")).toBe("QUARANTINED");
  });
});

describe("A126.3 — DCA direto (conexao_id=C1) + browser indireto (S1→C1) compartilham", () => {
  it("⚠️ a ordem do dca_cron explica o trade na reconciliação do browser da mesma conta", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S1", conexao_id: "C1" });
    plantarIntent(b, { id: "iDca", origin: "dca_cron", conexao_id: "C1",
                       external_order_id: "ORD-DCA" });
    const iBr = plantarIntent(b, { id: "iBr", origin: "autopilot_browser",
                                   session_id: "S1", conexao_id: null });
    // T-BR (ordem que o browser acabou de descobrir) é explicado pelo
    // idDescoberto; T-DCA SÓ é explicado se a sessão S1 resolver para o
    // escopo conexão C1, onde o braço direto enxerga o intent do dca_cron.
    const r = await reconciliar(b, iBr, { tipo: "so_trades",
      trades: [trade("T-BR", "ORD-BR"), trade("T-DCA", "ORD-DCA")] });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iBr")).not.toBe("QUARANTINED");
  });
});

describe("A126.4 — intent com conexao_id E session_id (S1→C1) aparece UMA vez", () => {
  it("⚠️ a união dos braços faz dedup por intent.id — sem duplicação de order/intent/fill ids", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S1", conexao_id: "C1" });
    // iD bate nos DOIS braços (conexao_id = C1 e session_id = S1, S1→C1).
    plantarIntent(b, { id: "iD", conexao_id: "C1", session_id: "S1",
                       external_order_id: "ORD-D", state: "FILLED" });
    plantarFill(b, { intent_id: "iD", external_order_id: "ORD-D",
                     external_trade_id: "T-D" });
    const chunks = espiarChunksDeIntentsDosFills(b);
    const ordens = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(ordens).toEqual(new Set(["ORD-D"]));
    const trades = await tradesNoLivroNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(trades).toEqual(new Set(["T-D"]));
    // O ponto do dedup: sem ele, iD entraria DUAS vezes no IN dos fills
    // (uma por braço). Com dedup, exatamente uma.
    expect(chunks.flat().filter((id) => id === "iD")).toHaveLength(1);
  });
});

describe("A126.5 — erro ao listar as sessões da conexão → INDETERMINADO (fail-closed)", () => {
  it("⚠️⚠️ o braço direto até leria bem, mas a consulta inteira vai a undefined", async () => {
    const b = bancoFalso();
    b.sessoes.push({ id: "S1", conexao_id: "C1" });
    plantarIntent(b, { id: "iDir", conexao_id: "C1", external_order_id: "ORD-DIRETA" });
    plantarIntent(b, { id: "iBr", origin: "autopilot_browser", session_id: "S1",
                       conexao_id: null, external_order_id: "ORD-BROWSER" });
    // SÓ a leitura de autopilot_sessions falha; a tabela de intents está boa.
    // Se o erro virasse "só o braço direto", o resultado seria
    // Set{"ORD-DIRETA"} — declarar completo pela metade. Nunca.
    b.falhas.selectNaTabela = { tabela: "autopilot_sessions",
                                mensagem: "listar sessoes quebrou" };
    const ordens = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(ordens).toBeUndefined();
    const trades = await tradesNoLivroNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(trades).toBeUndefined();
    const sessoes = await idsDeSessoesDaConexao(b.cliente, "C1");
    expect(sessoes).toBeUndefined();
  });
});

describe("A126.6 — paginação das SESSÕES da conexão", () => {
  function plantarCincoSessoes(b: BancoFalso): void {
    for (let n = 1; n <= 5; n++) {
      b.sessoes.push({ id: `S${n}`, conexao_id: "C1" });
      plantarIntent(b, { id: `iS${n}`, origin: "autopilot_browser",
                         session_id: `S${n}`, conexao_id: null,
                         external_order_id: `ORD-S${n}` });
    }
    // Ruído: sessão de OUTRA conexão não entra nem paginando.
    b.sessoes.push({ id: "SX", conexao_id: "C2" });
    plantarIntent(b, { id: "iSX", origin: "autopilot_browser", session_id: "SX",
                       conexao_id: null, external_order_id: "ORD-SX" });
  }

  it("⚠️ pagina=2 com 5 sessões de C1: TODOS os intents de todas as sessões aparecem", async () => {
    const b = bancoFalso();
    plantarCincoSessoes(b);
    // A listagem de sessões pagina até esgotar (2+2+1)...
    const sessoes = await idsDeSessoesDaConexao(b.cliente, "C1", 2);
    expect(sessoes).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    // ...e a materialização inteira também — nenhuma sessão fica de fora.
    const r = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO, 2);
    expect(r).toEqual(new Set(["ORD-S1", "ORD-S2", "ORD-S3", "ORD-S4", "ORD-S5"]));
  });

  it("⚠️⚠️ erro na 2ª página das sessões → undefined, NUNCA a 1ª página como completa", async () => {
    // Duas instâncias: a falha é na 2ª leitura da tabela, e cada função faz
    // a sua própria listagem paginada de sessões.
    const b1 = bancoFalso();
    plantarCincoSessoes(b1);
    b1.falhas.selectNaTabela = { tabela: "autopilot_sessions", naChamada: 2,
                                 mensagem: "caiu na 2a pagina de sessoes" };
    const sessoes = await idsDeSessoesDaConexao(b1.cliente, "C1", 2);
    expect(sessoes).toBeUndefined();

    const b2 = bancoFalso();
    plantarCincoSessoes(b2);
    b2.falhas.selectNaTabela = { tabela: "autopilot_sessions", naChamada: 2,
                                 mensagem: "caiu na 2a pagina de sessoes" };
    const r = await ordensConhecidasNoEscopo(b2.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO, 2);
    expect(r).toBeUndefined();
  });
});

describe("§45 — guarda: a materialização de conexão consulta autopilot_sessions", () => {
  const ESCOPO = readFileSync("src/lib/cex/execucao/escopo-de-conta.ts", "utf8");

  it("⚠️ autopilot_sessions é lida na MATERIALIZAÇÃO, não só no resolver", () => {
    // Uma leitura no resolver (resolverEscopoDaConta) + uma na listagem das
    // sessões da conexão (idsDeSessoesDaConexao). Se o braço de sessão sair
    // da materialização, a contagem cai para 1 — e o A126.1 quebra junto
    // (é o deliberate break §43).
    const leituras = ESCOPO.match(/from\("autopilot_sessions"\)/g) ?? [];
    expect(leituras.length).toBeGreaterThanOrEqual(2);
    expect(ESCOPO).toMatch(/export async function idsDeSessoesDaConexao\(/);
  });
});

describe("§19/§34 — a recuperação do A80/A102 segue resolvendo COM escopo", () => {
  it("⚠️⚠️ UNKNOWN descobre a ordem; os trades DELA são reconhecidos e o intent resolve", async () => {
    const b = bancoFalso();
    // UNKNOWN ainda sem external_order_id — exatamente o Cenário A.
    const iRec = plantarIntent(b, { id: "iRec", conexao_id: "C1" });
    const r = await reconciliar(b, iRec, { tipo: "achada",
      ordem: { id: "ORD-REC", status: "closed", filled: 10, average: 100,
               cost: 1000 } as never,
      trades: [{ ...trade("T-REC", "ORD-REC"), qty: 10, quote: 1000 }] });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iRec")).toBe("FILLED");
    expect(Number(b.intents.find((i) => i.id === "iRec")?.filled_qty)).toBe(10);
  });
});

describe("§42 — guarda estrutural: o padrão antigo não volta", () => {
  const INTENTS = readFileSync("src/lib/cex/execucao/intents.ts", "utf8");
  const ESCOPO = readFileSync("src/lib/cex/execucao/escopo-de-conta.ts", "utf8");
  const RECONC = readFileSync("src/lib/cex/execucao/reconciliador.ts", "utf8");

  it("⚠️ intents.ts NÃO exporta mais os helpers SEM escopo", () => {
    expect(INTENTS).not.toMatch(/export async function ordensConhecidas\(/);
    expect(INTENTS).not.toMatch(/export async function tradesNoLivro\(/);
  });

  it("⚠️⚠️ escopo-de-conta.ts: as duas funções EXIGEM `escopo` e o arquivo nunca fala de wallet", () => {
    expect(ESCOPO).toMatch(
      /export async function ordensConhecidasNoEscopo\(\s*db:\s*SupabaseClient<Database>,\s*escopo/);
    expect(ESCOPO).toMatch(
      /export async function tradesNoLivroNoEscopo\(\s*db:\s*SupabaseClient<Database>,\s*escopo/);
    // wallet_address NÃO é identidade de conta (A124.7) — nem em comentário
    // de assinatura ele pode aparecer como parâmetro de escopo.
    expect(ESCOPO).not.toContain("wallet_address");
  });

  it("⚠️⚠️ reconciliador.ts não chama o padrão antigo (exchange-wide, sem escopo)", () => {
    expect(RECONC).not.toMatch(/ordensConhecidas\(db, intent\.exchange_id/);
    expect(RECONC).not.toMatch(/tradesNoLivro\(db, intent\.exchange_id/);
    expect(RECONC).toMatch(/ordensConhecidasNoEscopo\(db, resolvido\.escopo/);
    expect(RECONC).toMatch(/tradesNoLivroNoEscopo\(db, resolvido\.escopo/);
  });
});
