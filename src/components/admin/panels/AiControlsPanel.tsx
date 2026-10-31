"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminConfirm } from "../useAdminConfirm";
import {
  conhecido, gravavel, gravarInterruptor, lerInterruptoresCliente, rotuloDoEstado, type EstadoTri,
} from "../interruptores-cliente";

// A lista de gates NÃO é redigitada aqui (auditoria 01/08). Ela vem de
// `gate-keys.ts` — módulo puro, sem import de servidor, justamente para que o
// painel possa derivar da mesma fonte que o cron e o watchdog. Espelhar à mão
// já custou três bugs: oracle/arbiter2 invisíveis no painel, e duas versões da
// lista do disjuntor de custo com mesas faltando.
import { FLYWHEEL_GATE_KEYS, MAPA_INTERRUPTORES, type FlywheelGateKey } from "@/lib/admin/gate-keys";

type GateKey = FlywheelGateKey;

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
  { key: "pause_arbiter2",   label: "ᛇ JÖRMUNGANDR",     desc: "Spot+perp hedgeada (funding + convergência), SEM alavanca. ZERO IA." },
  { key: "pause_arbiter2_lev", label: "ᚼ NÍÐHÖGGR 3× + ᚠ FÁFNIR 5×", desc: "Os gêmeos alavancados: mesma arbitragem, margem menor por ciclo. Alavancado a posição hedgeada PODE ser liquidada — a simulação modela isso. ZERO IA." },
  { key: "pause_ragnarok",   label: "ᚹ VÖLUNDR + ᛋ SKAÐI", desc: "Mesas mecânicas long-only (swing 48h + day 8h). ZERO token — é o CONTROLE do experimento." },
  { key: "pause_ragnarok_ai", label: "ᛘ MÍMIR (IA)",     desc: "A mesa de IA que aceita/veta/ajusta o plano do ferreiro. ESTA gasta token." },
  { key: "pause_ragnarok_dex", label: "ᚨ FREYJA (DEX)",  desc: "Mesma estratégia, praça on-chain (GeckoTerminal). ZERO token." },
  { key: "pause_urdr",       label: "ᚢᚱ URÐR (HISTÓRICO)", desc: "A Norna do passado: mecânica, escolhe pelo líquido MEDIDO em vez da prioridade declarada. Terceiro braço do duelo. ZERO token." },
  { key: "pause_ullr",       label: "ᚢ ULLR (LANÇAMENTO)", desc: "Arqueiro de pool recém-nascido. Long-only, munição diária contada. ZERO token." },
  { key: "pause_paper",      label: "PAPER · GATE.IO",   desc: "Pausa o agente de simulação DA CASA. Zero token — pausar só congela o experimento (e a carteira de USDT para de encher). ⚠️ NÃO afeta os agentes contratados por clientes: esses são o `BANCADA` abaixo." },
  { key: "pause_bancada",    label: "BANCADA DO CLIENTE", desc: "⚠️ PARA OS AGENTES QUE OS CLIENTES CONTRATARAM E PAGAM. Zero token, e o que ele pausa é receita — cada instância deixa de ser avaliada e a tela do cliente passa a dizer que a casa pausou. Use só em incidente." },
  { key: "pause_dca",        label: "ᚦ DCA AUTOMÁTICO",  desc: "Para os planos de compra recorrente na corretora do CLIENTE — dinheiro REAL, não simulação. ZERO token: é relógio + ordem a mercado. Gate PRÓPRIO e rota de cron própria, separados do autopilot de propósito: um bug na IA não pode parar a poupança de ninguém." },
  { key: "pause_zion",       label: "⚡ ZION (USUÁRIO)",  desc: "Desliga o ZION do PRODUTO, não uma mesa. Era o maior gastador de token e o único sem gate. Último recurso: degrada o que o usuário vê. Cotação e swap seguem funcionando." },
];

// Um gate sem cartão aqui é uma mesa que só se desliga por deploy. O painel
// avisa em vez de esconder — silêncio foi exatamente como oracle/arbiter2
// passaram despercebidos.
const UNLISTED_GATES = FLYWHEEL_GATE_KEYS.filter((k) => !GATES.some((g) => g.key === k));

export default function AiControlsPanel() {
  // ⚠️ Nasce DESCONHECIDO: antes um `false` default + leitura falha = "19 gates ON" na tela (ADM-004).
  const [gates, setGates] = useState<Record<string, EstadoTri>>({});
  /** Valor gravado de cada gate — o compare-and-set do estado `invalido` precisa dele. */
  const [brutos, setBrutos] = useState<Record<string, string | null>>({});
  const [loading, setLoading]   = useState(true);
  const [mutating, setMutating] = useState<GateKey | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [ilegivel, setIlegivel] = useState<string | null>(null);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [breakersErro, setBreakersErro] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const { confirm, modal: confirmModal } = useAdminConfirm();

  async function load() {
    const l = await lerInterruptoresCliente();
    if (l.ok) {
      setGates(Object.fromEntries(Object.entries(l.estados).map(([k, v]) => [k, v.estado])));
      setBrutos(Object.fromEntries(Object.entries(l.estados).map(([k, v]) => [k, v.persistido])));
      setIlegivel(null);
    } else {
      setGates({}); setBrutos({});
      setIlegivel(l.porque);
    }
    setLoading(false);
    // Breakers: falha de leitura aparece como falha, não como "seção vazia" nem "tudo ok".
    try {
      const res  = await fetch("/admin/api/ai-circuit");
      const json = await res.json().catch(() => null);
      if (res.ok && json) { setBreakers(json.breakers ?? []); setBreakersErro(null); }
      else setBreakersErro(json?.porque ?? json?.error ?? `HTTP ${res.status}`);
    } catch (e) { setBreakersErro(String(e)); }
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
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setErr(`reset do breaker ${id} falhou: ${json?.porque ?? json?.error ?? res.status}`);
      }
    } catch (e) { setErr(`reset do breaker ${id} falhou: ${String(e)}`); }
    await load();
    setResetting(null);
  }

  async function toggle(key: GateKey) {
    const atual = gates[key];
    if (!gravavel(atual)) return;
    // Valor INVÁLIDO gravado = consumidor lê como "não pausado". A correção oferecida
    // é a direção PROTETORA (pausar), com confirmação e CAS sobre o valor bruto.
    const next = atual !== "on";             // on = pausado
    const m = MAPA_INTERRUPTORES[key];
    // Dinheiro/receita de cliente confirma nos DOIS sentidos; inválido confirma sempre.
    if (atual === "invalido") {
      const ok = await confirm(
        `${key} tem valor INVÁLIDO gravado (${JSON.stringify(brutos[key] ?? null)}) — para os consumidores isso é "rodando". `
        + `Gravar "true" (PAUSAR)? Bloqueia: ${m.bloqueia}.`,
        true,
      );
      if (!ok) return;
    } else if (m.dinheiro) {
      const ok = await confirm(
        `${next ? "PAUSAR" : "RELIGAR"} ${key} — mexe em dinheiro ou receita de cliente. Bloqueia: ${m.bloqueia}. `
        + "Fica registrado no log de auditoria; sem trilha, o comando é recusado.",
        true,
      );
      if (!ok) return;
    }
    setMutating(key); setErr(null);
    const r = await gravarInterruptor(key, next, atual === "invalido" ? { bruto: brutos[key] ?? null } : atual === "on");
    if (!r.ok) setErr(r.conflito ? "Outro admin mudou este gate — recarreguei o estado real." : r.porque);
    await load();
    setMutating(null);
  }

  const masterPaused = gates.pause_backtest === "on";

  return (
    <TerminalPanel id="ai-controls" title="AI CONTROLS" subtitle="liga/desliga agentes · torneio" icon="⏻" source="supabase/admin_kv">
      {loading && <div className="adm-shimmer" style={{ height: 100 }} />}
      {err  && <div style={{ color: "var(--adm-red)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {ilegivel && (
        <div role="alert" style={{ color: "var(--adm-amber)", fontSize: 12, marginBottom: 10 }}>
          ⚠ ESTADO DESCONHECIDO — não consegui ler os gates ({ilegivel}). Isto NÃO quer dizer que estão ligados;
          os botões ficam travados até uma leitura dar certo.
        </div>
      )}
      {UNLISTED_GATES.length > 0 && (
        <div style={{ color: "var(--adm-red)", fontSize: 12, marginBottom: 10 }}>
          ⚠ Gate sem cartão neste painel — só se desliga por deploy: {UNLISTED_GATES.join(", ")}
        </div>
      )}

      {!loading && GATES.map(({ key, label, desc, master }) => {
        const estado = gates[key];
        const paused = estado === "on";
        // Sub-gates are visually dimmed while the master pause is on (moot).
        const dimmed = !master && masterPaused;
        return (
          <div key={key} className="adm-stat" style={{ alignItems: "center", opacity: dimmed ? 0.45 : 1 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
                color: paused ? "var(--adm-red)" : master ? "var(--adm-gold)" : "var(--adm-green)",
              }}>
                {label}
              </div>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 2 }}>{desc}</div>
            </div>
            <button
              className={`adm-toggle ${paused ? "danger" : "active"}`}
              role="switch"
              aria-checked={conhecido(estado) ? !paused : "mixed"}
              aria-label={`${label}: ${conhecido(estado) ? (paused ? "pausado" : "rodando") : rotuloDoEstado(estado)}`}
              onClick={() => toggle(key)}
              disabled={mutating === key || !gravavel(estado)}
              title={paused ? "Clique para LIGAR" : "Clique para DESLIGAR"}
            >
              {mutating === key ? "…" : estado === "invalido" ? "INVÁLIDO — PAUSAR?" : !conhecido(estado) ? rotuloDoEstado(estado) : paused ? "OFF — LIGAR?" : "ON"}
            </button>
          </div>
        );
      })}

      {/* Circuit breakers — a provider that failed N straight calls is skipped
          for a cooldown. Show the state so the operator isn't blind to it, and
          allow a manual reset after fixing the key / topping up credits. */}
      {!loading && breakersErro && (
        <div role="alert" style={{ marginTop: 12, color: "var(--adm-amber)", fontSize: 12 }}>
          ⚠ CIRCUIT BREAKERS — estado DESCONHECIDO ({breakersErro}). Não quer dizer que estão fechados.
        </div>
      )}
      {!loading && !breakersErro && breakers.some((b) => b.configured) && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--adm-border)", paddingTop: 8 }}>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 6 }}>
            CIRCUIT BREAKERS · pula provedor com falhas seguidas
          </div>
          {breakers.filter((b) => b.configured).map((b) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 12 }}>
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
      {confirmModal}
    </TerminalPanel>
  );
}
