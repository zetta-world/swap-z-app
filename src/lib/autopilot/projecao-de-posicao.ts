/**
 * ⚠️⚠️⚠️ A ÚNICA PORTA POR ONDE UM INTENT MEXE NA POSIÇÃO — A131-C.
 *
 * Antes havia três regras para a mesma pergunta:
 *
 *   · cron imediato       → `recordServerEntry` (soma com média)
 *   · navegador imediato  → NADA no servidor, só `localStorage`
 *   · fill tardio         → NADA: `reconciliarPendentes` nunca tocou em
 *                           `autopilot_positions`, apesar de o cron dizer por
 *                           escrito "posicao abre na reconciliacao"
 *
 * O terceiro caso é o pior: a ordem limitada que preenche dez minutos depois
 * ficava fora do livro para sempre. O bot não sabia que tinha comprado, o teto
 * de exposição não contava aquele capital, e o ramo de venda nunca achava a
 * posição para sair dela.
 *
 * ⚠️ IDEMPOTÊNCIA É DURÁVEL, NÃO DE PROCESSO. Recovery acontece depois de
 * restart, noutra invocação serverless, noutro deployment. Por isso o marcador
 * mora no banco (`autopilot_position_effects`, migration 0064) e o delta é
 * sempre `ledger − applied`, calculado DENTRO da transação que aplica.
 *
 * ⚠️ E OS NÚMEROS SÃO DO LIVRO. A RPC recebe o id do intent e lê `filled_qty`
 * / `filled_quote` da própria linha — quem chama não tem parâmetro para mentir
 * sobre quantidade (§32).
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type MotivoDaProjecao =
  | "aplicado" | "sem_delta" | "saida_em_liquidacao"
  | "ajuste_sem_quantidade" | "posicao_ja_encerrada"
  | "intent_inexistente" | "simulado" | "origem_nao_autonoma" | "sem_sessao"
  | "regressao" | "regressao_de_taxa" | "sem_posicao"
  /** ⚠️ A145: o recebido tardio de uma COMPRA não achou posição onde virar
   *  base de custo. Marcar como aplicado aqui perderia o custo para sempre —
   *  fail-closed visível, e um humano olha. */
  | "sem_posicao_para_custo"
  | "erro";

export type ResultadoDaProjecao =
  | { ok: true;
      motivo: "aplicado" | "sem_delta" | "saida_em_liquidacao"
            | "ajuste_sem_quantidade" | "posicao_ja_encerrada";
      aplicadoQty: number; aplicadoQuote: number; custoRemovido: number;
      fechou: boolean; realizado: number;
      /** ⚠️ A140: a taxa estava em moeda que não dá para precificar. O P&L
       *  saiu OTIMISTA — quem chama registra, e o stop afrouxa. */
      taxaNaoPrecificada: boolean }
  | { ok: false; motivo: MotivoDaProjecao; porque: string };

export interface DependenciasDaProjecao {
  /** Injetável para teste. Devolve o JSON da RPC ou lança. */
  chamarRpc?: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
}

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Projeta em `autopilot_positions` o efeito ainda não aplicado deste intent.
 *
 * ⚠️ FALHA É FALHA. Erro de RPC não vira "nada a fazer": quem chama precisa
 * saber que o dinheiro se moveu e o livro não acompanhou (§36).
 */
export async function projetarEfeitoDoIntent(
  intentId: string,
  opts: DependenciasDaProjecao = {},
): Promise<ResultadoDaProjecao> {
  /**
   * ⚠️⚠️ SÓ O ID — achado A140.
   *
   * A taxa e o dia vinham daqui, e a varredura de pendências não tinha como
   * saber deles: o mesmo preenchimento rendia P&L diferente conforme QUEM o
   * descobrisse, e `hoje = null` fazia o freeze do stop de perda não
   * acontecer. Os dois passaram para dentro do banco, que é a única
   * autoridade que o caminho imediato e o recovery compartilham.
   */
  const args = { p_intent_id: intentId };

  let bruto: unknown;
  try {
    if (opts.chamarRpc) {
      bruto = await opts.chamarRpc("autopilot_projetar_efeito_do_intent", args);
    } else {
      const db = getSupabaseAdmin();
      if (!db) return { ok: false, motivo: "erro", porque: "supabase nao configurado" };
      const { data, error } = await db.rpc("autopilot_projetar_efeito_do_intent", args);
      // ⚠️ O cliente RESOLVE com `{ error }` — não lança. Sem esta linha, uma
      // falha de banco passaria por projeção bem-sucedida.
      if (error) return { ok: false, motivo: "erro", porque: error.message.slice(0, 200) };
      bruto = data;
    }
  } catch (e) {
    return { ok: false, motivo: "erro", porque: ((e as Error)?.message ?? String(e)).slice(0, 200) };
  }

  const r = (bruto ?? {}) as Record<string, unknown>;
  if (r.ok !== true) {
    const motivo = (typeof r.motivo === "string" ? r.motivo : "erro") as MotivoDaProjecao;
    return { ok: false, motivo,
      porque: `projecao recusada: ${motivo}${r.no_livro !== undefined
        ? ` (aplicado ${String(r.aplicado)}, no livro ${String(r.no_livro)})` : ""}` };
  }
  /**
   * ⚠️ O MAPEAMENTO É EXPLÍCITO, e o default NÃO pode ser "aplicado": um
   * motivo novo no banco chegando como "aplicado" aqui foi exatamente o que
   * escondeu o `ajuste_sem_quantidade` no primeiro teste do A142.
   */
  const motivo = r.motivo === "sem_delta" ? "sem_delta" as const
               : r.motivo === "saida_em_liquidacao" ? "saida_em_liquidacao" as const
               : r.motivo === "ajuste_sem_quantidade" ? "ajuste_sem_quantidade" as const
               : r.motivo === "posicao_ja_encerrada" ? "posicao_ja_encerrada" as const
               : "aplicado" as const;
  return {
    ok: true, motivo,
    aplicadoQty: numero(r.aplicado_qty),
    aplicadoQuote: numero(r.aplicado_quote),
    custoRemovido: numero(r.custo_removido),
    fechou: r.fechou === true,
    realizado: numero(r.pnl_realizado),
    taxaNaoPrecificada: r.taxa_nao_precificada === true,
  };
}

/**
 * ⚠️⚠️⚠️ LÁPIDE — `projecoesPendentes` FOI REMOVIDA no fechamento do Round 9.
 *
 * Ela listava intents cuja PROJEÇÃO estava atrás do livro, e era cega para o
 * caso em que o próprio LIVRO está incompleto (taxa que a venue não reportou).
 * Um intent assim ficava fora de todo recovery e prendia a sessão para sempre.
 *
 * A sucessora é `pendenciasFinanceiras` em
 * `@/lib/autopilot/recuperacao-financeira`, que devolve também `precisaVenue`
 * — e a RPC antiga é derrubada na 0064. Esta lápide existe para que qualquer
 * caller esquecido quebre no `tsc` em vez de voltar a varrer meio problema.
 */

/**
 * ⚠️⚠️⚠️ A LIQUIDAÇÃO DA SAÍDA ARMADA, NUMA TRANSAÇÃO SÓ — achado A136.
 *
 * Eram duas escritas: o marcador (para a reconciliação não reduzir de novo) e
 * a posição. Qualquer ordem entre elas perdia:
 *
 *   marcador OK + posição falha → marcador diz "aplicado", a posição continua
 *                                 cheia, e a reconciliação vê delta zero para
 *                                 sempre: a venda nunca entra no livro;
 *   posição OK + marcador falha → a posição já reduziu e o marcador ficou
 *                                 atrás: a reconciliação reduz DE NOVO.
 *
 * Inverter a ordem só troca qual dos dois acontece — e telemetria alta não
 * conserta exactly-once. Agora as duas viram uma (RPC da 0064).
 *
 * ⚠️ A QUANTIDADE VEM DA CORRETORA, e é a única que não vem do livro: a
 * liquidação acontece ANTES de os fills serem ingeridos. O marcador guarda
 * exatamente o que foi aplicado, e a projeção seguinte aplica só o que passar
 * disso.
 */
export type ResultadoDaLiquidacao =
  | { ok: true; motivo: "aplicado" | "sem_delta" | "ajuste_sem_quantidade";
      aplicadoQty: number; custoRemovido: number; fechou: boolean;
      realizado: number; taxaNaoPrecificada: boolean }
  | { ok: false; motivo: string; porque: string };

export async function liquidarSaidaArmada(
  intentId: string, qtdVendida: number, quoteRecebido: number,
  deps: DependenciasDaProjecao = {},
): Promise<ResultadoDaLiquidacao> {
  // ⚠️ A140: taxa e dia saíram daqui — ver `projetarEfeitoDoIntent`.
  const args = {
    p_intent_id: intentId,
    p_qty_vendida: qtdVendida,
    p_quote_recebido: Number.isFinite(quoteRecebido) ? quoteRecebido : 0,
  };
  let bruto: unknown;
  try {
    if (deps.chamarRpc) {
      bruto = await deps.chamarRpc("autopilot_liquidar_saida_armada", args);
    } else {
      const db = getSupabaseAdmin();
      if (!db) return { ok: false, motivo: "erro", porque: "supabase nao configurado" };
      const { data, error } = await db.rpc("autopilot_liquidar_saida_armada", args);
      if (error) return { ok: false, motivo: "erro", porque: error.message.slice(0, 200) };
      bruto = data;
    }
  } catch (e) {
    return { ok: false, motivo: "erro", porque: ((e as Error)?.message ?? String(e)).slice(0, 200) };
  }
  const r = (bruto ?? {}) as Record<string, unknown>;
  if (r.ok !== true) {
    const motivo = typeof r.motivo === "string" ? r.motivo : "erro";
    return { ok: false, motivo, porque: `liquidacao recusada: ${motivo}` };
  }
  return {
    ok: true,
    motivo: r.motivo === "sem_delta" ? "sem_delta"
          : r.motivo === "ajuste_sem_quantidade" ? "ajuste_sem_quantidade" : "aplicado",
    aplicadoQty: numero(r.aplicado_qty),
    custoRemovido: numero(r.custo_removido),
    fechou: r.fechou === true,
    realizado: numero(r.pnl_realizado),
    taxaNaoPrecificada: r.taxa_nao_precificada === true,
  };
}
