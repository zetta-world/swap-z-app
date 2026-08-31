"use client";

/**
 * O MAPA `id → componente` — a fonte única de "quem desenha cada painel".
 *
 * ⚠️ POR QUE ELE MORA SOZINHO (16/08). Este mapa vivia dentro do
 * `DashboardClient`, que era a única tela que renderizava painel. Com a reforma
 * de áreas passaram a existir três telas (a grade, a área e o painel isolado em
 * tela cheia), e um mapa dentro de uma delas obrigaria as outras a importar a
 * tela inteira só para pegar a tabela.
 *
 * ⚠️ ESTE ARQUIVO É A METADE QUE FALTA DO REGISTRO. `lib/admin/modules.ts` diz
 * que um painel EXISTE; aqui se diz quem o DESENHA. Um id declarado lá e ausente
 * daqui compila, passa no lint, passa nos testes — e a tela fica vazia. É a
 * invariante nº 32, que eu cometi em 15/08 com o painel da taxa da corretora.
 */
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
import CeleiroPanel           from "./panels/CeleiroPanel";
import TournamentPanel        from "./panels/TournamentPanel";
import RagnarokPanel          from "./panels/RagnarokPanel";
import SwapGuardPanel         from "./panels/SwapGuardPanel";
import AuditBenchPanel        from "./panels/AuditBenchPanel";
import PlaybookBacktestPanel  from "./panels/PlaybookBacktestPanel";
import ArbiterCohortPanel     from "./panels/ArbiterCohortPanel";
import CalibrationPanel       from "./panels/CalibrationPanel";
import WhatWorkedPanel        from "./panels/WhatWorkedPanel";
import FundingPanel           from "./panels/FundingPanel";
import RendimentoPanel        from "./panels/RendimentoPanel";
import CombinacaoPanel        from "./panels/CombinacaoPanel";
import TaxaCexPanel           from "./panels/TaxaCexPanel";
import DerrapagemPanel       from "./panels/DerrapagemPanel";
import DescartadasPanel      from "./panels/DescartadasPanel";
import AprendizadoPanel      from "./panels/AprendizadoPanel";
import VarianciaPanel         from "./panels/VarianciaPanel";
import DexCexPanel            from "./panels/DexCexPanel";
import LiberacaoPanel         from "./panels/LiberacaoPanel";
import LiquidezPanel          from "./panels/LiquidezPanel";
import ProPiscinasPanel       from "./panels/ProPiscinasPanel";
import RotacaoGradePanel      from "./panels/RotacaoGradePanel";
import ReceitaPanel           from "./panels/ReceitaPanel";
import LigasPanel             from "./panels/LigasPanel";
import LabPanel               from "./panels/LabPanel";
import MuralPanel             from "./panels/MuralPanel";
import TierHubPanel           from "./panels/TierHubPanel";
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
import UlfhednarPanel         from "./panels/UlfhednarPanel";
import GrowthPanel            from "./panels/GrowthPanel";
import AlertsPanel            from "./panels/AlertsPanel";
import type { ModuleId }      from "@/lib/admin/modules";

export const PANELS: Partial<Record<ModuleId, React.ReactNode>> = {
  "command":            <CommandPanel />,
  "ulfhednar":          <UlfhednarPanel />,
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
  "celeiro":            <CeleiroPanel />,
  "tournament":         <TournamentPanel />,
  "ragnarok":           <RagnarokPanel />,
  "swap-guard":         <SwapGuardPanel />,
  "audit-bench":        <AuditBenchPanel />,
  "playbook-backtest":  <PlaybookBacktestPanel />,
  "arbiter-cohort":     <ArbiterCohortPanel />,
  "calibration":        <CalibrationPanel />,
  "what-worked":        <WhatWorkedPanel />,
  "funding":            <FundingPanel />,
  "rendimento":         <RendimentoPanel />,
  "combinacao":         <CombinacaoPanel />,
  "taxa-cex":           <TaxaCexPanel />,
  "derrapagem":         <DerrapagemPanel />,
  "descartadas":        <DescartadasPanel />,
  "aprendizado":        <AprendizadoPanel />,
  "variancia":          <VarianciaPanel />,
  "dex-cex":            <DexCexPanel />,
  "autopilot-liberacao": <LiberacaoPanel />,
  "liquidez":           <LiquidezPanel />,
  "pro-piscinas":       <ProPiscinasPanel />,
  "rotacao-grade":      <RotacaoGradePanel />,
  "receita-taxa":       <ReceitaPanel />,
  "ligas":              <LigasPanel />,
  "lab":                <LabPanel />,
  "mural-global":       <MuralPanel />,
  "tier-hub":           <TierHubPanel />,
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

