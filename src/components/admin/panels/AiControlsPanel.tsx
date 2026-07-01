"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

type GateKey = "pause_backtest" | "pause_agent_a" | "pause_agent_b" | "pause_tournament";

const GATES: { key: GateKey; label: string; desc: string; master?: boolean }[] = [
  { key: "pause_backtest",   label: "BACKTEST (MASTER)", desc: "Pausa TODAS as análises. Resolução (grátis) continua fechando trades.", master: true },
  { key: "pause_agent_a",    label: "AGENT A · ZION",    desc: "Pausa o Agent A (Sonnet sozinho)." },
  { key: "pause_agent_b",    label: "AGENT B · FERRARI", desc: "Pausa o Agent B híbrido (Opus CEO). Também exige HYBRID_B_ENABLED." },
  { key: "pause_tournament", label: "TORNEIO (MODELOS)", desc: "Pausa Mistral/DeepSeek/Kimi/Llama/Grok. É o que gasta nos provedores diretos." },
];

export default function AiControlsPanel() {
  const [gates, setGates] = useState<Record<GateKey, boolean>>({
    pause_backtest: false, pause_agent_a: false, pause_agent_b: false, pause_tournament: false,
  });
  const [loading, setLoading]   = useState(true);
  const [mutating, setMutating] = useState<GateKey | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [note, setNote]         = useState<string | null>(null);

  async function load() {
    try {
      const res  = await fetch("/admin/api/killswitch");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      const s = json.switches ?? {};
      setGates({
        pause_backtest:   !!s.pause_backtest,
        pause_agent_a:    !!s.pause_agent_a,
        pause_agent_b:    !!s.pause_agent_b,
        pause_tournament: !!s.pause_tournament,
      });
      if (json.note) setNote(json.note);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: GateKey) {
    const next = !gates[key];
    setMutating(key); setErr(null);
    try {
      const res = await fetch("/admin/api/killswitch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, enabled: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setGates((prev) => ({ ...prev, [key]: next }));
    } catch (e) { setErr(String(e)); } finally { setMutating(null); }
  }

  const masterPaused = gates.pause_backtest;

  return (
    <TerminalPanel id="ai-controls" title="AI CONTROLS" subtitle="liga/desliga agentes · torneio" icon="⏻" source="supabase/admin_kv">
      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {err  && <div style={{ color: "var(--adm-red)", fontSize: 10, marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ color: "var(--adm-amber)", fontSize: 9, marginBottom: 10 }}>⚠ {note}</div>}

      {!loading && GATES.map(({ key, label, desc, master }) => {
        const paused = gates[key];
        // Sub-gates are visually dimmed while the master pause is on (moot).
        const dimmed = !master && masterPaused;
        return (
          <div key={key} className="adm-stat" style={{ alignItems: "center", opacity: dimmed ? 0.45 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                color: paused ? "var(--adm-red)" : master ? "var(--adm-gold)" : "var(--adm-green)",
              }}>
                {label}
              </div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 2 }}>{desc}</div>
            </div>
            <button
              className={`adm-toggle ${paused ? "danger" : "active"}`}
              onClick={() => toggle(key)}
              disabled={mutating === key}
              title={paused ? "Clique para LIGAR" : "Clique para DESLIGAR"}
            >
              {mutating === key ? "…" : paused ? "OFF — LIGAR?" : "ON"}
            </button>
          </div>
        );
      })}
    </TerminalPanel>
  );
}
