"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminRealtime } from "../AdminRealtimeProvider";

type Agent = {
  source: string; name: string; kind: string;
  total: number; open: number; resolved: number;
  wins: number; losses: number; expired: number;
  winRate: number | null;
  expectancy: number | null; expectancyNet: number | null;
  avgWin: number | null; avgLoss: number | null;
  profitFactor: number | null; avgRR: number | null;
  sufficientSample: boolean;
};
type TT = { agents: Agent[]; minSample: number; fetchedAt: string };

const MEDAL = ["🥇", "🥈", "🥉"];

function kindColor(kind: string): string {
  if (kind === "agent") return "var(--adm-gold)";
  if (kind === "model") return "var(--adm-cyan)";
  return "var(--adm-ink-3)";
}

export default function TournamentPanel() {
  const [data, setData] = useState<TT | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const realtime = useAdminRealtime();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/tournament");
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

  const ranked = (data?.agents ?? []).filter((a) => a.resolved > 0);
  const waiting = (data?.agents ?? []).filter((a) => a.resolved === 0);

  return (
    <TerminalPanel id="tournament" title="TOURNAMENT" subtitle="agents & models · net expectancy" icon="♛" source="supabase/zion_suggestions">
      {loading && <div className="adm-shimmer" style={{ height: 120 }} />}
      {error   && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{error}</div>}

      {data && (
        <div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.06em", marginBottom: 8 }}>
            RANKED BY NET EXPECTANCY / TRADE · after fees ({data.minSample}+ decididos = confiável)
          </div>

          {ranked.length === 0 && (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 10, marginBottom: 8 }}>
              Nenhum agente com trade resolvido ainda — o torneio preenche a cada tick.
            </div>
          )}

          {ranked.map((a, i) => {
            const net = a.expectancyNet;
            const decided = a.wins + a.losses;
            const netColor = net == null ? "var(--adm-ink-3)" : net >= 0 ? "var(--adm-green)" : "var(--adm-red)";
            return (
              <div key={a.source} style={{ padding: "8px 0", borderBottom: "1px solid var(--adm-border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, width: 22, textAlign: "center", flexShrink: 0 }}>{MEDAL[i] ?? `#${i + 1}`}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: kindColor(a.kind), fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</div>
                    <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 1 }}>
                      {decided} decididos · {a.open} abertos
                      {!a.sufficientSample && <span style={{ color: "var(--adm-gold)" }}> · ⚠ amostra pequena</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 15, color: netColor, fontVariantNumeric: "tabular-nums" }}>
                      {net == null ? "—" : `${net >= 0 ? "+" : ""}${net.toFixed(2)}%`}
                    </div>
                    <div style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>
                      WR {a.winRate == null ? "—" : `${(a.winRate * 100).toFixed(0)}%`} · PF {a.profitFactor == null ? "—" : a.profitFactor.toFixed(2)} · R:R {a.avgRR == null ? "—" : a.avgRR.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {waiting.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.06em", marginBottom: 4 }}>AGUARDANDO RESOLUÇÃO (sem decididos)</div>
              {waiting.map((a) => (
                <div key={a.source} style={{ display: "flex", gap: 8, fontSize: 9, padding: "2px 0", alignItems: "center" }}>
                  <span style={{ color: kindColor(a.kind), flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                  <span style={{ color: "var(--adm-ink-3)", flexShrink: 0 }}>{a.open} abertos · {a.total} total</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}
