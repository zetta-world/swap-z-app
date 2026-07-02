import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Client error telemetry (R1.4). Browser-side crashes (window.onerror /
 * unhandledrejection) were invisible — a user hitting a white screen left no
 * trace anywhere. This route feeds them into the EXISTING error pipeline:
 * platform_events → admin LOGS & SECURITY panel → watchdog error-spike alert
 * on Telegram. Deliberately no Sentry SDK for now (heavy dependency, dormant
 * without a DSN) — documented as an optional upgrade in the RUNBOOK.
 *
 * Abuse posture: anonymous endpoint, so it is tightly rate-limited, payload
 * is size-capped and only whitelisted string fields are persisted (never raw
 * client JSON into the DB).
 */

const RL_OPTS = { windowMs: 60_000, max: 5 }; // 5 errors/min/IP is plenty for real crashes
const MAX_LEN = { message: 300, stack: 1500, url: 200 };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await rateLimitDurable(`telemetry:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const body = await req.json().catch(() => null) as
    { message?: unknown; stack?: unknown; url?: unknown; kind?: unknown } | null;
  if (!body || typeof body.message !== "string" || !body.message.trim()) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  await recordEvent("error", {
    path: clip(body.url, MAX_LEN.url),
    meta: {
      source:  "client",
      kind:    body.kind === "unhandledrejection" ? "unhandledrejection" : "onerror",
      message: body.message.slice(0, MAX_LEN.message),
      stack:   clip(body.stack, MAX_LEN.stack),
    },
  });
  return NextResponse.json({ ok: true });
}
