import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { configOu404, cookieFluxo, naoEntrou, SEM_CACHE } from "@/lib/admin/corp/http";
import { iniciarLogin } from "@/lib/admin/corp/fluxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin-auth/start?provider=google|azure — PKCE no servidor (design §4.2 passo 2). 404 sem R1. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  const rl = await rateLimitDurable(`admin-auth-start:${getClientId(req.headers)}`, { windowMs: 60_000, max: 10 });
  if (!rl.ok) return NextResponse.json({ ok: false, erro: "limite" }, { status: 429, headers: { ...SEM_CACHE, "Retry-After": String(rl.retryAfter) } });
  const r = await iniciarLogin(c.cfg, req.nextUrl.searchParams.get("provider") ?? "", req.nextUrl.searchParams.get("volta"), process.env.ADMIN_GOOGLE_HD || undefined);
  if (!r.ok) return naoEntrou(400);
  const res = NextResponse.redirect(r.url, { status: 302, headers: SEM_CACHE });
  res.cookies.set(cookieFluxo(r.cookieFluxo));
  return res;
}
