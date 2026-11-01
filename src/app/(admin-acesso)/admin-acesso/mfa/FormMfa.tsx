"use client";

import { useState } from "react";
import { botao, campo } from "../estilo";

/**
 * MFA do login corporativo (design §4.3). 1º acesso: código de ativação (fora de banda) → QR do TOTP →
 * 1º código. Seguintes: só o código. Os tokens do Supabase nunca passam por aqui.
 */
export default function FormMfa({ volta }: { volta: string }) {
  const [ativacao, setAtivacao] = useState("");
  const [codigo, setCodigo] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const post = async (corpo: Record<string, string>) => {
    setOcupado(true); setMsg(null);
    try {
      const r = await fetch("/api/admin-auth/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });
      return { status: r.status, json: await r.json().catch(() => null) as Record<string, unknown> | null };
    } finally { setOcupado(false); }
  };
  const iniciar = async () => {
    const r = await post({ etapa: "iniciar", ativacao });
    if (r.status !== 200) { setMsg("Código de ativação inválido ou expirado."); return; }
    if (r.json?.precisaAtivacao && typeof r.json.qrSvg === "string") setQr(r.json.qrSvg);
  };
  const verificar = async () => {
    const r = await post({ etapa: "verificar", codigo });
    if (r.status === 200) { window.location.assign(volta); return; }
    setMsg(r.status === 423 ? "Muitas tentativas. Tente de novo em 15 minutos." : "Código inválido.");
  };

  return (
    <div>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Verificação em duas etapas</h1>
      <label style={{ display: "block", fontSize: 12, marginTop: 8 }}>
        Código de ativação (só no primeiro acesso)
        <input style={campo} value={ativacao} onChange={(e) => setAtivacao(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" style={botao} disabled={ocupado || !ativacao} onClick={iniciar}>Ativar e mostrar o QR</button>
      {qr && (
        <div style={{ marginTop: 12, background: "#fff", padding: 8, borderRadius: 8 }}>
          <img src={qr} alt="QR para cadastrar o autenticador" style={{ width: "100%", height: "auto" }} />
        </div>
      )}
      <label style={{ display: "block", fontSize: 12, marginTop: 16 }}>
        Código de 6 dígitos do autenticador
        <input style={campo} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
      </label>
      <button type="button" style={botao} disabled={ocupado || codigo.length !== 6} onClick={verificar}>Entrar</button>
      {msg && <p role="alert" style={{ color: "#ff8080" }}>{msg}</p>}
    </div>
  );
}
