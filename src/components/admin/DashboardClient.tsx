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
import WhitelistPanel     from "./panels/WhitelistPanel";
import type { ModuleId }  from "@/lib/admin/modules";

const PANELS: Partial<Record<ModuleId, React.ReactNode>> = {
  "wallets-kpi":        <WalletsKpiPanel />,
  "tier-dist":          <TierDistPanel />,
  "autopilot-activity": <AutopilotPanel />,
  "cex-sessions":       <CexSessionsPanel />,
  "market-volume":      <MarketVolumePanel />,
  "tier-control":       <TierControlPanel />,
  "audit-log":          <AuditLogPanel />,
  "kill-switches":      <KillSwitchesPanel />,
  "whitelist":          <WhitelistPanel />,
};

export default function DashboardClient() {
  return <ModuleGrid panels={PANELS} />;
}
