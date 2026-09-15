/**
 * A RECONCILIAÇÃO E A RECUPERAÇÃO NO RESTART — achados A102, A103, A104, A105.
 *
 * ⚠️⚠️ O QUE ELA RESOLVE. Depois de um timeout, crash ou redeploy, existe um
 * intent em `SUBMITTING` ou `UNKNOWN` com a NOSSA chave de idempotência. A
 * pergunta "esta ordem existe na corretora?" passa a ter resposta exata, e é
 * ela que substitui o chute que o DCA fazia por escrito:
 *
 *     "Repetir arrisca comprar DUAS vezes; consumir o ciclo e seguir arrisca
 *      comprar uma vez a menos."
 *
 * ⚠️ AUSÊNCIA SÓ É CONCLUÍDA COM IDADE MÍNIMA. Uma ordem enviada há dois
 * segundos pode não ter aparecido ainda no histórico da corretora; declarar
 * "nunca existiu" nessa janela é o fantasma do A80 pelo caminho inverso. Antes
 * de `IDADE_MINIMA_PARA_CONCLUIR_AUSENCIA_MS`, ausência não conclui nada.
 *
 * ⚠️ E O LAÇO TEM FIM. Um intent que nunca reconcilia vai para QUARANTINED
 * depois de `TENTATIVAS_ATE_QUARENTENA` — fail-closed, com mão humana. Um
 * reconciliador que tenta para sempre é um alarme que ninguém ouve.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { lerOrdemNaVenue, type LeituraDaOrdem } from "@/lib/cex/execucao/venue-leitura";
import {
  transicionar, ingerirTrades, ingerirSnapshotDaOrdem,
  intentsParaReconciliar, marcarReconciliado, ordensConhecidas, tradesNoLivro,
  type IntentRow,
} from "@/lib/cex/execucao/intents";
import { detectarDeriva, type TradeObservado } from "@/lib/cex/execucao/deriva";
import { ehTerminal } from "@/lib/cex/execucao/estados";

/**
 * ⚠️ A JANELA EM QUE "NÃO ACHEI" NÃO SIGNIFICA NADA.
 *
 * Corretoras não indexam instantaneamente. Sessenta segundos é folgado para o
 * `fetchOrder` e para o histórico refletirem uma ordem recém-criada, e barato:
 * o custo é uma passada a mais do reconciliador.
 */
export const IDADE_MINIMA_PARA_CONCLUIR_AUSENCIA_MS = 60_000;

/** Depois disto, mão humana. Fail-closed, não laço eterno. */
export const TENTATIVAS_ATE_QUARENTENA = 12;

export type DesfechoDaReconciliacao =
  | "resolvido"        // o livro e o estado agora refletem a corretora
  | "segue_em_duvida"  // não deu para concluir; tenta de novo depois
  | "quarentena"       // desistiu de decidir sozinho
  | "erro";

export interface ResultadoDaReconciliacao {
  intentId: string;
  desfecho: DesfechoDaReconciliacao;
  estado: string;
  detalhe: string;
}

export interface DependenciasDaReconciliacao {
  db: SupabaseClient<Database>;
  /** Como obter a credencial daquele intent. `null` = não deu. */
  credenciais: (intent: IntentRow) => Promise<CexCredentials | null>;
  ler?: typeof lerOrdemNaVenue;
  agoraMs?: () => number;
}

/**
 * Reconcilia UM intent contra a corretora.
 *
 * ⚠️ ELE NUNCA ENVIA ORDEM. Reconciliar é LER e registrar o que já aconteceu;
 * qualquer reenvio é decisão de outro caminho, com reserva e intent próprios.
 */
export async function reconciliarIntent(
  deps: DependenciasDaReconciliacao, intent: IntentRow,
): Promise<ResultadoDaReconciliacao> {
  const { db } = deps;
  const ler = deps.ler ?? lerOrdemNaVenue;
  const agora = (deps.agoraMs ?? (() => Date.now()))();
  const idadeMs = agora - new Date(intent.created_at).getTime();

  const fim = (desfecho: DesfechoDaReconciliacao, estado: string, detalhe: string) =>
    ({ intentId: intent.id, desfecho, estado, detalhe });

  if (ehTerminal(intent.state)) {
    return fim("resolvido", intent.state, "ja terminal — nada a reconciliar");
  }

  const creds = await deps.credenciais(intent);
  if (!creds) {
    /**
     * ⚠️ SEM CREDENCIAL NÃO SE CONCLUI NADA. Conexão revogada, cofre ilegível
     * ou banco fora: nenhum desses é evidência sobre a ordem. Contam como
     * tentativa e, no limite, levam à quarentena — nunca a "não executou".
     */
    await marcarReconciliado(db, intent.id, intent.reconcile_attempts);
    if (intent.reconcile_attempts + 1 >= TENTATIVAS_ATE_QUARENTENA) {
      await transicionar(db, intent.id, "QUARANTINED",
        "sem credencial para reconciliar apos multiplas tentativas");
      return fim("quarentena", "QUARANTINED", "sem credencial");
    }
    return fim("segue_em_duvida", intent.state, "sem credencial para olhar a corretora");
  }

  let leitura: LeituraDaOrdem;
  try {
    leitura = await ler(intent.exchange_id as CexId, creds, {
      symbol: intent.symbol,
      externalOrderId: intent.external_order_id,
      clientOrderId: intent.client_order_id,
      desdeMs: new Date(intent.created_at).getTime() - 60_000,
    });
  } catch (e) {
    leitura = { tipo: "indeterminado", consultados: [],
      porque: (e as Error)?.message ?? String(e) };
  }

  await marcarReconciliado(db, intent.id, intent.reconcile_attempts);
  const tentativas = intent.reconcile_attempts + 1;

  /**
   * ⚠️⚠️ A DERIVA DE CONTA, DE GRAÇA — achado A103.
   *
   * O histórico de trades que acabamos de buscar cobre o SÍMBOLO inteiro na
   * janela, não só a nossa ordem. Então ele já responde a pergunta do A103 sem
   * nenhuma chamada a mais: existe trade aqui que a Z-SWAP não consegue
   * explicar?
   *
   * ⚠️ E A CONDUTA É FAIL-CLOSED: derivou, QUARENTENA. Continuar operando "com
   * cuidado" sobre uma conta que não fecha é a definição do problema — o
   * autopilot decide quanto comprar a partir do que ele ACHA que tem.
   */
  if (leitura.tipo === "achada" || leitura.tipo === "so_trades") {
    /**
     * ⚠️⚠️ A ORDEM QUE ACABAMOS DE DESCOBRIR É NOSSA.
     *
     * Este bloco quase inverteu o Cenário A inteiro. Um intent em UNKNOWN
     * ainda NÃO tem `external_order_id` gravado — é justamente o que a
     * reconciliação vem descobrir. Sem contá-la como conhecida, os trades
     * dela ficavam "sem intent correspondente" e TODA recuperação de timeout
     * terminava em quarentena: o conserto do A80 destruído pelo conserto do
     * A103, em silêncio.
     *
     * Pego pelo teste do Cenário A, não por leitura.
     */
    const idDescoberto = leitura.tipo === "achada"
      ? (leitura.ordem.id ? String(leitura.ordem.id) : null)
      : (leitura.trades[0]?.orderId ?? null);
    const derivou = await conferirDeriva(db, intent, leitura.trades, idDescoberto);
    if (derivou) {
      await transicionar(db, intent.id, "QUARANTINED", derivou.slice(0, 300));
      return fim("quarentena", "QUARANTINED", derivou);
    }
  }

  // ── caminho 1: os trades são a verdade ────────────────────────────────
  if (leitura.tipo === "so_trades" || (leitura.tipo === "achada" && leitura.trades.length > 0)) {
    const trades = leitura.trades;
    const idOrdem = leitura.tipo === "achada"
      ? (leitura.ordem.id ? String(leitura.ordem.id) : intent.external_order_id)
      : intent.external_order_id;

    // ⚠️ SAIR DE `SUBMITTING` ANTES DE INGERIR. O banco recusa fill contra
    // intent pré-envio, e `SUBMITTING` ainda não é pós-envio no livro.
    if (intent.state === "SUBMITTING") {
      await transicionar(db, intent.id, "SUBMITTED", "reconciliacao achou a ordem", idOrdem);
    }
    const ing = await ingerirTrades(db, intent.id, idOrdem, trades.map((t) => ({
      tradeId: t.tradeId, qty: t.qty, price: t.price, quote: t.quote,
      fee: t.fee, feeCurrency: t.feeCurrency, executedAt: t.executedAt,
    })));
    if (!ing.ok) {
      await transicionar(db, intent.id, "RECONCILIATION_REQUIRED",
        `ingestao de trades falhou: ${ing.porque}`.slice(0, 300));
      return fim("segue_em_duvida", "RECONCILIATION_REQUIRED", ing.porque);
    }
    const fechou = leitura.tipo === "achada"
      ? await fecharPeloStatus(db, intent.id, leitura.ordem.status)
      : null;
    return fim("resolvido", fechou ?? ing.state,
      `${trades.length} trade(s), executado ${ing.filledQty}`);
  }

  // ── caminho 2: só o acumulado da ordem ────────────────────────────────
  if (leitura.tipo === "achada") {
    const o = leitura.ordem;
    const idOrdem = o.id ? String(o.id) : intent.external_order_id;
    if (intent.state === "SUBMITTING") {
      await transicionar(db, intent.id, "SUBMITTED", "reconciliacao achou a ordem", idOrdem);
    }
    const executado = Number(o.filled);
    if (Number.isFinite(executado) && executado > 0) {
      const snap = await ingerirSnapshotDaOrdem(db, intent.id, idOrdem, {
        cumulativeQty: executado,
        avgPrice: Number(o.average) > 0 ? Number(o.average) : 0,
        cumulativeQuote: Number(o.cost) > 0 ? Number(o.cost) : 0,
        fee: o.fee?.cost ?? null, feeCurrency: o.fee?.currency ?? null,
        executedAt: o.timestamp ? new Date(o.timestamp).toISOString() : null,
      });
      if (!snap.ok) {
        await transicionar(db, intent.id, "RECONCILIATION_REQUIRED",
          `snapshot falhou: ${snap.porque}`.slice(0, 300));
        return fim("segue_em_duvida", "RECONCILIATION_REQUIRED", snap.porque);
      }
      if (snap.regrediu) {
        /**
         * ⚠️⚠️ A CORRETORA REPORTA MENOS DO QUE O LIVRO TEM. Ninguém
         * "desexecuta" um trade: ou o livro está errado, ou a leitura está.
         * Nenhuma das duas se resolve gravando por cima.
         */
        await transicionar(db, intent.id, "RECONCILIATION_REQUIRED",
          "corretora reporta executado MENOR que o livro — divergencia");
        return fim("segue_em_duvida", "RECONCILIATION_REQUIRED", "acumulado regrediu");
      }
    }
    const fechou = await fecharPeloStatus(db, intent.id, o.status);
    return fim("resolvido", fechou ?? "SUBMITTED", `status da venue: ${o.status}`);
  }

  // ── caminho 3: a corretora nega em todos os caminhos ──────────────────
  if (leitura.tipo === "ausente_em_todos") {
    if (idadeMs < IDADE_MINIMA_PARA_CONCLUIR_AUSENCIA_MS) {
      // ⚠️ Cedo demais para concluir. A corretora pode não ter indexado ainda.
      return fim("segue_em_duvida", intent.state,
        `ausente, mas o intent tem ${Math.round(idadeMs / 1000)}s — cedo para concluir`);
    }
    if (Number(intent.filled_qty) > 0) {
      /**
       * ⚠️ O LIVRO TEM EXECUÇÃO E A CORRETORA DIZ QUE A ORDEM NÃO EXISTE.
       * Contradição pura — não se apaga fill por causa de uma leitura.
       */
      await transicionar(db, intent.id, "RECONCILIATION_REQUIRED",
        "corretora nega a ordem, mas o livro tem execucao — divergencia");
      return fim("segue_em_duvida", "RECONCILIATION_REQUIRED", "nega ordem com fill no livro");
    }
    await transicionar(db, intent.id, "CANCELED",
      `ausente em ${leitura.consultados.join(", ")} apos ${Math.round(idadeMs / 1000)}s`);
    return fim("resolvido", "CANCELED", "a ordem nunca chegou a existir na corretora");
  }

  // ── caminho 4: não deu para olhar ─────────────────────────────────────
  if (tentativas >= TENTATIVAS_ATE_QUARENTENA) {
    await transicionar(db, intent.id, "QUARANTINED",
      `nao reconciliou em ${tentativas} tentativas: ${leitura.porque}`.slice(0, 300));
    return fim("quarentena", "QUARANTINED", leitura.porque);
  }
  if (intent.state === "SUBMITTING" || intent.state === "SUBMITTED") {
    await transicionar(db, intent.id, "UNKNOWN", leitura.porque.slice(0, 300));
  }
  return fim("segue_em_duvida", intent.state, leitura.porque);
}

/**
 * Há trade na corretora que a Z-SWAP não explica?
 *
 * ⚠️ FALHA DE LEITURA NÃO ACUSA. Se não der para montar o conjunto de ordens
 * conhecidas, o resultado é "não sei" — e não sei NÃO pode virar acusação de
 * deriva, senão um banco intermitente colocaria a conta do cliente em
 * quarentena toda vez que piorasse.
 */
async function conferirDeriva(
  db: SupabaseClient<Database>, intent: IntentRow,
  trades: readonly { tradeId: string; orderId: string | null; qty: number;
                     executedAt: string | null }[],
  /** A ordem que a leitura acabou de atribuir a ESTE intent. */
  idDescoberto: string | null,
): Promise<string | null> {
  if (trades.length === 0) return null;
  const observados: TradeObservado[] = trades.map((t) => ({
    tradeId: t.tradeId, orderId: t.orderId, symbol: intent.symbol, qty: t.qty,
    // ⚠️ `null` continua `null`: trade sem horário não pode ser posto dentro
    // nem fora da janela por conveniência.
    executedAtMs: t.executedAt ? new Date(t.executedAt).getTime() : null,
  }));
  const desdeMs = new Date(intent.created_at).getTime() - 60_000;
  const desdeIso = new Date(desdeMs).toISOString();
  const [ordens, noLivro] = await Promise.all([
    ordensConhecidas(db, intent.exchange_id, intent.symbol, desdeIso),
    tradesNoLivro(db, intent.exchange_id, desdeIso),
  ]);
  if (ordens === undefined || noLivro === undefined) return null;
  // As nossas: as gravadas, mais a que este intent acabou de descobrir.
  const nossas = new Set(ordens);
  if (idDescoberto) nossas.add(idDescoberto);
  if (intent.external_order_id) nossas.add(intent.external_order_id);
  const v = detectarDeriva(observados, {
    ordensConhecidas: nossas, tradesNoLivro: noLivro, desdeMs,
  });
  return v.derivou ? `ACCOUNT_DRIFT: ${v.achado.detalhe}` : null;
}

/** Mapeia o status da corretora para o fim do intent, quando ele é conclusivo. */
async function fecharPeloStatus(
  db: SupabaseClient<Database>, intentId: string, status: string,
): Promise<string | null> {
  const s = (status ?? "").toLowerCase();
  if (s === "canceled" || s === "cancelled" || s === "expired" || s === "rejected") {
    /**
     * ⚠️⚠️ ACHADO A101 NO PONTO EXATO. `CANCELED` aqui NÃO zera o executado: a
     * RPC calcula `canceled_qty = pedido - executado`. Um cancelamento depois
     * de preenchimento parcial cancela o REMANESCENTE, e o que já executou é
     * fato imutável.
     */
    const r = await transicionar(db, intentId, "CANCELED", `venue: ${s}`);
    return r.ok ? "CANCELED" : null;
  }
  // `closed`/`filled` não precisam de transição: o recálculo do livro já
  // promove a FILLED quando a soma alcança o pedido. Forçar aqui permitiria
  // "FILLED sem fill", que é o A81 voltando pela porta da reconciliação.
  return null;
}

/**
 * O RECUPERADOR — roda no cron e depois de todo restart (INVARIANTE 7).
 *
 * ⚠️ `intentsParaReconciliar` devolve `undefined` quando a LEITURA falha, e
 * isso não é "nenhum pendente". Um recuperador que confunde os dois conclui
 * "está tudo reconciliado" num banco fora do ar.
 */
export async function reconciliarPendentes(
  deps: DependenciasDaReconciliacao, limite = 50,
): Promise<{ olhados: number; resultados: ResultadoDaReconciliacao[]; leituraFalhou: boolean }> {
  const pendentes = await intentsParaReconciliar(deps.db, limite);
  if (pendentes === undefined) {
    return { olhados: 0, resultados: [], leituraFalhou: true };
  }
  const resultados: ResultadoDaReconciliacao[] = [];
  for (const intent of pendentes) {
    try {
      resultados.push(await reconciliarIntent(deps, intent));
    } catch (e) {
      resultados.push({ intentId: intent.id, desfecho: "erro", estado: intent.state,
        detalhe: ((e as Error)?.message ?? String(e)).slice(0, 200) });
    }
  }
  return { olhados: pendentes.length, resultados, leituraFalhou: false };
}
