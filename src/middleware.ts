import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Edge middleware — runs before every request in the matcher below.
 *
 * For /admin routes: verifies the session JWT and checks ADMIN_WALLETS.
 * Non-admins get a 404 (not 403) so the panel's existence stays hidden.
 * The full requireAdmin() check in each admin page/layout re-validates
 * server-side and also accepts tier_cache.source='admin' wallets.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  if (req.nextUrl.pathname.startsWith("/admin")) {
    const authed = await checkAdminCookie(req);
    if (!authed) {
      return new NextResponse(null, { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};

// ---------------------------------------------------------------------------

const ISSUER   = "z-swap";
const AUDIENCE = "z-swap-app";
const COOKIE   = "zswap_session";

async function checkAdminCookie(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return false;

  const secretStr = process.env.AUTH_JWT_SECRET;
  if (!secretStr || secretStr.length < 16) return false;

  try {
    const secret = new TextEncoder().encode(secretStr);
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    const wallet = payload.sub;
    if (typeof wallet !== "string") return false;
    return isEnvAdmin(wallet);
  } catch {
    return false;
  }
}

function isEnvAdmin(wallet: string): boolean {
  const raw = process.env.ADMIN_WALLETS ?? "";
  if (!raw.trim()) {
    // No allowlist set: fall through to the full DB check in the page
    return true;
  }
  const set = new Set(raw.split(",").map((w) => w.trim().toLowerCase()));
  return set.has(wallet.toLowerCase());
}
