import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Settings"
      subtitle="Personalize your Nexus. Slippage defaults, RPC endpoints, MEV behavior, privacy posture, and ZION operating mode."
      phase="Sprint 2 — Preferences"
      bullets={[
        "Per-chain default slippage and gas strategy",
        "Custom RPC endpoints (override defaults)",
        "MEV protection behavior — standard / aggressive / off",
        "Privacy mode — encrypted logs, randomized execution delay",
        "ZION operating mode — conservative / advanced / institutional",
        "Notifications: price alerts, liquidity alerts, governance alerts",
        "Theme: standard · pro · privacy (sync with main mode switcher)",
      ]}
    />
  );
}
