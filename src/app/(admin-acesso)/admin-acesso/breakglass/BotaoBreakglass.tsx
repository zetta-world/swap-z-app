"use client";

import { useState } from "react";
import { botao } from "../estilo";

export default function BotaoBreakglass() {
  const [msg, setMsg] = useState<string | null>(null);
  const entrar = async () => {
    const r = await fetch("/api/admin-auth/breakglass", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    if (r.ok) { window.location.assign("/admin"); return; }
    setMsg("Não autorizado: entre antes com a carteira de ADMIN_WALLETS (login normal) e confira a janela.");
  };
  return (
    <div>
      <h1 style={{ fontSize: 16, margin: "0 0 8px", color: "#ff8080" }}>Acesso de emergência</h1>
      <p style={{ fontSize: 12 }}>Uso registrado e alertado. Permite só recuperar acesso e travar incidente; nada financeiro.</p>
      <button type="button" style={botao} onClick={entrar}>Entrar em modo de emergência</button>
      {msg && <p role="alert" style={{ color: "#ff8080" }}>{msg}</p>}
    </div>
  );
}
