"use client";

import { useAdminLayout } from "@/lib/store/admin-layout";
import { useAdminRealtime, type RealtimeStatus } from "./AdminRealtimeProvider";

function truncateWallet(w: string): string {
  if (w.length <= 12) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

const STATUS_META: Record<RealtimeStatus, { dot: string; label: string }> = {
  live:       { dot: "green", label: "LIVE" },
  connecting: { dot: "amber", label: "SYNC" },
  off:        { dot: "muted", label: "POLL" },
};

export default function AdminHeader({ wallet }: { wallet: string }) {
  const { setCmdOpen } = useAdminLayout();
  const realtime = useAdminRealtime();
  const status = realtime?.status ?? "off";
  const meta = STATUS_META[status];

  return (
    <header className="adm-header">
      <div className="adm-valknut" aria-hidden>
        <span className="adm-valknut-rune">ᚨ</span>
      </div>
      <span className="adm-header-title">Odin Control</span>
      <span className="adm-header-sep" aria-hidden />
      <span className="adm-header-sub">Z-SWAP Admin</span>
      <span className="adm-header-spacer" />

      {/* Realtime connection status */}
      <span
        className="adm-header-status"
        title={
          status === "live" ? "Realtime connected — panels update on change"
          : status === "connecting" ? "Connecting to realtime…"
          : "Realtime off — panels poll on a timer"
        }
      >
        <span className={`adm-dot ${meta.dot} ${status === "live" ? "adm-dot-pulse" : ""}`} />
        {meta.label}
      </span>

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
