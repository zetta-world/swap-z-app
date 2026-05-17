import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Limit · DCA · TWAP"
      subtitle="Programmable order strategies that beat Jupiter and Matcha. Set it, walk away, and ZION watches the market for you."
      phase="Sprint 3 — Strategy Engine"
      bullets={[
        "Limit orders with on-chain settlement on ZETTA + EVM chains",
        "Dollar-cost averaging (DCA) — schedule weekly/monthly accumulation",
        "TWAP execution — split a large size across N intervals to minimize impact",
        "Stop-loss and take-profit conditional triggers",
        "ZION-suggested entry/exit zones from continuous market analysis",
        "Reversible swap with time-bounded recall (unique to Z-SWAP)",
      ]}
    />
  );
}
