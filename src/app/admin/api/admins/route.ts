import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction, envAdminWallets } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { logSecurity } from "@/lib/admin/track";

export const dynamic = "force-dynamic";

/**
 * ADMIN ACCESS control. GET → who currently has admin (env / panel / legacy).
 * POST → grant or revoke panel-managed admin access, decoupled from tiers.
 * Guards: never revoke yourself, never revoke an env admin (edit ADMIN_WALLETS),
 * never leave the platform with zero admins. Every change is audited.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const [{ data: panel }, { data: legacy }] = await Promise.all([
    db.from("platform_admins").select("wallet_address, granted_by, note, granted_at").order("granted_at", { ascending: true }),
    db.from("tier_cache").select("wallet_address, tier").eq("source", "admin"),
  ]);

  /**
   * ⚠️ A CHAVE É MINÚSCULA, SEMPRE (11/08).
   *
   * `envAdminWallets()` devolve minúsculo; o banco guarda com checksum
   * (`0x072c80F3…B1668A`). A comparação era literal, então a MESMA carteira
   * aparecia DUAS vezes no painel — uma como `ENV (fixo)` e outra como
   * `legado`, com botão de REVOGAR ao lado.
   *
   * E o botão não removia uma duplicata: ele apagava a linha do `tier_cache`,
   * que é a mesma que carrega o PLANO daquela carteira. Um clique rotulado
   * "revogar admin" tiraria o plano `trader` junto, enquanto o admin de ENV
   * continuava valendo. Duas consequências de um botão que parecia limpar
   * repetição.
   */
  const chave = (w: string) => w.trim().toLowerCase();
  const byWallet = new Map<string, { wallet: string; source: "env" | "panel" | "legacy"; revocable: boolean; grantedBy?: string | null; grantedAt?: string | null; note?: string | null }>();
  for (const w of envAdminWallets()) byWallet.set(chave(w), { wallet: w, source: "env", revocable: false });
  for (const r of legacy ?? []) if (!byWallet.has(chave(r.wallet_address))) byWallet.set(chave(r.wallet_address), { wallet: r.wallet_address, source: "legacy", revocable: true });
  for (const r of panel ?? []) byWallet.set(chave(r.wallet_address), { wallet: r.wallet_address, source: "panel", revocable: true, grantedBy: r.granted_by, grantedAt: r.granted_at, note: r.note });

  return NextResponse.json({ admins: [...byWallet.values()], fetchedAt: new Date().toISOString() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const target = typeof body?.wallet === "string" ? body.wallet.trim() : "";
  const action = body?.action;
  const note   = typeof body?.note === "string" ? body.note.slice(0, 120) : null;

  if (!target || target.length < 20 || target.length > 80)
    return NextResponse.json({ error: "wallet inválida" }, { status: 400 });
  if (action !== "grant" && action !== "revoke")
    return NextResponse.json({ error: "action deve ser grant ou revoke" }, { status: 400 });

  if (action === "grant") {
    const { error: erroDaConcessao } = await db.from("platform_admins").upsert(
      { wallet_address: target, granted_by: actor, note, granted_at: new Date().toISOString() },
      { onConflict: "wallet_address" },
    );
    if (erroDaConcessao) {
      return NextResponse.json(
        { error: "nao_gravou", action, target,
          porque: `o admin NÃO foi criado: ${erroDaConcessao.message.slice(0, 160)}` },
        { status: 500 },
      );
    }
    // ⚠️ Auditoria e alerta DEPOIS da gravação confirmada — ver a nota do revoke.
    await logAdminAction(actor, "admin.grant", target, { note });
    logSecurity("admin_granted", { by: `${actor.slice(0, 10)}…`, to: `${target.slice(0, 10)}…` }, "high");
    broadcastAdminRefresh("audit");
    return NextResponse.json({ ok: true, action, target });
  } else {
    // ── revoke guards ──
    // ⚠️ Comparação SEM CASE. Com ela literal, bastava digitar o próprio
    // endereço com outra caixa para furar a trava de auto-revogação.
    if (target.toLowerCase() === actor.toLowerCase())
      return NextResponse.json({ error: "você não pode revogar a si mesmo" }, { status: 400 });
    if (envAdminWallets().includes(target.toLowerCase()))
      return NextResponse.json({ error: "admin de ambiente — edite ADMIN_WALLETS no Vercel" }, { status: 400 });

    // Never leave zero admins: count what remains AFTER this revoke.
    const [{ data: panel }, { data: legacy }] = await Promise.all([
      db.from("platform_admins").select("wallet_address"),
      db.from("tier_cache").select("wallet_address").eq("source", "admin"),
    ]);
    /**
     * ⚠️ TUDO EM MINÚSCULO ANTES DE CONTAR. Misturando ENV (minúsculo) com
     * banco (checksum), a MESMA carteira entrava duas vezes — e a trava do
     * "último admin" passava a permitir revogar o último, porque o conjunto
     * continuava com o sósia dele em outra caixa.
     */
    const remaining = new Set<string>([
      ...envAdminWallets().map((w) => w.toLowerCase()),
      ...(panel ?? []).map((r) => r.wallet_address.toLowerCase()),
      ...(legacy ?? []).map((r) => r.wallet_address.toLowerCase()),
    ]);
    remaining.delete(target.toLowerCase());
    if (remaining.size === 0)
      return NextResponse.json({ error: "esse é o último admin — não dá pra revogar" }, { status: 400 });

    // Kill both mechanisms so access is actually gone.
    /**
     * ⚠️ `ilike` E NÃO `eq`: o `eq` exigia a caixa exata, então revogar com o
     * endereço digitado em minúsculo apagava ZERO linhas e devolvia sucesso —
     * o operador via "revogado" e o acesso continuava de pé.
     *
     * ⚠⚠ E O `ilike` CORRIGIU O SINTOMA, NÃO O MECANISMO. A frase acima
     * — *"apagava ZERO linhas e devolvia sucesso"* — continuava verdadeira por
     * outra porta: `supabase-js` RESOLVE com `{ error }` e não lança, então um
     * DELETE **recusado** era indistinguível de um bem-sucedido, e sem
     * `.select()` um DELETE que casa ZERO linhas também.
     *
     * ⚠⚠ ISTO É CONTROLE DE ACESSO, e é pior que o kill-switch (A25): ali o
     * operador deixava de procurar um problema; aqui ele deixa de procurar uma
     * PESSOA com acesso de admin à plataforma inteira. E o `logAdminAction` +
     * `logSecurity` gravavam "revogado" de qualquer jeito — o registro forense
     * mentia junto com a tela.
     *
     * ⚠️ SÃO DOIS MECANISMOS, e falhar em UM deixa o acesso de pé. Apagar
     * `platform_admins` e não apagar o `tier_cache` de origem `admin` é uma
     * revogação PELA METADE lida como completa — e a metade que sobra ainda
     * autoriza.
     */
    const [doPainel, doLegado] = await Promise.all([
      db.from("platform_admins").delete().ilike("wallet_address", target).select("wallet_address"),
      db.from("tier_cache").delete().ilike("wallet_address", target).eq("source", "admin").select("wallet_address"),
    ]);
    const falhou = [
      doPainel.error ? `platform_admins: ${doPainel.error.message.slice(0, 80)}` : "",
      doLegado.error ? `tier_cache: ${doLegado.error.message.slice(0, 80)}` : "",
    ].filter(Boolean);
    if (falhou.length) {
      logSecurity("admin_revoke_falhou", {
        by: `${actor.slice(0, 10)}…`, to: `${target.slice(0, 10)}…`, falhou,
      }, "high");
      return NextResponse.json(
        { error: "nao_revogou", action, target, falhou,
          porque: "o acesso de admin CONTINUA DE PÉ — pelo menos um dos dois "
            + "mecanismos não foi apagado. Confira antes de fechar o painel." },
        { status: 500 },
      );
    }

    /**
     * ⚠️ ZERO LINHAS NÃO É ERRO — mas também não é "revoguei".
     *
     * Um segundo clique no mesmo botão casa zero linhas e está certo: é
     * idempotência. O que não pode é o painel dizer "revogado" quando nada
     * mudou — o operador precisa distinguir "tirei o acesso" de "esta carteira
     * já não tinha acesso por nenhum dos dois caminhos".
     */
    const removidas = (doPainel.data?.length ?? 0) + (doLegado.data?.length ?? 0);
    await logAdminAction(actor, "admin.revoke", target, { removidas });
    logSecurity("admin_revoked", {
      by: `${actor.slice(0, 10)}…`, to: `${target.slice(0, 10)}…`, removidas,
    }, "high");
    broadcastAdminRefresh("audit");
    return NextResponse.json({
      ok: true, action, target, removidas,
      painel: doPainel.data?.length ?? 0,
      legado: doLegado.data?.length ?? 0,
      ...(removidas === 0
        ? { nota: "nenhuma linha correspondia — esta carteira já não era admin por painel nem por legado" }
        : {}),
    });
  }
}
