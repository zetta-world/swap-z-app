import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin/require";
import { autorizarAdmin } from "@/lib/admin/authz";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { logSecurity } from "@/lib/admin/track";
import { transicionar } from "@/lib/early-access/store";
import { estadoValido, motivoValido, NOTA_MAX } from "@/lib/early-access/estados";

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
 * ⚠️⚠️ EA2-IA07 — O LOG PERSISTENTE NÃO RECEBE TEXTO LIVRE. O corpo é
 * `{ id, to, reason_code, note? }`:
 *   · `reason_code` (obrigatório) ∈ `MOTIVOS` (estados.ts) — é o ÚNICO motivo
 *     que vai para o `admin_audit_log`, que é persistente e sobrevive à purga;
 *   · `note` (opcional, ≤ 400) — nota operacional humana; vai SÓ para a RPC,
 *     que a grava em `early_access_events.reason` / `status_reason`, registros
 *     da própria inscrição que a purga de privacidade apaga.
 * O campo antigo `reason` (texto livre) e qualquer outro campo são RECUSADOS:
 * nenhum caminho leva texto livre ao log persistente.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STATUS_DO_ERRO: Record<string, number> = {
  early_access_nao_encontrado:     404,
  early_access_transicao_proibida: 409,
  early_access_ja_convertido:      409,
  early_access_motivo_obrigatorio: 400,
  early_access_ator_obrigatorio:   400,
  // D-4 (0069): aprovar exige email verificado — a regra é do banco
  early_access_email_nao_verificado: 409,
  sem_banco:                       503,
  erro_banco:                      503,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await autorizarAdmin("users.early_access.transition");

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "corpo_invalido" }, { status: 400 });
  for (const k of Object.keys(body)) {
    if (!["id", "to", "reason_code", "note"].includes(k)) {
      return NextResponse.json({ error: "campo_desconhecido", field: k.slice(0, 40) }, { status: 400 });
    }
  }
  const id = typeof body.id === "string" ? body.id : "";
  const to = body.to;
  if (!UUID.test(id)) return NextResponse.json({ error: "id_invalido" }, { status: 400 });
  if (!estadoValido(to)) return NextResponse.json({ error: "to_invalido" }, { status: 400 });
  if (!motivoValido(body.reason_code)) return NextResponse.json({ error: "reason_code_invalido" }, { status: 400 });
  const codigo = body.reason_code;
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "note_invalida" }, { status: 400 });
  }
  const nota = typeof body.note === "string" ? body.note.trim() : "";
  if (nota.length > NOTA_MAX) return NextResponse.json({ error: "note_invalida" }, { status: 400 });

  // Para a RPC (registro da inscrição, apagado na purga): código + nota opcional.
  const motivoRegistro = nota === "" ? codigo : `${codigo} — ${nota}`;
  const r = await transicionar(id, to, `admin:${actor}`, motivoRegistro);
  if (!r.ok) {
    return NextResponse.json({ error: r.erro, mudou: false }, { status: STATUS_DO_ERRO[r.erro] ?? 503 });
  }

  // ── só depois da transição CONFIRMADA ──
  // EA2-IA07: SÓ metadado não pessoal — de/para e o CÓDIGO controlado. Nunca a nota.
  await logAdminAction(actor, "early_access.transition", id, { de: r.de, para: r.para, motivo_codigo: codigo });
  if (r.de === "blocked") {
    logSecurity("early_access_desbloqueio", { by: `${actor.slice(0, 10)}…` }, "high");
  }
  broadcastAdminRefresh("audit");
  return NextResponse.json({ ok: true, mudou: true, de: r.de, para: r.para });
}
