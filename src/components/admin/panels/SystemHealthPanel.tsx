"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Cron = { name: string; last: string | null; ageMin: number | null; stale: boolean };
type Dep  = { name: string; ok: boolean; latencyMs: number | null; note?: string };
type Ext = {
  id: string; name: string; purpose: string; breaks: string;
  impact: "critical" | "degraded" | "cosmetic";
  ok: boolean; latencyMs: number | null; note?: string;
};
type Health = { ok: boolean; crons: Cron[]; deps: Dep[]; external?: Ext[]; verdict?: string };

const IMPACT_LABEL: Record<string, string> = {
  critical: "CRÍTICA", degraded: "DEGRADA", cosmetic: "COSMÉTICA",
};

function dot(ok: boolean): string { return ok ? "var(--adm-green)" : "var(--adm-red)"; }

function ageLabel(c: Cron): string {
  if (c.ageMin == null) return "never";
  if (c.ageMin < 1) return "just now";
  if (c.ageMin < 90) return `${c.ageMin}m ago`;
  return `${Math.round(c.ageMin / 60)}h ago`;
}

export default function SystemHealthPanel() {
  const [data, setData] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/health");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setError(null);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, realtime?.status === "live" ? 60_000 : 45_000);
    return () => clearInterval(t);
  }, [load, realtime?.status]);

  return (
    <TerminalPanel
      id="system-health"
      title="SYSTEM HEALTH"
      subtitle="crons · dependências externas · uptime"
      icon="♥"
      source="heartbeats + live pings"
    >
      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: data.ok ? "var(--adm-green)" : "var(--adm-red)", boxShadow: `0 0 8px ${data.ok ? "var(--adm-glow-green)" : "var(--adm-glow-red)"}` }} />
            <span style={{ fontSize: 11, color: data.ok ? "var(--adm-green)" : "var(--adm-red)", letterSpacing: "0.1em" }}>
              {data.ok ? "ALL SYSTEMS OPERATIONAL" : "ATTENTION NEEDED"}
            </span>
          </div>

          {/* CAMINHO DO DINHEIRO — vem PRIMEIRO de propósito. É a seção que
              faltava quando a Jupiter desligou o endpoint e ninguém viu. */}
          {data.external && data.external.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div className="adm-category">Dependências externas · caminho do dinheiro</div>
              {data.verdict && (
                <div style={{ fontSize: 9, color: data.verdict.startsWith("🟢") ? "var(--adm-green)" : "var(--adm-red)", margin: "3px 0 6px" }}>
                  {data.verdict}
                </div>
              )}
              {[...data.external]
                // Quebrado primeiro, e dentro disso o mais crítico no topo —
                // numa emergência ninguém deve rolar a tela pra achar o problema.
                .sort((a, b) => Number(a.ok) - Number(b.ok)
                  || (a.impact === "critical" ? -1 : 1) - (b.impact === "critical" ? -1 : 1))
                .map((d) => (
                <div key={d.id} style={{
                  padding: "5px 7px", marginBottom: 4, borderRadius: 3,
                  background: d.ok ? "transparent" : "rgba(255 60 60 / 0.06)",
                  borderLeft: `2px solid ${d.ok ? "var(--adm-border)" : "var(--adm-red)"}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot(d.ok), flexShrink: 0 }} />
                    <span style={{ fontSize: 10, color: "var(--adm-ink-2)", flex: 1, fontFamily: "monospace" }}>{d.name}</span>
                    <span style={{ fontSize: 7, color: d.impact === "critical" ? "var(--adm-red)" : "var(--adm-ink-4)", letterSpacing: "0.06em" }}>
                      {IMPACT_LABEL[d.impact]}
                    </span>
                    <span style={{ fontSize: 9, color: "var(--adm-ink-3)", fontVariantNumeric: "tabular-nums", width: 52, textAlign: "right" }}>
                      {d.latencyMs != null ? `${d.latencyMs}ms` : "—"}
                    </span>
                  </div>
                  <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 2, paddingLeft: 14 }}>{d.purpose}</div>
                  {/* "O QUE QUEBRA" só aparece quando ESTÁ quebrado: às 3 da
                      manhã o que importa é a consequência, não o catálogo. */}
                  {!d.ok && (
                    <div style={{ fontSize: 8, color: "var(--adm-red)", marginTop: 2, paddingLeft: 14 }}>
                      ⚠ {d.breaks}
                      {d.note && <span style={{ color: "var(--adm-ink-4)" }}> · {d.note}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="adm-category">Crons</div>
          {data.crons.map((c) => (
            <div key={c.name} className="adm-stat" style={{ padding: "5px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot(!c.stale), flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--adm-ink-2)", flex: 1, fontFamily: "monospace" }}>{c.name}</span>
              <span style={{ fontSize: 10, color: c.stale ? "var(--adm-red)" : "var(--adm-ink-3)", fontVariantNumeric: "tabular-nums" }}>{ageLabel(c)}</span>
            </div>
          ))}

          <div className="adm-category" style={{ marginTop: 8 }}>Dependencies</div>
          {data.deps.map((d) => (
            <div key={d.name} className="adm-stat" style={{ padding: "5px 0", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot(d.ok), flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: "var(--adm-ink-2)", flex: 1 }}>{d.name}{d.note ? <span style={{ color: "var(--adm-ink-4)", fontSize: 8 }}> · {d.note}</span> : null}</span>
              <span style={{ fontSize: 10, color: d.ok ? "var(--adm-ink-3)" : "var(--adm-red)", fontVariantNumeric: "tabular-nums" }}>
                {d.ok ? (d.latencyMs != null ? `${d.latencyMs}ms` : "up") : "DOWN"}
              </span>
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
