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
  | "intent_inexistente" | "simulado" | "origem_nao_autonoma" | "sem_sessao"
  | "regressao" | "sem_posicao" | "erro";

export type ResultadoDaProjecao =
  | { ok: true; motivo: "aplicado" | "sem_delta" | "saida_em_liquidacao";
      aplicadoQty: number; aplicadoQuote: number; custoRemovido: number; fechou: boolean }
  | { ok: false; motivo: MotivoDaProjecao; porque: string };

/** O que a liquidação da saída armada JÁ aplicou direto na posição. */
export interface JaAplicadoPelaLiquidacao {
  qty: number;
  quote: number;
}

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
  opts: { jaAplicado?: JaAplicadoPelaLiquidacao } & DependenciasDaProjecao = {},
): Promise<ResultadoDaProjecao> {
  const args = {
    p_intent_id: intentId,
    ...(opts.jaAplicado
      ? { p_qty_ja_aplicada: opts.jaAplicado.qty, p_quote_ja_aplicada: opts.jaAplicado.quote }
      : {}),
  };

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
  return {
    ok: true,
    motivo: r.motivo === "sem_delta" ? "sem_delta"
          : r.motivo === "saida_em_liquidacao" ? "saida_em_liquidacao"
          : "aplicado",
    aplicadoQty: numero(r.aplicado_qty),
    aplicadoQuote: numero(r.aplicado_quote),
    custoRemovido: numero(r.custo_removido),
    fechou: r.fechou === true,
  };
}

/**
 * ⚠️⚠️⚠️ A VARREDURA DE PENDÊNCIAS — porque `FILLED` é TERMINAL.
 *
 * Achado da revisão adversarial: o comentário desta casa prometia que "a
 * reconciliação aplica o delta que faltar" se a projeção falhasse. Falso para
 * o caso mais comum — uma compra a mercado que preenche na hora vira `FILLED`,
 * e `intentsParaReconciliar` só olha os NÃO-terminais. Ninguém voltava naquele
 * intent: o bot comprava e nunca saberia que possui.
 *
 * ⚠️ MELHOR-ESFORÇO, E BARULHENTA. Falha de leitura não é "nada pendente":
 * devolve `null`, e quem chama registra a diferença.
 */
export async function projecoesPendentes(
  limite = 50, deps: DependenciasDaProjecao = {},
): Promise<string[] | null> {
  try {
    if (deps.chamarRpc) {
      const bruto = await deps.chamarRpc("autopilot_projecoes_pendentes", { p_limite: limite });
      return (Array.isArray(bruto) ? bruto : [])
        .map((l) => String((l as { intent_id?: unknown }).intent_id ?? ""))
        .filter(Boolean);
    }
    const db = getSupabaseAdmin();
    if (!db) return null;
    const { data, error } = await db.rpc("autopilot_projecoes_pendentes", { p_limite: limite });
    if (error) return null;
    return (data ?? []).map((l) => String(l.intent_id)).filter(Boolean);
  } catch {
    return null;
  }
}

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
  | { ok: true; motivo: "aplicado" | "sem_delta";
      aplicadoQty: number; custoRemovido: number; fechou: boolean }
  | { ok: false; motivo: string; porque: string };

export async function liquidarSaidaArmada(
  intentId: string, qtdVendida: number, quoteRecebido: number,
  deps: DependenciasDaProjecao = {},
): Promise<ResultadoDaLiquidacao> {
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
    motivo: r.motivo === "sem_delta" ? "sem_delta" : "aplicado",
    aplicadoQty: numero(r.aplicado_qty),
    custoRemovido: numero(r.custo_removido),
    fechou: r.fechou === true,
  };
}
