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
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Stat label="TODAY"  value={usd4(data.ai.today)} color="var(--adm-gold)" />
            <Stat label="7 DAYS" value={usd4(data.ai.week)}  color="var(--adm-ink)" />
            <Stat label="MONTH"  value={usd4(data.ai.month)} color="var(--adm-ink)" />
            <Stat label="YEAR"   value={usd(data.ai.year)}   color="var(--adm-cyan)" />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <Stat label="ALL-TIME"      value={usd(data.ai.all)}             color="var(--adm-violet)" />
            <Stat label="MONTH PROJ."   value={usd4(data.ai.monthProjection)} color="var(--adm-gold)" />
            <Stat label="CALLS (MONTH)" value={String(data.ai.calls.month)}   color="var(--adm-cyan)" />
          </div>

          <div className="adm-category">Daily spend · last 14 days</div>
          <DailyBars daily={data.ai.daily} />

          <div className="adm-category" style={{ marginTop: 12 }}>Spend per model · ≈ estimativa (tokens × tarifa pública)</div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 6, lineHeight: 1.4 }}>
            NÃO é cobrança real — é tokens medidos × tarifa pública do modelo. Um modelo com
            crédito de trial aparece aqui com "gasto" mesmo sem sair dinheiro da conta.
          </div>
          {data.ai.models.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No ZION calls yet.</div>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>MODEL</th>
                  <th style={{ textAlign: "right" }}>TODAY</th>
                  <th style={{ textAlign: "right" }}>7D</th>
                  <th style={{ textAlign: "right" }}>MONTH</th>
                  <th style={{ textAlign: "right" }}>ALL</th>
                  <th style={{ textAlign: "right" }}>CALLS</th>
                </tr>
              </thead>
              <tbody>
                {data.ai.models.map((m) => (
                  <tr key={m.model}>
                    <td style={{ color: "var(--adm-violet)", fontFamily: "monospace" }}>{compactModel(m.model)}</td>
                    <td style={{ textAlign: "right", color: m.today > 0 ? "var(--adm-gold)" : "var(--adm-ink-3)" }}>{usd4(m.today)}</td>
                    <td style={{ textAlign: "right" }}>{usd4(m.week)}</td>
                    <td style={{ textAlign: "right" }}>{usd4(m.month)}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-ink)" }}>{usd4(m.all)}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-ink-3)" }}>{m.calls}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="adm-category" style={{ marginTop: 10 }}>By source (all-time)</div>
          <table className="adm-table">
            <tbody>
              {Object.entries(data.ai.bySource).sort((a, b) => b[1] - a[1]).map(([src, c]) => (
                <tr key={src}><td style={{ color: "var(--adm-cyan)", fontFamily: "monospace" }}>{src}</td><td style={{ textAlign: "right" }}>{usd4(c)}</td></tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 8 }}>
            Model-aware estimate incl. cache-write (Opus/Sonnet/Haiku rates). Tokens all-time:
            {" "}{Math.round(data.ai.tokens.input / 1000)}k in · {Math.round(data.ai.tokens.output / 1000)}k out ·
            {" "}{Math.round(data.ai.tokens.cacheRead / 1000)}k cache-read · {Math.round(data.ai.tokens.cacheWrite / 1000)}k cache-write.
          </div>
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
