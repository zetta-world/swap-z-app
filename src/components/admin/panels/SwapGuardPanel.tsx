"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type Unknown = { program: string; count: number; lastSeen: string; symbols: string[]; likelyJupiterChange: boolean };
type Probe = {
  case: string; guardOk?: boolean; reason?: string | null; error?: string;
  programs?: string[]; unknownPrograms?: string[];
  instructionCount?: number; staticKeys?: number; addressLookupTables?: number;
};
type ProbeResp = { probes: Probe[]; verdict: string };
type GR = {
  mode: string; hours: number;
  passed: number; refused: number; blocked: number; total: number;
  refusalRate: number | null;
  unknown: Unknown[];
  verdict: string;
};

const MODE_LABEL: Record<string, { label: string; desc: string; color: string }> = {
  shadow:  { label: "OBSERVANDO", desc: "verifica e reporta · NÃO bloqueia", color: "var(--adm-amber)" },
  enforce: { label: "BLOQUEANDO", desc: "recusa a assinatura fora da lista", color: "var(--adm-green)" },
  off:     { label: "DESLIGADO",  desc: "sem verificação nenhuma",           color: "var(--adm-red)" },
};

const PERIODS = [{ label: "24H", h: 24 }, { label: "7D", h: 168 }, { label: "30D", h: 720 }];

export default function SwapGuardPanel() {
  const [data, setData] = useState<GR | null>(null);
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResp | null>(null);

  // A sonda responde, em segundos, a pergunta que tráfego orgânico levaria
  // semanas pra responder — e que uma plataforma não lançada nunca responderia.
  const runProbe = async () => {
    setProbing(true);
    try {
      const res = await fetch("/admin/api/swap-guard", { method: "POST" });
      setProbe(await res.json());
    } catch { setProbe({ probes: [], verdict: "falha ao rodar a sonda — tente de novo" }); }
    finally { setProbing(false); }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/admin/api/swap-guard?hours=${hours}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setData(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }, [hours]);

  useEffect(() => { load(); const t = setInterval(load, 120_000); return () => clearInterval(t); }, [load]);

  const m = data ? MODE_LABEL[data.mode] ?? MODE_LABEL.shadow : null;
  const rate = data?.refusalRate;
  const alarming = rate != null && rate > 0.5;

  return (
    <TerminalPanel id="swap-guard" title="SOLANA GUARD" subtitle="verificação de assinatura · Jupiter" icon="⛨" source="platform_events/swap_guard">
      {loading && <div className="adm-shimmer" style={{ height: 70 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}

      <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
        {PERIODS.map((p) => (
          <button key={p.label} className={`adm-toggle ${hours === p.h ? "active" : ""}`}
            style={{ fontSize: 8, padding: "2px 6px" }}
            onClick={() => { setHours(p.h); setLoading(true); }}>{p.label}</button>
        ))}
      </div>

      <div style={{ marginBottom: 10 }}>
        <button onClick={runProbe} disabled={probing}
          style={{ fontSize: 9, letterSpacing: "0.05em", padding: "5px 10px", borderRadius: 3,
            cursor: probing ? "wait" : "pointer", color: "var(--adm-cyan)",
            background: "rgba(0 229 255 / 0.06)", border: "1px solid rgba(0 229 255 / 0.25)" }}>
          {probing ? "verificando…" : "⚡ testar contra a Jupiter real (grátis · sem swap)"}
        </button>
        {probe && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 9, padding: "6px 8px", borderRadius: 3, lineHeight: 1.5,
              color: probe.verdict.startsWith("✅") ? "var(--adm-green)" : "var(--adm-amber)",
              background: "var(--adm-bg-raise)" }}>
              {probe.verdict}
            </div>
            {probe.probes.map((p, i) => (
              <div key={i} style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 4, fontFamily: "monospace" }}>
                <span style={{ color: p.error ? "var(--adm-red)" : p.guardOk ? "var(--adm-green)" : "var(--adm-red)" }}>
                  {p.case}: {p.error ? `erro — ${p.error}` : p.guardOk ? "APROVADO" : `RECUSADO — ${p.reason ?? ""}`}
                </span>
                {!p.error && (
                  <div>· {p.instructionCount} instruções · {p.staticKeys} chaves estáticas · {p.addressLookupTables} lookup tables</div>
                )}
                {!!p.unknownPrograms?.length && (
                  <div style={{ color: "var(--adm-amber)", wordBreak: "break-all" }}>· desconhecido: {p.unknownPrograms.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {data && m && (
        <div>
          <div style={{ fontSize: 9, color: m.color, letterSpacing: "0.06em", marginBottom: 8 }}>
            {m.label} — {m.desc}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 8 }}>
            {[
              ["APROVADOS", String(data.passed), "var(--adm-green)"],
              ["RECUSADOS", String(data.refused), data.refused > 0 ? "var(--adm-amber)" : "var(--adm-ink-2)"],
              ["BLOQUEADOS", String(data.blocked), data.blocked > 0 ? "var(--adm-red)" : "var(--adm-ink-3)"],
              ["TAXA RECUSA", rate == null ? "—" : `${(rate * 100).toFixed(1)}%`, alarming ? "var(--adm-red)" : "var(--adm-ink-2)"],
            ].map(([label, value, color]) => (
              <div key={label}>
                <div style={{ fontSize: 7, color: "var(--adm-ink-4)", letterSpacing: "0.08em" }}>{label}</div>
                <div style={{ fontSize: 11, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
              </div>
            ))}
          </div>

          <div style={{
            fontSize: 9, padding: "6px 8px", borderRadius: 3, marginBottom: 8,
            color: alarming ? "var(--adm-red)" : "var(--adm-ink-3)",
            background: alarming ? "rgba(255 60 60 / 0.07)" : "var(--adm-bg-raise)",
            borderLeft: `2px solid ${alarming ? "var(--adm-red)" : "var(--adm-border)"}`,
          }}>
            {data.verdict}
          </div>

          {data.unknown.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 4 }}>
                PROGRAMAS NÃO RECONHECIDOS — adicione à lista se for mudança da Jupiter
              </div>
              {data.unknown.map((u) => (
                <div key={u.program} style={{ marginBottom: 5, fontSize: 9 }}>
                  <div
                    onClick={() => navigator.clipboard?.writeText(u.program)}
                    title="toque p/ copiar"
                    style={{ fontFamily: "monospace", color: "var(--adm-cyan)", cursor: "pointer", wordBreak: "break-all" }}>
                    {u.program}
                  </div>
                  <div style={{ fontSize: 7, color: "var(--adm-ink-4)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span>{u.count}×</span>
                    {u.symbols.length > 0 && <span>{u.symbols.join(", ")}</span>}
                    {u.likelyJupiterChange && (
                      <span style={{ color: "var(--adm-amber)" }}>
                        provável mudança da Jupiter (atinge muita gente — atacante não consegue isso)
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 6, fontStyle: "italic" }}>
                Para liberar: adicione o endereço em <code>JUPITER_ALLOWED_PROGRAMS</code> (src/lib/swap/solana-guard.ts) e faça deploy.
                Emergência: <code>NEXT_PUBLIC_SOLANA_TX_GUARD=off</code> + redeploy.
              </div>
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}
