/**
 * ⚠️⚠️⚠️ A143 — LIQUIDAR ANTES DE PERSISTIR É LIQUIDAR SOBRE UM LIVRO VAZIO.
 *
 * `settleArmedExits` fazia, nesta ordem:
 *
 *     fetchCexOrderStatus(...)          ← pergunta à corretora
 *     liquidarSaidaArmada(intent, ...)  ← a RPC lê `fee_total`/`filled_quote`
 *                                         DO INTENT, que ninguém atualizou
 *
 * `fetchCexOrderStatus` NÃO escreve no livro de execuções. Então a corretora
 * podia dizer `filled=0,01 · cost=580 · fee=2` enquanto a linha do intent
 * seguia `filled_qty=0 · filled_quote=0 · fee_total=null` — e a A140 fez a
 * taxa ser derivada do LIVRO justamente para que imediato e recovery
 * chegassem ao mesmo número. Com o livro parado, esse número é ZERO:
 *
 *     realizado = recebido − custo_removido − 0
 *
 * A taxa some da conta, o prejuízo sai menor do que foi, e o `pnl_today` que
 * alimenta o stop de perda diária fica OTIMISTA. Na mesma passada em que a
 * venda perdedora deveria congelar a sessão, o cron segue para a seção de
 * entrada e COMPRA — o stop foi furado por um dado que existia e não tinha
 * sido gravado.
 *
 * ⚠️ O CONSERTO NÃO É PASSAR A TAXA DO TYPESCRIPT DE NOVO. Isso é exatamente
 * o que o A140 removeu, e pelo motivo certo: a varredura de pendências, cinco
 * minutos depois, não tem a resposta da corretora na mão. A ordem certa é
 * ASSENTAR e só então liquidar:
 *
 *     1. perguntar à corretora
 *     2. ingerir o snapshot no livro de execuções (`cex_ingest_order_snapshot`)
 *     3. confirmar que entrou, RELENDO a linha durável do intent
 *     4. liquidar com os números DO LIVRO
 *
 * ⚠️ E O PASSO 3 NÃO É CERIMÔNIA. `supabase-js` RESOLVE com `{ error }`: a
 * ingestão pode recusar (moeda de fee incompatível, estado pré-envio) sem
 * lançar nada. Liquidar em cima disso seria repetir o defeito com uma linha
 * a mais.
 *
 * ⚠️⚠️ FALHA AQUI É FAIL-CLOSED, E O PREÇO ESTÁ DECLARADO: a saída fica
 * ARMADA (a passada seguinte pergunta de novo, e a ingestão é idempotente por
 * `dedupe_key`), NADA de P&L pela metade, e a sessão NÃO abre entrada nova
 * nesta passada. Um P&L incompleto é pior que P&L nenhum — ele afrouxa o
 * freio com aparência de número.
 *
 * ⚠️ REGRESSÃO DA VENUE TAMBÉM FECHA. Se a corretora reportar MENOS do que o
 * livro já tem, ninguém "desexecuta" um trade: é divergência, e o
 * `greatest()` que a esconderia deixaria o P&L artificialmente otimista. Vai
 * para mão humana, não para a conta do dia.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { ingerirSnapshotDaOrdem, intentPorId } from "@/lib/cex/execucao/intents";
import {
  liquidarSaidaArmada,
  type ResultadoDaLiquidacao, type DependenciasDaProjecao,
} from "@/lib/autopilot/projecao-de-posicao";

/** O recorte de `CexOrder` que o assentamento lê. Nada além disto. */
export interface OrdemParaAssentar {
  filled?: unknown;
  average?: unknown;
  cost?: unknown;
  fee?: { cost?: unknown; currency?: unknown } | null;
  timestamp?: unknown;
}

export type MotivoDoAssentamento =
  | "sem_banco"
  | "ingestao_recusada"
  | "regressao_na_venue"
  | "intent_ilegivel"
  | "intent_inexistente"
  | "livro_sem_execucao";

export type FatosAssentados =
  | { ok: true;
      /** `filled_qty` DA LINHA DURÁVEL — nunca o número da resposta HTTP. */
      qty: number;
      /** `filled_quote` da mesma linha. */
      quote: number;
      /** Quantos fills a ingestão gravou agora (0 = já estava tudo lá). */
      inseridos: number }
  | { ok: false; motivo: MotivoDoAssentamento; porque: string };

export interface DependenciasDoAssentamento extends DependenciasDaProjecao {
  /** Injetável para teste; o padrão é o cliente de serviço. */
  db?: SupabaseClient<Database> | null;
  ingerir?: typeof ingerirSnapshotDaOrdem;
  lerIntent?: typeof intentPorId;
  /**
   * ⚠️ Injetável só para exercitar o caminho de RECUSA da liquidação sem
   * inventar um estado impossível no banco. O padrão é a função de produção,
   * e é ela que os testes de dinheiro exercitam.
   */
  liquidar?: (intentId: string, qtd: number, quote: number)
    => Promise<ResultadoDaLiquidacao>;
}

function numeroOuZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Passos 2 e 3: grava os fatos da corretora no livro de execuções e devolve o
 * que a LINHA DURÁVEL passou a dizer.
 *
 * ⚠️ `qtdInformada` é o que a venue afirmou ter preenchido, e só serve de
 * entrada da ingestão. O que volta daqui é o livro.
 */
export async function assentarFatosDaSaida(
  intentId: string,
  externalOrderId: string | null,
  ordem: OrdemParaAssentar,
  qtdInformada: number,
  deps: DependenciasDoAssentamento = {},
): Promise<FatosAssentados> {
  const db = deps.db ?? getSupabaseAdmin();
  if (!db) return { ok: false, motivo: "sem_banco", porque: "supabase nao configurado" };

  const ingerir = deps.ingerir ?? ingerirSnapshotDaOrdem;
  const lerIntent = deps.lerIntent ?? intentPorId;

  const custo = numeroOuZero(ordem.cost);
  const medio = numeroOuZero(ordem.average);
  const taxa = typeof ordem.fee?.cost === "number" && Number.isFinite(ordem.fee.cost)
    ? ordem.fee.cost : null;
  const moeda = ordem.fee?.currency == null ? null : String(ordem.fee.currency);

  const ing = await ingerir(db, intentId, externalOrderId, {
    cumulativeQty: qtdInformada,
    avgPrice: medio > 0 ? medio : 0,
    cumulativeQuote: custo,
    fee: taxa,
    feeCurrency: moeda,
    executedAt: typeof ordem.timestamp === "number"
      ? new Date(ordem.timestamp).toISOString() : null,
  });
  if (!ing.ok) {
    return { ok: false, motivo: "ingestao_recusada", porque: ing.porque };
  }
  /**
   * ⚠️ A CORRETORA DISSE MENOS DO QUE O LIVRO TEM. Não é ruído: ou o livro
   * está errado, ou a leitura está. Aplicar o menor valor "para seguir" é o
   * caminho que produz lucro artificial — a saída fica armada e um humano
   * olha.
   */
  if (ing.regrediu) {
    return { ok: false, motivo: "regressao_na_venue",
      porque: `a venue reporta ${qtdInformada} e o livro ja tem mais — divergencia, nao ruido` };
  }

  const linha = await lerIntent(db, intentId);
  if (linha === undefined) {
    return { ok: false, motivo: "intent_ilegivel",
      porque: "nao deu para reler o intent depois da ingestao" };
  }
  if (linha === null) {
    return { ok: false, motivo: "intent_inexistente", porque: `intent ${intentId} sumiu` };
  }

  const qty = numeroOuZero(linha.filled_qty);
  /**
   * ⚠️ INGESTÃO "OK" COM LIVRO ZERADO NÃO AUTORIZA NADA. Se a venue informou
   * preenchimento e a linha durável continua em zero, alguma coisa engoliu o
   * fato — e liquidar aqui é liquidar sobre o vazio de novo.
   */
  if (!(qty > 0)) {
    return { ok: false, motivo: "livro_sem_execucao",
      porque: `venue informou ${qtdInformada} e o intent segue com filled_qty ${qty}` };
  }
  return { ok: true, qty, quote: numeroOuZero(linha.filled_quote),
           inseridos: ing.inseridos };
}

export type DesfechoDaSaida =
  | { ok: true; resultado: ResultadoDaLiquidacao & { ok: true };
      /** Os números DO LIVRO com que a liquidação foi feita. */
      qty: number; quote: number }
  | { ok: false; etapa: "assentamento" | "liquidacao"; motivo: string; porque: string };

/**
 * ⚠️⚠️ A SEQUÊNCIA INTEIRA, NUM LUGAR SÓ — para que exista um caminho a
 * testar, e não uma ordem de chamadas reproduzida à mão dentro do cron.
 *
 * O cron passou a ser adaptador: ele pergunta à corretora, entrega o que
 * ouviu, e trata o desfecho. A regra "assenta, confere, liquida com o livro"
 * mora aqui.
 */
export async function assentarELiquidarSaida(
  intentId: string,
  externalOrderId: string | null,
  ordem: OrdemParaAssentar,
  qtdInformada: number,
  deps: DependenciasDoAssentamento = {},
): Promise<DesfechoDaSaida> {
  const fatos = await assentarFatosDaSaida(
    intentId, externalOrderId, ordem, qtdInformada, deps);
  if (!fatos.ok) {
    return { ok: false, etapa: "assentamento", motivo: fatos.motivo, porque: fatos.porque };
  }
  const liquidar = deps.liquidar
    ?? ((id: string, q: number, qu: number) =>
          liquidarSaidaArmada(id, q, qu, { chamarRpc: deps.chamarRpc }));
  /**
   * ⚠️⚠️ OS NÚMEROS SÃO OS DO LIVRO, não os da resposta HTTP. É a diferença
   * inteira do achado: a RPC deriva a taxa da MESMA linha de onde estes dois
   * saíram, então a conta fecha com a que o recovery faria depois.
   */
  const r = await liquidar(intentId, fatos.qty, fatos.quote);
  if (!r.ok) {
    return { ok: false, etapa: "liquidacao", motivo: r.motivo, porque: r.porque };
  }
  return { ok: true, resultado: r, qty: fatos.qty, quote: fatos.quote };
}
