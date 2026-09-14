import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import type { Tier } from "@/lib/tier/types";

export const dynamic = "force-dynamic";

const VALID_TIERS: Tier[] = ["free", "pro", "trader", "pilot"];

/** GET /admin/api/tier?wallet=0x... — inspect tier for a wallet */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const target = req.nextUrl.searchParams.get("wallet");
  if (!target) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const { data } = await db
    .from("tier_cache")
    .select("tier, source, checked_at, expires_at")
    .eq("wallet_address", target)
    .maybeSingle();

  const { data: user } = await db
    .from("users")
    .select("wallet_chain, created_at, last_seen_at")
    .eq("wallet_address", target)
    .maybeSingle();

  return NextResponse.json({ wallet: target, tierCache: data, user });
}

/** POST /admin/api/tier — grant or revoke a tier */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid json" }, { status: 400 });

  const { wallet: target, tier, action } = body as {
    wallet: string;
    tier:   Tier;
    action: "grant" | "revoke";
  };

  if (!target || typeof target !== "string")
    return NextResponse.json({ error: "wallet required" }, { status: 400 });
  if (!VALID_TIERS.includes(tier))
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  if (action !== "grant" && action !== "revoke")
    return NextResponse.json({ error: "action must be grant or revoke" }, { status: 400 });

  if (action === "grant") {
    const farFuture = new Date(Date.now() + 100 * 365 * 86_400_000).toISOString();
    const { error } = await db.from("tier_cache").upsert(
      {
        wallet_address: target,
        tier,
        /**
         * ⚠️⚠️ `"concessao"`, NUNCA `"admin"` — conceder um PLANO criava um
         * ADMIN (14/09, achado A04 da auditoria externa, confirmado no banco).
         *
         * `tier_cache.source` carregava DOIS significados no mesmo valor:
         *
         *   (a) "este plano foi definido por um admin"  ← o que esta linha grava
         *   (b) "esta carteira É um admin"              ← o que `requireAdmin` LÊ
         *
         * Um clique em "conceder trader" para um cliente entregava a ele o
         * painel inteiro: gates, kill-switches, concessão de tier, mural.
         *
         * Medido: das 4 carteiras com `source = 'admin'`, TRÊS não estão em
         * `platform_admins` — duas dormentes, uma nunca sequer entrou.
         *
         * ⚠️ O caminho LEGÍTIMO de conceder admin é `platform_admins`, por
         * POST /admin/api/admins — e ele nem toca nesta coluna. A confusão só
         * existia porque os dois sentidos couberam na mesma palavra.
         *
         * ⚠️ As linhas ANTIGAS com `'admin'` ficam como estão, e `requireAdmin`
         * segue honrando-as: revogá-las aqui tiraria acesso sem decisão humana,
         * e uma delas é de quem concedeu admin ao dono. O conjunto agora só
         * pode ENCOLHER.
         */
        source:     "concessao",
        checked_at: new Date().toISOString(),
        expires_at: farFuture,
      },
      { onConflict: "wallet_address" },
    );
    /**
     * ⚠️ E O ERRO É LIDO. `supabase-js` resolve com `{ error }` e não lança: um
     * `await` cujo erro ninguém lê é uma concessão que falhou em silêncio,
     * sobre a qual o painel diz "ok" — e o cliente pagou por um plano que não
     * existe.
     */
    if (error) {
      return NextResponse.json(
        { error: "nao_consegui_conceder", porque: error.message.slice(0, 200) },
        { status: 500 },
      );
    }
  } else {
    await db.from("tier_cache").delete().eq("wallet_address", target);
  }

  await logAdminAction(actor, `tier.${action}`, target, { tier });
  broadcastAdminRefresh("tier");
  broadcastAdminRefresh("audit");

  return NextResponse.json({ ok: true, action, target, tier });
}
