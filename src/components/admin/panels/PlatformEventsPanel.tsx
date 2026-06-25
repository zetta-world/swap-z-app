"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type AnalyticsData = {
  counts: {
    "24h": Record<string, number>;
    "7d":  Record<string, number>;
    "30d": Record<string, number>;
  };
  topPages: { path: string; count: number }[];
  recent: {
    event_type:     string;
    wallet_address: string | null;
    path:           string | null;
    created_at:     string;
  }[];
  fetchedAt: string;
};

const EVENT_COLOR: Record<string, string> = {
  page_view:  "var(--adm-cyan)",
  swap_intent: "var(--adm-green)",
  cex_order:  "var(--adm-gold)",
};

function eventColor(type: string): string {
  return EVENT_COLOR[type] ?? "var(--adm-ink-2)";
}

export default function PlatformEventsPanel() {
  const [data,    setData]    = useState<AnalyticsData | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab,     setTab]     = useState<"overview" | "pages" | "feed">("overview");

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res  = await fetch("/admin/api/analytics");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? res.status);
        if (mounted) setData(json);
      } catch (e) {
        if (mounted) setError(String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  const ts = data ? new Date(data.fetchedAt).toLocaleTimeString() : undefined;

  const EVENT_TYPES = ["page_view", "swap_intent", "cex_order"];

  return (
    <TerminalPanel
      id="platform-events"
      title="PLATFORM EVENTS"
      subtitle="page views · swap intents · orders"
      icon="◉"
      source="supabase/platform_events"
    >
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["overview", "pages", "feed"] as const).map((t) => (
          <button
            key={t}
            className={`adm-toggle ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && tab === "overview" && (
        <table className="adm-table">
          <thead>
            <tr>
              <th>EVENT</th>
              <th>24H</th>
              <th>7D</th>
              <th>30D</th>
            </tr>
          </thead>
          <tbody>
            {EVENT_TYPES.map((et) => (
              <tr key={et}>
                <td style={{ color: eventColor(et) }}>{et}</td>
                <td>{data.counts["24h"][et] ?? 0}</td>
                <td>{data.counts["7d"][et]  ?? 0}</td>
                <td>{data.counts["30d"][et] ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data && tab === "pages" && (
        <div>
          {data.topPages.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No page views recorded yet.</div>
          ) : (
            data.topPages.map(({ path, count }) => (
              <div key={path} className="adm-stat" style={{ padding: "5px 0" }}>
                <span style={{ fontSize: 9, color: "var(--adm-cyan)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {path}
                </span>
                <span style={{ fontSize: 11, color: "var(--adm-ink)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {count}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {data && tab === "feed" && (
        <div className="adm-scroll" style={{ maxHeight: 260 }}>
          {data.recent.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No events yet.</div>
          ) : (
            data.recent.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9 }}>
                <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>
                  {new Date(r.created_at).toLocaleTimeString()}
                </span>
                <span style={{ color: eventColor(r.event_type), flexShrink: 0 }}>
                  {r.event_type}
                </span>
                <span style={{ color: "var(--adm-ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                  {r.path ?? (r.wallet_address ? `${r.wallet_address.slice(0, 6)}…` : "—")}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </TerminalPanel>
  );
}
