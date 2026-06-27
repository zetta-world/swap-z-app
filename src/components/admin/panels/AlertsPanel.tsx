"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Alert = { metadata: { text?: string } | null; created_at: string };
type Data = { configured: boolean; recent: Alert[] };

export default function AlertsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testMsg, setTestMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/alerts");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const sendTest = async () => {
    setTestMsg("sending…");
    try {
      const res = await fetch("/admin/api/alert-test", { method: "POST" });
      const json = await res.json();
      setTestMsg(json.configured ? "sent ✓ — check Telegram" : "logged, but Telegram not configured");
      load();
    } catch { setTestMsg("failed"); }
    setTimeout(() => setTestMsg(null), 6000);
  };

  return (
    <TerminalPanel id="alerts" title="ALERTS" subtitle="Telegram · proactive notifications" icon="🔔" source="platform_events/alert">
      {loading && <div className="adm-shimmer" style={{ height: 80 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: data.configured ? "var(--adm-green)" : "var(--adm-gold)" }} />
            <span style={{ fontSize: 10, color: data.configured ? "var(--adm-green)" : "var(--adm-gold)", flex: 1 }}>
              {data.configured ? "Telegram CONNECTED" : "Telegram not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)"}
            </span>
            <button className="adm-toggle" onClick={sendTest}>SEND TEST</button>
          </div>
          {testMsg && <div style={{ fontSize: 9, color: "var(--adm-cyan)", marginBottom: 8 }}>{testMsg}</div>}

          <div className="adm-category">Recent alerts</div>
          <div className="adm-scroll" style={{ maxHeight: 240 }}>
            {data.recent.length === 0 ? (
              <div style={{ color: "var(--adm-ink-3)", fontSize: 10 }}>No alerts fired yet. ✓</div>
            ) : data.recent.map((a, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 9 }}>
                <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(a.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <span style={{ color: "var(--adm-ink-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(a.metadata?.text ?? "").replace(/<[^>]+>/g, "")}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
