import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Pools & Liquidity"
      subtitle="Concentrated liquidity v3, classic AMM, stable pools — all unified. Provide, manage and earn across the entire Nexus."
      phase="Sprint 3 — Liquidity Engine"
      bullets={[
        "Concentrated liquidity (v3) and traditional AMM in one interface",
        "Deep pool visualization — depth, fee tiers, historical liquidity",
        "Assisted pool creation with templates and economic guardrails",
        "Time-locked + programmable (vesting) LP positions",
        "Partial and scheduled liquidity removal",
        "Multi-provider liquidity composition",
        "Dynamic fee per pool · custom fee per token",
      ]}
    />
  );
}
