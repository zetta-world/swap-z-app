import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Cross-Chain Bridge"
      subtitle="Atomic settlement across 11 chains. Source-to-destination in a single operation, with unified liquidity treated as one surface."
      phase="Sprint 2 — LiFi SDK integration"
      bullets={[
        "Native cross-chain swap routing via LiFi SDK + ZETTA Settlement",
        "Atomic settlement — no partial fills, end-to-end finality",
        "Real-time fee + latency simulation across bridge paths",
        "MEV protection on destination chain",
        "ZION risk analysis on every cross-chain hop",
      ]}
    />
  );
}
