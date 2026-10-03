import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { csvCell } from "@/lib/admin/csv";
import { contarInscricoes, lerTudoParaExport, registrarExport, type LinhaInscricao } from "@/lib/early-access/store";

export const dynamic = "force-dynamic";

/**
 * GET /admin/api/early-access/export — CSV das inscrições.
 *
 * ⚠️ MINIMIZAÇÃO (F-12). O export PADRÃO não leva dado pessoal: só id, estado,
 * país, origem, UTM, marcos de verificação e datas. Dado pessoal exige
 * parâmetro DELIBERADO, e cada um fica registrado no audit:
 *
 *   ?email=1       → + email_normalized
 *   ?identidade=1  → + display_name, wallet_chain, wallet_address
 *
 * Nunca saem: telegram/X, ip_hmac, referral_flag (sinal interno de abuso),
 * status_reason (texto livre do admin), códigos e vínculos de indicação.
 *
 * ⚠️ `csvCell` em TODA célula (achado A29): nome e UTM vêm de fora e chegariam
 * à planilha de quem opera a plataforma como FÓRMULA.
 *
 * ⚠️ SEM TRUNCAMENTO SILENCIOSO (F-08). Conta antes; acima do teto responde
 * 413 `export_too_large` e não gera CSV nenhum. A leitura pede teto+1 linhas
 * e, se vier mais que o teto (cresceu entre a contagem e a leitura), recusa
 * do mesmo jeito. Menos linhas que a contagem também é recusado: um export que
 * não bate com a própria contagem não é entregue.
 *
 * ⚠️ SEM REGISTRO, SEM ARQUIVO. O export é gravado em `admin_audit_log` com o
 * resultado CONFERIDO (não `logAdminAction`, que engole erro).
 */
const TETO_EXPORT = 100_000;

const BASE: (keyof LinhaInscricao)[] = [
  "id", "created_at", "status", "country", "source",
  "utm_source", "utm_medium", "utm_campaign",
  "email_verified_at", "wallet_verified_at", "converted_at",
  // EA2-A02: só o consentimento EFETIVO do titular verificado. A declaração
  // provisória do formulário (`marketing_opt_in`) NÃO sai no export — uma
  // lista de envio montada com ela mandaria marketing sem consentimento.
  "marketing_efetivo", "marketing_escolhido_em",
  // EA2-IA04: consentimento ≠ entregabilidade. Só `marketing_elegivel`
  // (efetivo E não suprimido, gerado pelo banco) autoriza envio; a supressão
  // vai junto para que nenhuma lista pareça elegível depois de bounce/complaint.
  "marketing_elegivel", "email_suppressed_at", "email_suppression_reason",
];
const COM_EMAIL: (keyof LinhaInscricao)[] = ["email_normalized"];
const COM_IDENTIDADE: (keyof LinhaInscricao)[] = ["display_name", "wallet_chain", "wallet_address"];

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const p = req.nextUrl.searchParams;
  const opcoes = { email: p.get("email") === "1", identidade: p.get("identidade") === "1" };
  const cols: (keyof LinhaInscricao)[] = [
    ...BASE,
    ...(opcoes.email ? COM_EMAIL : []),
    ...(opcoes.identidade ? COM_IDENTIDADE : []),
  ];

  const contagem = await contarInscricoes();
  if (!contagem.ok) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  if (contagem.total > TETO_EXPORT) {
    return NextResponse.json({ error: "export_too_large", total: contagem.total, teto: TETO_EXPORT }, { status: 413 });
  }

  let linhas: LinhaInscricao[];
  try {
    linhas = await lerTudoParaExport(TETO_EXPORT + 1);
  } catch {
    // parcial não sai: `selectAllRows` lança em vez de truncar
    return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  }
  if (linhas.length > TETO_EXPORT) {
    return NextResponse.json({ error: "export_too_large", total: linhas.length, teto: TETO_EXPORT }, { status: 413 });
  }
  if (linhas.length < contagem.total) {
    return NextResponse.json({ error: "export_inconsistente", contadas: contagem.total, lidas: linhas.length }, { status: 503 });
  }

  if (!(await registrarExport(actor, linhas.length, opcoes))) {
    return NextResponse.json({ error: "audit_falhou", porque: "export não registrado — arquivo não entregue" }, { status: 503 });
  }
  broadcastAdminRefresh("audit");

  const out = [cols.join(",")];
  for (const l of linhas) out.push(cols.map((c) => csvCell(l[c])).join(","));

  return new NextResponse(out.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="early-access-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
