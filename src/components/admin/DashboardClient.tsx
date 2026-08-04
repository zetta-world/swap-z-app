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
import SwapAllowlistPanel     from "./panels/SwapAllowlistPanel";
import PlatformEventsPanel    from "./panels/PlatformEventsPanel";
import BacktestPanel          from "./panels/BacktestPanel";
import TournamentPanel        from "./panels/TournamentPanel";
import RagnarokPanel          from "./panels/RagnarokPanel";
import SwapGuardPanel         from "./panels/SwapGuardPanel";
import AuditBenchPanel        from "./panels/AuditBenchPanel";
import PlaybookBacktestPanel  from "./panels/PlaybookBacktestPanel";
import ArbiterCohortPanel     from "./panels/ArbiterCohortPanel";
import CalibrationPanel       from "./panels/CalibrationPanel";
import WhatWorkedPanel        from "./panels/WhatWorkedPanel";
import FundingPanel           from "./panels/FundingPanel";
import LaunchGatePanel        from "./panels/LaunchGatePanel";
import MarginPanel            from "./panels/MarginPanel";
import AiCostPanel            from "./panels/AiCostPanel";
import PaperPanel             from "./panels/PaperPanel";
import TrafficPanel           from "./panels/TrafficPanel";
import AiControlsPanel        from "./panels/AiControlsPanel";
import AdminAccessPanel       from "./panels/AdminAccessPanel";
import OperationsPanel        from "./panels/OperationsPanel";
import OperationsLedgerPanel  from "./panels/OperationsLedgerPanel";
import LogsSecurityPanel      from "./panels/LogsSecurityPanel";
import SystemHealthPanel      from "./panels/SystemHealthPanel";
import FinancePanel           from "./panels/FinancePanel";
import UsersPanel             from "./panels/UsersPanel";
import CommandPanel           from "./panels/CommandPanel";
import GrowthPanel            from "./panels/GrowthPanel";
import AlertsPanel            from "./panels/AlertsPanel";
import type { ModuleId }      from "@/lib/admin/modules";

const PANELS: Partial<Record<ModuleId, React.ReactNode>> = {
  "command":            <CommandPanel />,
  "alerts":             <AlertsPanel />,
  "growth":             <GrowthPanel />,
  "wallets-kpi":        <WalletsKpiPanel />,
  "tier-dist":          <TierDistPanel />,
  "autopilot-activity": <AutopilotPanel />,
  "live-ops":           <OperationsPanel />,
  "ops-ledger":         <OperationsLedgerPanel />,
  "finance":            <FinancePanel />,
  "users-explorer":     <UsersPanel />,
  "backtest":           <BacktestPanel />,
  "tournament":         <TournamentPanel />,
  "ragnarok":           <RagnarokPanel />,
  "swap-guard":         <SwapGuardPanel />,
  "audit-bench":        <AuditBenchPanel />,
  "playbook-backtest":  <PlaybookBacktestPanel />,
  "arbiter-cohort":     <ArbiterCohortPanel />,
  "calibration":        <CalibrationPanel />,
  "what-worked":        <WhatWorkedPanel />,
  "funding":            <FundingPanel />,
  "launch-gate":        <LaunchGatePanel />,
  "margin":             <MarginPanel />,
  "ai-cost":            <AiCostPanel />,
  "paper":              <PaperPanel />,
  "traffic":            <TrafficPanel />,
  "ai-controls":        <AiControlsPanel />,
  "admin-access":       <AdminAccessPanel />,
  "cex-sessions":       <CexSessionsPanel />,
  "market-volume":      <MarketVolumePanel />,
  "tier-control":       <TierControlPanel />,
  "audit-log":          <AuditLogPanel />,
  "logs-security":      <LogsSecurityPanel />,
  "system-health":      <SystemHealthPanel />,
  "kill-switches":      <KillSwitchesPanel />,
  "whitelist":          <WhitelistPanel />,
  "swap-allowlist":     <SwapAllowlistPanel />,
  "platform-events":    <PlatformEventsPanel />,
};

export default function DashboardClient() {
  return <ModuleGrid panels={PANELS} />;
}
