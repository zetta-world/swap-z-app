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
import { projetarEfeitoDoIntent } from "@/lib/autopilot/projecao-de-posicao";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import { lerOrdemNaVenue, type HistoricoDoSimbolo, type LeituraDaOrdem } from "@/lib/cex/execucao/venue-leitura";
import {
  transicionar, ingerirTrades, ingerirSnapshotDaOrdem,
  intentsParaReconciliar, marcarReconciliado,
  type IntentRow,
} from "@/lib/cex/execucao/intents";
import {
  resolverEscopoDaConta, ordensConhecidasNoEscopo, tradesNoLivroNoEscopo,
} from "@/lib/cex/execucao/escopo-de-conta";
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
  /**
   * ⚠️ `true` quando a LEITURA na venue falhou (credencial recusada, rede,
   * endpoint fora) — distinguindo "não consegui olhar" de "olhei e segue em
   * dúvida" (ex.: ausente mas cedo demais). Quem atende o usuário (A80/A102)
   * precisa dessa diferença: leitura falha é ERRO honesto, nunca "a ordem
   * não existe" e nunca FAILED.
   */
  leituraFalhou?: boolean;
  /**
   * ⚠️ A131-C: o motivo de a projeção no livro de posições não ter entrado.
   * O dinheiro já se moveu e está no livro de EXECUÇÕES; o que ficou para
   * trás é a POSIÇÃO. Quem chama registra em severidade alta — inventário
   * incompleto não pode virar licença para comprar mais.
   */
  projecaoFalhou?: string;
}

export interface DependenciasDaReconciliacao {
  db: SupabaseClient<Database>;
  /** Como obter a credencial daquele intent. `null` = não deu. */
  credenciais: (intent: IntentRow) => Promise<CexCredentials | null>;
  ler?: typeof lerOrdemNaVenue;
  agoraMs?: () => number;
  /**
   * ⚠️ ELEGIBILIDADE DO RECUPERADOR GLOBAL — ponto 9 do Round 2.
   *
   * Intents MANUAIS não têm sessão nem conexão: a rota descarta a credencial,
   * então o recuperador NUNCA vai conseguir olhar a venue por eles. Antes eles
   * contavam tentativa atrás de tentativa até a QUARENTENA — um alarme de
   * segurança disparado por uma limitação de desenho, não por evidência. Com
   * este predicado, o recuperador os PULA: ficam UNKNOWN aguardando a
   * reconciliação interativa (o usuário reautentica e consulta).
   */
  elegivel?: (intent: IntentRow) => boolean;
  /**
   * ⚠️⚠️ A131-C — A PROJEÇÃO DO FILL TARDIO NO LIVRO DE POSIÇÕES.
   *
   * O cron dizia por escrito, na linha da ordem aceita sem preenchimento:
   * *"posicao abre na reconciliacao"*. Não abria: `reconciliarPendentes` nunca
   * tocou em `autopilot_positions`. Uma limitada que preenchesse dez minutos
   * depois ficava fora do livro para sempre — o bot não sabia que tinha
   * comprado, o teto de exposição não contava aquele capital, e o ramo de
   * venda nunca achava a posição para sair.
   *
   * Injetável para teste; o padrão é a RPC idempotente da 0064.
   */
  projetar?: (intentId: string) => Promise<{ ok: boolean; motivo?: string }>;
}

/**
 * Este intent descreve inventário do BOT?
 *
 * ⚠️ MANUAL E SIMULADO FICAM DE FORA (§31). Projetar uma venda manual no livro
 * do autopilot seria sequestrar patrimônio do dono para o mandato do robô — e
 * a RPC confere isto de novo, do lado do banco.
 */
function projetavel(intent: IntentRow): boolean {
  return !intent.simulated
    && intent.autonomous === true
    && (intent.origin === "autopilot_browser" || intent.origin === "autopilot_cron")
    && Boolean(intent.session_id);
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
   * ⚠️⚠️ A125: A DERIVA RECEBE O HISTÓRICO ACCOUNT-WIDE, NUNCA OS TRADES DA
   * ORDEM. No contrato antigo os dois alimentos eram o MESMO array filtrado
   * pela ordem — um trade manual externo do mesmo símbolo era descartado na
   * leitura e NUNCA chegava ao detector. Agora `historico` vai à deriva e
   * `tradesDaOrdem` vai ao settlement, e nenhum dos dois invade o outro.
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
      : (leitura.tradesDaOrdem[0]?.orderId ?? null);
    const atribuicao = await conferirDeriva(db, intent, leitura.historico, idDescoberto);
    if (atribuicao.tipo === "deriva") {
      await transicionar(db, intent.id, "QUARANTINED", atribuicao.motivo.slice(0, 300));
      return fim("quarentena", "QUARANTINED", atribuicao.motivo);
    }
    if (atribuicao.tipo === "indeterminado") {
      return aplicarAtribuicaoIndeterminada(db, intent, tentativas, atribuicao);
    }
  }

  // ── caminho 1: os trades são a verdade ────────────────────────────────
  // ⚠️ A125: o settlement usa SÓ `tradesDaOrdem` — o filtro local da ordem
  // alvo. Um trade externo do histórico account-wide NUNCA entra em
  // `ingerirTrades`/`cex_fills` (§9): ele é evidência para a deriva, não
  // fato do livro deste intent.
  if (leitura.tipo === "so_trades"
      || (leitura.tipo === "achada" && leitura.tradesDaOrdem.length > 0)) {
    const trades = leitura.tradesDaOrdem;
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
      /**
       * ⚠️ A118/A121: COBERTURA INCOMPLETA É ADIADO, não erro — de quantidade
       * (`cobertura_incompleta`) ou de fee (`cobertura_fee_incompleta`,
       * `fee_currency_incompativel`). `fetchMyTrades` é página única sem
       * prova de completude; o banco recusou substituir o sintético por um
       * fato menor ou menos informado. NADA foi deletado nem inserido — o
       * intent permanece no estado em que está para a próxima passada (não
       * marca FAILED, não abre RECONCILIATION_REQUIRED por uma página curta).
       */
      if (ing.adiado) {
        return fim("segue_em_duvida",
          intent.state === "SUBMITTING" ? "SUBMITTED" : intent.state,
          `adiado: ${ing.porque}`);
      }
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
    /**
     * ⚠️⚠️ A125-ABSENCE (round 8, §55/§56): A INTEGRIDADE DA CONTA VEM
     * ANTES DE QUALQUER CONCLUSÃO SOBRE A ORDEM. O `ausente_em_todos` agora
     * carrega o histórico account-wide (ou `null` = a leitura falhou), e a
     * pergunta "esta conta ainda fecha?" é respondida PRIMEIRO:
     *
     *   · deriva        → QUARENTENA (há atividade externa à vista);
     *   · indeterminado → a MESMA política dos caminhos 1/2 — histórico
     *     falhou, trade sem orderId ou registro inválido NUNCA viram
     *     CANCELED: cancelar sobre uma conta que não conseguimos inspecionar
     *     é o A125-ABSENCE;
     *   · ok            → só então idade mínima → filled_qty → CANCELED
     *     (§57: o A102 legítimo — histórico limpo e confiável, ordem velha,
     *     zero executado — segue concluindo).
     */
    const atribuicao = await conferirDeriva(db, intent, leitura.historico, null);
    if (atribuicao.tipo === "deriva") {
      await transicionar(db, intent.id, "QUARANTINED", atribuicao.motivo.slice(0, 300));
      return fim("quarentena", "QUARANTINED", atribuicao.motivo);
    }
    if (atribuicao.tipo === "indeterminado") {
      return aplicarAtribuicaoIndeterminada(db, intent, tentativas, atribuicao);
    }
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
  return { ...fim("segue_em_duvida", intent.state, leitura.porque), leituraFalhou: true };
}

/**
 * O resultado explícito da atribuição (A124): o "não sei" é um valor de
 * primeira classe, não `null` disfarçado de "sem deriva".
 */
export type ResultadoDaAtribuicao =
  | { tipo: "ok" }                          // conferiu, nada órfão
  | { tipo: "deriva"; motivo: string }      // ACCOUNT_DRIFT
  | { tipo: "indeterminado"; motivo: string };

/**
 * Há trade na corretora que a Z-SWAP não explica NA CONTA DESTE INTENT?
 *
 * ⚠️⚠️ A124: O ESCOPO É A CONTA, NUNCA A CORRETORA. Os conjuntos passaram a
 * ser montados por `conexao_id`/`credential_fingerprint`/`session_id` —
 * trade ou ordem de OUTRA CONTA do mesmo cliente não absolve atividade
 * externa desta (cross-account era o P0). Sem identidade de conta, ou com a
 * leitura do escopo falhando, o veredito é `indeterminado` — fail-closed:
 * quem chama NÃO pode transformar isso em "sem drift", CANCELED ou consulta
 * exchange-wide.
 *
 * ⚠️⚠️ A125: A ENTRADA É O HISTÓRICO ACCOUNT-WIDE DO SÍMBOLO, não os trades
 * da ordem alvo — filtrar por ordem ANTES daqui escondia exatamente o trade
 * manual externo que esta checagem existe para encontrar.
 *
 * ⚠️⚠️ A128/A129 (round 8): A PRECEDÊNCIA DO VEREDITO é exata (§40/§47):
 *
 *   1. `historico === null` (a leitura account-wide falhou) → indeterminado;
 *   2. órfão à vista → DERIVA — mesmo com página cheia ou registros
 *      inválidos: o que se vê é evidência, e deriva comprovada vence tudo;
 *   3. sem órfãos, com trades sem `orderId` → indeterminado: não atribuído
 *      não é explicado, e "não sei de quem é" nunca absolve;
 *   4. sem órfãos, com `registrosInvalidos.total > 0` → indeterminado: a
 *      venue devolveu linhas que não lemos — um histórico parcialmente
 *      ilegível não prova "sem drift";
 *   5. sem órfãos, página possivelmente truncada → indeterminado: o
 *      truncamento pode ESCONDER órfãos, nunca absolver o que não se viu;
 *   6. só então → ok.
 */
async function conferirDeriva(
  db: SupabaseClient<Database>, intent: IntentRow,
  /** O histórico account-wide do símbolo; `null` = a leitura falhou (§39/§40). */
  historico: HistoricoDoSimbolo | null,
  /** A ordem que a leitura acabou de atribuir a ESTE intent. */
  idDescoberto: string | null,
): Promise<ResultadoDaAtribuicao> {
  if (historico === null) {
    return { tipo: "indeterminado", motivo: "historico account-wide falhou" };
  }
  // ⚠️ Página NO LIMITE = completude não provada (§13B): sem órfãos à vista
  // isso é "não conferi tudo", NUNCA "sem drift".
  const confiavel = !historico.possivelmenteIncompleto;
  if (historico.trades.length === 0 && historico.registrosInvalidos.total === 0) {
    return confiavel
      ? { tipo: "ok" }
      : { tipo: "indeterminado", motivo: "pagina cheia — completude nao provada" };
  }
  const observados: TradeObservado[] = historico.trades.map((t) => ({
    tradeId: t.tradeId, orderId: t.orderId, symbol: intent.symbol, qty: t.qty,
    // ⚠️ `null` continua `null`: trade sem horário não pode ser posto dentro
    // nem fora da janela por conveniência.
    executedAtMs: t.executedAt ? new Date(t.executedAt).getTime() : null,
  }));
  const desdeMs = new Date(intent.created_at).getTime() - 60_000;
  const desdeIso = new Date(desdeMs).toISOString();
  const resolvido = await resolverEscopoDaConta(db, intent);
  if (!resolvido.ok) {
    return { tipo: "indeterminado", motivo: `escopo de conta indeterminado: ${resolvido.porque}` };
  }
  const [ordens, noLivro] = await Promise.all([
    ordensConhecidasNoEscopo(db, resolvido.escopo, intent.exchange_id, intent.symbol, desdeIso),
    tradesNoLivroNoEscopo(db, resolvido.escopo, intent.exchange_id, intent.symbol, desdeIso),
  ]);
  if (ordens === undefined || noLivro === undefined) {
    return { tipo: "indeterminado",
             motivo: "falha de leitura ao montar o escopo da conta" };
  }
  // As nossas: as gravadas NO ESCOPO, mais a que este intent acabou de
  // descobrir (§19 preservado: sem isto a recuperação do A80 quarentenava).
  const nossas = new Set(ordens);
  if (idDescoberto) nossas.add(idDescoberto);
  if (intent.external_order_id) nossas.add(intent.external_order_id);
  const v = detectarDeriva(observados, {
    ordensConhecidas: nossas, tradesNoLivro: noLivro, desdeMs,
  });
  if (v.tipo === "deriva") {
    // ⚠️ Órfão VISÍVEL é evidência — deriva mesmo com a página possivelmente
    // truncada ou com registros inválidos (§40: a deriva comprovada vence).
    return { tipo: "deriva", motivo: `ACCOUNT_DRIFT: ${v.achado.detalhe}` };
  }
  if (v.tipo === "indeterminado") {
    // ⚠️ A128: trade sem `orderId` não prova deriva E não prova ok.
    return { tipo: "indeterminado", motivo: v.motivo };
  }
  if (historico.registrosInvalidos.total > 0) {
    // ⚠️ A129 (§47): a leitura veio com linhas que não conseguimos ler —
    // "sem drift" sobre um histórico parcialmente ilegível seria inventado.
    return { tipo: "indeterminado",
      motivo: `historico com ${historico.registrosInvalidos.total} registro(s) `
            + "invalidos — leitura parcialmente ilegivel" };
  }
  return confiavel
    ? { tipo: "ok" }
    : { tipo: "indeterminado", motivo: "pagina cheia — completude nao provada" };
}

/**
 * ⚠️⚠️ A124/A128 (round 8): O BLOCO DO INDETERMINADO, fatorado UMA vez e
 * compartilhado pelos caminhos 1, 2 e 3 (§55). INDETERMINADO NUNCA VIRA
 * VERDE. Não saber a conta (ou não conseguir LER o escopo, ou não conseguir
 * LER o histórico) não é "sem drift": é "não conferi". Conduta fail-closed —
 * esgotadas as tentativas, QUARENTENA com motivo próprio; antes disso,
 * RECONCILIATION_REQUIRED e segue em dúvida. NUNCA CANCELED, NUNCA
 * "resolvido", NUNCA fallback exchange-wide.
 */
async function aplicarAtribuicaoIndeterminada(
  db: SupabaseClient<Database>, intent: IntentRow, tentativas: number,
  atribuicao: { tipo: "indeterminado"; motivo: string },
): Promise<ResultadoDaReconciliacao> {
  if (tentativas >= TENTATIVAS_ATE_QUARENTENA) {
    await transicionar(db, intent.id, "QUARANTINED",
      `atribuicao_indeterminada apos ${tentativas} tentativas: ${atribuicao.motivo}`
        .slice(0, 300));
    return { intentId: intent.id, desfecho: "quarentena",
             estado: "QUARANTINED", detalhe: atribuicao.motivo };
  }
  // ⚠️ De SUBMITTING não há aresta direta para RECONCILIATION_REQUIRED
  // (a máquina de estados manda SUBMITTING→UNKNOWN na dúvida) — faz o
  // desvio em dois passos, como o caminho 4 já faz.
  if (intent.state === "SUBMITTING") {
    await transicionar(db, intent.id, "UNKNOWN",
      `atribuicao indeterminada: ${atribuicao.motivo}`.slice(0, 300));
  }
  await transicionar(db, intent.id, "RECONCILIATION_REQUIRED",
    `atribuicao indeterminada: ${atribuicao.motivo}`.slice(0, 300));
  return { intentId: intent.id, desfecho: "segue_em_duvida",
           estado: "RECONCILIATION_REQUIRED", detalhe: atribuicao.motivo };
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
    /**
     * ⚠️ PULAR NÃO É CONTAR. Um intent inelegível (manual, sem credencial
     * persistida) não acumula `reconcile_attempts` e NÃO vai para quarentena
     * automática — quarentena é para "tentamos e não concluímos", não para
     * "nunca tivemos como tentar".
     */
    if (deps.elegivel && !deps.elegivel(intent)) continue;
    try {
      const r = await reconciliarIntent(deps, intent);
      /**
       * ⚠️⚠️ A PROJEÇÃO VEM DEPOIS DA RECONCILIAÇÃO, SEMPRE QUE ELA RODA.
       *
       * Não só no desfecho "resolvido": um PARTIALLY_FILLED que cresceu também
       * mudou o inventário, e ele continua em dúvida. A idempotência é do
       * marcador — `ledger − applied` —, então chamar de mais é barato e
       * chamar de menos perde o fato.
       *
       * ⚠️ Falha aqui NÃO derruba a reconciliação: o livro de execuções já
       * registrou o que aconteceu. Ela vira sinal, e a passada seguinte tenta
       * de novo (a RPC é retentável por construção).
       */
      if (projetavel(intent)) {
        const projetar = deps.projetar ?? projetarEfeitoDoIntent;
        const p = await projetar(intent.id);
        if (!p.ok) r.projecaoFalhou = p.motivo ?? "erro";
      }
      resultados.push(r);
    } catch (e) {
      resultados.push({ intentId: intent.id, desfecho: "erro", estado: intent.state,
        detalhe: ((e as Error)?.message ?? String(e)).slice(0, 200) });
    }
  }
  return { olhados: pendentes.length, resultados, leituraFalhou: false };
}
