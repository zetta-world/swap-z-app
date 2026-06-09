import AppShell from "@/components/layout/AppShell";
import ProTerminal from "@/components/pro/ProTerminal";
import TierGate from "@/components/auth/TierGate";

export default function Page() {
  return (
    <AppShell>
      {/* Gated behind the "pro" tier. Dormant until TIER_GATES_ENABLED=true —
          until then TierGate renders ProTerminal unconditionally. */}
      <TierGate required="pro">
        <ProTerminal />
      </TierGate>
    </AppShell>
  );
}
