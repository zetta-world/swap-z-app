"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type DexData = {
  total24h:  number;
  change24h: number | null;
  top: { name: string; volume24h: number }[];
  fetchedAt: string;
} | null;

export default function MarketVolumePanel() {
  const [data, setData] = useState<DexData>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        // DefiLlama aggregated DEX volume endpoint — public, no key required
        const res = await fetch("https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyVolume");
        if (!res.ok) throw new Error(`llama ${res.status}`);
        const json = await res.json();
        const total24h  = json.total24h  ?? 0;
        const change24h = json.change_1d ?? null;
        const top = ((json.protocols ?? []) as { name: string; total24h: number }[])
          .sort((a, b) => (b.total24h ?? 0) - (a.total24h ?? 0))
          .slice(0, 5)
          .map((p) => ({ name: p.name, volume24h: p.total24h ?? 0 }));
        if (mounted) setData({ total24h, change24h, top, fetchedAt: new Date().toISOString() });
      } catch (e) {
        if (mounted) setError(String(e));
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  function fmtB(n: number): string {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    return `$${n.toLocaleString()}`;
  }

  return (
    <TerminalPanel
      id="market-volume"
      title="MARKET"
      subtitle="24h DEX volume — market data, not platform"
      icon="⋈"
      source="DefiLlama"
    >
      {!data && !error && (
        <div className="adm-shimmer" style={{ height: 80 }} />
      )}
      {error && (
        <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>
      )}
      {data && (
        <>
          <div className="adm-stat">
            <span className="adm-stat-label">TOTAL DEX 24H</span>
            <span className="adm-stat-value amber">{fmtB(data.total24h)}</span>
            {data.change24h !== null && (
              <span className={`adm-stat-sub ${data.change24h >= 0 ? "" : "red"}`}>
                {data.change24h >= 0 ? "+" : ""}{data.change24h.toFixed(1)}%
              </span>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.2em", marginBottom: 6 }}>
              TOP PROTOCOLS
            </div>
            {data.top.map((p) => (
              <div key={p.name} className="adm-stat" style={{ padding: "4px 0" }}>
                <span className="adm-stat-label">{p.name.toUpperCase()}</span>
                <span className="adm-stat-value" style={{ fontSize: 11 }}>{fmtB(p.volume24h)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </TerminalPanel>
  );
}
