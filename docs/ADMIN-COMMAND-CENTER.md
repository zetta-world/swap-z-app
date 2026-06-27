# Z-SWAP Command Center — Admin Roadmap

> A professional, enterprise-grade admin organized by business FUNCTION (not a
> trader dashboard). The operator wears every hat — CEO, CTO, CFO, CISO,
> marketing, legal, support — so the admin is a multi-department command center.
>
> Architecture: the existing modular panel grid (`lib/admin/modules.ts` +
> category filter) is EXTENDED with new categories + panels — no rewrite.

## Workspaces (by role)

| # | Workspace | Role | Status |
|---|-----------|------|--------|
| ① | **COMMAND** | CEO/President | 🟢 consolidated KPI board (users, volume, P&L, autopilot, win-rate, AI cost) + alert strip |
| ② | **GROWTH** | Marketing | 🟢 value-ladder funnel + DAU/WAU/MAU + stickiness + signups |
| ③ | **FINANCE** | CFO/Accountant | 🟢 AI cost (all Claude calls), volume, attributed revenue, CSV export |
| ④ | **TRADING & ZION** | Analyst | 🟢 OPERATIONS, LIVE OPS, BACKTEST, ZION analyses, MARKET |
| ⑤ | **SECURITY & COMPLIANCE** | CISO/Legal | 🟢 LOGS & SECURITY, AUDIT, KILL SWITCHES; +threat score, geoblock/ToS, retention 🔴 |
| ⑥ | **SYSTEM HEALTH** | CTO/DevOps | 🟢 cron heartbeats + dependency pings + status light |
| ⑦ | **USERS** | Support/Ops | 🟢 leaderboard + per-wallet drill-down (tier, sessions, ops, P&L, events) |
| ⑧ | **ALERTS** | cross-cutting | 🟢 Telegram engine + ALERTS panel (test button, history); fires on high-sev security + autopilot freeze. Activates on TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env. |

## Phases

1. **SYSTEM HEALTH + cron heartbeats** — catch silent breakage instantly. (in progress)
2. **ALERTS (Telegram)** — be paged on: high-sev security, stale cron, frozen autopilot, error spike. Needs a bot token + chat id.
3. **FINANCE** — revenue + AI/infra cost monitor + CSV export for accounting.
4. **GROWTH** (funnel/retention) + **USERS** (per-wallet drill-down).
5. **COMMAND** overview screen + advanced SECURITY/compliance.

## Categories to add to the module registry
`command` · `growth` · `finance` · `security` · `system` · `users`
(current: `dashboard` · `controls` · `logs`)
