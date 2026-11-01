"use client";

import TerminalPanel from "../TerminalPanel";
import { useAdminStats } from "../useAdminStats";
import StatMetrica from "../StatMetrica";

export default function WalletsKpiPanel() {
  const state = useAdminStats();

  return (
    <TerminalPanel
      id="wallets-kpi"
      title="WALLETS"
      subtitle="signups · active · chain split"
      icon="◈"
      source="supabase/users"
      secondsAgo={state.status === "ok" ? state.secondsAgo : undefined}
      refreshing={state.status === "ok" ? state.refreshing : undefined}
      onRefresh={state.status === "ok" || state.status === "error" ? state.refresh : undefined}
    >
      {state.status === "loading" && (
        <>
          <div className="adm-shimmer" style={{ height: 14, width: "60%", marginBottom: 10 }} />
          <div className="adm-shimmer" style={{ height: 14, width: "45%", marginBottom: 10 }} />
          <div className="adm-shimmer" style={{ height: 14, width: "50%" }} />
        </>
      )}
      {state.status === "error" && (
        <div style={{ color: "var(--adm-red)", fontSize: 13 }}>{state.message}</div>
      )}
      {state.status === "ok" && (() => {
        const { total, active7d, active30d, chainSplit } = state.data.wallets;
        const t = total.value, a7 = active7d.value;
        const split = chainSplit.value;
        return (
          <>
            <StatMetrica rotulo="TOTAL SIGNUPS" m={total} formatar={(v) => v.toLocaleString()} />
            <StatMetrica rotulo="ACTIVE 7D" m={active7d} formatar={(v) => v.toLocaleString()} cor="green"
              sub={t != null && a7 != null && t > 0 ? `${Math.round(a7 / t * 100)}%` : "—"} />
            <StatMetrica rotulo="ACTIVE 30D" m={active30d} formatar={(v) => v.toLocaleString()} cor="green" />
            <StatMetrica rotulo="EVM / SOLANA" m={chainSplit} formatar={(v) => (v["evm"] ?? 0).toLocaleString()} cor="cyan"
              sub={split ? `/ ${(split["solana"] ?? 0).toLocaleString()}` : undefined} />
          </>
        );
      })()}
    </TerminalPanel>
  );
}
