import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { logSecurity } from "@/lib/admin/track";
import { transicionar } from "@/lib/early-access/store";
import { estadoValido } from "@/lib/early-access/estados";

export const dynamic = "force-dynamic";

/**
 * POST /admin/api/early-access/transition — { id, to, reason? }
 *
 * ⚠️⚠️ O AUDIT QUE VALE É O DA RPC. `early_access_transicionar` (0068) trava a
 * linha, valida a matriz, atualiza e grava `early_access_events` na MESMA
 * transação: sem evento, sem mudança. `logAdminAction` é ESPELHO — chamado só
 * depois do sucesso confirmado, e a falha dele não desfaz nada nem mente nada.
 *
 * Erros da regra (transição proibida, motivo ausente, já convertido) voltam
 * com o código, para o painel dizer o porquê; erro de banco não vaza mensagem.
 *
 * ⚠️ O MOTIVO É OPERACIONAL, NÃO DADO PESSOAL (F-12). Ele vai para o audit
 * imutável (`early_access_events.reason`) e para o `admin_audit_log`; escreva
 * "spam", "perfil incompleto", "reconsiderado" — nunca nome, documento,
 * contato ou qualquer dado do titular. Append-only não se apaga depois.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STATUS_DO_ERRO: Record<string, number> = {
  early_access_nao_encontrado:     404,
  early_access_transicao_proibida: 409,
  early_access_ja_convertido:      409,
  early_access_motivo_obrigatorio: 400,
  early_access_ator_obrigatorio:   400,
  sem_banco:                       503,
  erro_banco:                      503,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const to = body?.to;
  const reasonRaw = body?.reason;
  if (!UUID.test(id)) return NextResponse.json({ error: "id_invalido" }, { status: 400 });
  if (!estadoValido(to)) return NextResponse.json({ error: "to_invalido" }, { status: 400 });
  if (reasonRaw !== undefined && reasonRaw !== null && typeof reasonRaw !== "string") {
    return NextResponse.json({ error: "reason_invalido" }, { status: 400 });
  }
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";

  const r = await transicionar(id, to, `admin:${actor}`, reason === "" ? null : reason);
  if (!r.ok) {
    return NextResponse.json({ error: r.erro, mudou: false }, { status: STATUS_DO_ERRO[r.erro] ?? 503 });
  }

  // ── só depois da transição CONFIRMADA ──
  await logAdminAction(actor, "early_access.transition", id, { de: r.de, para: r.para, motivo: reason || null });
  if (r.de === "blocked") {
    logSecurity("early_access_desbloqueio", { by: `${actor.slice(0, 10)}…` }, "high");
  }
  broadcastAdminRefresh("audit");
  return NextResponse.json({ ok: true, mudou: true, de: r.de, para: r.para });
}
