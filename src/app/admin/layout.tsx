import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/require";
import AdminShell from "@/components/admin/AdminShell";
import "./admin.css";

export const metadata = { title: "Control Panel" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { wallet } = await requireAdmin();
  return <AdminShell wallet={wallet}>{children}</AdminShell>;
}
