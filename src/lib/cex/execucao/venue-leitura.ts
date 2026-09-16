/**
 * AS LEITURAS QUE A RECONCILIAÇÃO PRECISA — achado A102.
 *
 * ⚠️⚠️ `fetchOrder` NÃO BASTA, e o achado diz exatamente por quê: dependendo da
 * corretora, uma ordem antiga, cancelada ou de um ciclo já arquivado some do
 * endpoint de ordem e só existe no histórico de trades.
 *
 *     OrderNotFound NÃO significa "a ordem nunca existiu".
 *
 * Significa "este endpoint não a tem". A diferença entre as duas leituras é a
 * diferença entre reconciliar e inventar.
 *
 * ⚠️ POR ISSO SÃO TRÊS CAMINHOS, nesta ordem, e o primeiro que RESPONDER manda:
 *
 *   1. `fetchOrder` pelo id externo, quando já o temos
 *   2. `fetchOrder` pelo `clientOrderId` — a chave que NÓS geramos
 *   3. `fetchMyTrades` / `fetchClosedOrders` — o histórico
 *
 * ⚠️ E O SILÊNCIO DOS TRÊS NÃO É "NÃO EXISTE". É `indeterminado`, e quem chama
 * NÃO pode concluir nada dele. Converter "não achei" em "não aconteceu" é a
 * conversão que produz o fantasma do A80.
 *
 * ⚠️ HIPÓTESES DECLARADAS SOBRE AS CORRETORAS (documentação do ccxt, não teste
 * contra API real — o briefing proíbe usar dinheiro para validar):
 *   · `fetchOrder(undefined, symbol, { clientOrderId })` é suportado por
 *     binance, bybit, okx e kucoin. Onde não for, o passo 2 falha e caímos no 3.
 *   · `fetchMyTrades` devolve `order` (id da ordem) em cada trade nas quatro.
 *   · algumas venues exigem `symbol`; por isso ele é obrigatório aqui.
 */

import type { CexId, CexCredentials, CexOrder } from "@/lib/cex/types";
import { instanciarExchange, normalizeOrder } from "@/lib/cex/server";

export interface TradeDaVenue {
  tradeId: string;
  orderId: string | null;
  qty: number;
  price: number;
  quote: number;
  fee: number | null;
  feeCurrency: string | null;
  executedAt: string | null;
}

/**
 * ⚠️⚠️ A125 — O HISTÓRICO DA CONTA E OS TRADES DA ORDEM SÃO COISAS DISTINTAS.
 *
 * `fetchMyTrades(symbol, ...)` devolve os trades do SÍMBOLO inteiro na janela,
 * pela credencial da chamada — incluindo trades manuais e de outras ordens.
 * Desse bruto saem DUAS coleções com semânticas que NÃO podem se misturar:
 *
 *   · `historico.trades`  — account-wide. Alimenta SOMENTE a deriva (A103):
 *     "existe trade aqui que a Z-SWAP não explica?" NUNCA vai para o livro.
 *   · `tradesDaOrdem`     — filtro local do bruto pelo id da ordem alvo.
 *     SÓ isto alimenta o settlement (`ingerirTrades`/`cex_fills`).
 *
 * No contrato antigo havia um campo genérico `trades`, sempre filtrado por
 * ordem: o trade manual externo do mesmo símbolo era descartado ANTES de
 * chegar ao detector de deriva — o A124 tinha o escopo certo e recebia a
 * entrada incompleta. O rename é proposital: não existe campo `trades`.
 *
 * ⚠️ §14: trades SEM timestamp seguem na análise — o `executedAtMs != null`
 * do deriva.ts já os mantém na janela; descartá-los aqui seria esconder
 * evidência por conveniência de formato.
 */
export interface HistoricoDoSimbolo {
  /** TODOS os trades normalizados do símbolo na janela — account-wide pela
   *  credencial da chamada. Alimenta SOMENTE a deriva, nunca o livro. */
  trades: TradeDaVenue[];
  /**
   * ⚠️ `true` quando a página veio NO LIMITE (200) — a completude NÃO está
   * provada (§13, opção B: não existe cursor universal do ccxt inventável
   * aqui). O truncamento só pode ESCONDER órfãos (sub-detecção): o que se
   * vê continua sendo evidência; o que não se vê impede o "sem drift".
   */
  possivelmenteIncompleto: boolean;
}

export type LeituraDaOrdem =
  /** A corretora respondeu e a ordem existe. */
  | { tipo: "achada"; ordem: CexOrder;
      /** Os trades DESTA ordem (filtro local do histórico) — settlement SÓ usa isto. */
      tradesDaOrdem: TradeDaVenue[];
      /** O histórico account-wide do símbolo; `null` = a leitura falhou (§39/§40). */
      historico: HistoricoDoSimbolo | null }
  /**
   * ⚠️⚠️ O CENÁRIO D DO BRIEFING, EXATAMENTE. `fetchOrder` devolveu
   * OrderNotFound — a ordem sumiu do endpoint de ordens — e o histórico de
   * trades TEM as execuções dela.
   *
   * Sem este caminho, o A102 acontece: "não achei a ordem" viraria "nada
   * executou", sobre dinheiro que saiu.
   */
  | { tipo: "so_trades"; tradesDaOrdem: TradeDaVenue[];
      historico: HistoricoDoSimbolo | null }
  /**
   * ⚠️ A corretora respondeu e afirma NÃO TER esta ordem em NENHUM dos
   * caminhos consultados — incluindo o histórico. Só isto autoriza concluir
   * que nada executou, e mesmo assim quem chama decide o que fazer.
   */
  | { tipo: "ausente_em_todos"; consultados: string[] }
  /** Não deu para olhar. NÃO é "não existe". */
  | { tipo: "indeterminado"; porque: string; consultados: string[] };

function normalizarTrade(raw: Record<string, unknown>): TradeDaVenue | null {
  const id = raw.id == null ? null : String(raw.id);
  const qty = Number(raw.amount);
  const price = Number(raw.price);
  if (!id || !(qty > 0) || !(price > 0)) return null;
  const fee = raw.fee as { cost?: unknown; currency?: unknown } | undefined;
  return {
    tradeId: id,
    orderId: raw.order == null ? null : String(raw.order),
    qty, price,
    quote: Number(raw.cost) > 0 ? Number(raw.cost) : qty * price,
    fee: typeof fee?.cost === "number" ? fee.cost : null,
    feeCurrency: fee?.currency == null ? null : String(fee.currency),
    executedAt: typeof raw.timestamp === "number"
      ? new Date(raw.timestamp).toISOString() : null,
  };
}

/** `true` quando o erro do ccxt afirma que o endpoint não tem a ordem. */
function ehNaoEncontrada(e: unknown): boolean {
  const nome = (e as { constructor?: { name?: string } })?.constructor?.name ?? "";
  return nome === "OrderNotFound";
}

export async function lerOrdemNaVenue(
  id: CexId,
  creds: CexCredentials,
  alvo: { symbol: string; externalOrderId: string | null; clientOrderId: string;
          desdeMs?: number | null },
): Promise<LeituraDaOrdem> {
  const consultados: string[] = [];
  let exchange;
  try {
    exchange = await instanciarExchange(id, creds);
  } catch (e) {
    return { tipo: "indeterminado", consultados,
      porque: `instanciar: ${(e as Error)?.message ?? String(e)}`.slice(0, 200) };
  }

  /** Quantos caminhos afirmaram positivamente "não tenho". */
  let negaram = 0;
  let ultimoErro: string | null = null;

  /**
   * ⚠️ O SLOT LAZY DO HISTÓRICO — §37/§39.
   *
   * `fetchMyTrades` executa NO MÁXIMO UMA VEZ por leitura, custe o caminho
   * que custar. `undefined` = ainda não chamado; `null` = a leitura FALHOU
   * (erro ou NotSupported) — e falha NUNCA vira `[]`: um array vazio é um
   * FATO ("sem trades no símbolo/janela"), que só o sucesso pode declarar.
   *
   * A normalização é ÚNICA (§38): `tradesDaOrdem` é um FILTRO sobre os
   * mesmos objetos de `historico.trades`, nunca uma renormalização.
   */
  const LIMITE_DA_PAGINA = 200;
  let slotHistorico: HistoricoDoSimbolo | null | undefined = undefined;
  const buscarHistorico = async (): Promise<HistoricoDoSimbolo | null> => {
    if (slotHistorico !== undefined) return slotHistorico;
    try {
      consultados.push("fetchMyTrades");
      const raw = await exchange.fetchMyTrades(
        alvo.symbol, alvo.desdeMs ?? undefined, LIMITE_DA_PAGINA
      ) as unknown as Record<string, unknown>[];
      const todos = raw.map(normalizarTrade).filter((t): t is TradeDaVenue => t !== null);
      slotHistorico = { trades: todos, possivelmenteIncompleto: raw.length === LIMITE_DA_PAGINA };
    } catch (e) {
      ultimoErro = (e as Error)?.message ?? String(e);
      slotHistorico = null;
    }
    return slotHistorico;
  };

  /**
   * Settlement: SÓ os trades DA ORDEM. ⚠️ Sem id de ordem não dá para
   * atribuir o trade a ESTE intent. Atribuir por símbolo e horário seria
   * adivinhação — e erra exatamente quando há duas ordens parecidas, que é
   * quando importa.
   */
  const filtrarDaOrdem = (historico: HistoricoDoSimbolo | null,
                          orderId: string | null): TradeDaVenue[] =>
    historico !== null && orderId
      ? historico.trades.filter((t) => t.orderId === orderId)
      : [];

  // ── 1. pelo id externo ──────────────────────────────────────────────
  if (alvo.externalOrderId) {
    try {
      consultados.push("fetchOrder(id)");
      const raw = await exchange.fetchOrder(
        alvo.externalOrderId, alvo.symbol) as unknown as Record<string, unknown>;
      const ordem = normalizeOrder(raw);
      const historico = await buscarHistorico();
      return { tipo: "achada", ordem, historico,
        tradesDaOrdem: filtrarDaOrdem(historico, alvo.externalOrderId) };
    } catch (e) {
      if (ehNaoEncontrada(e)) {
        negaram++;
        /**
         * ⚠️⚠️ CENÁRIO D. O endpoint de ordens negou, mas NÓS temos o id
         * externo — então o histórico de trades pode atribuir as execuções a
         * esta ordem com certeza, sem adivinhar por símbolo e horário.
         */
        const historico = await buscarHistorico();
        const daOrdem = filtrarDaOrdem(historico, alvo.externalOrderId);
        if (daOrdem.length > 0) {
          return { tipo: "so_trades", tradesDaOrdem: daOrdem, historico };
        }
      } else {
        ultimoErro = (e as Error)?.message ?? String(e);
      }
    }
  }

  // ── 2. pela NOSSA chave ─────────────────────────────────────────────
  try {
    consultados.push("fetchOrder(clientOrderId)");
    const raw = await exchange.fetchOrder(
      undefined as unknown as string, alvo.symbol,
      { clientOrderId: alvo.clientOrderId }) as unknown as Record<string, unknown>;
    const ordem = normalizeOrder(raw);
    const historico = await buscarHistorico();
    return { tipo: "achada", ordem, historico,
      tradesDaOrdem: filtrarDaOrdem(historico, ordem.id ? String(ordem.id) : null) };
  } catch (e) {
    if (ehNaoEncontrada(e)) negaram++;
    else ultimoErro = (e as Error)?.message ?? String(e);
  }

  // ── 3. o histórico ──────────────────────────────────────────────────
  try {
    consultados.push("fetchClosedOrders");
    const raw = await exchange.fetchClosedOrders(
      alvo.symbol, alvo.desdeMs ?? undefined, 200) as unknown as Record<string, unknown>[];
    const casada = raw.find((o) =>
      String(o.clientOrderId ?? "") === alvo.clientOrderId
      || (alvo.externalOrderId != null && String(o.id ?? "") === alvo.externalOrderId));
    if (casada) {
      const ordem = normalizeOrder(casada);
      const historico = await buscarHistorico();
      return { tipo: "achada", ordem, historico,
        tradesDaOrdem: filtrarDaOrdem(historico, ordem.id ? String(ordem.id) : null) };
    }
    negaram++;
  } catch (e) {
    ultimoErro = (e as Error)?.message ?? String(e);
  }

  /**
   * ⚠️⚠️ SÓ DECLARA AUSÊNCIA QUEM CONSULTOU O HISTÓRICO E FOI NEGADO. Um
   * `OrderNotFound` isolado no `fetchOrder` não basta — é exatamente a
   * conclusão apressada que o A102 nomeia.
   */
  if (negaram >= 2 && ultimoErro === null) {
    return { tipo: "ausente_em_todos", consultados };
  }
  return { tipo: "indeterminado", consultados,
    porque: ultimoErro ?? "nenhum caminho respondeu de forma conclusiva" };
}
