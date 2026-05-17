import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Portfolio"
      subtitle="One view across 11 chains. Balances, positions, history, P&L — and a ZION-curated risk report on everything you hold."
      phase="Sprint 3 — Aggregator"
      bullets={[
        "Multi-chain balance aggregation (wagmi v2 + Solana wallet adapter)",
        "LP positions, staking, and pending rewards in one place",
        "Realized + unrealized P&L with cost basis tracking",
        "Full transaction history with ZION-explained categorization",
        "Per-token risk report on every asset held",
        "Export to CSV / PDF for accounting and compliance",
      ]}
    />
  );
}
