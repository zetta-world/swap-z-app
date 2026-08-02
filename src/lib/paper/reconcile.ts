/**
 * RECONCILIAÇÃO DAS CARTEIRAS DE PAPEL — o capital que sumia em silêncio.
 *
 * O QUE FOI ENCONTRADO (01/08, ao zerar o Setor A):
 *
 * Quatorze das vinte carteiras de paper haviam perdido entre US$450 e US$1.000
 * de capital FANTASMA — dinheiro debitado que nunca voltou. Grok e Mistral
 * estavam literalmente em **$0,00**.
 *
 * E o pior não é o número: é que isso NÃO APARECIA EM LUGAR NENHUM. O painel
 * mostra `patrimônio = inicial + realizado + não-realizado`, que continuava
 * bonito (MÍMIR "$999", VÖLUNDR "$996"). Mas quem decide se uma mesa consegue
 * ABRIR uma posição é o `cash_usd`, e ele estava em $49 e $98.
 *
 * O efeito é brutal e invisível: `sizePosition` devolve 0 abaixo de
 * `MIN_CASH_USD`, então as mesas simplesmente PARAM de operar. Não há erro, não
 * há alerta, não há linha vermelha — elas ficam quietas, e quem olha conclui
 * "não apareceu setup". Parte das amostras minúsculas que o dono estranhou
 * (4, 10, 10 trades) é isso: as mesas não estavam paradas por disciplina,
 * estavam sem dinheiro.
 *
 * ⚠️ A CAUSA RAIZ NÃO ESTÁ PROVADA. O débito (`bookPaperFills`) e o crédito
 * (`resolvePaperPositions`) estão corretos lidos isoladamente. As carteiras que
 * NÃO vazaram são exatamente as que nunca operaram (FREYJA, ULLR, oracle_grok)
 * ou as que têm contabilidade PRÓPRIA, fora deste motor (arbiter, arbiter2) —
 * o que aponta para o motor, mas apontar não é provar.
 *
 * Por isso este módulo NÃO tenta consertar a causa: ele MEDE o desvio e o
 * expõe. Enquanto a causa não for encontrada, o mínimo é que a próxima fuga
 * apareça no mesmo dia, em vez de ser descoberta por acaso semanas depois,
 * quando a amostra do experimento já foi comprometida.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

/** Quanto de desvio ainda é arredondamento de ponto flutuante, e não fuga. */
export const DRIFT_TOLERANCE_USD = 0.5;

export interface WalletDrift {
  source: string;
  label: string;
  startingUsd: number;
  /** O caixa que a carteira DIZ ter. */
  cashUsd: number;
  /** O caixa que ela DEVERIA ter: inicial − preso em aberto + P&L realizado. */
  expectedUsd: number;
  /** Negativo = capital sumiu. */
  driftUsd: number;
  /** A mesa ainda consegue abrir posição, ou já está sem dinheiro? */
  starved: boolean;
}

/**
 * A conta é simples e é justamente por isso que ela pega: o caixa de uma
 * carteira de paper só pode ser o capital inicial, menos o que está preso em
 * posição aberta, mais o que já foi realizado. Qualquer outra coisa é dinheiro
 * que apareceu ou sumiu sem trade.
 */
export function computeDrift(
  a: { source: string; label: string; startingUsd: number; cashUsd: number },
  openCostUsd: number,
  realizedPnlUsd: number,
  minCashUsd = 25,
): WalletDrift {
  const expectedUsd = a.startingUsd - openCostUsd + realizedPnlUsd;
  return {
    ...a, expectedUsd,
    driftUsd: a.cashUsd - expectedUsd,
    // Sem caixa acima do piso, `sizePosition` devolve 0 e a mesa para de
    // operar sem dizer nada a ninguém.
    starved: a.cashUsd < minCashUsd,
  };
}

/** Só o que importa: quem está fora da tolerância, pior primeiro. */
export function significantDrifts(all: WalletDrift[], tolerance = DRIFT_TOLERANCE_USD): WalletDrift[] {
  return all
    .filter((d) => Math.abs(d.driftUsd) > tolerance)
    .sort((x, y) => x.driftUsd - y.driftUsd);
}

/** Carteiras que já não conseguem abrir posição — silêncio por falta de caixa. */
export function starvedWallets(all: WalletDrift[]): WalletDrift[] {
  return all.filter((d) => d.starved);
}

/**
 * Lê o estado real e reconcilia. Best-effort: sem banco devolve lista vazia em
 * vez de derrubar quem chamou.
 */
export async function reconcileWallets(minCashUsd = 25): Promise<WalletDrift[]> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  const [{ data: accounts }, { data: positions }] = await Promise.all([
    db.from("paper_accounts").select("id, source, label, starting_usd, cash_usd"),
    db.from("paper_positions").select("account_id, status, cost_usd, pnl_usd").limit(20000),
  ]);
  if (!accounts) return [];

  const openBy = new Map<string, number>();
  const pnlBy = new Map<string, number>();
  for (const p of positions ?? []) {
    const id = String((p as { account_id: string }).account_id);
    const row = p as { status: string; cost_usd: number | null; pnl_usd: number | null };
    if (row.status === "open") openBy.set(id, (openBy.get(id) ?? 0) + Number(row.cost_usd ?? 0));
    pnlBy.set(id, (pnlBy.get(id) ?? 0) + Number(row.pnl_usd ?? 0));
  }

  return accounts.map((a) => {
    const row = a as { id: string; source: string; label: string | null; starting_usd: number; cash_usd: number };
    return computeDrift(
      {
        source: row.source, label: row.label ?? row.source,
        startingUsd: Number(row.starting_usd), cashUsd: Number(row.cash_usd),
      },
      openBy.get(String(row.id)) ?? 0,
      pnlBy.get(String(row.id)) ?? 0,
      minCashUsd,
    );
  });
}
