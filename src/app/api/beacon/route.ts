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
/** Coarse UA classification (no external lib) — enough to separate joio do
 *  trigo: is this a bot, which browser, which OS. */
function classifyUA(ua: string): { bot: boolean; browser: string; os: string } {
  const bot = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|twitterbot|discord|headless|lighthouse|python-requests|axios|curl|wget|monitor|uptime|pingdom|ahrefs|semrush|dataprovider|scan|preview/i.test(ua);
  const browser =
    /edg\//i.test(ua) ? "Edge" :
    /opr\/|opera/i.test(ua) ? "Opera" :
    /samsungbrowser/i.test(ua) ? "Samsung" :
    /firefox|fxios/i.test(ua) ? "Firefox" :
    /chrome|crios/i.test(ua) ? "Chrome" :          // Brave reports as Chrome
    /safari/i.test(ua) ? "Safari" : "outro";
  const os =
    /iphone|ipad|ipod/i.test(ua) ? "iOS" :
    /android/i.test(ua) ? "Android" :
    /windows/i.test(ua) ? "Windows" :
    /mac os x|macintosh/i.test(ua) ? "macOS" :
    /linux/i.test(ua) ? "Linux" : "outro";
  return { bot, browser, os };
}

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

    // Dwell ping: the client sends how long it stayed on a page when leaving.
    // Recorded as its own lightweight event so we can answer "which page holds
    // the visitor longest" without a second page_view row.
    const dwellMs = num(typeof body?.dwellMs === "number" ? String(body.dwellMs) : null);
    if (dwellMs != null && dwellMs > 0) {
      recordEvent("dwell", { path, meta: { cid, ms: Math.min(dwellMs, 1_800_000) } });
      return new NextResponse(null, { status: 204 });
    }

    const { bot, browser, os } = classifyUA(ua);

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
        bot, browser, os,
        referrer,
      },
    });
  } catch {
    // never fail
  }
  return new NextResponse(null, { status: 204 });
}
