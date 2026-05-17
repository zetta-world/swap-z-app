import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Z-PAD Launchpad"
      subtitle="Deploy a token. Lock liquidity. Fair launch. Audited templates and anti-bot guardrails — integrated end-to-end with Z-SWAP."
      phase="Sprint 4 — Token Factory"
      bullets={[
        "Audited token templates (standard · taxed · rebase · vesting)",
        "Configurable buy/sell/transfer fees with on-chain enforcement",
        "Native LP lock + intelligent vesting schedules",
        "Fair / private / public / protected launch modes",
        "Anti-bot launch controls (max wallet · cooldown · gas guard)",
        "Verified contract generator with one-click deploy",
        "Project rating + Z-PAD project registry",
      ]}
    />
  );
}
