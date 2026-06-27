import type { ComponentType } from "react";

export type ModuleId =
  | "wallets-kpi"
  | "tier-dist"
  | "autopilot-activity"
  | "live-ops"
  | "ops-ledger"
  | "backtest"
  | "cex-sessions"
  | "market-volume"
  | "audit-log"
  | "logs-security"
  | "system-health"
  | "tier-control"
  | "whitelist"
  | "kill-switches"
  | "platform-events";

export type ModuleCategory = "dashboard" | "controls" | "logs" | "system";

export type ModuleDef = {
  id:             ModuleId;
  title:          string;
  subtitle:       string;
  icon:           string;        // single character / rune / ASCII symbol
  category:       ModuleCategory;
  defaultEnabled: boolean;
  defaultOrder:   number;
  minH?:          number;        // minimum grid row-span hint
};

export const MODULE_REGISTRY: ModuleDef[] = [
  {
    id: "wallets-kpi",
    title: "WALLETS",
    subtitle: "signups · active · chain split",
    icon: "◈",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 0,
  },
  {
    id: "tier-dist",
    title: "TIER MATRIX",
    subtitle: "distribution across free / pro / trader / pilot",
    icon: "⊕",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 1,
  },
  {
    id: "autopilot-activity",
    title: "AUTOPILOT",
    subtitle: "sessions · runs · pnl today",
    icon: "⊛",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 2,
  },
  {
    id: "live-ops",
    title: "LIVE OPS",
    subtitle: "open positions · autopilot run feed",
    icon: "⊠",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 3,
  },
  {
    id: "ops-ledger",
    title: "OPERATIONS",
    subtitle: "every client trade · volume · realized P&L",
    icon: "≣",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 4,
  },
  {
    id: "backtest",
    title: "BACKTEST",
    subtitle: "ZION win-rate · expectancy · suggestions",
    icon: "◇",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "cex-sessions",
    title: "CEX SESSIONS",
    subtitle: "active autopilot per exchange",
    icon: "⊞",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "market-volume",
    title: "MARKET",
    subtitle: "24h DEX volume · trending pairs",
    icon: "⋈",
    category: "dashboard",
    defaultEnabled: true,
    defaultOrder: 4,
  },
  {
    id: "platform-events",
    title: "PLATFORM EVENTS",
    subtitle: "page views · swap intents · errors",
    icon: "◉",
    category: "dashboard",
    defaultEnabled: false,
    defaultOrder: 5,
  },
  {
    id: "tier-control",
    title: "TIER CONTROL",
    subtitle: "grant · revoke · inspect",
    icon: "⊗",
    category: "controls",
    defaultEnabled: true,
    defaultOrder: 6,
  },
  {
    id: "whitelist",
    title: "WHITELIST",
    subtitle: "allowlist management",
    icon: "⊘",
    category: "controls",
    defaultEnabled: true,
    defaultOrder: 7,
  },
  {
    id: "kill-switches",
    title: "KILL SWITCHES",
    subtitle: "swap · cex · maintenance",
    icon: "⊝",
    category: "controls",
    defaultEnabled: true,
    defaultOrder: 8,
  },
  {
    id: "audit-log",
    title: "AUDIT LOG",
    subtitle: "all privileged actions",
    icon: "◎",
    category: "logs",
    defaultEnabled: true,
    defaultOrder: 9,
  },
  {
    id: "logs-security",
    title: "LOGS & SECURITY",
    subtitle: "errors · abuse · intrusion attempts",
    icon: "⚠",
    category: "logs",
    defaultEnabled: true,
    defaultOrder: 10,
  },
  {
    id: "system-health",
    title: "SYSTEM HEALTH",
    subtitle: "crons · dependencies · uptime",
    icon: "♥",
    category: "system",
    defaultEnabled: true,
    defaultOrder: 11,
  },
];

export const MODULE_BY_ID = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>;
