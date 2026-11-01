"use client";

import { useState } from "react";
import { botao, campo } from "../estilo";

export default function FormStepUp({ volta }: { volta: string }) {
  const [codigo, setCodigo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const enviar = async () => {
    setMsg(null);
    const r = await fetch("/api/admin-auth/step-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo }) });
    if (r.ok) { window.location.assign(volta); return; }
    const j = await r.json().catch(() => null) as { erro?: string } | null;
    setMsg(j?.erro === "login_necessario" ? "Sessão do provedor expirou: entre de novo em /admin-acesso." : "Código inválido.");
  };
  return (
    <div>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Confirmar identidade</h1>
      <p style={{ fontSize: 12, opacity: 0.8 }}>Ações sensíveis exigem o código do autenticador dos últimos 5 minutos.</p>
      <label style={{ display: "block", fontSize: 12 }}>
        Código de 6 dígitos
        <input style={campo} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ""))} />
      </label>
      <button type="button" style={botao} disabled={codigo.length !== 6} onClick={enviar}>Confirmar</button>
      {msg && <p role="alert" style={{ color: "#ff8080" }}>{msg}</p>}
    </div>
  );
}
