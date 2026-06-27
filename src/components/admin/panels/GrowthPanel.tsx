"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Growth = {
  active: { dau: number; wau: number; mau: number; stickiness: number | null };
  signups: { new1d: number; new7d: number };
  funnel: { step: string; count: number; conv: number | null }[];
};

export default function GrowthPanel() {
  const [d, setD] = useState<Growth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"funnel" | "active">("funnel");
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/growth");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 180_000 : 120_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  const maxCount = d ? Math.max(1, ...d.funnel.map((f) => f.count)) : 1;

  return (
    <TerminalPanel id="growth" title="GROWTH" subtitle="funnel · active users · signups" icon="↗" source="users + operations + tiers">
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["funnel", "active"] as const).map((t) => (
          <button key={t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 120 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {d && tab === "funnel" && (
        <div>
          {d.funnel.map((f) => (
            <div key={f.step} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, marginBottom: 3 }}>
                <span style={{ color: "var(--adm-ink-2)" }}>{f.step}</span>
                <span style={{ color: "var(--adm-ink-3)" }}>
                  <span style={{ color: "var(--adm-ink)", fontVariantNumeric: "tabular-nums" }}>{f.count}</span>
                  {f.conv != null && f.step !== "signed up" ? `  ·  ${(f.conv * 100).toFixed(1)}%` : ""}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "var(--adm-bg-raise)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(f.count / maxCount) * 100}%`, background: "linear-gradient(90deg, var(--adm-cyan), var(--adm-violet))", transition: "width 0.4s" }} />
              </div>
            </div>
          ))}
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8 }}>Conversion = % of signed-up wallets reaching each step.</div>
        </div>
      )}

      {d && tab === "active" && (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Stat label="DAU" value={d.active.dau} />
            <Stat label="WAU" value={d.active.wau} />
            <Stat label="MAU" value={d.active.mau} />
          </div>
          <div className="adm-stat" style={{ padding: "5px 0" }}>
            <span style={{ fontSize: 9, color: "var(--adm-ink-3)", flex: 1 }}>STICKINESS (DAU/MAU)</span>
            <span style={{ fontSize: 12, color: "var(--adm-cyan)", fontVariantNumeric: "tabular-nums" }}>{d.active.stickiness == null ? "—" : `${(d.active.stickiness * 100).toFixed(0)}%`}</span>
          </div>
          <div className="adm-stat" style={{ padding: "5px 0" }}>
            <span style={{ fontSize: 9, color: "var(--adm-ink-3)", flex: 1 }}>NEW SIGNUPS</span>
            <span style={{ fontSize: 11, color: "var(--adm-green)" }}>+{d.signups.new1d} (24h) · +{d.signups.new7d} (7d)</span>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 18, color: "var(--adm-ink)", fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}
