/**
 * ⚠️⚠️⚠️ RECUPERAÇÃO FINANCEIRA TERMINAL — o buraco que o fechamento do
 * Round 9 veio tapar.
 *
 * TERMINAL DE ORDEM NÃO É TERMINAL DE CONTABILIDADE. Uma ordem pode estar
 * `FILLED` — nada mais sai dela na corretora — e ainda ter taxa ausente,
 * recebido ausente, sintético por substituir, posição por projetar ou P&L por
 * aplicar. O sistema tratava as duas coisas como uma só, e o preço era um
 * estado ABSORVENTE:
 *
 *   · `fetchOrder` de várias corretoras NÃO traz comissão (ela só existe nos
 *     trades) → `fee_total` fica NULL;
 *   · NULL não é zero (item 11), então a sessão é marcada e para de COMPRAR;
 *   · o intent virou `FILLED`, que não está em `PRECISAM_RECONCILIAR` → o
 *     recuperador de intents nunca volta nele;
 *   · `ingerirTrades`, o único caminho que traz a fee real, só era alcançado
 *     de dentro daquele recuperador;
 *   · a varredura de projeções não o relistava, porque comparava LIVRO com
 *     POSIÇÃO e o problema estava no próprio LIVRO.
 *
 * A sessão ficava presa para sempre e NADA no sistema ia buscar o que
 * faltava. Fail-closed sem soltura não é recovery — é uma parada permanente
 * com aparência de segurança, e contradizia I9, I11 e I12 ao mesmo tempo.
 *
 * ⚠️ A PENDÊNCIA NÃO É UMA TABELA, É UMA DERIVAÇÃO. Não existe fila para
 * ficar dessincronizada do dinheiro: `autopilot_pendencias_financeiras` é uma
 * pergunta feita aos fatos duráveis a cada passada. Uma pendência "fecha"
 * porque deixa de ser verdadeira, nunca porque alguém a marcou como fechada —
 * e é isso que a faz sobreviver a restart, deploy e cron perdido.
 *
 * ⚠️ A CREDENCIAL É A HISTÓRICA (I2). `credenciaisDoIntentParaRecovery`
 * resolve por `intent.conexao_id`, a versão do cofre daquele momento. Nunca a
 * da sessão atual: uma sessão rearmada de C1 para C2 perguntaria a C2 por uma
 * ordem que nasceu em C1 — conta errada, resposta errada, e no melhor caso
 * "ordem não encontrada" virando conclusão sobre dinheiro.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { CexId, CexCredentials } from "@/lib/cex/types";
import {
  ingerirTrades, ingerirSnapshotDaOrdem, intentPorId, type IntentRow,
} from "@/lib/cex/execucao/intents";
import { lerOrdemNaVenue } from "@/lib/cex/execucao/venue-leitura";
import { credenciaisDoIntentParaRecovery } from "@/lib/cex/conexoes";
import {
  projetarEfeitoDoIntent, type ResultadoDaProjecao,
} from "@/lib/autopilot/projecao-de-posicao";

export type MotivoDaPendencia =
  | "sem_marcador"
  | "quantidade_pendente"
  | "recebido_pendente"
  | "taxa_pendente"
  | "taxa_desconhecida"
  | "resultado_sem_recebido";

export interface PendenciaFinanceira {
  intentId: string;
  motivo: MotivoDaPendencia;
  /**
   * ⚠️ `true` quando o LIVRO está incompleto: projetar de novo não adianta, é
   * preciso perguntar à corretora. `false` quando só a projeção está atrás —
   * aí nenhuma chamada externa é necessária, e gastá-la seria desperdício no
   * caminho de 5 em 5 minutos.
   */
  precisaVenue: boolean;
}

export interface DependenciasDaRecuperacao {
  db?: SupabaseClient<Database> | null;
  chamarRpc?: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Como obter a credencial HISTÓRICA daquele intent. `null` = não deu. */
  credenciais?: (intent: IntentRow) => Promise<CexCredentials | null>;
  ler?: typeof lerOrdemNaVenue;
  lerIntent?: typeof intentPorId;
  projetar?: (intentId: string) => Promise<ResultadoDaProjecao>;
}

/**
 * As pendências financeiras de agora.
 *
 * ⚠️ `null` É FALHA DE LEITURA, não "nada pendente" — a regra nº 33 desta
 * casa. Quem chama registra a diferença: um banco intermitente não pode virar
 * "está tudo convergido".
 */
export async function pendenciasFinanceiras(
  limite = 50, deps: DependenciasDaRecuperacao = {},
): Promise<PendenciaFinanceira[] | null> {
  const mapear = (linhas: unknown): PendenciaFinanceira[] =>
    (Array.isArray(linhas) ? linhas : [])
      .map((l) => {
        const r = l as { intent_id?: unknown; motivo?: unknown; precisa_venue?: unknown };
        return {
          intentId: String(r.intent_id ?? ""),
          motivo: (typeof r.motivo === "string" ? r.motivo : "sem_marcador") as MotivoDaPendencia,
          precisaVenue: r.precisa_venue === true,
        };
      })
      .filter((p) => p.intentId);
  try {
    if (deps.chamarRpc) {
      return mapear(await deps.chamarRpc(
        "autopilot_pendencias_financeiras", { p_limite: limite }));
    }
    const db = deps.db ?? getSupabaseAdmin();
    if (!db) return null;
    const { data, error } = await db.rpc(
      "autopilot_pendencias_financeiras", { p_limite: limite });
    if (error) return null;
    return mapear(data);
  } catch {
    return null;
  }
}

export type DesfechoDaRecuperacao =
  | { ok: true;
      /** O que mudou no livro nesta tentativa. */
      etapa: "projetada" | "livro_atualizado" | "sem_novidade";
      realizado: number; taxaNaoPrecificada: boolean; motivoDaProjecao: string }
  | { ok: false; motivo: string; porque: string };

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Leva UMA pendência o mais longe que os fatos permitirem.
 *
 * ⚠️⚠️ NUNCA FINGE CONVERGÊNCIA. Se a corretora não expõe a taxa, a pendência
 * continua de pé e a sessão continua sem comprar — que é o desfecho honesto.
 * O que este módulo garante é que ela seja TENTADA de novo a cada passada,
 * para sempre, em vez de sair do radar.
 */
export async function recuperarPendenciaFinanceira(
  p: PendenciaFinanceira, deps: DependenciasDaRecuperacao = {},
): Promise<DesfechoDaRecuperacao> {
  const projetar = deps.projetar
    ?? ((id: string) => projetarEfeitoDoIntent(id, { chamarRpc: deps.chamarRpc }));

  /**
   * ⚠️ O CAMINHO BARATO PRIMEIRO. Só a projeção atrasada não justifica uma
   * chamada externa — e o cron roda isto de 5 em 5 minutos para cada sessão.
   */
  if (!p.precisaVenue) {
    const r = await projetar(p.intentId);
    if (!r.ok) return { ok: false, motivo: r.motivo, porque: r.porque };
    return { ok: true, etapa: "projetada", realizado: r.realizado,
             taxaNaoPrecificada: r.taxaNaoPrecificada, motivoDaProjecao: r.motivo };
  }

  const db = deps.db ?? getSupabaseAdmin();
  if (!db) return { ok: false, motivo: "sem_banco", porque: "supabase nao configurado" };
  const lerIntent = deps.lerIntent ?? intentPorId;
  const credenciais = deps.credenciais
    ?? ((intent: IntentRow) => credenciaisDoIntentParaRecovery(db, intent));
  const ler = deps.ler ?? lerOrdemNaVenue;

  const intent = await lerIntent(db, p.intentId);
  if (intent === undefined) {
    return { ok: false, motivo: "intent_ilegivel", porque: "nao deu para ler o intent" };
  }
  if (intent === null) {
    return { ok: false, motivo: "intent_inexistente", porque: `intent ${p.intentId} sumiu` };
  }

  /**
   * ⚠️⚠️ SEM CREDENCIAL HISTÓRICA NÃO SE PERGUNTA (I2). Legado sem
   * `conexao_id`, conexão revogada ou cofre ilegível: a pendência fica de pé e
   * quem chama registra. Perguntar com a credencial ATUAL seria perguntar na
   * conta errada — o ataque que o cofre versionado fecha.
   */
  const creds = await credenciais(intent as IntentRow);
  if (!creds) {
    return { ok: false, motivo: "sem_credencial_historica",
      porque: "a ordem nasceu noutra versao do cofre (ou e legado sem elo) — "
        + "perguntar com a credencial atual seria perguntar na conta errada" };
  }

  const leitura = await ler(String(intent.exchange_id) as CexId, creds, {
    symbol: String(intent.symbol),
    externalOrderId: intent.external_order_id == null
      ? null : String(intent.external_order_id),
    clientOrderId: String(intent.client_order_id),
  });
  if (leitura.tipo === "indeterminado") {
    return { ok: false, motivo: "venue_indeterminada", porque: leitura.porque };
  }
  if (leitura.tipo === "ausente_em_todos") {
    /**
     * ⚠️ A ordem executou (o livro tem `filled_qty > 0`, é por isso que ela
     * está aqui) e a corretora agora não a encontra em caminho nenhum. Isso
     * NÃO autoriza concluir nada sobre a taxa — é divergência, e o lugar dela
     * é a mão humana, não uma convergência inventada.
     */
    return { ok: false, motivo: "ordem_sumiu_na_venue",
      porque: `o livro tem execucao e a venue nao acha a ordem em ${
        leitura.consultados.join("/")} — divergencia` };
  }

  /**
   * ⚠️⚠️ OS TRADES PRIMEIRO, e é o ponto inteiro deste módulo: eles são o
   * único caminho que traz a COMISSÃO real de venues cujo `fetchOrder` não a
   * reporta. O snapshot da ordem é o fallback, e ele não sabe a taxa que
   * nunca foi dita.
   *
   * ⚠️ SÓ `tradesDaOrdem` (A125): o histórico account-wide é evidência para a
   * deriva, nunca fato do livro deste intent.
   */
  let mexeuNoLivro = false;
  const trades = leitura.tradesDaOrdem;
  const idOrdem = leitura.tipo === "achada" && leitura.ordem.id
    ? String(leitura.ordem.id)
    : (intent.external_order_id == null ? null : String(intent.external_order_id));

  if (trades.length > 0) {
    const ing = await ingerirTrades(db, p.intentId, idOrdem, trades.map((t) => ({
      tradeId: t.tradeId, qty: t.qty, price: t.price, quote: t.quote,
      fee: t.fee, feeCurrency: t.feeCurrency, executedAt: t.executedAt,
      orderId: t.orderId,
    })));
    if (!ing.ok && !ing.adiado) {
      return { ok: false, motivo: "ingestao_de_trades_recusada", porque: ing.porque };
    }
    // ⚠️ ADIADO não é erro (A118/A121): a página veio curta ou sem a fee
    // explícita, o banco não tocou em nada, e a próxima passada tenta de novo.
    mexeuNoLivro = ing.ok && ing.inseridos > 0;
  } else if (leitura.tipo === "achada") {
    const o = leitura.ordem;
    const executado = Number(o.filled);
    if (Number.isFinite(executado) && executado > 0) {
      const custo = Number(o.cost);
      const medio = Number(o.average);
      const snap = await ingerirSnapshotDaOrdem(db, p.intentId, idOrdem, {
        cumulativeQty: executado,
        avgPrice: Number.isFinite(medio) && medio > 0 ? medio : 0,
        // ⚠️ Invariante Q: ausência é `null`, nunca `0`.
        cumulativeQuote: Number.isFinite(custo) && custo > 0 ? custo : null,
        fee: typeof o.fee?.cost === "number" ? o.fee.cost : null,
        feeCurrency: o.fee?.currency == null ? null : String(o.fee.currency),
        executedAt: o.timestamp ? new Date(o.timestamp).toISOString() : null,
      });
      if (!snap.ok) {
        return { ok: false, motivo: "snapshot_recusado", porque: snap.porque };
      }
      if (snap.regrediu) {
        // ⚠️ Ninguém "desexecuta" um trade nem "desrecebe" dinheiro.
        return { ok: false, motivo: "regressao_na_venue",
          porque: "a corretora reporta MENOS do que o livro ja tem — divergencia" };
      }
      mexeuNoLivro = snap.inseridos > 0;
    }
  }

  /**
   * ⚠️ PROJETA SEMPRE, mesmo sem nada novo no livro. O marcador pode estar
   * atrás por outro motivo (uma projeção que falhou antes), e a RPC é
   * idempotente: `ledger − applied`. Repetir não soma nada.
   */
  const r = await projetar(p.intentId);
  if (!r.ok) return { ok: false, motivo: r.motivo, porque: r.porque };
  return {
    ok: true,
    etapa: mexeuNoLivro ? "livro_atualizado" : "sem_novidade",
    realizado: numero(r.realizado),
    taxaNaoPrecificada: r.taxaNaoPrecificada,
    motivoDaProjecao: r.motivo,
  };
}
