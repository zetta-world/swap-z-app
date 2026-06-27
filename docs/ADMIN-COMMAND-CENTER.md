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
| ① | **COMMAND** | CEO/President | overview of everything (users, revenue, volume, AUM, ZION win-rate, system light, alerts) — 🔴 |
| ② | **GROWTH** | Marketing | funnel (visit→connect→signin→trade→autopilot→paid), conversion, retention cohorts, DAU/WAU/MAU, channels — 🔴 |
| ③ | **FINANCE** | CFO/Accountant | tier/NFT revenue, MRR, AI+infra cost, margin, volume & fees, CSV export — 🔴 |
| ④ | **TRADING & ZION** | Analyst | OPERATIONS 🟢, LIVE OPS 🟢, BACKTEST 🟢, ZION analyses 🟢, MARKET 🟢 |
| ⑤ | **SECURITY & COMPLIANCE** | CISO/Legal | LOGS & SECURITY 🟢, AUDIT 🟢, KILL SWITCHES 🟢; +threat score, geoblock/ToS, retention 🔴 |
| ⑥ | **SYSTEM HEALTH** | CTO/DevOps | dependency status, cron freshness, error rate, latency, API quotas — 🟡 (Phase 1) |
| ⑦ | **USERS** | Support/Ops | list + per-wallet drill-down (tier, sessions, ops, P&L, events) — 🔴 |
| ⑧ | **ALERTS** | cross-cutting | proactive notifications (Telegram/email) + history — 🔴 (Phase 2) |

## Phases

1. **SYSTEM HEALTH + cron heartbeats** — catch silent breakage instantly. (in progress)
2. **ALERTS (Telegram)** — be paged on: high-sev security, stale cron, frozen autopilot, error spike. Needs a bot token + chat id.
3. **FINANCE** — revenue + AI/infra cost monitor + CSV export for accounting.
4. **GROWTH** (funnel/retention) + **USERS** (per-wallet drill-down).
5. **COMMAND** overview screen + advanced SECURITY/compliance.

## Categories to add to the module registry
`command` · `growth` · `finance` · `security` · `system` · `users`
(current: `dashboard` · `controls` · `logs`)
