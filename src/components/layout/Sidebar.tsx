"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, Boxes } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  NAV_ITEMS, NAV_GROUP_KEYS, NAV_BADGE_CLASSES, type NavItem,
} from "./nav-items";

export default function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useUI();
  const t = useT();
  const w = sidebarCollapsed ? 80 : 248;

  const grouped = NAV_ITEMS.reduce<Record<string, NavItem[]>>((acc, item) => {
    (acc[item.group] = acc[item.group] || []).push(item);
    return acc;
  }, {});

  return (
    <motion.aside
      initial={false}
      animate={{ width: w }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-40 glass-pane border-r border-white/5 overflow-hidden"
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          <div className="relative w-9 h-9 flex-shrink-0">
            <div className="absolute inset-0 rounded-xl bg-grad-cyan opacity-20 blur-md" />
            <div className="relative w-9 h-9 rounded-xl bg-grad-cyan flex items-center justify-center">
              <span className="font-display font-extrabold text-bg text-lg leading-none">Z</span>
            </div>
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0">
              <div className="font-display font-extrabold text-ink text-sm leading-none tracking-wide">Z-SWAP</div>
              <div className="font-mono text-[9px] text-ink-3 tracking-[0.18em] uppercase mt-1">Liquidity Nexus</div>
            </div>
          )}
        </Link>
        <button
          onClick={toggleSidebar}
          className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-cyan hover:bg-white/5 transition-colors flex-shrink-0"
          aria-label={t("common.toggleSidebar")}
        >
          <ChevronLeft className={cn("w-4 h-4 transition-transform", sidebarCollapsed && "rotate-180")} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 no-scrollbar">
        {(["trade", "discover", "build", "manage"] as const).map((g) => (
          <div key={g} className="mb-5">
            {!sidebarCollapsed && (
              <div className="font-mono text-[10px] text-ink-4 tracking-[0.18em] uppercase px-2 mb-2">
                {t(NAV_GROUP_KEYS[g])}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {grouped[g]?.map((item) => {
                const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                        active
                          ? "bg-white/[0.06] text-ink"
                          : "text-ink-2 hover:bg-white/[0.03] hover:text-ink",
                      )}
                    >
                      {active && (
                        <motion.div
                          layoutId="sidebar-active"
                          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-cyan shadow-glow-cyan"
                        />
                      )}
                      <Icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-cyan" : "text-ink-3 group-hover:text-ink-2")} />
                      {!sidebarCollapsed && (
                        <>
                          <span className="font-sans text-sm flex-1 truncate">{t(item.labelKey)}</span>
                          {item.badgeKey && item.badgeTone && (
                            <span className={cn(
                              "font-mono text-[9px] tracking-widest px-1.5 py-0.5 rounded-full border",
                              NAV_BADGE_CLASSES[item.badgeTone],
                            )}>
                              {t(item.badgeKey)}
                            </span>
                          )}
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Eco footer link */}
      {!sidebarCollapsed && (
        <div className="px-3 pb-4">
          <a
            href="https://zettaword.global"
            target="_blank"
            rel="noopener"
            className="block p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:border-cyan/20 hover:bg-cyan/[0.03] transition-all group"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Boxes className="w-3.5 h-3.5 text-cyan" />
              <span className="font-mono text-[10px] text-cyan tracking-widest uppercase">ZETTA Ecosystem</span>
            </div>
            <div className="font-sans text-xs text-ink-2 leading-snug">
              23+ products. One sovereign infrastructure.
            </div>
          </a>
        </div>
      )}
    </motion.aside>
  );
}

export const SIDEBAR_WIDTH_OPEN     = 248;
export const SIDEBAR_WIDTH_COLLAPSED = 80;
