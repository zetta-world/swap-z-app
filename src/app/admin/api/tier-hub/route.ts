import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { PLAN_TIERS } from "@/lib/pricing/plans";
import type { Tier } from "@/lib/tier/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O HUB DE PLANOS — quem está em cada faixa, e como chegou lá.
 *
 * ⚠️ A ORIGEM VIAJA JUNTO COM A CONTAGEM, e é o campo que mais importa aqui.
 *
 * `tier_cache.source` distingue `nft` (comprou o passe), `admin` (cortesia
 * concedida por nós) e `sem_pass`/`nao_checado` (caiu no `free`). Hoje TODOS
 * os planos pagos são `admin` — zero vendas. Uma tela que mostrasse só
 * "trader: 2" transformaria cortesia em tração, que é a leitura mais cara que
 * este painel pode induzir, e justamente numa reunião.
 */

export interface FaixaHub {
  tier: Tier;
  deus: string; runa: string; epiteto: string;
  /** ⚠️ CADA FAIXA TEM DOIS PRODUTOS, e a tela precisa mostrar os dois.
   *  O passe (NFT do deus) é compra única de 3 anos; a Hird (o guerreiro que
   *  SERVE aquele deus) é assinatura mensal. Mostrar só o passe escondia
   *  metade da oferta — e é justamente a metade recorrente. */
  carta: string;              /* arte do passe — /nft/* */
  guerreiro: string; guerreiroDesc: string; guerreiroRuna: string;
  avatar: string;             /* arte da Hird — /warriors/* */
  brasao: string;             /* brasão do deus servido — /tiers/* */
  precoUsd: number; mensalUsd: number;
  /** Carteiras nesta faixa hoje. */
  ativos: number;
  /** Quantas COMPRARAM o passe — o número que vira receita. */
  compradas: number;
  /** Quantas são cortesia nossa. */
  cortesia: number;
}

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "sem banco" }, { status: 503 });

  try {
    // leitura-limitada: `tier_cache` tem uma linha por carteira conhecida —
    // dezenas hoje, e a paginação abaixo cobre o crescimento sem teto.
    const linhas = await selectAllRows<{
      wallet_address: string; tier: string; source: string; checked_at: string;
    }>((de, ate) => db
      .from("tier_cache")
      .select("wallet_address, tier, source, checked_at")
      .order("checked_at", { ascending: false }).range(de, ate));

    const faixas: FaixaHub[] = PLAN_TIERS.map((p) => {
      const desta = linhas.filter((l) => l.tier === p.tier);
      return {
        tier: p.tier,
        deus: p.god, runa: p.rune, epiteto: p.epithet,
        carta: p.card,
        guerreiro: p.warrior, guerreiroDesc: p.warriorDesc,
        guerreiroRuna: p.warriorRune, avatar: p.avatar ?? p.crest,
        brasao: p.crest,
        precoUsd: p.usdTarget, mensalUsd: p.monthlyUsd,
        ativos: desta.length,
        compradas: desta.filter((l) => l.source === "nft").length,
        cortesia: desta.filter((l) => l.source === "admin").length,
      };
    });

    /**
     * ⚠️ AS ATIVAÇÕES TRAZEM A ORIGEM NA LINHA. "Carteira X virou trader" sem
     * dizer se comprou ou ganhou é a mesma frase para dois fatos opostos — e
     * numa tabela que rola sozinha, ninguém volta para conferir.
     */
    const ativacoes = linhas
      .filter((l) => l.tier !== "free")
      .slice(0, 12)
      .map((l) => ({
        quando: l.checked_at,
        carteira: `${l.wallet_address.slice(0, 8)}…${l.wallet_address.slice(-4)}`,
        tier: l.tier,
        comprou: l.source === "nft",
      }));

    const free = linhas.filter((l) => l.tier === "free").length;

    return NextResponse.json({
      faixas, ativacoes,
      total: linhas.length, free,
      vendidas: faixas.reduce((s, f) => s + f.compradas, 0),
      cortesias: faixas.reduce((s, f) => s + f.cortesia, 0),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
