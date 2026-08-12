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
interface Piloto { wallet: string; nota: string; at: string }
interface Estado {
  liberado: boolean;
  causa:    "aberto" | "fechado_por_decisao" | "sem_registro" | "indisponivel";
  motivo:   string | null;
  desde:    string | null;
  minMotivo: number;
  verdes:   Verde[];
  pilotos:  Piloto[];
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
  const [novoPiloto, setNovoPiloto] = useState("");
  const [notaPiloto, setNotaPiloto] = useState("");

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

  const mexerPiloto = async (corpo: Record<string, string>) => {
    setBusy(true);
    try {
      const res = await fetch("/admin/api/autopilot-liberacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const b = await res.json() as { error?: string };
      if (!res.ok) { setErro(b.error ?? `HTTP ${res.status}`); return; }
      setNovoPiloto(""); setNotaPiloto("");
      await carregar();
    } finally { setBusy(false); }
  };

  return (
    <TerminalPanel
      id="autopilot-liberacao"
      title="LIBERAÇÃO DA AUTOMAÇÃO"
      subtitle="autopilot de CEX · aberto ao público?"
      icon="🔒"
      source="admin_kv/autopilot_cex_liberado"
      onRefresh={carregar}
    >
      {erro && <div style={{ color: "var(--adm-red)", fontSize: 12 }}>{erro}</div>}
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
            fontSize: 11, lineHeight: 1.6, marginBottom: 8,
            color: data.causa === "indisponivel" ? "var(--adm-red)" : "var(--adm-ink-4)",
          }}>
            {CAUSA_TEXTO[data.causa]}
            {data.desde && <> · desde {new Date(data.desde).toLocaleString("pt-BR")}</>}
            {data.motivo && <> — <i>&quot;{data.motivo}&quot;</i></>}
          </div>

          {/* ⚠️ A CONSEQUÊNCIA VEM ANTES DO BOTÃO, não depois. */}
          <div style={{
            border: "1px solid var(--adm-amber)", borderRadius: 3, padding: "5px 7px",
            margin: "7px 0", fontSize: 11, color: "var(--adm-amber)", lineHeight: 1.6,
          }}>
            ⚠️ Abrir liga os <b>dois canais</b> de automação: o piloto do navegador e o
            worker do servidor, que compra sozinho com a chave do cliente e o navegador
            fechado. Fechado, o cliente não consegue armar, o cron pula e cada sessão
            armada recebe uma linha de <code>skipped</code> com o motivo.
          </div>

          {/* A evidência, ao lado do interruptor. */}
          <div style={{ fontSize: 11, color: "var(--adm-ink-3)", lineHeight: 1.6, marginBottom: 6 }}>
            <b>Verdes do laboratório ({data.verdes.length}):</b>{" "}
            {data.verdes.length === 0
              ? <span style={{ color: "var(--adm-ink-4)" }}>nenhuma — não há o que justificar abrir</span>
              : data.verdes.map((v) => `${v.name} (${v.family}, $${v.capitalUsd})`).join(" · ")}
            <div style={{ color: "var(--adm-ink-4)", fontSize: 10, marginTop: 3 }}>
              ⚠️ A lista NÃO distingue estratégia de corretora de estratégia on-chain —
              <code> lab_strategies.family</code> é carrego/direcional/estrutura, não venue.
              Automação por API de CEX só alcança as de corretora; conferir na leitura.
            </div>
          </div>

          {!data.liberado ? (
            <>
              <label style={{ display: "block", fontSize: 11, color: "var(--adm-ink-4)" }}>
                justificativa (obrigatória, mínimo {min} caracteres — daqui a um mês a
                pergunta vai ser &quot;o que justificava isto?&quot;)
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="ex.: cesta de funding medida a +3,0%/ano, 42 produtos, custo líquido"
                  style={{
                    display: "block", width: "100%", marginTop: 3, padding: "4px 6px",
                    background: "transparent", border: "1px solid var(--adm-border)",
                    borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 12, fontFamily: "inherit",
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
                  borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 12, fontFamily: "inherit",
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
          {/* ─── PILOTOS: quem roda com a automação fechada ─────────────── */}
          <div style={{ marginTop: 12, borderTop: "1px solid var(--adm-border)", paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)", marginBottom: 4 }}>
              <b>CARTEIRAS PILOTO ({data.pilotos.length})</b> — rodam a automação mesmo
              fechada, para teste com dinheiro real
            </div>
            {/* ⚠️ A CONSEQUÊNCIA VEM ANTES DA LISTA. */}
            <div style={{
              border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
              margin: "5px 0", fontSize: 11, color: "var(--adm-red)", lineHeight: 1.6,
            }}>
              ⚠️ Isto é um <b>furo deliberado na trava</b>: a carteira listada negocia com
              DINHEIRO REAL numa feature fechada para todo o resto. Um grant de admin
              <b> não</b> entra aqui — quem recebeu admin para olhar métricas não vira
              autorizado a rodar o robô por consequência. A carteira do
              <code> ADMIN_WALLETS</code> (ambiente, exige redeploy) já é piloto e não
              precisa ser listada.
            </div>
            {data.pilotos.length === 0 && (
              <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 5 }}>
                nenhuma carteira autorizada além do <code>ADMIN_WALLETS</code>
              </div>
            )}
            {data.pilotos.map((p) => (
              <div key={p.wallet} style={{
                display: "flex", alignItems: "baseline", gap: 6, fontSize: 11,
                color: "var(--adm-ink-3)", marginBottom: 3,
              }}>
                <code style={{ color: "var(--adm-ink-2)" }}>{p.wallet.slice(0, 10)}…{p.wallet.slice(-6)}</code>
                <i style={{ color: "var(--adm-ink-4)", flex: 1 }}>&quot;{p.nota}&quot;</i>
                <button
                  className="adm-btn" style={{ fontSize: 11, padding: "1px 5px" }}
                  disabled={busy}
                  onClick={() => void mexerPiloto({ remover: p.wallet })}
                >revogar</button>
              </div>
            ))}
            <input
              value={novoPiloto}
              onChange={(e) => setNovoPiloto(e.target.value)}
              placeholder="0x… carteira a autorizar"
              style={{
                display: "block", width: "100%", marginTop: 5, padding: "4px 6px",
                background: "transparent", border: "1px solid var(--adm-border)",
                borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 12, fontFamily: "inherit",
              }}
            />
            <input
              value={notaPiloto}
              onChange={(e) => setNotaPiloto(e.target.value)}
              placeholder={`por que esta carteira (mínimo ${min} caracteres)`}
              style={{
                display: "block", width: "100%", marginTop: 3, padding: "4px 6px",
                background: "transparent", border: "1px solid var(--adm-border)",
                borderRadius: 3, color: "var(--adm-ink-2)", fontSize: 12, fontFamily: "inherit",
              }}
            />
            <button
              className="adm-btn" style={{ marginTop: 5 }}
              disabled={busy || novoPiloto.trim().length < 8 || notaPiloto.trim().length < min}
              onClick={() => void mexerPiloto({ piloto: novoPiloto, motivo: notaPiloto })}
            >
              {notaPiloto.trim().length < min
                ? `⚑ escreva a nota (${notaPiloto.trim().length}/${min})`
                : "⚑ AUTORIZAR carteira piloto"}
            </button>
          </div>
        </>
      )}
    </TerminalPanel>
  );
}
