import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import {
  reconcileWallets, planRepair, planRealizedRepair, repairWallets, lastRepair, realizedDrifts,
} from "@/lib/paper/reconcile";

export const dynamic = "force-dynamic";

/**
 * DEVOLVER O CAPITAL QUE O VAZAMENTO LEVOU.
 *
 * O bug foi corrigido em `paper/engine.ts` no dia 01/08, mas correção não
 * devolve dinheiro: o Radar seguiu com $51 de $1.000 e nesse estado não abre
 * posição nenhuma. A mesa fica viva no papel e morta na prática — e o
 * experimento perde um braço sem que nada fique vermelho por causa disso.
 *
 * GET  = mostra o que SERIA feito, sem fazer. Um reparo de ledger que só existe
 *        na forma "clica e confia" é a coisa errada; dá para ver a conta antes.
 * POST = executa e deixa registro.
 *
 * O reparo NÃO é automático de propósito. Rodá-lo dentro da própria
 * reconciliação zeraria qualquer vazamento novo a cada rodada, e o detector
 * passaria a esconder exatamente o que foi construído para revelar.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const all = await reconcileWallets();
  return NextResponse.json({
    plan: planRepair(all),
    last: await lastRepair(),
    // Contexto: caixa a MAIS não entra no plano. Dinheiro que apareceu do nada
    // é outro bug, provavelmente pior, e tirar o excesso apagaria a pista.
    surplus: all.filter((d) => !d.retired && d.driftUsd > 0.5).map((d) => ({ source: d.source, driftUsd: d.driftUsd })),
    /**
     * ⚠️ O SEGUNDO INVARIANTE (05/08): o contador `realized_pnl_usd` contra o
     * P&L calculado das posições vivas.
     *
     * Vai separado do `plan` de propósito. Desvio de CAIXA é dinheiro que
     * apareceu ou sumiu; desvio de CONTADOR é a mesma verdade escrita duas
     * vezes com valores diferentes — e é o segundo que faz duas telas mostrarem
     * números distintos para a mesma carteira. Misturar os dois num botão só
     * esconderia qual dos dois problemas foi consertado.
     */
    /**
     * ⚠️ O PLANO DO CONTADOR (18/08). `contadorDivergente` abaixo é o
     * DIAGNÓSTICO — existe desde 05/08 e nunca teve conserto do outro lado.
     * Este campo é o que o POST vai de fato escrever, e existe separado para
     * o operador ver a conta antes de apertar, igual ao `plan` do caixa.
     */
    planContador: planRealizedRepair(all),
    contadorDivergente: realizedDrifts(all).map((d) => ({
      source: d.source, label: d.label,
      guardado: d.storedRealizedUsd ?? null,
      calculado: d.computedRealizedUsd,
      driftUsd: d.realizedDriftUsd,
      retired: d.retired,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const { repaired, realizedFixed, failed } = await repairWallets();
  return NextResponse.json({
    ok: failed.length === 0,
    repaired,
    /**
     * ⚠️ SEPARADO DO CAIXA NA RESPOSTA. Devolver os dois numa lista só faria
     * "reparei 5 carteiras" significar duas coisas diferentes — e a pergunta
     * que o operador tem depois de apertar é qual dos DOIS defeitos sumiu.
     */
    realizedFixed,
    failed,
    totalUsd: Math.round(repaired.reduce((s, e) => s + e.deltaUsd, 0) * 100) / 100,
    // O contador não move dinheiro: o número aqui é de CORREÇÃO de registro,
    // e somá-lo ao total de caixa inventaria capital que nunca existiu.
    contadorCorrigido: realizedFixed.length,
    // A bancada continua conferindo DEPOIS. Se o desvio voltar, é fuga nova.
    next: "rode a bancada de novo — desvio que reaparecer depois disto é vazamento NOVO",
  }, { headers: { "Cache-Control": "no-store" } });
}
