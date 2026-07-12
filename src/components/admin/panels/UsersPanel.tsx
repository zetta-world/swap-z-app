"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type WalletRow = {
  wallet: string; ops: number; volume: number; pnl: number; grossWin: number; grossLoss: number;
  tier: string; firstSeen: string | null; lastSeen: string; pageViews: number; autopilot: boolean;
};
type Detail = {
  wallet: string; tier: string; tierSource: string | null; chain: string | null;
  firstSeen: string | null; lastSeen: string | null;
  financials: { volume: number; netPnl: number; grossWin: number; grossLoss: number; winOps: number; lossOps: number; winRate: number | null; totalOps: number };
  byChain: { chain: string; volume: number; pnl: number; ops: number }[];
  byKind:  { kind: string; count: number; volume: number; pnl: number }[];
  autopilot: { activeSessions: number; sessions: { exchange_id: string; risk_mode: string; market_type: string; is_active: boolean; trades_today: number; pnl_today: number; frozen_until_day: string | null }[]; pnlToday: number; openPositions: number; openExposure: number };
  browsing: { pageViews: number; byPath: { path: string; n: number }[] };
  operations: { kind: string; pair: string | null; side: string | null; volume_usd: number | null; pnl_usd: number | null; status: string; created_at: string }[];
};

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--adm-green)" : "var(--adm-red)");
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—");

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 70, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 7px" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 13, color: color ?? "var(--adm-ink)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

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
    <TerminalPanel id="users-explorer" title="USERS" subtitle="raio-x financeiro + comportamento por carteira" icon="◭" source="operations + autopilot + events">
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input className="adm-input" placeholder="cola uma wallet…" value={query} spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) openWallet(query.trim()); }}
          style={{ flex: 1, fontSize: 10, fontFamily: "monospace", background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px", color: "var(--adm-ink)" }} />
        <button className="adm-toggle" onClick={() => query.trim() && openWallet(query.trim())}>GO</button>
        {detail && <button className="adm-toggle" onClick={() => setDetail(null)}>← LISTA</button>}
      </div>

      {error && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}
      {loading && !list && <div className="adm-shimmer" style={{ height: 100 }} />}

      {detail ? (
        <div>
          {/* Identity */}
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--adm-cyan)" }}>{short(detail.wallet)}</span>
            <span style={{ fontSize: 9, color: "var(--adm-violet)" }}>{detail.tier}{detail.tierSource ? ` (${detail.tierSource})` : ""}</span>
            {detail.chain && <span style={{ fontSize: 9, color: "var(--adm-ink-3)" }}>{detail.chain.toUpperCase()}</span>}
            <span style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>1ª {date(detail.firstSeen)} · últ {date(detail.lastSeen)}</span>
          </div>

          {/* Financial X-ray */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <Tile label="VOLUME" value={usd(detail.financials.volume)} />
            <Tile label="P&L LÍQ." value={`${detail.financials.netPnl >= 0 ? "+" : ""}${usd(detail.financials.netPnl)}`} color={pnlColor(detail.financials.netPnl)} />
            <Tile label="GANHOU" value={usd(detail.financials.grossWin)} color="var(--adm-green)" />
            <Tile label="PERDEU" value={usd(detail.financials.grossLoss)} color="var(--adm-red)" />
            <Tile label="ACERTO" value={detail.financials.winRate == null ? "—" : `${detail.financials.winRate.toFixed(0)}%`} />
            <Tile label="OPS" value={String(detail.financials.totalOps)} />
          </div>

          {/* Autopilot */}
          {(detail.autopilot.activeSessions > 0 || detail.autopilot.openPositions > 0 || detail.autopilot.sessions.length > 0) && (
            <>
              <div className="adm-category">Autopilot</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <Tile label="SESSÕES ON" value={String(detail.autopilot.activeSessions)} />
                <Tile label="P&L HOJE" value={`${detail.autopilot.pnlToday >= 0 ? "+" : ""}${usd(detail.autopilot.pnlToday)}`} color={pnlColor(detail.autopilot.pnlToday)} />
                <Tile label="ABERTAS" value={String(detail.autopilot.openPositions)} />
                <Tile label="EXPOSIÇÃO" value={usd(detail.autopilot.openExposure)} />
              </div>
            </>
          )}

          {/* Volume by chain + by kind */}
          {detail.byChain.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
              <div>
                <div className="adm-category">Por chain</div>
                <table className="adm-table"><tbody>
                  {detail.byChain.slice(0, 6).map((c) => (
                    <tr key={c.chain}><td style={{ color: "var(--adm-cyan)" }}>{c.chain}</td><td>{usd(c.volume)}</td><td style={{ color: pnlColor(c.pnl) }}>{c.pnl >= 0 ? "+" : ""}{usd(c.pnl)}</td></tr>
                  ))}
                </tbody></table>
              </div>
              <div>
                <div className="adm-category">Por tipo</div>
                <table className="adm-table"><tbody>
                  {detail.byKind.slice(0, 6).map((k) => (
                    <tr key={k.kind}><td style={{ color: "var(--adm-ink-2)" }}>{k.kind}</td><td>{k.count}×</td><td>{usd(k.volume)}</td></tr>
                  ))}
                </tbody></table>
              </div>
            </div>
          )}

          {/* Browsing behaviour */}
          <div className="adm-category" style={{ marginTop: 6 }}>Navegação · {detail.browsing.pageViews} page-views</div>
          {detail.browsing.byPath.length === 0 ? <div style={{ color: "var(--adm-ink-4)", fontSize: 9 }}>—</div> : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {detail.browsing.byPath.map((p) => (
                <span key={p.path} style={{ fontSize: 8, fontFamily: "monospace", color: "var(--adm-ink-3)", border: "1px solid var(--adm-border)", borderRadius: 4, padding: "1px 5px" }}>
                  {p.path} <span style={{ color: "var(--adm-cyan)" }}>{p.n}</span>
                </span>
              ))}
            </div>
          )}

          {/* Recent operations */}
          <div className="adm-category" style={{ marginTop: 6 }}>Operações recentes</div>
          <div className="adm-scroll" style={{ maxHeight: 130 }}>
            {detail.operations.length === 0 ? <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>Nenhuma.</div> :
              detail.operations.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 6, padding: "3px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9, alignItems: "center" }}>
                  <span style={{ color: "var(--adm-ink-3)", flexShrink: 0 }}>{date(o.created_at)}</span>
                  {o.side && <span style={{ color: o.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", width: 24 }}>{o.side}</span>}
                  <span style={{ color: "var(--adm-ink)", flex: 1, fontFamily: "monospace" }}>{o.pair ?? o.kind}</span>
                  <span style={{ color: "var(--adm-ink-3)" }}>{o.volume_usd != null ? usd(o.volume_usd) : ""}</span>
                  <span style={{ color: pnlColor(o.pnl_usd ?? 0), width: 46, textAlign: "right" }}>{o.pnl_usd == null ? "" : `${o.pnl_usd >= 0 ? "+" : ""}${usd(o.pnl_usd)}`}</span>
                </div>
              ))}
          </div>
        </div>
      ) : (
        list && (
          list.length === 0 ? <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>Sem atividade de carteira ainda.</div> :
          <table className="adm-table">
            <thead><tr><th>WALLET</th><th>TIER</th><th>OPS</th><th>VOL</th><th>P&L</th><th>👁</th><th>🤖</th></tr></thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.wallet} style={{ cursor: "pointer" }} onClick={() => openWallet(w.wallet)}>
                  <td style={{ color: "var(--adm-cyan)", fontFamily: "monospace" }} title={`1ª vez ${date(w.firstSeen)}`}>{short(w.wallet)}</td>
                  <td style={{ color: "var(--adm-violet)" }}>{w.tier}</td>
                  <td>{w.ops}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(w.volume)}</td>
                  <td style={{ color: pnlColor(w.pnl), fontVariantNumeric: "tabular-nums" }}>{w.pnl >= 0 ? "+" : ""}{usd(w.pnl)}</td>
                  <td style={{ color: "var(--adm-ink-3)" }}>{w.pageViews}</td>
                  <td>{w.autopilot ? "🟢" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </TerminalPanel>
  );
}
