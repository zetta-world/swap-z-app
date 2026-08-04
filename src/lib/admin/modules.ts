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
  | "playbook-backtest"
  | "arbiter-cohort"
  | "calibration"
  | "what-worked"
  | "funding"
  | "ligas"
  | "tournament"
  | "ragnarok"
  | "swap-guard"
  | "audit-bench"
  | "launch-gate"
  | "margin"
  | "ai-cost"
  | "paper"
  | "traffic"
  | "ai-controls"
  | "admin-access"
  | "cex-sessions"
  | "market-volume"
  | "audit-log"
  | "logs-security"
  | "system-health"
  | "users-explorer"
  | "tier-control"
  | "whitelist"
  | "swap-allowlist"
  | "kill-switches"
  | "platform-events";

/**
 * Categorias do painel.
 *
 * A separação entre `dashboard`, `lab` e `bench` NÃO é organização cosmética —
 * é higiene de dado. Antes, patrimônio simulado de agente ficava lado a lado
 * com volume real de usuário na mesma aba, e num relance de olho os dois viram
 * "os números da plataforma". Misturar experimento com produção é como uma
 * planilha de projeção colada na de faturamento: alguém, algum dia, soma as
 * duas.
 *
 *   dashboard — DINHEIRO E USUÁRIO REAIS. Nada simulado entra aqui.
 *   lab       — experimento: flywheel, mesas paper, torneio, backtest, barra
 *               de lançamento. Tudo aqui é USDT de mentira.
 *   bench     — verificação da própria plataforma: auditoria, sondas de
 *               ataque, guard de assinatura, saúde de dependência.
 */
export type ModuleCategory =
  | "command"     // e aí?
  | "receita"     // estamos ganhando?
  | "custos"      // estamos gastando quanto?
  | "margem"      // estamos lucrando?
  | "operacao"    // o que roda AGORA com dinheiro real
  | "crescimento" // estamos crescendo?
  | "mercado"     // como está o mercado LÁ FORA (dado de terceiro)
  | "lab"         // o experimento funciona? (tudo simulado)
  | "bench"       // a plataforma está sã?
  | "controls"    // o que eu ligo/desligo
  | "logs";       // o que aconteceu

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
    category: "crescimento",
    defaultEnabled: true,
    defaultOrder: 0,
  },
  {
    id: "tier-dist",
    title: "TIER MATRIX",
    subtitle: "distribution across free / pro / trader / pilot",
    icon: "⊕",
    category: "receita",
    defaultEnabled: true,
    defaultOrder: 1,
  },
  {
    id: "autopilot-activity",
    title: "AUTOPILOT",
    subtitle: "sessions · runs · pnl today",
    icon: "⊛",
    category: "operacao",
    defaultEnabled: true,
    defaultOrder: 2,
  },
  {
    id: "live-ops",
    title: "LIVE OPS",
    subtitle: "open positions · autopilot run feed",
    icon: "⊠",
    category: "operacao",
    defaultEnabled: true,
    defaultOrder: 3,
  },
  {
    id: "ops-ledger",
    title: "OPERATIONS",
    subtitle: "every client trade · volume · realized P&L",
    icon: "≣",
    category: "receita",
    defaultEnabled: true,
    defaultOrder: 4,
  },
  {
    id: "playbook-backtest",
    title: "QUAL ESTRATÉGIA PAGA",
    subtitle: "cada playbook medido isolado no histórico",
    icon: "⚖",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 4,
  },
  {
    id: "arbiter-cohort",
    title: "COORTE DO ARBITER",
    subtitle: "1× · 3× · 5× — a alavanca como única variável",
    icon: "ᚼ",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "calibration",
    title: "CALIBRAGEM",
    subtitle: "a mesma janela com travas diferentes — qual cautela custa caro",
    icon: "🎚",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 6,
  },
  {
    id: "what-worked",
    title: "O QUE TERIA DADO LUCRO",
    subtitle: "estratégias canônicas na mesma janela — inclusive as que vendem",
    icon: "🧭",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 7,
  },
  {
    id: "funding",
    title: "FUNDING / BASIS",
    subtitle: "renda neutra spot+perp — a arbitragem que não depende de velocidade",
    icon: "🪙",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 8,
  },
  {
    id: "ligas",
    title: "AS TRÊS LIGAS",
    subtitle: "pedágio, futuros e postar o spread — onde a conta pode fechar",
    icon: "🏟",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 9,
  },
  {
    id: "backtest",
    title: "BACKTEST",
    subtitle: "ZION win-rate · expectancy · suggestions",
    icon: "◇",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "tournament",
    title: "TOURNAMENT",
    subtitle: "agents & models ranked by net expectancy",
    icon: "♛",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "ragnarok",
    title: "RAGNARÖK",
    subtitle: "acumulação de USDT · mecânico vs IA · qual estratégia paga",
    icon: "ᚱ",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "swap-guard",
    title: "SOLANA GUARD",
    subtitle: "verificação de assinatura · Jupiter",
    icon: "⛨",
    category: "bench",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "audit-bench",
    title: "BANCADA DE AUDITORIA",
    subtitle: "o que só o sistema vivo responde",
    icon: "⚖",
    category: "bench",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "ai-cost",
    title: "CUSTO DE IA",
    subtitle: "gasto por modelo · projeção do mês",
    icon: "💸",
    category: "custos",
    defaultEnabled: true,
    defaultOrder: 1,
  },
  {
    id: "margin",
    title: "MARGEM",
    subtitle: "receita − custos · a conta que decide se a empresa vive",
    icon: "📊",
    category: "margem",
    defaultEnabled: true,
    defaultOrder: 1,
  },
  {
    id: "launch-gate",
    title: "BARRA DE LANÇAMENTO",
    subtitle: "critério pré-registrado · 5 de 5 ou não vai",
    icon: "🚦",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 4,
  },
  {
    id: "paper",
    title: "PAPER · GATE.IO",
    subtitle: "simulação autônoma · patrimônio por agente",
    icon: "📈",
    category: "lab",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "cex-sessions",
    title: "CEX SESSIONS",
    subtitle: "active autopilot per exchange",
    icon: "⊞",
    category: "operacao",
    defaultEnabled: true,
    defaultOrder: 5,
  },
  {
    id: "market-volume",
    title: "MARKET",
    subtitle: "24h DEX volume · trending pairs",
    icon: "⋈",
    category: "mercado",
    defaultEnabled: true,
    defaultOrder: 4,
  },
  {
    id: "platform-events",
    title: "PLATFORM EVENTS",
    subtitle: "page views · swap intents · errors",
    icon: "◉",
    category: "logs",
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
    id: "swap-allowlist",
    title: "SWAP ALLOWLIST",
    subtitle: "observe router/spender · anti-drain",
    icon: "⛨",
    category: "bench",
    defaultEnabled: true,
    defaultOrder: 8,
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
    id: "admin-access",
    title: "ADMIN ACCESS",
    subtitle: "conceder · revogar acesso ao painel",
    icon: "🛡",
    category: "controls",
    defaultEnabled: true,
    defaultOrder: 6,
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
    category: "bench",
    defaultEnabled: true,
    defaultOrder: 11,
  },
  {
    id: "finance",
    title: "FINANCE",
    subtitle: "AI cost · volume · revenue · CSV",
    icon: "$",
    category: "receita",
    defaultEnabled: true,
    defaultOrder: 12,
  },
  {
    id: "users-explorer",
    title: "USERS",
    subtitle: "leaderboard · per-wallet drill-down",
    icon: "◭",
    category: "crescimento",
    defaultEnabled: true,
    defaultOrder: 13,
  },
  {
    id: "traffic",
    title: "MIDGARD",
    subtitle: "acessos no mapa · dia/semana/mês · origem",
    icon: "🌍",
    category: "crescimento",
    defaultEnabled: true,
    defaultOrder: 14,
  },
  {
    id: "growth",
    title: "GROWTH",
    subtitle: "funnel · active users · signups",
    icon: "↗",
    category: "crescimento",
    defaultEnabled: true,
    defaultOrder: 14,
  },
];

export const MODULE_BY_ID = Object.fromEntries(
  MODULE_REGISTRY.map((m) => [m.id, m]),
) as Record<ModuleId, ModuleDef>;
