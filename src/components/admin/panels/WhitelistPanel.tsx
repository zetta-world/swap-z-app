"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

export default function WhitelistPanel() {
  const [envWallets, setEnvWallets] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Fetch the list of admin wallets from the stats endpoint
    // The allowlist is ENV-only so it's not manageable via UI — we show it read-only
    fetch("/admin/api/whitelist")
      .then((r) => r.json())
      .then((j) => { setEnvWallets(j.wallets ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <TerminalPanel
      id="whitelist"
      title="WHITELIST"
      subtitle="ADMIN_WALLETS env — read-only"
      icon="⊘"
      source="env/ADMIN_WALLETS"
    >
      <div style={{ color: "var(--adm-amber)", fontSize: 9, marginBottom: 12, letterSpacing: "0.1em" }}>
        ⚠ The admin allowlist is managed via the ADMIN_WALLETS environment variable.
        Changes require a redeploy. Wallets with tier_cache.source=&apos;admin&apos; bypass this list.
      </div>
      {!loaded && <div className="adm-shimmer" style={{ height: 40 }} />}
      {loaded && envWallets.length === 0 && (
        <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>
          No ADMIN_WALLETS env var set — tier_cache.source=&apos;admin&apos; is the only gate.
        </div>
      )}
      {loaded && envWallets.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {envWallets.map((w, i) => (
            <div key={i} style={{
              fontSize: 9,
              color: "var(--adm-cyan)",
              fontFamily: "monospace",
              padding: "4px 8px",
              background: "rgba(0 229 255 / 0.04)",
              border: "1px solid rgba(0 229 255 / 0.12)",
              borderRadius: 2,
            }}>
              {w}
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
