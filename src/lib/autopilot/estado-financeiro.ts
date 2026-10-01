/**
 * ⚠️⚠️⚠️ UM ESTADO FINANCEIRO, UMA IDADE — raiz comum de CR-3, CR-4 e CR-5.
 *
 * O retest independente reproduziu três falhas com a MESMA causa: o cron
 * carregava a linha da sessão uma vez e depois decidia dinheiro sobre cópias
 * de idades diferentes. Coexistiam, na mesma passada:
 *
 *   · `s`, carregado ANTES do recovery;
 *   · `pnlToday` e `frozenUntil` em memória;
 *   · bandeiras relidas parcialmente (só quarentena e contabilidade);
 *   · `entradasLiberadas`, calculado UMA vez antes do laço de cartões;
 *   · o banco, atualizado por projeção, liquidação e recovery no meio de tudo.
 *
 * O resultado era o banco dizer uma coisa e a autorização decidir por outra:
 *
 *   CR-3 — recovery gravava `pnl_today = −51` e freeze de hoje; a sessão
 *          decidia com o `−49` de antes e mandava a COMPRA.
 *   CR-4 — a VENDA do mesmo scan levantava `contabilidade_incompleta_em`; o
 *          cartão de COMPRA seguinte usava o `entradasLiberadas` calculado
 *          antes dela.
 *   CR-5 — o recovery aplicava o resultado de HOJE e a virada do dia, decidida
 *          por um snapshot de ONTEM, zerava tudo em seguida.
 *
 * ⚠️ O CONSERTO NÃO É "RELER MAIS UMA COLUNA". É ter UMA leitura autoritativa,
 * feita no instante da decisão, com TODOS os campos que autorizam risco — e
 * fazer cada aumento de exposição passar por ela. Reler barato e no momento
 * certo é mais simples de provar do que sincronizar N espelhos.
 *
 * ⚠️ E A VIRADA DO DIA NÃO MORA MAIS AQUI. Ela está dentro de
 * `autopilot_aplicar_pnl` (0064), na mesma transação que escreve o resultado:
 * quem aplica P&L carimba o dia. Qualquer virada posterior encontra
 * `last_reset_day = hoje` e não tem o que zerar.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AutopilotSessionRow } from "@/lib/supabase/types";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  avaliarAutorizacaoDaSessaoParaExecucao, entradaAutorizadaNaSessao,
  type AutorizacaoDeExecucao, type MotivoDaRecusaDeExecucao,
  type MotivoDaRecusaDeEntrada,
} from "@/lib/autopilot/autorizacao-de-execucao";
import { utcDayKey } from "@/lib/autopilot/sessions";

/** Os campos que autorizam risco. Nenhuma decisão de entrada usa outra fonte. */
export interface EstadoFinanceiroDaSessao {
  id: string;
  ativa: boolean;
  expiraEm: string | null;
  pnlToday: number;
  dailyLossStopUsd: number;
  frozenUntilDay: string | null;
  lastResetDay: string | null;
  tradesToday: number;
  maxTradesPorDia: number;
  maxTradeUsd: number;
  conexaoId: string | null;
  quarentenaEm: string | null;
  contabilidadeIncompletaEm: string | null;
}

export interface DependenciasDoEstado {
  db?: SupabaseClient<Database> | null;
}

const COLUNAS =
  "id, is_active, expires_at, pnl_today, daily_loss_stop_usd, frozen_until_day, "
  + "last_reset_day, trades_today, max_trades_per_day, max_trade_usd, conexao_id, "
  + "quarentena_em, contabilidade_incompleta_em";

/**
 * A leitura autoritativa. `null` = NÃO DEU PARA LER — e quem chama trata isso
 * como bloqueio, nunca como "está tudo bem".
 */
export async function lerEstadoFinanceiroDaSessao(
  sessionId: string, deps: DependenciasDoEstado = {},
): Promise<EstadoFinanceiroDaSessao | null> {
  const db = deps.db ?? getSupabaseAdmin();
  if (!db) return null;
  const { data, error } = await db
    .from("autopilot_sessions").select(COLUNAS).eq("id", sessionId).maybeSingle();
  // ⚠️ O cliente RESOLVE com `{ error }`. E linha ausente sobre uma sessão que
  // deveria existir também é ausência de resposta, não ausência de risco.
  if (error || !data) return null;
  const l = data as unknown as Record<string, unknown>;
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  const t = (v: unknown) => (v == null ? null : String(v));
  return {
    id: String(l.id),
    ativa: l.is_active === true,
    expiraEm: t(l.expires_at),
    pnlToday: n(l.pnl_today),
    dailyLossStopUsd: n(l.daily_loss_stop_usd),
    frozenUntilDay: t(l.frozen_until_day),
    lastResetDay: t(l.last_reset_day),
    tradesToday: n(l.trades_today),
    maxTradesPorDia: n(l.max_trades_per_day),
    maxTradeUsd: n(l.max_trade_usd),
    conexaoId: t(l.conexao_id),
    quarentenaEm: t(l.quarentena_em),
    contabilidadeIncompletaEm: t(l.contabilidade_incompleta_em),
  };
}

/** A mesma forma, a partir de uma linha já carregada (o canal do navegador). */
export function estadoDaLinha(s: AutopilotSessionRow): EstadoFinanceiroDaSessao {
  return {
    id: s.id,
    ativa: s.is_active,
    expiraEm: s.expires_at,
    pnlToday: Number(s.pnl_today ?? 0),
    dailyLossStopUsd: Number(s.daily_loss_stop_usd ?? 0),
    frozenUntilDay: s.frozen_until_day,
    lastResetDay: s.last_reset_day,
    tradesToday: Number(s.trades_today ?? 0),
    maxTradesPorDia: Number(s.max_trades_per_day ?? 0),
    maxTradeUsd: Number(s.max_trade_usd ?? 0),
    conexaoId: s.conexao_id,
    quarentenaEm: s.quarentena_em,
    contabilidadeIncompletaEm: s.contabilidade_incompleta_em,
  };
}

export type MotivoDaRecusaDeRisco =
  | MotivoDaRecusaDeExecucao
  | MotivoDaRecusaDeEntrada
  | "estado_ilegivel"
  /** ⚠️ O stop de perda calculado sobre o número DURÁVEL de agora. */
  | "stop_de_perda_atingido";

export type AutorizacaoDeRisco =
  | { ok: true; estado: EstadoFinanceiroDaSessao; autorizacao: AutorizacaoDeExecucao & { ok: true } }
  | { ok: false; motivo: MotivoDaRecusaDeRisco; porque: string };

/**
 * ⚠️⚠️⚠️ O PORTÃO ÚNICO DE AUMENTO DE EXPOSIÇÃO.
 *
 * Avalia, sobre o estado de AGORA e numa ordem só: sessão ativa, validade,
 * congelamento, teto diário de trades, conexão, quarentena, contabilidade
 * completa e o stop de perda DURÁVEL. Chamado imediatamente antes de cada
 * COMPRA autônoma, nos dois canais.
 *
 * ⚠️ A VIRADA DO DIA É APLICADA NA LEITURA, não gravada aqui: se a linha é de
 * ontem, o contador e o congelamento de ontem não valem hoje. Quem grava a
 * virada é `autopilot_aplicar_pnl`, junto do resultado.
 */
export function avaliarRisco(
  estado: EstadoFinanceiroDaSessao | null, agora: Date = new Date(),
): AutorizacaoDeRisco {
  if (!estado) {
    return { ok: false, motivo: "estado_ilegivel",
      porque: "nao deu para ler o estado financeiro da sessao — sem ele nao se "
        + "afirma limite nenhum, e nenhuma entrada nova sai" };
  }
  const hoje = utcDayKey(agora);
  const viradoHoje = estado.lastResetDay === hoje;
  // ⚠️ Contador e congelamento de ONTEM não valem hoje.
  const tradesHoje = viradoHoje ? estado.tradesToday : 0;
  const congeladaAte = viradoHoje ? estado.frozenUntilDay : null;
  const pnlHoje = viradoHoje ? estado.pnlToday : 0;

  const sessao = avaliarAutorizacaoDaSessaoParaExecucao({
    ativa: estado.ativa,
    expiraEm: estado.expiraEm,
    congeladaAte,
    tradesHoje,
    maxTradesPorDia: estado.maxTradesPorDia,
    maxTradeUsd: estado.maxTradeUsd,
    conexaoId: estado.conexaoId,
    emQuarentena: Boolean(estado.quarentenaEm),
    contabilidadeIncompleta: Boolean(estado.contabilidadeIncompletaEm),
  }, agora);
  if (!sessao.ok) return { ok: false, motivo: sessao.motivo, porque: sessao.porque };

  /**
   * ⚠️⚠️ O STOP DE PERDA SOBRE O NÚMERO DURÁVEL — CR-3.
   *
   * `frozen_until_day` é gravado por quem aplica o P&L, mas entre a aplicação
   * e esta decisão pode haver qualquer coisa. Conferir o NÚMERO, e não só a
   * marca, fecha a janela: se o dia já está no limite, não sai entrada nova
   * nem que a marca tenha ficado para trás.
   */
  if (estado.dailyLossStopUsd > 0 && pnlHoje <= -estado.dailyLossStopUsd) {
    return { ok: false, motivo: "stop_de_perda_atingido",
      porque: `pnl_today ${pnlHoje} atingiu o stop de ${estado.dailyLossStopUsd} — `
        + "zero entrada nova hoje; saidas e recovery seguem" };
  }

  const entrada = entradaAutorizadaNaSessao({
    emQuarentena: Boolean(estado.quarentenaEm),
    contabilidadeIncompleta: Boolean(estado.contabilidadeIncompletaEm),
  });
  if (!entrada.ok) return { ok: false, motivo: entrada.motivo, porque: entrada.porque };

  return { ok: true, estado, autorizacao: sessao };
}

/**
 * Lê AGORA e decide. É esta a função que cada caminho de COMPRA autônoma
 * chama imediatamente antes do efeito externo.
 */
export async function autorizarAumentoDeExposicao(
  sessionId: string, agora: Date = new Date(), deps: DependenciasDoEstado = {},
): Promise<AutorizacaoDeRisco> {
  return avaliarRisco(await lerEstadoFinanceiroDaSessao(sessionId, deps), agora);
}
