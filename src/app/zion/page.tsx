import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="ZION AI Terminal"
      subtitle="Conversational liquidity intelligence. Ask anything: a token, a pool, a strategy. ZION reads on-chain data, runs simulations, explains itself."
      phase="Sprint 2 — Claude streaming"
      bullets={[
        "Conversational analysis powered by Claude Sonnet 4.6 streaming",
        "AI reading of contracts, liquidity, and holder behavior",
        "Dynamic slippage suggestion per pool conditions",
        "Reverse swap simulation (what input gets you target output)",
        "Conservative · Advanced · Institutional operating modes",
        "Explainable logs — every recommendation justified, never executed",
        "Continuous learning from on-chain market data",
      ]}
    />
  );
}
