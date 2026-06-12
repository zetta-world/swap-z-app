"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shield, EyeOff, Settings, ChevronDown, Zap, Menu, Sparkles, Search } from "lucide-react";
import { useState } from "react";
import { useUI } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import ConnectButton from "@/components/wallet/ConnectButton";
import { useTierAccent } from "@/components/tier/TierAccentProvider";

const NAV_TABS = [
  { label: "SWAP",      href: "/"         },
  { label: "POOLS",     href: "/pools"    },
  { label: "DASHBOARD", href: "/explorer" },
  { label: "TERMINAL",  href: "/pro"      },
] as const;

export default function Topbar({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const pathname = usePathname();
  const { setCommand, toggleZion, zionOpen } = useUI();
  const { active: tierActive, tier: activeTier } = useTierAccent();
  const t = useT();
  const isTrader = tierActive && activeTier === "trader";
  const [hideBalance, setHideBalance] = useState(false);

  return (
    <header className="topbar-shell glass-pane sticky top-0 z-30">
      <div aria-hidden className="tier-ambient" />

      {/* ── LEFT: Logo ──────────────────────────────────────── */}
      <div className="topbar-logo">
        {/* Mobile hamburger */}
        <button
          onClick={onOpenMobileNav}
          aria-label={t("topbar.openCommand")}
          className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink hover:bg-white/5 transition-colors flex-shrink-0 mr-1"
        >
          <Menu className="w-5 h-5" />
        </button>

        <Link href="/" className="topbar-logo-link">
          {/* Emblem — runic Z medallion */}
          <Image
            src="/assets/trader/z-medallion-small.svg"
            alt="Z-SWAP"
            width={38}
            height={38}
            className="topbar-logo-emblem"
            priority
          />

          {/* Logo text */}
          <div className="hidden sm:flex flex-col min-w-0 justify-center">
            <div className="topbar-logo-name">Z-SWAP</div>
            <span aria-hidden className="tier-logo-underline" />
            <div className="topbar-logo-sub">
              {isTrader ? "THE REALM OF THOR" : "Liquidity Nexus"}
            </div>
          </div>
        </Link>
      </div>

      {/* ── CENTER: Nav tabs ────────────────────────────────── */}
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
              <span className="topbar-tab-label">{tab.label}</span>
              <span aria-hidden className="topbar-tab-line" />
            </Link>
          );
        })}
      </nav>

      {/* ── RIGHT: Controls ─────────────────────────────────── */}
      <div className="topbar-actions">

        {/* ⚡ THOR button — trader tier only */}
        {isTrader && (
          <Link href="/pro" className="topbar-thor-btn hidden sm:flex items-center gap-1.5">
            <span className="topbar-thor-rune">ᚦ</span>
            <span>THOR</span>
            <Zap className="w-3 h-3 opacity-60" />
          </Link>
        )}

        {/* Chain selector */}
        <button className="topbar-chain-btn hidden lg:flex items-center gap-1.5">
          <span className="topbar-chain-dot" />
          <span>SOLANA</span>
          <ChevronDown className="w-3 h-3 opacity-50" />
        </button>

        {/* Tool strip */}
        <div className="topbar-tools hidden xl:flex items-center">
          <button aria-label="Security" className="topbar-tool-btn">
            <Shield className="w-3.5 h-3.5" />
          </button>
          <button
            aria-label="Hide balance"
            onClick={() => setHideBalance((v) => !v)}
            className={cn("topbar-tool-btn", hideBalance && "topbar-tool-btn--active")}
          >
            <EyeOff className="w-3.5 h-3.5" />
          </button>
          <Link href="/settings" className="topbar-tool-btn">
            <Settings className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* ZION AI */}
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
          <span className="hidden xl:inline font-display font-bold text-xs tracking-wide">ZION</span>
        </button>

        {/* Mobile search */}
        <button
          onClick={() => setCommand(true)}
          aria-label={t("common.search")}
          className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-cyan hover:bg-white/5 transition-colors"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Wallet — wrapped for trader ornate corners */}
        <div className="topbar-wallet-wrap">
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
