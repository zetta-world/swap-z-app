"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAutoRefresh } from "../useAutoRefresh";
import AvisoDeFonte from "../AvisoDeFonte";
import { corDoPnl } from "@/lib/admin/cor-resultado";
import { exibirMetrica, mensagemDeFalha, type OperationalMetric } from "@/lib/admin/metrica";

type Recent = {
  wallet_address: string | null; kind: string; pair: string | null; side: string | null;
  volume_usd: number | null; pnl_usd: number | null; status: string; created_at: string;
};
type Agregado = { totalVolume: number; totalPnl: number; byKind: Record<string, { count: number; volume: number; pnl: number }> };
type Ledger = {
  total: OperationalMetric<number>;
  agregado: OperationalMetric<Agregado>;
  recent: Recent[] | null;
  recentMetrica: OperationalMetric<null>;
  fetchedAt: string;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * ⚠️ R3/P1-11: o total (contagem exata) e as somas (sobre todas as linhas) chegam como métricas;
 * falha = "—" + INDISPONÍVEL, nunca "No operations recorded yet.". Erro de rede ZERA o dado.
 */
export default function OperationsLedgerPanel() {
  const [data, setData] = useState<Ledger | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "feed">("overview");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/ledger", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) { setData(null); setError(mensagemDeFalha(res.status, json)); return; }
      setData(json); setError(null);
    } catch (e) { setData(null); setError(String(e)); }
  }, []);
  const { secondsAgo, refreshing, forceRefresh } = useAutoRefresh({ onRefresh: load, intervalMs: 60_000 });
  const loading = !data && !error;

  const ag = data?.agregado.value ?? null;
  const vol = data ? exibirMetrica(data.agregado, (v) => usd(v.totalVolume)) : null;
  const pnl = data ? exibirMetrica(data.agregado, (v) => `${v.totalPnl > 0 ? "+" : ""}${usd(v.totalPnl)}`) : null;
  const tot = data ? exibirMetrica(data.total, (v) => String(v)) : null;

  return (
    <TerminalPanel id="ops-ledger" title="OPERATIONS" subtitle="every client trade · volume · P&L (declarados)" icon="≣" source="supabase/operations"
      secondsAgo={data ? secondsAgo : undefined} refreshing={refreshing} onRefresh={forceRefresh}>
      <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {(["overview", "feed"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`adm-toggle ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>

      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {error   && <div role="alert" style={{ color: "var(--adm-red)", fontSize: 13 }}>{error} — isto NÃO é "nenhuma operação".</div>}

      {data && tab === "overview" && (
        <div>
          <AvisoDeFonte m={data.total} rotulo="contagem" />
          {data.agregado.state !== "ok" && <AvisoDeFonte m={data.agregado} rotulo="somas" />}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <Stat label="OPERATIONS" value={tot!.texto} color={tot!.cor ?? "var(--adm-cyan)"} />
            <Stat label="VOLUME" value={vol!.texto} color={vol!.cor ?? "var(--adm-ink)"} />
            <Stat label="REALIZED P&L" value={pnl!.texto} color={pnl!.cor ?? (ag ? corDoPnl(ag.totalPnl) : "var(--adm-ink-3)")} />
          </div>
          {ag == null ? null : Object.keys(ag.byKind).length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 13 }}>No operations recorded yet.</div>
          ) : (
            <table className="adm-table">
              <thead><tr><th>KIND</th><th>N</th><th>VOLUME</th><th>P&L</th></tr></thead>
              <tbody>
                {Object.entries(ag.byKind).sort((a, b) => b[1].count - a[1].count).map(([kind, v]) => (
                  <tr key={kind}>
                    <td style={{ color: "var(--adm-cyan)", fontFamily: "monospace" }}>{kind}</td>
                    <td>{v.count}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{usd(v.volume)}</td>
                    <td style={{ color: corDoPnl(v.pnl), fontVariantNumeric: "tabular-nums" }}>{v.pnl > 0 ? "+" : ""}{usd(v.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && tab === "feed" && (
        <div className="adm-scroll" style={{ maxHeight: 300 }}>
          {data.recent == null ? (
            <AvisoDeFonte m={data.recentMetrica} rotulo="recentes" />
          ) : data.recent.length === 0 ? (
            <div style={{ color: "var(--adm-ink-3)", fontSize: 13 }}>No operations yet.</div>
          ) : data.recent.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--adm-border)", fontSize: 12, alignItems: "center" }}>
              <span style={{ color: "var(--adm-ink-3)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              <span style={{ color: "var(--adm-ink-4)", flexShrink: 0, width: 52, fontFamily: "monospace" }}>{r.wallet_address ? `${r.wallet_address.slice(0, 6)}…` : "—"}</span>
              {r.side && <span style={{ color: r.side === "buy" ? "var(--adm-green)" : "var(--adm-red)", flexShrink: 0, width: 26 }}>{r.side}</span>}
              <span style={{ color: "var(--adm-ink)", flexShrink: 0, width: 76, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.pair ?? r.kind}</span>
              <span style={{ color: "var(--adm-ink-3)", flex: 1, fontVariantNumeric: "tabular-nums" }}>{r.volume_usd != null ? usd(r.volume_usd) : ""}</span>
              <span style={{ color: corDoPnl(r.pnl_usd), flexShrink: 0, width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {r.pnl_usd == null ? "" : `${r.pnl_usd >= 0 ? "+" : ""}${usd(r.pnl_usd)}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ flex: 1, background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ fontSize: 11, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>{label}</div>
      <div style={{ fontSize: 18, color, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{value}</div>
    </div>
  );
}
