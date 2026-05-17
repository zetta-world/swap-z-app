import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Risk Scanner"
      subtitle="Every token vetted before you touch it. Honeypot, taxes, LP lock, holder concentration, contract verification — all surfaced in seconds."
      phase="Sprint 2 — GoPlus + Honeypot.is"
      bullets={[
        "Real-time honeypot detection across 11 chains",
        "Buy/sell/transfer tax analysis with worst-case simulation",
        "LP lock verification + unlock schedule on-chain",
        "Holder concentration heatmap — top 10 / 50 / 100 distribution",
        "Contract verification + cross-reference against known malicious patterns",
        "Anomalous liquidity pattern + arbitrage bot detector",
        "ZION confidence score (0–100) with explainable breakdown",
      ]}
    />
  );
}
