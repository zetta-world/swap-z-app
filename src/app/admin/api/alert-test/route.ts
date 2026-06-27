import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { notifyTelegram, alertConfigured } from "@/lib/admin/track";

export const dynamic = "force-dynamic";

/** Send a test alert so the operator can confirm Telegram delivery. */
export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const configured = alertConfigured();
  notifyTelegram("✅ <b>Z-SWAP</b> test alert — your alerts are working. You'll be pinged on high-severity security events, autopilot freezes, and stale crons.");
  return NextResponse.json({ ok: true, configured });
}
