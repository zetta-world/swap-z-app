import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";

export const dynamic = "force-dynamic";

/**
 * Send a REAL, awaited test alert and report the actual Telegram result — so
 * the operator sees the precise reason on failure (token wrong → Unauthorized,
 * chat id wrong → chat not found, env missing → needs redeploy).
 */
export async function POST(): Promise<NextResponse> {
  await requireAdmin();

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json({
      ok: false, configured: false,
      detail: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not visible to this deployment — add them in Vercel (Production) and REDEPLOY.",
    });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text: "✅ Z-SWAP test alert — your alerts are working." }),
    });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; description?: string };
    if (body.ok) {
      recordEvent("alert", { meta: { text: "test alert sent" } });
      return NextResponse.json({ ok: true, configured: true });
    }
    return NextResponse.json({ ok: false, configured: true, detail: `Telegram rejected: ${body.description ?? `HTTP ${res.status}`}` });
  } catch (e) {
    return NextResponse.json({ ok: false, configured: true, detail: `Network error: ${e instanceof Error ? e.message : String(e)}` });
  }
}
