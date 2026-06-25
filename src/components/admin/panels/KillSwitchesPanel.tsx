"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminConfirm } from "../useAdminConfirm";

type SwitchKey = "disable_swap" | "disable_cex" | "maintenance_mode";

const SWITCHES: { key: SwitchKey; label: string; desc: string }[] = [
  { key: "disable_swap",     label: "SWAP",        desc: "Disable all swap execution" },
  { key: "disable_cex",      label: "CEX",         desc: "Disable CEX autopilot & trading" },
  { key: "maintenance_mode", label: "MAINTENANCE",  desc: "Show maintenance page to all users" },
];

export default function KillSwitchesPanel() {
  const [switches, setSwitches] = useState<Record<SwitchKey, boolean>>({
    disable_swap:     false,
    disable_cex:      false,
    maintenance_mode: false,
  });
  const [loading,  setLoading]  = useState(true);
  const [mutating, setMutating] = useState<SwitchKey | null>(null);
  const [err,      setErr]      = useState<string | null>(null);
  const [note,     setNote]     = useState<string | null>(null);
  const { confirm, modal: confirmModal } = useAdminConfirm();

  async function load() {
    try {
      const res  = await fetch("/admin/api/killswitch");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setSwitches(json.switches);
      if (json.note) setNote(json.note);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(key: SwitchKey) {
    const next = !switches[key];
    // Confirm only when ENABLING a kill-switch (the destructive direction).
    if (next) {
      const label = SWITCHES.find((s) => s.key === key)?.desc ?? key;
      const ok = await confirm(
        `Enable kill-switch: ${label}. This affects all users platform-wide and is recorded in the audit log.`,
        true,
      );
      if (!ok) return;
    }
    setMutating(key);
    setErr(null);
    try {
      const res = await fetch("/admin/api/killswitch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, enabled: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setSwitches((prev) => ({ ...prev, [key]: next }));
    } catch (e) {
      setErr(String(e));
    } finally {
      setMutating(null);
    }
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
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginBottom: 8 }}>{err}</div>}
      {note && (
        <div style={{ color: "var(--adm-amber)", fontSize: 9, marginBottom: 10 }}>
          ⚠ {note}
        </div>
      )}
      {!loading && SWITCHES.map(({ key, label, desc }) => {
        const isOn = switches[key];
        return (
          <div key={key} className="adm-stat" style={{ alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: isOn ? "var(--adm-red)" : "var(--adm-ink-3)",
              }}>
                {label}
              </div>
              <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 2 }}>{desc}</div>
            </div>
            <button
              className={`adm-toggle ${isOn ? "danger" : "active"}`}
              onClick={() => toggle(key)}
              disabled={mutating === key}
            >
              {mutating === key ? "…" : isOn ? "ON — DISABLE?" : "OFF"}
            </button>
          </div>
        );
      })}
      {confirmModal}
    </TerminalPanel>
  );
}
