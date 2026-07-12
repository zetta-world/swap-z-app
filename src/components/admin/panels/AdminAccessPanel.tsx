"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAdminConfirm } from "../useAdminConfirm";

type Admin = {
  wallet: string;
  source: "env" | "panel" | "legacy";
  revocable: boolean;
  grantedBy?: string | null;
  grantedAt?: string | null;
  note?: string | null;
};

const SRC_COLOR: Record<Admin["source"], string> = {
  env:    "var(--adm-ink-3)",
  panel:  "var(--adm-cyan)",
  legacy: "var(--adm-gold)",
};
const SRC_LABEL: Record<Admin["source"], string> = {
  env: "ENV (fixo)", panel: "concedido", legacy: "legado",
};

/**
 * ADMIN ACCESS — grant/revoke who can open this panel, decoupled from tiers.
 * env admins are read-only (baked into the deployment); panel/legacy grants are
 * revocable. Guards on the server: no self-revoke, no last-admin-lockout.
 */
export default function AdminAccessPanel() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [wallet, setWallet] = useState("");
  const [note,   setNote]   = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, modal } = useAdminConfirm();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/admins");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setAdmins(json.admins ?? []); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function grant() {
    const w = wallet.trim();
    if (!w) return;
    if (!(await confirm(`Conceder acesso ADMIN à carteira ${w}? Ela poderá abrir todo o painel.`, false))) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/admin/api/admins", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: w, action: "grant", note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setMsg(`✓ admin concedido a ${w.slice(0, 10)}…`); setWallet(""); setNote("");
      await load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  async function revoke(w: string) {
    if (!(await confirm(`REVOGAR o acesso admin de ${w}? Ela perde o painel imediatamente.`, true))) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch("/admin/api/admins", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: w, action: "revoke" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setMsg(`✓ admin revogado de ${w.slice(0, 10)}…`);
      await load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  }

  return (
    <TerminalPanel id="admin-access" title="ADMIN ACCESS" subtitle="conceder · revogar acesso ao painel" icon="🛡" source="supabase/platform_admins">
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
        <input className="adm-input" placeholder="wallet address a conceder…" value={wallet}
          onChange={(e) => setWallet(e.target.value)} spellCheck={false} />
        <div style={{ display: "flex", gap: 6 }}>
          <input className="adm-input" placeholder="nota (opcional: 'sócio', 'ops'…)" value={note}
            onChange={(e) => setNote(e.target.value)} spellCheck={false} style={{ flex: 1 }} />
          <button className="adm-toggle" onClick={grant} disabled={busy || !wallet.trim()} style={{ flexShrink: 0, color: "var(--adm-cyan)" }}>
            CONCEDER
          </button>
        </div>
      </div>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginBottom: 8 }}>{err}</div>}
      {msg && <div style={{ color: "var(--adm-green)", fontSize: 10, marginBottom: 8 }}>{msg}</div>}

      <table className="adm-table">
        <thead><tr><th>CARTEIRA</th><th>ORIGEM</th><th></th></tr></thead>
        <tbody>
          {admins.length === 0 && <tr><td colSpan={3} style={{ color: "var(--adm-ink-3)" }}>—</td></tr>}
          {admins.map((a) => (
            <tr key={a.wallet}>
              <td style={{ fontFamily: "monospace", fontSize: 9, color: "var(--adm-ink)", wordBreak: "break-all" }}
                  title={a.note ?? undefined}>
                {a.wallet.slice(0, 14)}…{a.wallet.slice(-6)}
                {a.note && <span style={{ color: "var(--adm-ink-4)" }}> · {a.note}</span>}
              </td>
              <td style={{ color: SRC_COLOR[a.source], fontSize: 9 }}>{SRC_LABEL[a.source]}</td>
              <td style={{ textAlign: "right" }}>
                {a.revocable
                  ? <button className="adm-toggle danger" onClick={() => revoke(a.wallet)} disabled={busy} style={{ padding: "2px 8px", fontSize: 9 }}>REVOGAR</button>
                  : <span style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>🔒</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 6 }}>
        🔒 admins de ENV são fixos no deploy (edite ADMIN_WALLETS no Vercel). Você não pode revogar a si mesmo nem o último admin.
      </div>
      {modal}
    </TerminalPanel>
  );
}
