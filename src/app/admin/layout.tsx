import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/require";
import AdminShell from "@/components/admin/AdminShell";
import "./admin.css";

export const metadata = { title: "Control Panel" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { wallet } = await requireAdmin();

  // The anon key is safe in the browser by design (RLS-protected), and these
  // tables have no RLS policies — so it can only listen to the broadcast bus,
  // never read a row. We hand it only to authenticated admins regardless.
  const realtime = {
    url:     process.env.SUPABASE_URL     ?? null,
    anonKey: process.env.SUPABASE_ANON_KEY ?? null,
  };

  return <AdminShell wallet={wallet} realtime={realtime}>{children}</AdminShell>;
}
