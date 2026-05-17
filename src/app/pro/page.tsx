import ComingSoon from "@/components/layout/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      title="Pro Terminal"
      subtitle="Bloomberg-grade trading interface. Pure black. Monospace. Multi-pane resizable layout. Custom crosshair cursor. Hot-keyed for traders who never leave the screen."
      phase="Sprint 4 — Terminal Mode"
      bullets={[
        "TradingView Lightweight Charts with full indicator suite",
        "Real-time depth chart + order book aggregated across DEXs",
        "Multi-pane resizable workspace (drag · drop · snap)",
        "Keyboard-first trading — B for buy, S for sell, ⌘+↵ to execute",
        "Whale tracker + abnormal liquidity pattern detector",
        "Volume real vs artificial — institutional-grade analytics",
        "Save & share custom workspace layouts",
      ]}
    />
  );
}
