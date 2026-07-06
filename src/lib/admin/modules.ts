import type { ComponentType } from "react";

export type ModuleId =
  | "command"
  | "alerts"
  | "growth"
  | "wallets-kpi"
  | "tier-dist"
  | "autopilot-activity"
  | "live-ops"
  | "ops-ledger"
  | "finance"
  | "backtest"
  | "tournament"
  | "traffic"
  | "ai-controls"
  | "cex-sessions"
  | "market-volume"
  | "audit-log"
  | "logs-security"
  | "system-health"
  | "users-explorer"
  | "tier-control"
  | "whitelist"
  | "kill-switches"
  | "platform-events";

export type ModuleCategory = "command" | "dashboard" | "growth" | "finance" | "users" | "controls" | "logs" | "system";

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
    id: "command",
    title: "COMMAND",
    subtitle: "the whole company at a glance",
    icon: "◆",
    category: "command",
    defaultEnabled: true,
    defaultOrder: -2,
  },
  {
    id: "alerts",
    title: "ALERTS",
    subtitle: "Telegram · proactive notifications",
    icon: "🔔",
    category: "command",
    defaultEnabled: true,
    defaultOrder: -1,
  },
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
    id: "tournament",
    title: "TOURNAMENT",
    subtitle: "agents & models ranked by net expectancy",
    icon: "♛",
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
    id: "ai-controls",
    title: "AI CONTROLS",
    subtitle: "liga/desliga agentes · torneio · backtest",
    icon: "⏻",
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
  {
    id: "finance",
    title: "FINANCE",
    subtitle: "AI cost · volume · revenue · CSV",
    icon: "$",
    category: "finance",
    defaultEnabled: true,
    defaultOrder: 12,
  },
  {
    id: "users-explorer",
    title: "USERS",
    subtitle: "leaderboard · per-wallet drill-down",
    icon: "◭",
    category: "users",
    defaultEnabled: true,
    defaultOrder: 13,
  },
  {
    id: "traffic",
    title: "MIDGARD",
    subtitle: "acessos no mapa · dia/semana/mês · origem",
    icon: "🌍",
    category: "growth",
    defaultEnabled: true,
    defaultOrder: 14,
  },
  {
    id: "growth",
    title: "GROWTH",
    subtitle: "funnel · active users · signups",
    icon: "↗",
    category: "growth",
    defaultEnabled: true,
    defaultOrder: 14,
  },
];

export const MODULE_BY_ID = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>;
