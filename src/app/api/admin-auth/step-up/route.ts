import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { configOu404, cookieAdmin, mesmaOrigem, naoEntrou, recusaCsrf, SEM_CACHE } from "@/lib/admin/corp/http";
import { COOKIE_ADMIN } from "@/lib/admin/sessao-corporativa";
import { stepUp } from "@/lib/admin/corp/fluxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin-auth/step-up `{ codigo }` (design §4.5): TOTP recente → sessão com id NOVO. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  if (!mesmaOrigem(req, c.cfg)) return recusaCsrf();
  const rl = await rateLimitDurable(`admin-auth-stepup:${getClientId(req.headers)}`, { windowMs: 60_000, max: 10 });
  if (!rl.ok) return NextResponse.json({ ok: false, erro: "limite" }, { status: 429, headers: SEM_CACHE });
  const corpo = await req.json().catch(() => null) as { codigo?: unknown } | null;
  const r = await stepUp(c.cfg, req.cookies.get(COOKIE_ADMIN)?.value, corpo?.codigo);
  if (!r.ok) return r.codigo === "refresh_invalido"
    ? NextResponse.json({ ok: false, erro: "login_necessario" }, { status: 401, headers: SEM_CACHE })
    : naoEntrou();
  const res = NextResponse.json({ ok: true }, { headers: SEM_CACHE });
  res.cookies.set(cookieAdmin(r.tokenAdmin));
  return res;
}
