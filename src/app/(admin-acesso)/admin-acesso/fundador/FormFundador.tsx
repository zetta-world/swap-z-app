"use client";

import { useState } from "react";
import { botao, campo } from "../estilo";

type Acao = "bootstrap" | "recuperar_mfa" | "transicionar_multi";

/** Só envia o pedido; a decisão é do servidor. A autorização `zfb_…` nunca é guardada no navegador. */
export default function FormFundador() {
  const [autorizacao, setAutorizacao] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [codigoAtivacao, setCodigoAtivacao] = useState<string | null>(null);

  const enviar = async (acao: Acao) => {
    setMsg(null);
    setCodigoAtivacao(null);
    const corpo = acao === "transicionar_multi" ? { acao } : { acao, autorizacao: autorizacao.trim() };
    const r = await fetch("/api/admin-auth/fundador", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
    });
    setAutorizacao("");
    const j = await r.json().catch(() => null) as { ok?: boolean; codigoAtivacao?: string } | null;
    if (!r.ok || !j?.ok) {
      setMsg(r.status === 429 ? "Muitas tentativas. Aguarde um minuto." : "Pedido recusado. O motivo foi registrado na auditoria.");
      return;
    }
    if (acao === "recuperar_mfa" && j.codigoAtivacao) { setCodigoAtivacao(j.codigoAtivacao); return; }
    setMsg(acao === "bootstrap" ? "Feito: você é o superadmin fundador. Isto não se repete." : "Feito: governança multi_admin.");
  };

  const valida = /^zfb_[A-Za-z0-9_-]{43}$/.test(autorizacao.trim());
  return (
    <div>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Governança do Admin</h1>
      <p style={{ fontSize: 12, opacity: 0.8 }}>
        Bootstrap do fundador: entre pelo IdP, confirme o código do autenticador em{" "}
        <a href="/admin-acesso/step-up?volta=/admin-acesso/fundador" style={{ color: "inherit" }}>/admin-acesso/step-up</a>{" "}
        (vale 5 min) e cole a autorização de uso único gerada offline.
      </p>
      <label style={{ display: "block", fontSize: 12 }}>
        Autorização de uso único (zfb_…)
        <input style={campo} autoComplete="off" spellCheck={false} value={autorizacao}
          onChange={(e) => setAutorizacao(e.target.value)} />
      </label>
      <button type="button" style={botao} disabled={!valida} onClick={() => enviar("bootstrap")}>Bootstrap do fundador</button>
      <button type="button" style={botao} disabled={!valida} onClick={() => enviar("recuperar_mfa")}>
        Recuperar MFA (carteira de ADMIN_WALLETS conectada)
      </button>
      <button type="button" style={botao} onClick={() => enviar("transicionar_multi")}>Transicionar para multi_admin</button>
      {codigoAtivacao && (
        <p role="status" style={{ wordBreak: "break-all" }}>
          Novo código de ativação (aparece só agora, vale 72 h): <strong>{codigoAtivacao}</strong>
        </p>
      )}
      {msg && <p role="alert" style={{ color: msg.startsWith("Feito") ? "#80ffb0" : "#ff8080" }}>{msg}</p>}
    </div>
  );
}
