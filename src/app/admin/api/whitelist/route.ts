import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await requireAdmin();

  const raw = process.env.ADMIN_WALLETS ?? "";
  const wallets = raw
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  return NextResponse.json({ wallets });
}
