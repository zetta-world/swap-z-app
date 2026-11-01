import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { configOu404, cookieAdmin, mesmaOrigem, naoEntrou, recusaCsrf, SEM_CACHE } from "@/lib/admin/corp/http";
import { abrirBreakglass } from "@/lib/admin/corp/fluxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin-auth/breakglass (design §6) — SÓ em `corp`, com `ADMIN_BREAKGLASS_UNTIL` no futuro
 * (≤ 24 h) e a carteira da sessão em `ADMIN_WALLETS`. Sessão de no máximo 1 h, alerta alto a cada uso.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  if (!mesmaOrigem(req, c.cfg)) return recusaCsrf();
  const s = await getSession();
  const r = await abrirBreakglass(c.cfg, s?.sub ?? null);
  if (!r.ok) return naoEntrou(r.codigo === "config" ? 404 : 401);
  const res = NextResponse.json({ ok: true, ate: new Date(r.ate).toISOString() }, { headers: SEM_CACHE });
  res.cookies.set(cookieAdmin(r.tokenAdmin));
  return res;
}
