import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { runAudit } from "@/lib/admin/audit";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A bancada faz várias chamadas externas em paralelo; 60s é o teto do plano.
export const maxDuration = 60;

/**
 * POST /admin/api/audit-bench — roda a bancada contra o sistema VIVO.
 *
 * (O caminho é `audit-bench` porque `/admin/api/audit` já serve o log de ações
 * administrativas — coisa diferente.)
 *
 * Roda no servidor de produção de propósito: é ele que alcança a internet, o
 * banco real e as próprias rotas. Uma auditoria rodada de um ambiente sem rede
 * confunde "não consegui testar" com "passou" — e foi assim que uma plataforma
 * com o agregador de swap morto recebeu nota de aprovada.
 *
 * Só lê. Não escreve nada de negócio, não gasta token, não move fundo.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet } = await requireAdmin();

  // A origem tem que ser a URL PÚBLICA: as checagens de rota precisam bater no
  // servidor de fora, como um atacante faria. Preferir o header da requisição
  // (é o host real que o navegador acessou) e cair na env como reserva.
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("host");
  const origin = host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL ?? "");

  if (!origin) {
    return NextResponse.json(
      { error: "origin_unknown", detail: "sem host na requisição nem NEXT_PUBLIC_SITE_URL" },
      { status: 400 },
    );
  }

  // O painel manda o que o NAVEGADOR enxerga das `NEXT_PUBLIC_*`. Só ele sabe:
  // essas variáveis são assadas no build, então o servidor lendo `process.env`
  // vê o valor de AGORA e o navegador vê o valor do último deploy. Sem esse
  // envio a verificação de sincronia fica inconclusiva, nunca aprovada.
  const body = await req.json().catch(() => null) as { browserEnv?: Record<string, string | null> } | null;
  const browserEnv = body?.browserEnv && typeof body.browserEnv === "object" ? body.browserEnv : undefined;

  const report = await runAudit(origin, browserEnv);

  // Fica no ledger de eventos: a série histórica mostra se a nota melhora ou
  // apodrece, e um relatório que só existe na tela não serve de prova.
  // AWAIT obrigatório: sem ele o insert perde a corrida contra o congelamento
  // da função serverless e a auditoria some sem deixar rastro. Ver a nota em
  // what-worked/route.ts e o comentário dentro de recordEvent.
  await recordEvent("audit_run", {
    wallet,
    meta: {
      score: report.score, grade: report.grade,
      passed: report.passed, failed: report.failed, inconclusive: report.inconclusive,
      blocking: report.blocking.map((b) => b.id),
    },
  });

  return NextResponse.json(report);
}
