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
 * + a guarda estrutural (§42) + o bloco A126 REESCRITO pelo R8 (§66): o join
 * `session→conexao` saiu — `conexao_id` direto materializa, session-only REAL
 * é indeterminado, rearm C1→C2 não migra intent antigo de escopo, fingerprint
 * segue. A guarda §45 inverteu de sinal: `autopilot_sessions` NÃO é lida aqui.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { bancoFalso, type BancoFalso } from "@/lib/cex/execucao/banco-falso";
import {
  reconciliarIntent, TENTATIVAS_ATE_QUARENTENA,
} from "@/lib/cex/execucao/reconciliador";
import {
  resolverEscopoDaConta, ordensConhecidasNoEscopo, tradesNoLivroNoEscopo,
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

/**
 * ⚠️ A125 — as duas coleções do contrato novo. A deriva lê `historico`
 * (account-wide); o settlement lê `tradesDaOrdem` (só a ordem alvo). Nas
 * fixtures abaixo os dois compartilham os MESMOS objetos quando o trade é da
 * ordem — como na leitura real, em que o subset é filtro do bruto. A129 (R8):
 * a qualidade da leitura viaja junto — zero registros inválidos aqui.
 */
const HIST_LIMPO = { possivelmenteIncompleto: false,
                     registrosInvalidos: { total: 0, porMotivo: {} } };
const daOrdem = (ts: TradeDaVenue[]) =>
  ({ tradesDaOrdem: ts, historico: { trades: ts, ...HIST_LIMPO } });
/** Trades EXTERNOS à ordem alvo: só o histórico os carrega (é o caso A125). */
const soNoHistorico = (ts: TradeDaVenue[]) =>
  ({ tradesDaOrdem: [] as TradeDaVenue[],
     historico: { trades: ts, ...HIST_LIMPO } });

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
      ...soNoHistorico([trade("777", "MANUAL-B")]) });
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
      ...soNoHistorico([trade("T-X", "ORD-123")]) });
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
      ...daOrdem([trade("T-S1", "ORD-S1")]) });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iS2")).not.toBe("QUARANTINED");
  });
});

describe("A124.4 — autopilot_browser (R8): conexao_id direto materializa; session-only NÃO herda", () => {
  it("⚠️⚠️ o intent do browser com conexao_id gravado resolve para a conexão — sem ler a sessão", async () => {
    // R8 (§67): o browser grava `conexao_id` no intent. O vínculo é a linha,
    // não o join mutável session→conexao do R7.
    const b = bancoFalso();
    const iBrowser = plantarIntent(b, { id: "iBr", session_id: "S-browser",
                                        conexao_id: "C1",
                                        origin: "autopilot_browser" });
    const r0 = await resolverEscopoDaConta(b.cliente, iBrowser);
    expect(r0).toEqual({ ok: true, escopo: { tipo: "conexao", conexaoId: "C1" } });

    plantarIntent(b, { id: "iC1", conexao_id: "C1", external_order_id: "ORD-C1" });
    const ok = await reconciliar(b, iBrowser, { tipo: "so_trades",
      ...daOrdem([trade("T-C1", "ORD-C1")]) });
    expect(ok.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iBr")).not.toBe("QUARANTINED");
  });

  it("⚠️⚠️ ordem de OUTRA conexão (C2) segue alheia para o browser de C1", async () => {
    const b = bancoFalso();
    const iBrowser = plantarIntent(b, { id: "iBr", session_id: "S-browser",
                                        conexao_id: "C1",
                                        origin: "autopilot_browser" });
    plantarIntent(b, { id: "iC2", conexao_id: "C2", external_order_id: "ORD-C2" });
    const r = await reconciliar(b, iBrowser, { tipo: "achada",
      ordem: { id: "ORD-BR", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      ...soNoHistorico([trade("T-C2", "ORD-C2")]) });
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iBr")).toBe("QUARANTINED");
  });
});

describe("A124.5 — session-only (R8 §65): INDETERMINADO, nunca herda a conexão da sessão", () => {
  it("⚠️⚠️ a sessão S→C1 EXISTE e mesmo assim o intent session-only não entra no escopo de C1", async () => {
    // R8 supera R7/A126 (§66): a sessão é mutável — rearm C1→C2 reescreve
    // `autopilot_sessions.conexao_id`. Join por sessão migraria intents
    // ANTIGOS para o escopo da conexão NOVA. Legacy session-only é
    // indeterminado com motivo explícito — não é deriva, não é ok.
    const b = bancoFalso();
    b.sessoes.push({ id: "S-old", conexao_id: "C1" });
    const iS1 = plantarIntent(b, { id: "iS1", session_id: "S-old",
                                   origin: "autopilot_browser" });
    const r0 = await resolverEscopoDaConta(b.cliente, iS1);
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.porque).toContain("legacy session-only");

    // A ordem da PRÓPRIA conta (C1) não absolve: sem identidade histórica
    // comprovada, a reconciliação não conclui nada — RECONCILIATION_REQUIRED.
    plantarIntent(b, { id: "iC1", conexao_id: "C1", external_order_id: "ORD-C1" });
    const r = await reconciliar(b, iS1, { tipo: "achada",
      ordem: { id: "ORD-S1", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      ...soNoHistorico([trade("T-C1", "ORD-C1")]) });
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(estadoDe(b, "iS1")).toBe("RECONCILIATION_REQUIRED");
  });

  it("⚠️ sessão inexistente ou sem conexao_id: o MESMO indeterminado — o resolver nem consulta o banco", async () => {
    const b = bancoFalso();
    const iS1 = plantarIntent(b, { id: "iS1", session_id: "S-fantasma" });
    const r0 = await resolverEscopoDaConta(b.cliente, iS1);
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.porque).toContain("legacy session-only");

    b.sessoes.push({ id: "S-sem", conexao_id: null });
    const iS2 = plantarIntent(b, { id: "iS2", session_id: "S-sem" });
    const r1 = await resolverEscopoDaConta(b.cliente, iS2);
    expect(r1.ok).toBe(false);
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
      ...daOrdem([trade("T-F1", "ORD-F1")]) });
    expect(ok.desfecho).toBe("resolvido");

    // F1 NÃO é absolvido pela ordem de F2 — nem dividindo a mesma wallet.
    const iF1b = plantarIntent(b, { id: "iF1b", origin: "manual", autonomous: false,
      credential_fingerprint: "F1", wallet_address: "0xW" });
    const r = await reconciliar(b, iF1b, { tipo: "achada",
      ordem: { id: "ORD-F1B", status: "open", filled: 0, average: 0,
               cost: 0 } as never,
      ...soNoHistorico([trade("T-F2", "ORD-F2")]) });
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
      ...soNoHistorico([trade("T-C2", "ORD-C2")]) });
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
      ...soNoHistorico([trade("999", "ORD-EXT-ETH")]) });
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
      ...daOrdem([trade("T-DCA", "ORD-DCA")]) });
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
      ...daOrdem([trade("T-ORB", "ORD-ORB")]) });
    expect(r.desfecho).toBe("segue_em_duvida");
    expect(r.estado).toBe("RECONCILIATION_REQUIRED");
    expect(estadoDe(b, "iSem")).toBe("RECONCILIATION_REQUIRED");
    expect(r.detalhe).toContain("sem identidade de conta");
  });

  it("⚠️ esgotadas as tentativas, o indeterminado vira QUARENTENA (fail-closed), nunca CANCELED", async () => {
    const b = bancoFalso();
    const iSem = plantarIntent(b, { id: "iSem", origin: "manual", ...semIdentidade });
    const r = await reconciliar(b, iSem, { tipo: "so_trades",
      ...daOrdem([trade("T-ORB", "ORD-ORB")]) }, TENTATIVAS_ATE_QUARENTENA - 1);
    expect(r.desfecho).toBe("quarentena");
    expect(estadoDe(b, "iSem")).toBe("QUARANTINED");
    expect(String(b.intents.find((i) => i.id === "iSem")?.state_reason))
      .toContain("atribuicao_indeterminada");
  });
});

describe("A124.11 — falha de leitura é INDETERMINADO, nunca Set vazio + verde", () => {
  it("⚠️ session-only com o banco FORA: o resolver nem toca o banco — indeterminado por A127", async () => {
    // R8 (§65): o resolver não lê `autopilot_sessions` em hipótese nenhuma —
    // o intent session-only é indeterminado por desenho, com o banco são ou
    // quebrado. Não há mais "falha ao resolver sessao".
    const b = bancoFalso();
    const iS = plantarIntent(b, { id: "iS", session_id: "S-x" });
    b.falhas.select = "banco fora do ar";
    const r0 = await resolverEscopoDaConta(b.cliente, iS);
    expect(r0.ok).toBe(false);
    if (!r0.ok) expect(r0.porque).toContain("legacy session-only");

    const r = await reconciliar(b, iS, { tipo: "so_trades",
      ...daOrdem([trade("T1", "ORD-Q")]) });
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
      ...daOrdem([trade("T1", "ORD-Q")]) });
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

/**
 * ⚠️⚠️ BLOCO A126 REESCRITO PELO R8 (§66 — troca de hipótese, não perda de
 * cobertura).
 *
 * O R7 materializava o escopo conexão como a UNIÃO `conexao_id = C1` +
 * `session_id IN sessoes(C1)`, porque o browser gravava `session_id` com
 * `conexao_id` NULL. A hipótese caiu: a sessão é MUTÁVEL (rearm C1→C2
 * reescreve `autopilot_sessions.conexao_id`), então o join não é prova
 * histórica de conta — e migrar intents antigos para o escopo da conexão
 * nova é exatamente o ataque A127. O que vale agora:
 *
 *   · `conexao_id` gravado NO INTENT materializa (um braço só);
 *   · session-only REAL → indeterminado (coberto em A124.4/A124.5 acima);
 *   · rearm C1→C2 NÃO migra intent antigo de escopo;
 *   · fingerprint segue funcionando (A124.6).
 */
describe("A126/R8 — conexao_id direto materializa (um braço só, sem sessão)", () => {
  it("⚠️⚠️ dois intents da MESMA conexão se reconhecem pelo conexao_id gravado", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iA", origin: "autopilot_browser",
                       conexao_id: "C1", external_order_id: "O-A" });
    const iB = plantarIntent(b, { id: "iB", origin: "autopilot_browser",
                                  conexao_id: "C1" });
    // T-B é a ordem descoberta (idDescoberto); T-A SÓ é explicado se O-A
    // entrar no escopo de C1 pelo braço `conexao_id` — sem sessão nenhuma.
    const r = await reconciliar(b, iB, { tipo: "so_trades",
      tradesDaOrdem: [trade("T-B", "ORD-B")],
      historico: { trades: [trade("T-B", "ORD-B"), trade("T-A", "O-A")],
                   ...HIST_LIMPO } });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "iB")).not.toBe("QUARANTINED");
  });

  it("⚠️⚠️ rearm C1→C2 NÃO migra o intent antigo: o escopo é o conexao_id GRAVADO (§66)", async () => {
    // O intent I1 foi criado quando a conta era C1 e grava conexao_id=C1.
    // A sessão S1 foi rearmada para C2 — e mesmo que I1 carregue
    // session_id=S1, o escopo dele segue sendo C1: a ordem antiga O-A (de C1)
    // continua explicada e nada migra para o escopo de C2.
    const b = bancoFalso();
    b.sessoes.push({ id: "S1", conexao_id: "C2" });   // S1 rearmada para C2
    plantarIntent(b, { id: "iA", conexao_id: "C1", external_order_id: "O-A",
                       state: "FILLED" });
    plantarIntent(b, { id: "iNovoC2", conexao_id: "C2",
                       external_order_id: "O-C2" });
    const i1 = plantarIntent(b, { id: "i1", session_id: "S1", conexao_id: "C1" });
    const r0 = await resolverEscopoDaConta(b.cliente, i1);
    expect(r0).toEqual({ ok: true, escopo: { tipo: "conexao", conexaoId: "C1" } });

    // T-A (ordem de C1) é explicado; T-C2 (ordem de C2) seria ÓRFÃO no escopo
    // de I1 — o rearm não o puxou para a conta nova.
    const r = await reconciliar(b, i1, { tipo: "so_trades",
      tradesDaOrdem: [trade("T-1", "ORD-1")],
      historico: { trades: [trade("T-1", "ORD-1"), trade("T-A", "O-A")],
                   ...HIST_LIMPO } });
    expect(r.desfecho).toBe("resolvido");
    expect(estadoDe(b, "i1")).not.toBe("QUARANTINED");

    const rDeriva = await reconciliar(b,
      plantarIntent(b, { id: "i1b", session_id: "S1", conexao_id: "C1" }),
      { tipo: "achada",
        ordem: { id: "ORD-1B", status: "open", filled: 0, average: 0,
                 cost: 0 } as never,
        ...soNoHistorico([trade("T-C2", "O-C2")]) });
    expect(rDeriva.desfecho).toBe("quarentena");
    expect(estadoDe(b, "i1b")).toBe("QUARANTINED");
  });

  it("⚠️ o fingerprint segue intacto: F1 materializa F1, e só F1", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iF1", credential_fingerprint: "F1",
                       external_order_id: "ORD-F1" });
    plantarIntent(b, { id: "iF2", credential_fingerprint: "F2",
                       external_order_id: "ORD-F2" });
    const ordens = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "fingerprint", fingerprint: "F1" }, "binance", "BTC/USDT", VELHO);
    expect(ordens).toEqual(new Set(["ORD-F1"]));
    const r0 = await resolverEscopoDaConta(b.cliente,
      plantarIntent(b, { id: "iF1b", credential_fingerprint: "F1",
                         session_id: "S-qualquer" }));
    // fingerprint tem precedência sobre a sessão (e a sessão não é lida).
    expect(r0).toEqual({ ok: true, escopo: { tipo: "fingerprint", fingerprint: "F1" } });
  });

  it("⚠️⚠️ um braço só: o intent aparece UMA vez no IN dos fills (não há união para deduplicar)", async () => {
    const b = bancoFalso();
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
    // Com UM braço, iD entra exatamente uma vez — por construção, sem dedup.
    expect(chunks.flat().filter((id) => id === "iD")).toHaveLength(1);
  });

  it("⚠️⚠️ erro na leitura dos intents do escopo → undefined (fail-closed, braço único)", async () => {
    const b = bancoFalso();
    plantarIntent(b, { id: "iDir", conexao_id: "C1", external_order_id: "ORD-DIRETA" });
    b.falhas.selectNaTabela = { tabela: "cex_execution_intents",
                                mensagem: "leitura quebrou" };
    const ordens = await ordensConhecidasNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(ordens).toBeUndefined();
    const trades = await tradesNoLivroNoEscopo(b.cliente,
      { tipo: "conexao", conexaoId: "C1" }, "binance", "BTC/USDT", VELHO);
    expect(trades).toBeUndefined();
  });
});

describe("§45 (R8) — guarda INVERTIDA: a materialização NÃO lê autopilot_sessions", () => {
  const ESCOPO = readFileSync("src/lib/cex/execucao/escopo-de-conta.ts", "utf8");

  it("⚠️⚠️ nenhuma consulta a autopilot_sessions, nenhum braço de sessão, variante sessao fora", () => {
    // R8 supera R7/A126 (§66): a sessão é mutável e não é prova histórica.
    // Se o join voltar, estes três sinais voltam juntos — e A124.5 quebra.
    expect(ESCOPO).not.toContain('from("autopilot_sessions")');
    expect(ESCOPO).not.toMatch(/idsDeSessoesDaConexao/);
    expect(ESCOPO).not.toMatch(/tipo:\s*"sessao"/);
    expect(ESCOPO).not.toMatch(/coluna:\s*"session_id"/);
    // E o comentário que registra a superação está no arquivo.
    expect(ESCOPO).toMatch(/R8 supera R7\/A126/);
  });

  it("⚠️⚠️ o resolver não consulta o banco: session-only é indeterminado por desenho", () => {
    const i = ESCOPO.indexOf("export async function resolverEscopoDaConta");
    const fim = ESCOPO.indexOf("\n}", i);
    const corpo = ESCOPO.slice(i, fim);
    expect(corpo).not.toMatch(/db\.from\(/);
    expect(corpo).toMatch(/legacy session-only/);
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
      ...daOrdem([{ ...trade("T-REC", "ORD-REC"), qty: 10, quote: 1000 }]) });
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
