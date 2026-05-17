"use client";

import { Search, Sparkles, Bell, Globe, ChevronDown, Menu } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { cn } from "@/lib/cn";
import ModeSwitcher from "./ModeSwitcher";
import LangSwitcher from "./LangSwitcher";

export default function Topbar({ onOpenMobileNav }: { onOpenMobileNav?: () => void }) {
  const { setCommand, toggleZion, zionOpen } = useUI();

  return (
    <header className="sticky top-0 z-30 h-16 px-4 sm:px-6 flex items-center justify-between gap-3 border-b border-white/5 glass-pane">
      {/* Mobile menu + brand */}
      <div className="flex items-center gap-3 lg:hidden">
        <button
          onClick={onOpenMobileNav}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-2 hover:text-ink hover:bg-white/5 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-grad-cyan flex items-center justify-center">
            <span className="font-display font-extrabold text-bg text-[13px] leading-none">Z</span>
          </div>
          <span className="font-display font-extrabold text-ink text-sm">Z-SWAP</span>
        </div>
      </div>

      {/* Command bar trigger */}
      <button
        onClick={() => setCommand(true)}
        className="hidden md:flex flex-1 max-w-md items-center gap-3 px-3.5 py-2 rounded-lg bg-white/[0.03] border border-white/5 hover:border-cyan/20 hover:bg-white/[0.05] transition-colors group"
      >
        <Search className="w-4 h-4 text-ink-3 group-hover:text-cyan transition-colors flex-shrink-0" />
        <span className="font-sans text-sm text-ink-3 group-hover:text-ink-2 transition-colors flex-1 text-left">
          Search tokens, pools, chains, actions…
        </span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-ink-3 border border-white/10 bg-white/[0.02]">
          ⌘K
        </kbd>
      </button>

      {/* Right cluster */}
      <div className="flex items-center gap-2">
        {/* Live pulse indicator */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/5">
          <span className="w-1.5 h-1.5 rounded-full bg-green pulse-dot" />
          <span className="font-mono text-[10px] text-ink-2 tracking-widest uppercase">Network Live</span>
        </div>

        <ModeSwitcher />
        <LangSwitcher />

        <button
          onClick={toggleZion}
          className={cn(
            "relative flex items-center gap-2 px-3 py-2 rounded-lg border transition-all",
            zionOpen
              ? "border-gold/40 bg-gold/10 text-gold shadow-glow-gold"
              : "border-white/8 bg-white/[0.03] text-ink-2 hover:text-gold hover:border-gold/30",
          )}
          aria-label="Open ZION AI"
        >
          <Sparkles className="w-4 h-4" />
          <span className="hidden sm:inline font-display font-bold text-xs tracking-wide">ZION</span>
        </button>

        <button
          className="hidden lg:flex items-center gap-2 btn btn-secondary py-2 px-3.5"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
        </button>

        <button className="btn btn-primary py-2 px-3.5 sm:px-4 text-xs sm:text-sm">
          <span>Connect Wallet</span>
        </button>
      </div>
    </header>
  );
}
