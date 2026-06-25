"use client";

import { useAdminLayout } from "@/lib/store/admin-layout";

function truncateWallet(w: string): string {
  if (w.length <= 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

export default function AdminHeader({ wallet }: { wallet: string }) {
  const { setCmdOpen } = useAdminLayout();

  return (
    <header className="adm-header">
      <div className="adm-valknut" aria-hidden>
        <span className="adm-valknut-rune">ᚨ</span>
      </div>
      <span className="adm-header-title">Odin Control</span>
      <span className="adm-header-sep" aria-hidden />
      <span className="adm-header-sub">Z-SWAP Admin</span>
      <span className="adm-header-spacer" />
      <span className="adm-header-wallet" title={wallet}>{truncateWallet(wallet)}</span>
      <button
        className="adm-kbd-hint"
        onClick={() => setCmdOpen(true)}
        aria-label="Open command bar"
      >
        ⌘K
      </button>
    </header>
  );
}
