"use client";

import { Search, Sparkles, Bell, Menu } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import ModeSwitcher from "./ModeSwitcher";
import ConnectButton from "@/components/wallet/ConnectButton";

export default function Topbar({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const { setCommand, toggleZion, zionOpen } = useUI();
  const t = useT();

  return (
    <header className="sticky top-0 z-30 h-14 sm:h-16 px-3 sm:px-5 lg:px-6 flex items-center gap-2 sm:gap-3 border-b border-white/5 glass-pane">
      {/* Pilot-only ambient shimmer — display:none unless html[data-tier="pilot"] */}
      <div aria-hidden className="tier-ambient" />

      {/* ─── LEFT: hamburger + brand (mobile/tablet only) ─────────────── */}
      <div className="flex items-center gap-2 lg:hidden min-w-0 flex-shrink-0">
        <button
          onClick={onOpenMobileNav}
          aria-label={t("topbar.openCommand")}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink hover:bg-white/5 transition-colors flex-shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>
        <a href="/" className="flex items-center gap-2 min-w-0">
          <div className="relative w-7 h-7 flex-shrink-0">
            <div className="absolute inset-0 rounded-lg bg-grad-cyan opacity-30 blur-md" />
            <div className="relative w-7 h-7 rounded-lg bg-grad-cyan flex items-center justify-center">
              <span className="font-display font-extrabold text-bg text-[13px] leading-none">Z</span>
            </div>
          </div>
          <span className="font-display font-extrabold text-ink text-sm whitespace-nowrap hidden xs:inline">
            Z-SWAP
          </span>
        </a>
      </div>

      {/* ─── CENTER: command bar (md+) ────────────────────────────────── */}
      <button
        onClick={() => setCommand(true)}
        className="hidden md:flex flex-1 max-w-md items-center gap-3 px-3.5 py-2 rounded-lg bg-white/[0.03] border border-white/5 hover:border-cyan/20 hover:bg-white/[0.05] transition-colors group"
      >
        <Search className="w-4 h-4 text-ink-3 group-hover:text-cyan transition-colors flex-shrink-0" />
        <span className="font-sans text-sm text-ink-3 group-hover:text-ink-2 transition-colors flex-1 text-left truncate">
          {t("topbar.commandPalette")}
        </span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-ink-3 border border-white/10 bg-white/[0.02]">
          ⌘K
        </kbd>
      </button>

      {/* ─── Spacer on mobile to push right cluster to the edge ──────── */}
      <div className="flex-1 md:hidden" />

      {/* ─── RIGHT: live pulse + controls + wallet ───────────────────── */}
      <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        {/* Live indicator — xl only */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5">
          <span className="w-1.5 h-1.5 rounded-full bg-green pulse-dot" />
          <span className="font-mono text-[10px] text-ink-2 tracking-widest uppercase">{t("explorer.liveActive")}</span>
        </div>

        <ModeSwitcher />
        {/* Language picker lives in /settings → Appearance group.
            Keeping it out of the topbar keeps the header uncluttered on mobile —
            users rarely switch language more than once. */}

        {/* Mobile-only search icon (replaces command bar) */}
        <button
          onClick={() => setCommand(true)}
          aria-label={t("common.search")}
          className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-cyan hover:bg-white/5 transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* ZION button — always visible */}
        <button
          onClick={toggleZion}
          aria-label={t("topbar.askZion")}
          className={cn(
            "relative flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-lg border transition-all",
            zionOpen
              ? "border-gold/40 bg-gold/10 text-gold shadow-glow-gold"
              : "border-white/8 bg-white/[0.03] text-ink-2 hover:text-gold hover:border-gold/30",
          )}
        >
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          <span className="hidden sm:inline font-display font-bold text-xs tracking-wide">ZION</span>
        </button>

        {/* Notifications — lg+ */}
        <button
          aria-label={t("settings.groupNotifications")}
          className="hidden lg:flex items-center justify-center w-9 h-9 rounded-lg border border-white/8 bg-white/[0.03] text-ink-2 hover:text-cyan hover:border-cyan/30 transition-colors"
        >
          <Bell className="w-4 h-4" />
        </button>

        {/* Connect wallet — real wagmi integration */}
        <ConnectButton />
      </div>
    </header>
  );
}
