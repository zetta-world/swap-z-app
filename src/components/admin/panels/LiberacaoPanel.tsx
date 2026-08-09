"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * O INTERRUPTOR DA AUTOMAÇÃO DE CEX — Fase 7.2.
 *
 * ⚠️ Por que este painel existe separado do KILL-SWITCHES: lá o default é
 * "ausência = ligado" (certo para as mesas internas); aqui é o inverso, porque
 * ausência de registro não é autorização. Dois defaults opostos na mesma tela
 * seriam um convite a copiar o errado.
 *
 * ⚠️ E a EVIDÊNCIA fica ao lado do botão. Um interruptor sozinho depende da
 * memória de quem aperta.
 */

interface Verde { name: string; family: string; capitalUsd: number }
interface Estado {
  liberado: boolean;
  causa:    "aberto" | "fechado_por_decisao" | "sem_registro" | "indisponivel";
  motivo:   string | null;
  desde:    string | null;
  minMotivo: number;
  verdes:   Verde[];
}

const CAUSA_TEXTO: Record<Estado["causa"], string> = {
  aberto:              "aberta ao público",
  fechado_por_decisao: "fechada por decisão registrada",
  sem_registro:        "fechada — nunca foi liberada (sem registro no banco)",
  indisponivel:        "fechada — NÃO consegui ler o banco (isto é infraestrutura, não decisão)",
};

export default function LiberacaoPanel() {
  const [data,   setData]   = useState<Estado | null>(null);
  const [erro,   setErro]   = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [busy,   setBusy]   = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/autopilot-liberacao");
      if (!res.ok) { setErro(`HTTP ${res.status}`); return; }
      setData(await res.json() as Estado);
      setErro(null);
    } catch (e) { setErro(String(e).slice(0, 120)); }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const alternar = useCallback(async (liberar: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/admin/api/autopilot-liberacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liberar, motivo }),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) { setErro(body.error ?? `HTTP ${res.status}`); return; }
      setMotivo("");
      await carregar();
    } finally { setBusy(false); }
  }, [motivo, carregar]);

  const min = data?.minMotivo ?? 15;
  const curto = motivo.trim().length < min;

  return (
    <TerminalPanel
      id="autopilot-liberacao"
      title="LIBERAÇÃO DA AUTOMAÇÃO"
      subtitle="autopilot de CEX · aberto ao público?"
      icon="🔒"
      source="admin_kv/autopilot_cex_liberado"
      onRefresh={carregar}
    >
      {erro && <div style={{ color: "var(--adm-red)", fontSize: 9 }}>{erro}</div>}
      {!data && !erro && <div className="adm-shimmer" style={{ height: 60 }} />}

      {data && (
        <>
          <div className="adm-stat">
            <span className="adm-stat-label">ESTADO</span>
            <span className={`adm-stat-value ${data.liberado ? "green" : ""}`}>
              {data.liberado ? "ABERTA" : "FECHADA"}
            </span>
          </div>
          <div style={{
            fontSize: 8.5, lineHeight: 1.6, marginBottom: 8,
            color: data.causa === "indisponivel" ? "var(--adm-red)" : "var(--adm-ink-4)",
          }}>
            {CAUSA_TEXTO[data.causa]}
            {data.desde && <> · desde {new Date(data.desde).toLocaleString("pt-BR")}</>}
            {data.motivo && <> — <i>&quot;{data.motivo}&quot;</i></>}
          </div>

          {/* ⚠️ A CONSEQUÊNCIA VEM ANTES DO BOTÃO, não depois. */}
          <div style={{
            border: "1px solid var(--adm-amber)", borderRadius: 3, padding: "5px 7px",
            margin: "7px 0", fontSize: 8, color: "var(--adm-amber)", lineHeight: 1.6,
          }}>
            ⚠️ Abrir liga os <b>dois canais</b> de automação: o piloto do navegador e o
            worker do servidor, que compra sozinho com a chave do cliente e o navegador
            fechado. Fechado, o cliente não consegue armar, o cron pula e cada sessão
            armada recebe uma linha de <code>skipped</code> com o motivo.
          </div>

          {/* A evidência, ao lado do interruptor. */}
          <div style={{ fontSize: 8.5, color: "var(--adm-ink-3)", lineHeight: 1.6, marginBottom: 6 }}>
            <b>Verdes do laboratório ({data.verdes.length}):</b>{" "}
            {data.verdes.length === 0
              ? <span style={{ color: "var(--adm-ink-4)" }}>nenhuma — não há o que justificar abrir</span>
              : data.verdes.map((v) => `${v.name} (${v.family}, $${v.capitalUsd})`).join(" · ")}
            <div style={{ color: "var(--adm-ink-4)", fontSize: 7.5, marginTop: 3 }}>
              ⚠️ A lista NÃO distingue estratégia de corretora de estratégia on-chain —
              <code> lab_strategies.family</code> é carrego/direcional/estrutura, não venue.
              Automação por API de CEX só alcança as de corretora; conferir na leitura.
            </div>
          </div>

          {!data.liberado ? (
            <>
              <label style={{ display: "block", fontSize: 8, color: "var(--adm-ink-4)" }}>
                justificativa (obrigatória, mínimo {min} caracteres — daqui a um mês a
                pergunta vai ser &quot;o que justificava isto?&quot;)
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="ex.: cesta de funding medida a +3,0%/ano, 42 produtos, custo líquido"
                  style={{
                    display: "block", width: "100%", marginTop: 3, padding: "4px 6px",
                    background: "transparent", border: "1px solid var(--adm-border)",
                    borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 9, fontFamily: "inherit",
                  }}
                />
              </label>
              <button
                className="adm-btn" style={{ marginTop: 6 }}
                disabled={busy || curto}
                onClick={() => void alternar(true)}
              >
                {busy ? "abrindo…"
                  : curto ? `🔓 escreva a justificativa (${motivo.trim().length}/${min})`
                  : "🔓 ABRIR a automação ao público"}
              </button>
            </>
          ) : (
            <>
              {/* ⚠️ Fechar NÃO exige justificativa: atrito na direção segura seria
                  atrito no lugar errado, exatamente quando se quer desligar rápido. */}
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="motivo do fechamento (opcional)"
                style={{
                  display: "block", width: "100%", marginTop: 3, padding: "4px 6px",
                  background: "transparent", border: "1px solid var(--adm-border)",
                  borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 9, fontFamily: "inherit",
                }}
              />
              <button
                className="adm-btn" style={{ marginTop: 6, borderColor: "var(--adm-red)", color: "var(--adm-red)" }}
                disabled={busy}
                onClick={() => void alternar(false)}
              >
                {busy ? "fechando…" : "🔒 FECHAR a automação"}
              </button>
            </>
          )}
        </>
      )}
    </TerminalPanel>
  );
}
