"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

// Espelha FLYWHEEL_GATE_KEYS (src/lib/admin/gates.ts). Um gate que existe no
// cron mas não aparece aqui é uma mesa que só se desliga por deploy — foi o que
// aconteceu com oracle/arbiter2, agora corrigido.
type GateKey =
  | "pause_backtest" | "pause_agent_a" | "pause_agent_b" | "pause_tournament"
  | "pause_radar" | "pause_sniper" | "pause_arbiter" | "pause_paper"
  | "pause_oracle" | "pause_arbiter2"
  | "pause_ragnarok" | "pause_ragnarok_ai" | "pause_ragnarok_dex" | "pause_ullr";

type Breaker = {
  id: string; label: string; configured: boolean;
  fails: number; tripped: boolean; cooldownEndsAt: string | null;
};

const GATES: { key: GateKey; label: string; desc: string; master?: boolean }[] = [
  { key: "pause_backtest",   label: "BACKTEST (MASTER)", desc: "Pausa TODAS as análises. Resolução (grátis) continua fechando trades.", master: true },
  { key: "pause_agent_a",    label: "AGENT A · ZION",    desc: "Pausa o Agent A (Sonnet sozinho)." },
  { key: "pause_agent_b",    label: "AGENT B · FERRARI", desc: "Pausa o Agent B híbrido (Opus CEO). Também exige HYBRID_B_ENABLED." },
  { key: "pause_tournament", label: "TORNEIO (MODELOS)", desc: "Pausa Mistral/DeepSeek/Kimi/Llama/Grok. É o que gasta nos provedores diretos." },
  { key: "pause_radar",      label: "RADAR (BRAIN)",     desc: "Pausa o acorde do modelo nos gatilhos de preço. Detecção (grátis) continua." },
  { key: "pause_sniper",     label: "SNIPER ANTIGO",     desc: "VEÐRFÖLNIR (aposentado). Já desligado por default — só religa com SNIPER_LEGACY=on." },
  { key: "pause_oracle",     label: "VÖLVA 🔮 (ORÁCULO)", desc: "Mesa de tese diária, multi-modelo. Gasta 1×/dia." },
  { key: "pause_arbiter",    label: "ᛉ RATATOSKR",       desc: "Arbitragem spot cross-CEX. ZERO IA (aritmética pura) — dados públicos, opera no paper." },
  { key: "pause_arbiter2",   label: "ᛇ JÖRMUNGANDR",     desc: "Spot+perp hedgeada (funding + convergência). ZERO IA." },
  { key: "pause_ragnarok",   label: "ᚹ VÖLUNDR + ᛋ SKAÐI", desc: "Mesas mecânicas long-only (swing 48h + day 8h). ZERO token — é o CONTROLE do experimento." },
  { key: "pause_ragnarok_ai", label: "ᛘ MÍMIR (IA)",     desc: "A mesa de IA que aceita/veta/ajusta o plano do ferreiro. ESTA gasta token." },
  { key: "pause_ragnarok_dex", label: "ᚨ FREYJA (DEX)",  desc: "Mesma estratégia, praça on-chain (GeckoTerminal). ZERO token." },
  { key: "pause_ullr",       label: "ᚢ ULLR (LANÇAMENTO)", desc: "Arqueiro de pool recém-nascido. Long-only, munição diária contada. ZERO token." },
  { key: "pause_paper",      label: "PAPER · GATE.IO",   desc: "Pausa o agente de simulação. Zero token — pausar só congela o experimento (e a carteira de USDT para de encher)." },
];

export default function AiControlsPanel() {
  const [gates, setGates] = useState<Record<GateKey, boolean>>({
    pause_backtest: false, pause_agent_a: false, pause_agent_b: false, pause_tournament: false,
    pause_radar: false, pause_sniper: false, pause_arbiter: false, pause_paper: false,
    pause_oracle: false, pause_arbiter2: false,
    pause_ragnarok: false, pause_ragnarok_ai: false, pause_ragnarok_dex: false, pause_ullr: false,
  });
  const [loading, setLoading]   = useState(true);
  const [mutating, setMutating] = useState<GateKey | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [note, setNote]         = useState<string | null>(null);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [resetting, setResetting] = useState<string | null>(null);

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
        pause_radar:      !!s.pause_radar,
        pause_sniper:     !!s.pause_sniper,
        pause_arbiter:    !!s.pause_arbiter,
        pause_paper:      !!s.pause_paper,
        pause_oracle:     !!s.pause_oracle,
        pause_arbiter2:   !!s.pause_arbiter2,
        pause_ragnarok:     !!s.pause_ragnarok,
        pause_ragnarok_ai:  !!s.pause_ragnarok_ai,
        pause_ragnarok_dex: !!s.pause_ragnarok_dex,
        pause_ullr:         !!s.pause_ullr,
      });
      if (json.note) setNote(json.note);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
    // Circuit-breaker states — best-effort, never blocks the toggles.
    try {
      const res  = await fetch("/admin/api/ai-circuit");
      const json = await res.json();
      if (res.ok) setBreakers(json.breakers ?? []);
    } catch { /* section just stays empty */ }
  }

  useEffect(() => { load(); }, []);

  async function resetBreaker(id: string) {
    setResetting(id);
    try {
      const res = await fetch("/admin/api/ai-circuit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) setBreakers((prev) => prev.map((b) => b.id === id ? { ...b, fails: 0, tripped: false, cooldownEndsAt: null } : b));
    } catch { /* keep old state */ } finally { setResetting(null); }
  }

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

      {/* Circuit breakers — a provider that failed N straight calls is skipped
          for a cooldown. Show the state so the operator isn't blind to it, and
          allow a manual reset after fixing the key / topping up credits. */}
      {!loading && breakers.some((b) => b.configured) && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--adm-border)", paddingTop: 8 }}>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 6 }}>
            CIRCUIT BREAKERS · pula provedor com falhas seguidas
          </div>
          {breakers.filter((b) => b.configured).map((b) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 9 }}>
              <span style={{ flex: 1, color: "var(--adm-ink)" }}>{b.label}</span>
              {b.tripped ? (
                <>
                  <span style={{ color: "var(--adm-red)" }}>
                    ⛔ TRIPADO até {b.cooldownEndsAt ? new Date(b.cooldownEndsAt).toLocaleTimeString() : "—"}
                  </span>
                  <button className="adm-toggle danger" onClick={() => resetBreaker(b.id)} disabled={resetting === b.id}>
                    {resetting === b.id ? "…" : "RESET"}
                  </button>
                </>
              ) : b.fails > 0 ? (
                <span style={{ color: "var(--adm-gold)" }}>⚠ {b.fails} falha(s) seguida(s)</span>
              ) : (
                <span style={{ color: "var(--adm-green)" }}>● ok</span>
              )}
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
