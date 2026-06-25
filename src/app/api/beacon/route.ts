import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { recordEvent } from "@/lib/admin/track";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

/** POST /api/beacon — receives page-view pings from the client Beacon component.
 *
 * Body: { path: string }
 * Reads the session cookie (if present) to associate the view with a wallet.
 * No response body needed — client fires-and-forgets with keepalive.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    const path = typeof body?.path === "string" ? body.path.slice(0, 500) : null;
    if (!path) return new NextResponse(null, { status: 204 });

    // Skip tracking for API routes, admin, and static files
    if (
      path.startsWith("/api/") ||
      path.startsWith("/admin") ||
      path.startsWith("/_next/")
    ) {
      return new NextResponse(null, { status: 204 });
    }

    const session = await getSession();
    recordEvent("page_view", { wallet: session?.sub ?? null, path });
  } catch {
    // never fail
  }
  return new NextResponse(null, { status: 204 });
}
