"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type WalletRow = { wallet: string; ops: number; volume: number; pnl: number; lastSeen: string; tier: string };
type Detail = {
  wallet: string; tier: string; tierSource: string | null;
  sessions: { exchange_id: string; risk_mode: string; market_type: string; is_active: boolean; trades_today: number; pnl_today: number; frozen_until_day: string | null }[];
  operations: { kind: string; pair: string | null; side: string | null; volume_usd: number | null; pnl_usd: number | null; status: string; created_at: string }[];
  events: { event_type: string; created_at: string }[];
  totals: { ops: number; volume: number; pnl: number };
};

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");

export default function UsersPanel() {
  const [list, setList] = useState<WalletRow[] | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/users");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setList(json.wallets); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  const openWallet = useCallback(async (wallet: string) => {
    if (!wallet) return;
    setError(null);
    try {
      const res = await fetch(`/admin/api/users?wallet=${encodeURIComponent(wallet)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setDetail(json);
    } catch (e) { setError(String(e)); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  return (
    <TerminalPanel id="users-explorer" title="USERS" subtitle="leaderboard · per-wallet drill-down" icon="◭" source="operations + sessions + tier">
      {/* Search */}
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input
          className="adm-input"
          placeholder="paste a wallet…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) openWallet(query.trim()); }}
          style={{ flex: 1, fontSize: 10, fontFamily: "monospace", background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px", color: "var(--adm-ink)" }}
        />
        <button className="adm-toggle" onClick={() => query.trim() && openWallet(query.trim())}>GO</button>
        {detail && <button className="adm-toggle" onClick={() => setDetail(null)}>← LIST</button>}
      </div>

      {error && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}
      {loading && !list && <div className="adm-shimmer" style={{ height: 100 }} />}

      {/* Detail view */}
      {detail ? (
        <div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--adm-cyan)" }}>{short(detail.wallet)}</span>
            <span style={{ fontSize: 9, color: "var(--adm-violet)" }}>{detail.tier}{detail.tierSource ? ` (${detail.tierSource})` : ""}</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 9, color: "var(--adm-ink-3)" }}>{detail.totals.ops} ops · {usd(detail.totals.volume)} vol · </span>
            <span style={{ fontSize: 9, color: pnlColor(detail.totals.pnl) }}>{detail.totals.pnl >= 0 ? "+" : ""}{usd(detail.totals.pnl)} P&L</span>
          </div>

          {detail.sessions.length > 0 && (
            <>
              <div className="adm-category">Autopilot sessions</div>
              {detail.sessions.map((s, i) => (
                <div key={i} className="adm-stat" style={{ padding: "4px 0", fontSize: 9 }}>
                  <span style={{ color: "var(--adm-ink-2)", flex: 1 }}>{s.exchange_id} · {s.risk_mode} · {s.market_type}{s.is_active ? "" : " (off)"}{s.frozen_until_day ? " · FROZEN" : ""}</span>
                  <span style={{ color: "var(--adm-ink-3)" }}>{s.trades_today} trades · </span>
                  <span style={{ color: pnlColor(s.pnl_today) }}>{s.pnl_today >= 0 ? "+" : ""}{usd(s.pnl_today)}</span>
                </div>
              ))}
            </>
          )}

          <div className="adm-category" style={{ marginTop: 6 }}>Operations</div>
          <div className="adm-scroll" style={{ maxHeight: 160 }}>
            {detail.operations.length === 0 ? <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>None.</div> :
              detail.operations.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 6, padding: "3px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
                  <span style={{ color: "var(--adm-ink-3)", flexShrink: 0 }}>{new Date(o.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  {o.side && <span style={{ color: o.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", width: 24 }}>{o.side}</span>}
                  <span style={{ color: "var(--adm-ink)", flex: 1, fontFamily: "monospace" }}>{o.pair ?? o.kind}</span>
                  <span style={{ color: "var(--adm-ink-3)" }}>{o.volume_usd != null ? usd(o.volume_usd) : ""}</span>
                  <span style={{ color: pnlColor(o.pnl_usd ?? 0), width: 46, textAlign: "right" }}>{o.pnl_usd == null ? "" : `${o.pnl_usd >= 0 ? "+" : ""}${usd(o.pnl_usd)}`}</span>
                </div>
              ))}
          </div>
        </div>
      ) : (
        /* List view */
        list && (
          list.length === 0 ? <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No wallet activity yet.</div> :
          <table className="adm-table">
            <thead><tr><th>WALLET</th><th>TIER</th><th>OPS</th><th>VOL</th><th>P&L</th></tr></thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.wallet} style={{ cursor: "pointer" }} onClick={() => openWallet(w.wallet)}>
                  <td style={{ color: "var(--adm-cyan)", fontFamily: "monospace" }}>{short(w.wallet)}</td>
                  <td style={{ color: "var(--adm-violet)" }}>{w.tier}</td>
                  <td>{w.ops}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(w.volume)}</td>
                  <td style={{ color: pnlColor(w.pnl), fontVariantNumeric: "tabular-nums" }}>{w.pnl >= 0 ? "+" : ""}{usd(w.pnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </TerminalPanel>
  );
}
