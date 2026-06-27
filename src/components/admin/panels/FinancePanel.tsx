"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Finance = {
  ai:     { cost24h: number; cost7d: number; calls24h: number; calls7d: number; bySource: Record<string, number> };
  volume: { v24h: number; v7d: number; vAll: number; count: number };
  revenue:{ sol: number; usd: number | null; solUsd: number | null; tierCounts: Record<string, number> };
};

const usd  = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function FinancePanel() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"ai" | "volume" | "revenue">("ai");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/finance");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 180_000 : 120_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  return (
    <TerminalPanel id="finance" title="FINANCE" subtitle="AI cost · volume · revenue" icon="$" source="tokens · operations · tiers">
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        {(["ai", "volume", "revenue"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
        <div style={{ flex: 1 }} />
        <a href="/admin/api/ledger/export" className="adm-toggle" style={{ textDecoration: "none" }} title="Download operations CSV">⤓ CSV</a>
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "ai" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Stat label="AI COST 24H" value={usd(data.ai.cost24h)} color="var(--adm-gold)" />
            <Stat label="AI COST 7D" value={usd(data.ai.cost7d)} color="var(--adm-ink)" />
            <Stat label="CALLS 7D" value={String(data.ai.calls7d)} color="var(--adm-cyan)" />
          </div>
          <div className="adm-category">By source (7d cost)</div>
          {Object.keys(data.ai.bySource).length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No ZION calls yet.</div>
          ) : (
            <table className="adm-table">
              <tbody>
                {Object.entries(data.ai.bySource).sort((a, b) => b[1] - a[1]).map(([src, c]) => (
                  <tr key={src}><td style={{ color: "var(--adm-cyan)", fontFamily: "monospace" }}>{src}</td><td style={{ textAlign: "right" }}>{usd(c)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8 }}>Estimate @ Sonnet rates ($3/$15/$0.30 per 1M in/out/cache).</div>
        </div>
      )}

      {data && tab === "volume" && (
        <div style={{ display: "flex", gap: 8 }}>
          <Stat label="VOLUME 24H" value={usd0(data.volume.v24h)} color="var(--adm-green)" />
          <Stat label="VOLUME 7D" value={usd0(data.volume.v7d)} color="var(--adm-ink)" />
          <Stat label="ALL-TIME" value={usd0(data.volume.vAll)} color="var(--adm-cyan)" />
        </div>
      )}

      {data && tab === "revenue" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Stat label="ATTRIBUTED REVENUE" value={`${data.revenue.sol.toLocaleString()} SOL`} color="var(--adm-green)" />
            <Stat label="≈ USD" value={data.revenue.usd != null ? usd0(data.revenue.usd) : "—"} color="var(--adm-ink)" />
          </div>
          <table className="adm-table">
            <thead><tr><th>TIER</th><th>HOLDERS</th></tr></thead>
            <tbody>
              {Object.entries(data.revenue.tierCounts).map(([tier, n]) => (
                <tr key={tier}><td style={{ color: "var(--adm-violet)" }}>{tier}</td><td>{n}</td></tr>
              ))}
            </tbody>
          </table>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8 }}>Attributed = tier holders × pass price (incl. admin grants). Not realized cash.</div>
        </div>
      )}
    </TerminalPanel>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 15, color, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}
