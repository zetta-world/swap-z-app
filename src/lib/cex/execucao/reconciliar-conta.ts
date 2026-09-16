/**
 * ⚠️⚠️ A RECONCILIAÇÃO DE CONTA, INDEPENDENTE DE INTENTS — achado A103.
 *
 * O QUE EXISTIA ANTES. A reconciliação (`reconciliarIntent`) só roda quando há
 * um INTENT pendente — SUBMITTING de um processo morto, UNKNOWN de um timeout.
 * Mas a pergunta "a conta ainda fecha?" não depende de intent nenhum: um saque
 * do cliente, uma venda manual no app da corretora, uma posição aberta por
 * fora — nada disso gera intent, e tudo isso invalida o inventário sobre o qual
 * o autopilot decide quanto comprar e o que pode vender.
 *
 * ESTE MÓDULO RODA POR SESSÃO ATIVA, no cron do autopilot, toda passada:
 *
 *   1. lê as posições internas do bot (`autopilot_positions` da sessão) — é
 *      este o inventário que a estratégia controla, NÃO o saldo total da conta;
 *   2. lê os saldos reais na venue (somente leitura, credencial da sessão via
 *      cofre — quem chama resolve `credenciaisDaSessao`, fail-closed);
 *   3. para cada ativo com posição interna aberta: saldo livre real menor que
 *      a quantidade interna MENOS a tolerância → ACCOUNT_DRIFT → a sessão entra
 *      em QUARENTENA (migration 0058): zero BUY autônomo, saídas permitidas,
 *      até mão humana;
 *   4. falha ao ler saldo ou posições → FAIL-CLOSED: não se conclui "sem
 *      drift", e quem chama bloqueia novas entradas até haver leitura confiável;
 *   5. primeira reconciliação de uma sessão sem baseline → grava o snapshot em
 *      `saldo_baseline`. É uma DECLARAÇÃO: não reconstruímos patrimônio
 *      histórico da exchange, e depósito a mais NUNCA é deriva.
 *
 * ⚠️ A TOLERÂNCIA É A DO `conferirSaldo` (max(US$5, 2%)), convertida para
 * quantidade pelo preço de referência. Corretoras arredondam e taxas saem em
 * outras moedas; a tolerância cobre isso sem cobrir um saque.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, AutopilotSessionRow } from "@/lib/supabase/types";
import type { CexId, CexCredentials, CexBalance } from "@/lib/cex/types";
import { fetchCexBalance } from "@/lib/cex/server";
import { getOpenServerPositions } from "@/lib/autopilot/positions-server";
import {
  TOLERANCIA_DE_SALDO_PCT, TOLERANCIA_DE_SALDO_USD,
} from "@/lib/cex/execucao/deriva";

/** O inventário interno de um ativo, do jeito que a conferência precisa. */
export interface PosicaoInterna {
  base: string;
  baseAmount: number;
  /** Referência de preço para converter a tolerância de USD para quantidade. */
  precoRef: number;
}

export type ResultadoDaConta =
  | { resultado: "sem_drift"; conferidos: number; baselineGravada: boolean }
  | { resultado: "deriva"; achados: string[]; quarentenaGravada: boolean }
  /** ⚠️ NÃO é "sem drift". Quem chama bloqueia novas entradas até ler de novo. */
  | { resultado: "leitura_falhou"; etapa: "posicoes" | "saldos"; porque: string };

export interface DependenciasDaConta {
  db: SupabaseClient<Database>;
  /** Injetável para teste. `undefined` = falha de leitura, NÃO "sem posições". */
  lerPosicoes?: (sessaoId: string) => Promise<PosicaoInterna[] | undefined>;
  /** Injetável para teste. `undefined`/lançar = falha de leitura. */
  lerSaldos?: (sessao: AutopilotSessionRow, creds: CexCredentials)
    => Promise<CexBalance[] | undefined>;
  agoraIso?: () => string;
}

/** A leitura de produção das posições: o que o bot ACHA que tem. */
async function lerPosicoesDaProducao(sessaoId: string): Promise<PosicaoInterna[] | undefined> {
  try {
    const rows = await getOpenServerPositions(sessaoId);
    return rows.map((p) => ({
      base: p.base.toUpperCase(),
      baseAmount: Number(p.base_amount),
      precoRef: Number(p.entry_price),
    }));
  } catch {
    return undefined;
  }
}

/** A leitura de produção dos saldos: o que a corretora DIZ que há. */
async function lerSaldosDaProducao(
  sessao: AutopilotSessionRow, creds: CexCredentials,
): Promise<CexBalance[] | undefined> {
  try {
    const { balances } = await fetchCexBalance(sessao.exchange_id as CexId, creds, true);
    return balances;
  } catch {
    return undefined;
  }
}

/**
 * Reconcilia a CONTA de uma sessão contra a venue. Nunca envia ordem — lê,
 * compara e, se derivou, prende as entradas até mão humana.
 */
export async function reconciliarConta(
  deps: DependenciasDaConta, sessao: AutopilotSessionRow, creds: CexCredentials,
): Promise<ResultadoDaConta> {
  const agoraIso = (deps.agoraIso ?? (() => new Date().toISOString()))();

  // ── 1. O inventário interno. Falha aqui não é "o bot não tem nada". ──
  const posicoes = await (deps.lerPosicoes ?? lerPosicoesDaProducao)(sessao.id);
  if (posicoes === undefined) {
    return { resultado: "leitura_falhou", etapa: "posicoes",
      porque: "nao deu para ler as posicoes internas da sessao" };
  }
  const abertas = posicoes.filter((p) => p.baseAmount > 0);

  // ── 2. O saldo real. Falha aqui não é "a conta está vazia" — é NÃO SEI. ──
  const saldos = await (deps.lerSaldos ?? lerSaldosDaProducao)(sessao, creds);
  if (saldos === undefined) {
    return { resultado: "leitura_falhou", etapa: "saldos",
      porque: "nao deu para ler o saldo na venue — fail-closed" };
  }

  // ── o baseline, uma vez por sessão — declaração, não reconstrução ──
  let baselineGravada = false;
  if (sessao.saldo_baseline == null) {
    const { error } = await deps.db.from("autopilot_sessions").update({
      saldo_baseline: {
        lido_em: agoraIso,
        saldos: saldos.filter((b) => b.total > 0)
          .map((b) => ({ asset: b.asset, free: b.free, total: b.total })),
      },
      updated_at: agoraIso,
    }).eq("id", sessao.id);
    /**
     * ⚠️ A baseline não gravar NÃO bloqueia a conferência — ela é registro, não
     * trava. Mas não se afirma que gravou quando não gravou.
     */
    baselineGravada = !error;
  }

  // ── 3. A conferência, ativo a ativo. Depósito a mais NUNCA é deriva. ──
  const achados: string[] = [];
  for (const p of abertas) {
    const saldo = saldos.find((b) => b.asset.toUpperCase() === p.base);
    const livreReal = saldo ? Number(saldo.free) : 0;
    const preco = p.precoRef > 0 ? p.precoRef
      : saldo && saldo.total > 0 && (saldo.usdValue ?? 0) > 0
        ? Number(saldo.usdValue) / Number(saldo.total)
        : 0;
    if (!(preco > 0)) {
      /**
       * ⚠️ SEM PREÇO, NÃO HÁ TOLERÂNCIA CONVERTIDA — e converter errado acusa
       * ou absolve por engano. Este ativo não pôde ser conferido: conta como
       * leitura insuficiente, fail-closed, não como "sem drift".
       */
      return { resultado: "leitura_falhou", etapa: "saldos",
        porque: `sem preco de referencia para conferir ${p.base}` };
    }
    const esperadoUsd = p.baseAmount * preco;
    const limiteQty = Math.max(TOLERANCIA_DE_SALDO_USD,
                               esperadoUsd * TOLERANCIA_DE_SALDO_PCT) / preco;
    if (livreReal < p.baseAmount - limiteQty) {
      achados.push(
        `ACCOUNT_DRIFT ${p.base}: saldo livre real ${livreReal} < inventario interno `
        + `${p.baseAmount} (tolerancia ${limiteQty.toFixed(8)})`,
      );
    }
  }

  if (achados.length === 0) {
    return { resultado: "sem_drift", conferidos: abertas.length, baselineGravada };
  }

  // ── 4. Deriva confirmada → QUARENTENA. Fail-closed, com mão humana. ──
  const motivo = achados.join(" | ").slice(0, 500);
  const { error } = await deps.db.from("autopilot_sessions").update({
    quarentena_motivo: motivo, quarentena_em: agoraIso, updated_at: agoraIso,
  }).eq("id", sessao.id);
  return { resultado: "deriva", achados, quarentenaGravada: !error };
}
