import { NextResponse, type NextRequest } from "next/server";
import { apagar, configOu404, mesmaOrigem, recusaCsrf, SEM_CACHE, COOKIE_PRE } from "@/lib/admin/corp/http";
import { COOKIE_ADMIN } from "@/lib/admin/sessao-corporativa";
import { logout } from "@/lib/admin/corp/fluxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/admin-auth/logout — revoga a linha (escrita conferida) e apaga os cookies. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const c = configOu404();
  if (!c.ok) return c.resposta;
  if (!mesmaOrigem(req, c.cfg)) return recusaCsrf();
  const r = await logout(req.cookies.get(COOKIE_ADMIN)?.value, req.cookies.get(COOKIE_PRE)?.value, c.cfg);
  const res = NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 503, headers: SEM_CACHE });
  res.cookies.set({ ...apagar(COOKIE_ADMIN), sameSite: "strict" });
  res.cookies.set(apagar(COOKIE_PRE));
  return res;
}
