"use client";

import { type ReactNode, useEffect } from "react";
import { useAdminLayout } from "@/lib/store/admin-layout";
import AdminHeader from "./AdminHeader";
import AdminCommandBar from "./AdminCommandBar";

export default function AdminShell({
  wallet,
  children,
}: {
  wallet: string;
  children: ReactNode;
}) {
  const { setCmdOpen } = useAdminLayout();

  // ⌘K / Ctrl+K opens the command bar
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === "Escape") {
        setCmdOpen(false);
      }
    }
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [setCmdOpen]);

  return (
    <div className="admin-shell" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      {/* Odin ambient backdrop with shooting star */}
      <div className="admin-odin-bg" aria-hidden>
        <div className="adm-comet" aria-hidden />
      </div>

      {/* Content above backdrop */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }}>
        <AdminHeader wallet={wallet} />
        <main style={{ flex: 1, overflowY: "auto" }}>
          {children}
        </main>
      </div>

      {/* Rune watermark */}
      <div className="adm-rune-watermark" aria-hidden>ᚨ · ᚦ · ᚠ · ᚢ</div>

      {/* Command bar portal */}
      <AdminCommandBar />
    </div>
  );
}
