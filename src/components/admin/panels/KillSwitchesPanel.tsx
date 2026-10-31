"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminConfirm } from "../useAdminConfirm";
import { MAPA_INTERRUPTORES, PLATFORM_KILL_KEYS, type PlatformKillKey } from "@/lib/admin/gate-keys";
import {
  conhecido, gravavel, gravarInterruptor, lerInterruptoresCliente, rotuloDoEstado, type EstadoTri,
} from "../interruptores-cliente";

const ROTULO: Record<PlatformKillKey, string> = {
  disable_swap: "SWAP", disable_cex: "CEX", maintenance_mode: "MAINTENANCE",
};

/**
 * ⚠️ O TEXTO DIZ O QUE A CHAVE FAZ DE VERDADE (`MAPA_INTERRUPTORES`, conferido
 * por teste contra os consumidores). Antes: "Show maintenance page to all users"
 * — e nada no middleware lia `maintenance_mode`.
 */
export default function KillSwitchesPanel() {
  const [estados, setEstados] = useState<Record<string, EstadoTri>>({});
  /** Valor gravado — o compare-and-set do estado `invalido` precisa dele. */
  const [brutos, setBrutos] = useState<Record<string, string | null>>({});
  const [loading,  setLoading]  = useState(true);
  const [mutating, setMutating] = useState<PlatformKillKey | null>(null);
  const [err,      setErr]      = useState<string | null>(null);
  const [ilegivel, setIlegivel] = useState<string | null>(null);
  const { confirm, modal: confirmModal } = useAdminConfirm();

  async function load() {
    const l = await lerInterruptoresCliente();
    if (l.ok) {
      setEstados(Object.fromEntries(Object.entries(l.estados).map(([k, v]) => [k, v.estado])));
      setBrutos(Object.fromEntries(Object.entries(l.estados).map(([k, v]) => [k, v.persistido])));
      setIlegivel(null);
    } else {
      setEstados({}); setBrutos({});  // nada lido = nada sabido: botões travados
      setIlegivel(l.porque);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: PlatformKillKey) {
    const atual = estados[key];
    if (!gravavel(atual)) return;
    // ⚠️ Valor INVÁLIDO gravado (ex.: "TRUE"): os consumidores comparam `=== "true"`,
    // então o kill switch NÃO está bloqueando. A correção oferecida é LIGAR (proteger).
    const next = atual !== "on";
    const m = MAPA_INTERRUPTORES[key];
    const ok = await confirm(
      (atual === "invalido"
        ? `${ROTULO[key]} tem valor INVÁLIDO gravado (${JSON.stringify(brutos[key] ?? null)}) — hoje ele NÃO bloqueia nada. Gravar "true" (LIGAR)? `
        : `${next ? "LIGAR" : "DESLIGAR"} ${ROTULO[key]} — `)
      + `bloqueia: ${m.bloqueia}. Não bloqueia: ${m.naoBloqueia}. `
      + "Fica registrado no log de auditoria; sem trilha, o comando é recusado.",
      true,
    );
    if (!ok) return;
    setMutating(key);
    setErr(null);
    const r = await gravarInterruptor(key, next, atual === "invalido" ? { bruto: brutos[key] ?? null } : atual === "on");
    if (!r.ok) setErr(r.conflito ? "Outro admin mudou este interruptor — recarreguei o estado real." : r.porque);
    await load();                // a tela mostra o que o banco tem, não o que o clique supôs
    setMutating(null);
  }

  return (
    <TerminalPanel
      id="kill-switches"
      title="KILL SWITCHES"
      subtitle="swap · cex · maintenance"
      icon="⊝"
      source="supabase/admin_kv"
    >
      {loading && <div className="adm-shimmer" style={{ height: 80 }} />}
      {err && <div role="alert" style={{ color: "var(--adm-red)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {ilegivel && (
        <div role="alert" style={{ color: "var(--adm-amber)", fontSize: 12, marginBottom: 10 }}>
          ⚠ ESTADO DESCONHECIDO — não consegui ler os interruptores ({ilegivel}). Isto NÃO quer dizer que estão
          desligados; os botões ficam travados até uma leitura dar certo.
          <button className="adm-toggle" style={{ marginLeft: 8 }} onClick={() => { setLoading(true); load(); }}>recarregar</button>
        </div>
      )}
      {!loading && PLATFORM_KILL_KEYS.map((key) => {
        const estado = estados[key];
        const isOn = estado === "on";
        const m = MAPA_INTERRUPTORES[key];
        return (
          <div key={key} className="adm-stat" style={{ alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: isOn ? "var(--adm-red)" : conhecido(estado) ? "var(--adm-ink-3)" : "var(--adm-amber)",
              }}>
                {ROTULO[key]}
              </div>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 2 }}>bloqueia: {m.bloqueia}</div>
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 2 }}>não bloqueia: {m.naoBloqueia}</div>
            </div>
            <button
              className={`adm-toggle ${isOn ? "danger" : "active"}`}
              role="switch"
              aria-checked={conhecido(estado) ? isOn : "mixed"}
              aria-label={`${ROTULO[key]}: ${rotuloDoEstado(estado)}`}
              onClick={() => toggle(key)}
              disabled={mutating === key || !gravavel(estado)}
            >
              {mutating === key ? "…" : isOn ? "ON — DESLIGAR?" : estado === "invalido" ? "INVÁLIDO — LIGAR?" : rotuloDoEstado(estado)}
            </button>
          </div>
        );
      })}
      {confirmModal}
    </TerminalPanel>
  );
}
