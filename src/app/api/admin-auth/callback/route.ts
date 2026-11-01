import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { apagar, configOu404, cookiePre, COOKIE_FLUXO, SEM_CACHE } from "@/lib/admin/corp/http";
import { concluirCallback } from "@/lib/admin/corp/fluxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin-auth/callback?code=…&f=… (design §4.2 passos 3–5). O cookie de fluxo é de USO ÚNICO
 * (apagado em toda resposta). Qualquer recusa → a mesma página "não foi possível entrar".
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  const falhou = () => {
    const res = NextResponse.redirect(new URL("/admin-acesso?erro=1", c.cfg.origem), { status: 302, headers: SEM_CACHE });
    res.cookies.set(apagar(COOKIE_FLUXO));
    return res;
  };
  const rl = await rateLimitDurable(`admin-auth-cb:${getClientId(req.headers)}`, { windowMs: 60_000, max: 10 });
  if (!rl.ok) return falhou();
  const q = req.nextUrl.searchParams;
  const r = await concluirCallback(c.cfg, {
    code: q.get("code"), f: q.get("f"), erroIdp: q.get("error"), cookieFluxo: req.cookies.get(COOKIE_FLUXO)?.value,
  });
  if (!r.ok) return falhou();
  const destino = new URL("/admin-acesso/mfa", c.cfg.origem);
  destino.searchParams.set("volta", r.volta);
  const res = NextResponse.redirect(destino, { status: 302, headers: SEM_CACHE });
  res.cookies.set(apagar(COOKIE_FLUXO));
  res.cookies.set(cookiePre(r.tokenPre));
  return res;
}
