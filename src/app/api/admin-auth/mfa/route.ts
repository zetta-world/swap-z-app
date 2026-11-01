import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { apagar, configOu404, cookieAdmin, COOKIE_PRE, mesmaOrigem, naoEntrou, recusaCsrf, SEM_CACHE } from "@/lib/admin/corp/http";
import { iniciarMfa, verificarMfa } from "@/lib/admin/corp/fluxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin-auth/mfa `{ etapa: "iniciar", ativacao }` | `{ etapa: "verificar", codigo }` (design §4.3).
 * Sucesso do verificar: sessão ATIVA com id NOVO no cookie Strict; o pré-MFA é apagado.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  if (!mesmaOrigem(req, c.cfg)) return recusaCsrf();
  const rl = await rateLimitDurable(`admin-auth-mfa:${getClientId(req.headers)}`, { windowMs: 60_000, max: 10 });
  if (!rl.ok) return NextResponse.json({ ok: false, erro: "limite" }, { status: 429, headers: SEM_CACHE });
  const corpo = await req.json().catch(() => null) as { etapa?: unknown; ativacao?: unknown; codigo?: unknown } | null;
  const pre = req.cookies.get(COOKIE_PRE)?.value;
  if (corpo?.etapa === "iniciar") {
    const r = await iniciarMfa(c.cfg, pre, corpo.ativacao);
    if (!r.ok) return naoEntrou();
    return NextResponse.json(r, { headers: SEM_CACHE });
  }
  if (corpo?.etapa === "verificar") {
    const r = await verificarMfa(c.cfg, pre, corpo.codigo);
    if (!r.ok) return NextResponse.json({ ok: false, erro: r.codigo === "bloqueado" ? "bloqueado" : "nao_foi_possivel_entrar" }, { status: r.codigo === "bloqueado" ? 423 : 401, headers: SEM_CACHE });
    const res = NextResponse.json({ ok: true }, { headers: SEM_CACHE });
    res.cookies.set(apagar(COOKIE_PRE));
    res.cookies.set(cookieAdmin(r.tokenAdmin));
    return res;
  }
  return NextResponse.json({ ok: false, erro: "etapa" }, { status: 400, headers: SEM_CACHE });
}
