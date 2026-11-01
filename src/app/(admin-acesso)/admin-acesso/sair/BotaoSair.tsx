"use client";

import { useState } from "react";
import { botao } from "../estilo";

export default function BotaoSair() {
  const [estado, setEstado] = useState<"pronto" | "saiu" | "falhou">("pronto");
  const sair = async () => {
    const r = await fetch("/api/admin-auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    setEstado(r.ok ? "saiu" : "falhou");
  };
  return (
    <div>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Encerrar sessão administrativa</h1>
      <button type="button" style={botao} onClick={sair} disabled={estado === "saiu"}>Sair agora</button>
      {estado === "saiu" && <p role="status">Sessão encerrada neste navegador.</p>}
      {estado === "falhou" && <p role="alert" style={{ color: "#ff8080" }}>Não consegui confirmar a revogação no banco — os cookies foram apagados; confira as sessões no painel.</p>}
    </div>
  );
}
