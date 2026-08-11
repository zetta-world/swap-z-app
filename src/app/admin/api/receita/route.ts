import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { TIER_FEE_BPS, receitaUsd, MOTIVOS_SOLANA_SEM_TAXA } from "@/lib/tier/fees";
import type { Tier } from "@/lib/tier/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RECEITA DE TAXA — C21/C22, o painel da Fase 9.3.
 *
 * ⚠️ DUAS COISAS SEPARADAS, E A SEPARAÇÃO É O PONTO: o volume REAL (medido no
 * livro de operações) e a PROJEÇÃO por faixa. Misturar as duas produziria o
 * número que este laboratório passou nove fases evitando — uma projeção lida
 * como resultado.
 *
 * ⚠️ E O TRÁFEGO DE SONDA SAI DA CONTA. O banco de ataque grava operações com
 * `volume_usd = 0` de propósito; contá-las como volume de cliente inflaria a
 * amostra com o nosso próprio teste.
 */

/** Faixas declaradas. A primeira é a nossa realidade; as outras, cenários. */
const FAIXAS_MENSAIS = [10_000, 100_000, 1_000_000, 10_000_000] as const;
const PLANOS: Tier[] = ["free", "pro", "trader", "pilot"];

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();

  let real = { operacoes: 0, volumeUsd: 0, desde: null as string | null, ate: null as string | null };
  let sonda = 0;
  let falha: string | null = null;

  if (db) {
    try {
      const { data, error } = await db
        .from("operations")
        .select("volume_usd, created_at, status")
        .eq("status", "confirmed");
      if (error) throw new Error(error.message);
      const linhas = data ?? [];
      // ⚠️ Volume zero é sonda (o banco de ataque grava assim). Fora da conta.
      const reais = linhas.filter((r) => Number(r.volume_usd ?? 0) > 0);
      sonda = linhas.length - reais.length;
      const datas = reais.map((r) => String(r.created_at)).sort();
      real = {
        operacoes: reais.length,
        volumeUsd: Number(reais.reduce((s, r) => s + Number(r.volume_usd ?? 0), 0).toFixed(2)),
        desde: datas[0] ?? null,
        ate: datas[datas.length - 1] ?? null,
      };
    } catch (e) {
      falha = String(e).slice(0, 160);
    }
  } else {
    falha = "sem banco";
  }

  /**
   * ⚠️ A RECEITA REAL usa a taxa do plano FREE de propósito, e a tela diz isso:
   * não sabemos o plano de cada operação passada — o campo não existe no livro.
   * Usar o teto é o limite SUPERIOR do que teríamos arrecadado, não uma
   * estimativa. Um número menor precisaria de um dado que não temos.
   */
  const receitaRealTetoUsd = receitaUsd(real.volumeUsd, "free");

  const projecao = FAIXAS_MENSAIS.map((volumeUsd) => ({
    volumeUsd,
    porPlano: Object.fromEntries(
      PLANOS.map((t) => [t, receitaUsd(volumeUsd, t)]),
    ) as Record<Tier, number>,
  }));

  return NextResponse.json({
    real, sonda, falha,
    receitaRealTetoUsd,
    taxaPorPlano: TIER_FEE_BPS,
    projecao,
    solanaSemTaxa: MOTIVOS_SOLANA_SEM_TAXA,
    naoMedido: [
      "⚠️ o livro NÃO guarda o plano de quem operou, então a receita real é o "
        + "TETO (tudo cobrado a 1%), não uma estimativa. Para o número exato, o "
        + "plano teria que ser gravado por operação daqui para a frente",
      "⚠️ a projeção NÃO é previsão: é aritmética sobre um volume hipotético. "
        + "Ela responde 'quanto renderia SE', não 'quanto vai render'",
      "só EVM cobra — a Solana está sem taxa por decisão registrada",
      "a taxa é retida no token de saída, então o valor em dólar depende do "
        + "preço daquele token na hora, não do preço de hoje",
    ],
    fetchedAt: new Date().toISOString(),
  });
}
