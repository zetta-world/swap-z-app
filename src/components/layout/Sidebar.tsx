"use client";

import Image from "next/image";
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
      className="god-card hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-40 glass-pane border-r border-white/5 overflow-hidden"
    >
      {/* Logo — 80px to align with topbar */}
      <div className="sidebar-logo-area flex items-center justify-between px-4 border-b border-white/5 flex-shrink-0">
        <Link href="/" className="topbar-logo-link flex items-center gap-2.5 min-w-0">
          <Image
            src="/assets/trader/emblem.png"
            alt="Z-SWAP"
            width={36}
            height={36}
            className="topbar-logo-emblem"
            priority
          />
          {!sidebarCollapsed && (
            <div className="min-w-0 flex flex-col justify-center">
              <div className="topbar-logo-name">Z-SWAP</div>
              <span aria-hidden className="tier-logo-underline" />
              <div className="topbar-logo-sub">Liquidity Nexus</div>
            </div>
          )}
        </Link>
        <button
          onClick={toggleSidebar}
          className="sidebar-collapse-btn w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-cyan hover:bg-white/5 transition-colors flex-shrink-0"
          aria-label={t("common.toggleSidebar")}
        >
          <ChevronLeft className={cn("w-4 h-4 transition-transform", sidebarCollapsed && "rotate-180")} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 no-scrollbar">
        {(["trade", "discover", "build", "manage"] as const).map((g) => (
          <div key={g} className="sidebar-group mb-5">
            {!sidebarCollapsed && (
              <div className="sidebar-group-label font-mono text-[10px] text-ink-4 tracking-[0.18em] uppercase px-2 mb-2">
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
                        "sidebar-nav-item relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                        active
                          ? "sidebar-nav-item--active bg-white/[0.06] text-ink"
                          : "text-ink-2 hover:bg-white/[0.03] hover:text-ink",
                      )}
                    >
                      {active && (
                        <motion.div
                          layoutId="sidebar-active"
                          className="tier-active-bar absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-cyan shadow-glow-cyan"
                        />
                      )}
                      <Icon className={cn(
                        "sidebar-nav-icon w-4 h-4 flex-shrink-0",
                        active ? "tier-active-icon text-cyan" : "text-ink-3 group-hover:text-ink-2",
                      )} />
                      {!sidebarCollapsed && (
                        <>
                          <span className="sidebar-nav-label font-sans text-sm flex-1 truncate">
                            {t(item.labelKey)}
                          </span>
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

      {/* Ecosystem footer */}
      {!sidebarCollapsed && (
        <div className="sidebar-footer px-3 pb-4">
          <a
            href="https://zettaword.global"
            target="_blank"
            rel="noopener"
            className="sidebar-eco-card block p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:border-cyan/20 hover:bg-cyan/[0.03] transition-all group"
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

export const SIDEBAR_WIDTH_OPEN      = 248;
export const SIDEBAR_WIDTH_COLLAPSED = 80;
