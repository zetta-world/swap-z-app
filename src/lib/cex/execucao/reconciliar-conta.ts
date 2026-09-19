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
 *   3. para cada ativo com posição interna aberta, a EXISTÊNCIA do inventário é
 *      medida pelo saldo TOTAL real (`free + used`): total real menor que a
 *      quantidade interna MENOS a tolerância → ACCOUNT_DRIFT → a sessão entra
 *      em QUARENTENA (migration 0058): zero BUY autônomo, saídas permitidas,
 *      até mão humana;
 *   4. posição com EXIT ARMADO PELA PRÓPRIA Z-SWAP (`exit_armed` +
 *      `exit_order_id`) explica saldo `used`: a quantidade dela está travada
 *      numa ordem de venda NOSSA. `free` baixo com `total` íntegro e exit
 *      armado NÃO é deriva — é o bot funcionando;
 *   5. total suficiente MAS `free + armada` abaixo do inventário → há saldo
 *      travado (ou movido) que NEM o bot explica: `bloqueio_nao_explicado`.
 *      Entradas bloqueadas (fail-closed), evento `account_external_activity`,
 *      SEM quarentena destrutiva — o inventário EXISTE, o que não se explica
 *      é a trava sobre ele. Não se diz "saldo não sustenta inventário" porque
 *      ele sustenta;
 *   6. falha ao ler saldo ou posições → FAIL-CLOSED: não se conclui "sem
 *      drift", e quem chama bloqueia novas entradas até haver leitura confiável;
 *   7. primeira reconciliação de uma sessão sem baseline → grava o snapshot em
 *      `saldo_baseline`.
 *
 * ⚠️⚠️ O QUE ESTE MÓDULO PROVA — E O QUE NÃO PROVA. O que ele garante é a
 * INTEGRIDADE DO INVENTÁRIO ATRIBUÍDO AO AUTOPILOT: o que o bot registra como
 * dele existe na venue, ou a sessão para. Ele NÃO faz "reconciliação completa"
 * da conta: não reconstrói patrimônio histórico da exchange, não audita
 * depósitos alheios ao bot, e o `saldo_baseline` é TELEMETRIA (um snapshot de
 * referência), não prova de nada. Depósito a mais NUNCA é deriva e NUNCA
 * aumenta posição interna.
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
  /**
   * `true` quando a posição está com o EXIT ARMADO pela própria Z-SWAP
   * (`autopilot_positions.status = 'exit_armed'` com `exit_order_id`). A
   * quantidade dela aparece como `used` na venue porque está travada numa
   * ordem de venda NOSSA — é saldo do bot, não atividade externa.
   */
  armada?: boolean;
}

export type ResultadoDaConta =
  | { resultado: "sem_drift"; conferidos: number; baselineGravada: boolean }
  | { resultado: "deriva"; achados: string[]; quarentenaGravada: boolean }
  /**
   * ⚠️ O inventário EXISTE (o total cobre), mas há trava/atividade externa que
   * nem o bot nem a tolerância explicam. NÃO é deriva — nada se apaga, nenhuma
   * quarentena é gravada — e NÃO é "sem drift": quem chama bloqueia ENTRADAS
   * (fail-closed) e avisa com evento próprio (`account_external_activity`).
   */
  | { resultado: "bloqueio_nao_explicado"; achados: string[] }
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
    /**
     * ⚠️⚠️ A133 — a leitura agora DIZ se falhou, e `undefined` significa
     * exatamente isso aqui: `leitura_falhou` na etapa `posicoes`, que é o que
     * este arquivo já documentava querer. Antes o erro chegava como `[]`, e
     * "conta sem inventário" bate com QUALQUER saldo — a conferência passava
     * dizendo `sem_drift`, que é a mentira mais cara possível neste ponto.
     */
    const leitura = await getOpenServerPositions(sessaoId);
    if (!leitura.ok) return undefined;
    return leitura.posicoes.map((p) => ({
      base: p.base.toUpperCase(),
      baseAmount: Number(p.base_amount),
      precoRef: Number(p.entry_price),
      // Só o exit armado PELA Z-SWAP (com ordem registrada) explica `used`.
      armada: p.status === "exit_armed" && !!p.exit_order_id,
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
 * O saldo que mede a EXISTÊNCIA do inventário: o TOTAL.
 *
 * ⚠️ `free` não mede existência — uma ordem de venda armada pelo próprio bot
 * move o saldo para `used` sem que um satoshi saia da conta. O `total` da
 * venue é `free + used`; se ele vier ausente/ilegível, o fallback é somar os
 * dois componentes, nunca assumir zero.
 */
function totalRealDo(saldo: CexBalance): number {
  const total = Number(saldo.total);
  if (Number.isFinite(total)) return total;
  return Number(saldo.free) + Number(saldo.used);
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
  let saldos: CexBalance[] | undefined;
  try {
    saldos = await (deps.lerSaldos ?? lerSaldosDaProducao)(sessao, creds);
  } catch {
    saldos = undefined; // ⚠️ lançar também é falha de leitura — fail-closed.
  }
  if (saldos === undefined) {
    return { resultado: "leitura_falhou", etapa: "saldos",
      porque: "nao deu para ler o saldo na venue — fail-closed" };
  }

  // ── o baseline, uma vez por sessão — TELEMETRIA, não prova ──
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
     * ⚠️ A baseline não gravar NÃO bloqueia a conferência — ela é um snapshot
     * de referência (telemetria), não trava nem evidência. Mas não se afirma
     * que gravou quando não gravou.
     */
    baselineGravada = !error;
  }

  /**
   * ── 3. A conferência, por ATIVO. Depósito a mais NUNCA é deriva. ──
   *
   * Agrega por base: duas posições no mesmo ativo dividem o MESMO saldo da
   * venue, e conferi-las uma a uma contra o mesmo `free` acusaria duas vezes
   * a mesma fração. A tolerância soma a de cada posição.
   */
  const porBase = new Map<string, { interno: number; armada: number; limiteQty: number }>();
  for (const p of abertas) {
    const saldo = saldos.find((b) => b.asset.toUpperCase() === p.base);
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
    const g = porBase.get(p.base) ?? { interno: 0, armada: 0, limiteQty: 0 };
    g.interno += p.baseAmount;
    if (p.armada) g.armada += p.baseAmount;
    g.limiteQty += limiteQty;
    porBase.set(p.base, g);
  }

  const achados: string[] = [];
  const bloqueios: string[] = [];
  for (const [base, g] of porBase) {
    const saldo = saldos.find((b) => b.asset.toUpperCase() === base);
    const totalReal = saldo ? totalRealDo(saldo) : 0;
    const livreReal = saldo ? Number(saldo.free) : 0;

    if (totalReal < g.interno - g.limiteQty) {
      /**
       * ⚠️ DERIVA REAL: nem contando o que está travado em ordem o inventário
       * existe na venue. Saque, venda manual, conta errada — mão humana.
       */
      achados.push(
        `ACCOUNT_DRIFT ${base}: saldo total real ${totalReal} < inventario interno `
        + `${g.interno} (tolerancia ${g.limiteQty.toFixed(8)})`,
      );
    } else if (livreReal + g.armada < g.interno - g.limiteQty) {
      /**
       * ⚠️ O INVENTÁRIO EXISTE, MAS ESTÁ TRAVADO POR FORA. O total cobre, só
       * que nem o saldo livre nem o exit armado pela Z-SWAP explicam onde ele
       * está: uma ordem aberta manual, um lend/stake, uma trava da venue. NÃO
       * é deriva — nada se apaga — e NÃO é "sem drift": fail-closed nas
       * entradas até alguém explicar a trava.
       */
      bloqueios.push(
        `ACCOUNT_EXTERNAL_ACTIVITY ${base}: inventario interno ${g.interno} existe `
        + `(total real ${totalReal}), mas so ${livreReal} livre + ${g.armada} com exit `
        + `armado pela Z-SWAP — trava/atividade externa nao explicada `
        + `(tolerancia ${g.limiteQty.toFixed(8)})`,
      );
    }
  }

  if (achados.length === 0 && bloqueios.length === 0) {
    return { resultado: "sem_drift", conferidos: abertas.length, baselineGravada };
  }

  if (bloqueios.length > 0 && achados.length === 0) {
    // ⚠️ SEM quarentena: o inventário está lá. A trava é que precisa de dono.
    return { resultado: "bloqueio_nao_explicado", achados: bloqueios };
  }

  // ── 4. Deriva confirmada → QUARENTENA. Fail-closed, com mão humana. ──
  const motivo = [...achados, ...bloqueios].join(" | ").slice(0, 500);
  const { error } = await deps.db.from("autopilot_sessions").update({
    quarentena_motivo: motivo, quarentena_em: agoraIso, updated_at: agoraIso,
  }).eq("id", sessao.id);
  return { resultado: "deriva", achados, quarentenaGravada: !error };
}
