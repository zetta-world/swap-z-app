"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type LogRow = {
  id:           string;
  actor_wallet: string;
  action:       string;
  target:       string | null;
  payload:      Record<string, unknown> | null;
  created_at:   string;
};

export default function AuditLogPanel() {
  const [rows,    setRows]    = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/admin/api/audit?limit=30");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? res.status);
        if (mounted) setRows(json.rows ?? []);
      } catch (e) {
        if (mounted) setErr(String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => { mounted = false; clearInterval(t); };
  }, []);

  function actionColor(action: string): string {
    if (action.startsWith("tier.grant"))   return "var(--adm-green)";
    if (action.startsWith("tier.revoke"))  return "var(--adm-red)";
    if (action.startsWith("killswitch"))   return "var(--adm-amber)";
    return "var(--adm-cyan)";
  }

  return (
    <TerminalPanel
      id="audit-log"
      title="AUDIT LOG"
      subtitle="all privileged actions"
      icon="◎"
      source="supabase/admin_audit_log"
    >
      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}
      {!loading && !err && rows.length === 0 && (
        <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No actions logged yet.</div>
      )}
      {!loading && rows.length > 0 && (
        <div className="adm-scroll" style={{ maxHeight: 280 }}>
          <table className="adm-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>ACTION</th>
                <th>ACTOR</th>
                <th>TARGET</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: "var(--adm-ink-3)", whiteSpace: "nowrap", fontSize: 9 }}>
                    {new Date(r.created_at).toLocaleTimeString()}
                  </td>
                  <td style={{ color: actionColor(r.action), whiteSpace: "nowrap" }}>
                    {r.action}
                  </td>
                  <td style={{ fontSize: 9, color: "var(--adm-ink-2)", fontFamily: "monospace" }}>
                    {r.actor_wallet.slice(0, 6)}…{r.actor_wallet.slice(-4)}
                  </td>
                  <td style={{ fontSize: 9, color: "var(--adm-ink-2)", fontFamily: "monospace" }}>
                    {r.target ? `${r.target.slice(0, 6)}…${r.target.slice(-4)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </TerminalPanel>
  );
}
