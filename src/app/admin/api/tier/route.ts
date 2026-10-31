import { NextRequest, NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { logSecurity } from "@/lib/admin/track";
import { comandoAuditado, avisoDeAuditoria, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import type { Tier } from "@/lib/tier/types";

export const dynamic = "force-dynamic";

const VALID_TIERS: Tier[] = ["free", "pro", "trader", "pilot"];

/** GET /admin/api/tier?wallet=0x... — inspect tier for a wallet */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await autorizarAdmin("users.tier.read");
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
  const { wallet: actor } = await autorizarAdmin("users.tier.write");
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

  /**
   * ⚠️ CONCEDER PLANO POR CIMA DE ADMIN LEGADO APAGAVA O ADMIN (revisão adversarial,
   * Admin CC 2.0). O upsert troca `source` de `'admin'` para `'concessao'` na MESMA
   * linha que `requireAdmin` lê — o admin sumia sem decisão e sem trilha (o log
   * AUTH-04 só cobria a revogação). Agora: lida conferida; linha `'admin'` → 409,
   * nada gravado. O caminho é migrar o acesso para `platform_admins` antes.
   */
  if (action === "grant") {
    const { data: atual, error: erroAtual } = await db.from("tier_cache")
      .select("source").eq("wallet_address", target).maybeSingle();
    if (erroAtual) {
      return NextResponse.json({
        error: "leitura_falhou", porque: "NADA foi concedido: não consegui ler o registro atual desta carteira",
      }, { status: 503 });
    }
    if (atual?.source === "admin") {
      return NextResponse.json({
        error: "admin_legado", target,
        porque: "NADA foi concedido: esta carteira é admin pela fonte legada (tier_cache.source='admin'); "
          + "conceder plano aqui apagaria o acesso admin. Conceda admin em ADMIN ACCESS (platform_admins) antes.",
      }, { status: 409 });
    }
  }

  type Efeito = { removidas: Array<{ tier: string | null; source: string | null }> };
  const r = await comandoAuditado<Efeito>({
    acao: `tier.${action}`, ator: actor, alvo: target, dados: { tier },
    executar: async () => {
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
        if (error) return { ok: false, codigo: "nao_consegui_conceder", detalhe: error.message.slice(0, 200) };
        return { ok: true, valor: { removidas: [] } };
      }
      /**
       * ⚠️ O REVOKE NÃO ERA CONFERIDO: `delete()` sem ler o `error` respondia
       * `ok: true` e o log de auditoria dizia "revogou" com o DELETE recusado.
       * Agora o erro é lido e o `.select()` conta o que saiu de fato.
       */
      const { data: apagadas, error: erroDoRevoke } = await db.from("tier_cache")
        .delete().eq("wallet_address", target).select("tier, source");
      if (erroDoRevoke) return { ok: false, codigo: "nao_consegui_revogar", detalhe: erroDoRevoke.message.slice(0, 200) };
      const removidas = (apagadas ?? []).map((l) => ({ tier: l.tier ?? null, source: l.source ?? null }));
      return { ok: true, valor: { removidas }, depois: { removidas } };
    },
  });

  if (r.estado === "recusado") {
    return NextResponse.json(
      { error: "auditoria_indisponivel", porque: `o plano NÃO foi alterado. ${PORQUE_AUDITORIA_INDISPONIVEL}` },
      { status: 503 },
    );
  }
  if (r.estado === "falhou" && r.codigo === "nao_consegui_conceder") {
    return NextResponse.json(
      { error: "nao_consegui_conceder", porque: r.detalhe ?? "", ...avisoDeAuditoria(r.auditoria) },
      { status: 500 },
    );
  }
  if (r.estado !== "executado") {
    const codigo = r.estado === "falhou" ? r.codigo : "estado_incerto";
    return NextResponse.json(
      { error: codigo, porque: r.estado === "falhou" ? (r.detalhe ?? codigo) : codigo,
        ...(r.estado === "falhou" ? avisoDeAuditoria(r.auditoria) : {}) },
      { status: 500 },
    );
  }

  /**
   * ⚠️ REVOGAR UM PLANO PODE REVOGAR UM ADMIN LEGADO (AUTH-04): a linha de
   * `tier_cache` com `source = 'admin'` é a mesma que `requireAdmin` honra. A
   * política não muda aqui (decisão de R2/R5) — mas deixa de ser muda.
   */
  const removidas = r.valor.removidas;
  if (removidas.some((l) => l.source === "admin")) {
    logSecurity("tier_revoke_removeu_admin_legado", {
      by: `${actor.slice(0, 10)}…`, to: `${target.slice(0, 10)}…`,
    }, "high");
  }

  broadcastAdminRefresh("tier");
  broadcastAdminRefresh("audit");

  return NextResponse.json({
    ok: true, action, target, tier,
    ...(action === "revoke" ? { removidas: removidas.length } : {}),
    ...avisoDeAuditoria(r.auditoria),
  });
}
