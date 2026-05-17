import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Governance"
      subtitle="On-chain governance with hybrid (on/off-chain) DAO. Stake-weighted voting, reputation, and delegated authority — built for long-term protocol stewardship."
      phase="Sprint 4 — DAO Module"
      bullets={[
        "On-chain proposals with execution validation",
        "Stake-weighted voting with delegated authority",
        "Reputation-based governance layer",
        "Hybrid on/off-chain DAO operations",
        "Programmable penalty mechanisms",
        "Treasury governed by DAO with on-chain audit trail",
      ]}
    />
  );
}
