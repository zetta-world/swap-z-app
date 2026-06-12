"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, Sparkles, Bell, Menu, Zap } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import ConnectButton from "@/components/wallet/ConnectButton";
import { useTierAccent } from "@/components/tier/TierAccentProvider";
import { GOD_META, isPaidTier } from "@/lib/tier/gods";

const NAV_TABS = [
  { label: "SWAP",      href: "/"          },
  { label: "POOLS",     href: "/pools"     },
  { label: "DASHBOARD", href: "/explorer"  },
  { label: "TERMINAL",  href: "/pro"       },
] as const;

export default function Topbar({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const pathname   = usePathname();
  const { setCommand, toggleZion, zionOpen } = useUI();
  const { active: tierActive, tier: activeTier } = useTierAccent();
  const t = useT();
  const isTrader = tierActive && activeTier === "trader";

  return (
    <header className="topbar-shell glass-pane sticky top-0 z-30">
      {/* Tier ambient shimmer */}
      <div aria-hidden className="tier-ambient" />

      {/* ── LEFT: Logo ─────────────────────────── */}
      <div className="topbar-logo">
        {/* Mobile hamburger */}
        <button
          onClick={onOpenMobileNav}
          aria-label={t("topbar.openCommand")}
          className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink hover:bg-white/5 transition-colors flex-shrink-0 mr-1"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link href="/" className="flex items-center gap-2.5">
          <div className="relative w-9 h-9 flex-shrink-0">
            <div className="absolute inset-0 rounded-xl bg-grad-cyan opacity-25 blur-md" />
            <div className="relative w-9 h-9 rounded-xl bg-grad-cyan flex items-center justify-center">
              <span className="font-display font-extrabold text-bg text-lg leading-none">Z</span>
            </div>
          </div>
          <div className="hidden sm:block min-w-0">
            <div className="font-display font-extrabold text-ink text-sm leading-none tracking-wide">Z-SWAP</div>
            <span aria-hidden className="tier-logo-underline" />
            <div className="font-mono text-[9px] text-ink-3 tracking-[0.18em] uppercase mt-0.5">
              {isTrader ? "REALM OF THOR" : "Liquidity Nexus"}
            </div>
          </div>
        </Link>
      </div>

      {/* ── CENTER: Primary nav tabs ────────────── */}
      <nav className="topbar-tabs hidden md:flex" aria-label="Primary navigation">
        {NAV_TABS.map((tab) => {
          const active =
            tab.href === "/"
              ? pathname === "/"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn("topbar-tab", active && "topbar-tab--active")}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* ── RIGHT: controls ─────────────────────── */}
      <div className="topbar-actions">
        {/* Search — md+ */}
        <button
          onClick={() => setCommand(true)}
          className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 hover:border-white/10 hover:bg-white/[0.05] transition-colors group"
          aria-label={t("topbar.commandPalette")}
        >
          <Search className="w-3.5 h-3.5 text-ink-3 group-hover:text-cyan transition-colors" />
          <kbd className="hidden xl:inline font-mono text-[10px] text-ink-4 border border-white/10 rounded px-1.5">⌘K</kbd>
        </button>

        {/* THOR badge — tier pill enhanced */}
        {tierActive && isPaidTier(activeTier) && (
          <div
            className="tier-pill topbar-thor-badge hidden sm:flex items-center gap-1.5"
            title={`${GOD_META[activeTier].god} · ${GOD_META[activeTier].epithet}`}
          >
            <span className="font-display font-bold text-base leading-none" style={{ color: "var(--tier-accent)" }}>
              {GOD_META[activeTier].rune}
            </span>
            <span className="font-mono text-[9px] tracking-widest uppercase" style={{ color: "var(--tier-accent)" }}>
              {GOD_META[activeTier].god}
            </span>
          </div>
        )}

        {/* ZION */}
        <button
          onClick={toggleZion}
          aria-label={t("topbar.askZion")}
          className={cn(
            "topbar-zion-btn flex items-center gap-1.5 rounded-lg border transition-all",
            zionOpen
              ? "border-gold/40 bg-gold/10 text-gold shadow-glow-gold"
              : "border-white/8 bg-white/[0.03] text-ink-2 hover:text-gold hover:border-gold/30",
          )}
        >
          <Sparkles className="w-4 h-4 flex-shrink-0" />
          <span className="hidden sm:inline font-display font-bold text-xs tracking-wide">ZION</span>
        </button>

        {/* Notifications — xl+ */}
        <button
          aria-label={t("settings.groupNotifications")}
          className="hidden xl:flex items-center justify-center w-9 h-9 rounded-lg border border-white/8 bg-white/[0.03] text-ink-2 hover:text-cyan hover:border-cyan/30 transition-colors"
        >
          <Bell className="w-4 h-4" />
        </button>

        {/* Mobile search */}
        <button
          onClick={() => setCommand(true)}
          aria-label={t("common.search")}
          className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-cyan hover:bg-white/5 transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>

        <ConnectButton />
      </div>
    </header>
  );
}
