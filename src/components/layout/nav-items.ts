/**
 * Single source of truth for the app's primary navigation. Imported by
 * the desktop Sidebar, the MobileNav drawer and the ⌘K CommandBar so
 * that label keys, badges and ordering can't drift between surfaces.
 */

import {
  ArrowLeftRight, Workflow, Sparkles, Layers, Rocket, BarChart3,
  Shield, Vote, Wallet, Settings, Activity, Banknote, CreditCard,
  Handshake, Users, Gem,
} from "lucide-react";
import { type MessageKey } from "@/lib/i18n";

export type NavBadgeTone = "ai" | "new" | "beta" | "soon";
export type NavGroup = "trade" | "discover" | "build" | "manage";

export interface NavItem {
  href: string;
  labelKey: MessageKey;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: MessageKey;
  badgeTone?: NavBadgeTone;
  group: NavGroup;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/",          labelKey: "nav.swap",       icon: ArrowLeftRight,  group: "trade" },
  { href: "/buy",       labelKey: "nav.buy",        icon: CreditCard,      group: "trade", badgeKey: "nav.badgeSoon", badgeTone: "soon" },
  { href: "/bridge",    labelKey: "nav.bridge",     icon: Workflow,        group: "trade" },
  { href: "/orders",    labelKey: "nav.orders",     icon: Activity,        group: "trade", badgeKey: "nav.badgeNew",  badgeTone: "new" },
  { href: "/cex",       labelKey: "nav.cex",        icon: Banknote,        group: "trade", badgeKey: "nav.badgeNew",  badgeTone: "new" },
  { href: "/otc",       labelKey: "nav.otc",        icon: Handshake,       group: "trade", badgeKey: "nav.badgeSoon", badgeTone: "soon" },
  { href: "/p2p",       labelKey: "nav.p2p",        icon: Users,           group: "trade", badgeKey: "nav.badgeSoon", badgeTone: "soon" },
  { href: "/nft",       labelKey: "nav.nft",        icon: Gem,             group: "trade", badgeKey: "nav.badgeSoon", badgeTone: "soon" },
  { href: "/pro",       labelKey: "nav.pro",        icon: BarChart3,       group: "trade", badgeKey: "nav.badgeBeta", badgeTone: "beta" },

  { href: "/pools",     labelKey: "nav.pools",      icon: Layers,          group: "discover" },
  { href: "/explorer",  labelKey: "nav.explorer",   icon: Shield,          group: "discover" },
  { href: "/zion",      labelKey: "nav.zion",       icon: Sparkles,        group: "discover", badgeKey: "nav.badgeAi", badgeTone: "ai" },

  { href: "/launchpad", labelKey: "nav.launchpad",  icon: Rocket,          group: "build" },
  { href: "/governance", labelKey: "nav.governance", icon: Vote,           group: "build" },

  { href: "/portfolio", labelKey: "nav.portfolio",  icon: Wallet,          group: "manage" },
  { href: "/settings",  labelKey: "nav.settings",   icon: Settings,        group: "manage" },
];

export const NAV_GROUP_KEYS: Record<NavGroup, MessageKey> = {
  trade:    "nav.groupTrade",
  discover: "nav.groupDiscover",
  build:    "nav.groupBuild",
  manage:   "nav.groupManage",
};

export const NAV_BADGE_CLASSES: Record<NavBadgeTone, string> = {
  ai:   "text-gold border-gold/30 bg-gold/5",
  new:  "text-cyan border-cyan/30 bg-cyan/5",
  beta: "text-violet border-violet/30 bg-violet/5",
  soon: "text-gold border-gold/40 bg-gold/10",
};
