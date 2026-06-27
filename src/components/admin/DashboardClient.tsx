"use client";

import ModuleGrid from "./ModuleGrid";
import WalletsKpiPanel    from "./panels/WalletsKpiPanel";
import TierDistPanel      from "./panels/TierDistPanel";
import AutopilotPanel     from "./panels/AutopilotPanel";
import CexSessionsPanel   from "./panels/CexSessionsPanel";
import MarketVolumePanel  from "./panels/MarketVolumePanel";
import TierControlPanel   from "./panels/TierControlPanel";
import AuditLogPanel      from "./panels/AuditLogPanel";
import KillSwitchesPanel  from "./panels/KillSwitchesPanel";
import WhitelistPanel         from "./panels/WhitelistPanel";
import PlatformEventsPanel    from "./panels/PlatformEventsPanel";
import BacktestPanel          from "./panels/BacktestPanel";
import OperationsPanel        from "./panels/OperationsPanel";
import OperationsLedgerPanel  from "./panels/OperationsLedgerPanel";
import LogsSecurityPanel      from "./panels/LogsSecurityPanel";
import SystemHealthPanel      from "./panels/SystemHealthPanel";
import FinancePanel           from "./panels/FinancePanel";
import UsersPanel             from "./panels/UsersPanel";
import type { ModuleId }      from "@/lib/admin/modules";

const PANELS: Partial<Record<ModuleId, React.ReactNode>> = {
  "wallets-kpi":        <WalletsKpiPanel />,
  "tier-dist":          <TierDistPanel />,
  "autopilot-activity": <AutopilotPanel />,
  "live-ops":           <OperationsPanel />,
  "ops-ledger":         <OperationsLedgerPanel />,
  "finance":            <FinancePanel />,
  "users-explorer":     <UsersPanel />,
  "backtest":           <BacktestPanel />,
  "cex-sessions":       <CexSessionsPanel />,
  "market-volume":      <MarketVolumePanel />,
  "tier-control":       <TierControlPanel />,
  "audit-log":          <AuditLogPanel />,
  "logs-security":      <LogsSecurityPanel />,
  "system-health":      <SystemHealthPanel />,
  "kill-switches":      <KillSwitchesPanel />,
  "whitelist":          <WhitelistPanel />,
  "platform-events":    <PlatformEventsPanel />,
};

export default function DashboardClient() {
  return <ModuleGrid panels={PANELS} />;
}
