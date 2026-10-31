import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("identity.env_admins.read");

  const raw = process.env.ADMIN_WALLETS ?? "";
  const wallets = raw
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  return NextResponse.json({ wallets });
}
