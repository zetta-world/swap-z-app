"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Finance = {
  ai: {
    today: number; week: number; month: number; year: number; all: number;
    calls: { today: number; week: number; month: number; year: number; all: number };
    byModel: Record<string, number>;
    bySource: Record<string, number>;
    models: Array<{ model: string; today: number; week: number; month: number; all: number; calls: number }>;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
    daily: Array<{ date: string; cost: number }>;
    monthProjection: number;
  };
  volume: { v24h: number; v7d: number; vAll: number; count: number };
  revenue:{ sol: number; usd: number | null; solUsd: number | null; tierCounts: Record<string, number> };
};

const usd  = (n: number) => `$${n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(2)}`;
const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usd4 = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const compactModel = (m: string) => m.replace(/^claude-/, "").replace(/-\d{8}$/, "");

export default function FinancePanel() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"revenue" | "volume">("revenue");
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
    <TerminalPanel id="finance" title="RECEITA" subtitle="passes vendidos · volume transacionado" icon="💰" source="tiers · operations">
      <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
        {(["revenue", "volume"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
        <div style={{ flex: 1 }} />
        <a href="/admin/api/ledger/export" className="adm-toggle" style={{ textDecoration: "none" }} title="Download operations CSV">⤓ CSV</a>
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {/* CUSTO DE IA saiu daqui (30/07) para o painel próprio, na aba CUSTOS.
          Ele vivia como um terço deste card — mas é o que matou o assento
          Anthropic, é o que os kill-switches controlam e é o que o watchdog
          vigia. Merece ficar ao lado dos disjuntores, não dentro do financeiro. */}
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

function DailyBars({ daily }: { daily: Array<{ date: string; cost: number }> }) {
  const max = Math.max(...daily.map((d) => d.cost), 0.0001);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 48, marginTop: 4 }}>
      {daily.map((d) => {
        const h = Math.max(2, Math.round((d.cost / max) * 44));
        const isToday = d.date === daily[daily.length - 1].date;
        return (
          <div key={d.date} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
               title={`${d.date}: $${d.cost.toFixed(4)}`}>
            <div style={{ height: h, background: isToday ? "var(--adm-gold)" : "var(--adm-cyan)", opacity: d.cost > 0 ? 0.85 : 0.25, borderRadius: 2 }} />
          </div>
        );
      })}
    </div>
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
