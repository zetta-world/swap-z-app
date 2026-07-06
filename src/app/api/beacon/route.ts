import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { recordEvent } from "@/lib/admin/track";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

/** POST /api/beacon — receives page-view pings from the client Beacon component.
 *
 * Body: { path: string, ref?: string }
 * Reads the session cookie (if present) to associate the view with a wallet.
 * No response body needed — client fires-and-forgets with keepalive.
 *
 * MIDGARD enrichment (T1-T3, docs/PLANO-MIDGARD-TRAFEGO.md): each view also
 * records coarse geo from Vercel's edge headers (country/region/city/lat/lon —
 * city-level, never the IP itself), a pseudonymous visitor hash (`cid`,
 * truncated sha256 of IP+UA — lets the admin panel count UNIQUES without
 * storing the IP in the clear), the device class, and the external referrer.
 * LGPD posture: no raw IP persisted, no new cookies, geo is city-granular.
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

    const h = req.headers;
    const dec = (v: string | null) => { try { return v ? decodeURIComponent(v) : null; } catch { return v; } };
    const num = (v: string | null) => { const n = parseFloat(v ?? ""); return Number.isFinite(n) ? n : null; };

    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
    const ua = h.get("user-agent") ?? "";
    const cid = createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 16);

    // External referrer only (same-site navigation is noise).
    const rawRef = typeof body?.ref === "string" ? body.ref.slice(0, 300) : "";
    let referrer: string | null = null;
    try {
      if (rawRef) {
        const u = new URL(rawRef);
        const own = (process.env.NEXT_PUBLIC_SITE_URL ?? "").includes(u.hostname);
        if (!own) referrer = u.hostname;
      }
    } catch { /* ignore malformed */ }

    const session = await getSession();
    recordEvent("page_view", {
      wallet: session?.sub ?? null,
      path,
      meta: {
        cid,
        country: h.get("x-vercel-ip-country") ?? null,
        region:  h.get("x-vercel-ip-country-region") ?? null,
        city:    dec(h.get("x-vercel-ip-city")),
        lat:     num(h.get("x-vercel-ip-latitude")),
        lon:     num(h.get("x-vercel-ip-longitude")),
        device:  /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop",
        referrer,
      },
    });
  } catch {
    // never fail
  }
  return new NextResponse(null, { status: 204 });
}
