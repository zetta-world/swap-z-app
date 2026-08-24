"use client";

import { useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { estadoDa, faz, type Mensagem } from "@/lib/einherjar/mensagem";

/**
 * EINHERJAR — o salão onde os agentes se reportam.
 * (`docs/PLANO-EINHERJAR.md`)
 *
 * ⚠️⚠️ ESTA TELA NÃO É UM CHAT, E DIZ ISSO.
 *
 * Uma página web não injeta mensagem numa sessão do Claude Code rodando na
 * máquina do dono — não existe canal de entrada. Uma caixa que PARECE chat
 * criaria a expectativa de resposta em segundos, e o dono ficaria olhando para
 * uma tela esperando alguém que nem sabe que foi chamado.
 *
 * Por isso cada mensagem carrega "há X · AINDA NÃO LIDO" em vez de um balãozinho:
 * o estado de leitura É a informação. É a mesma disciplina das auditorias de
 * 23/08 — a interface não afirma o que o sistema não faz.
 */

type Evento = { tipo: string; quando: string; resumo: string | null; fonte: string | null };
type Resp = {
  linha: Evento[]; truncado: boolean; mensagens: Mensagem[];
  interlocutores: string[]; naoMostra: string[]; fetchedAt: string;
};

const COR_ESTADO = {
  nao_lida:          "var(--adm-amber)",
  lida_sem_resposta: "var(--adm-cyan)",
  respondida:        "var(--adm-green)",
} as const;

const ROTULO_ESTADO = {
  nao_lida:          "AINDA NÃO LIDO",
  lida_sem_resposta: "lido · sem resposta",
  respondida:        "respondido",
} as const;

export default function EinherjarPanel() {
  const [d, setD] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [para, setPara] = useState("nuvem");
  const [assunto, setAssunto] = useState("");
  const [corpo, setCorpo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  const carregar = async () => {
    setCarregando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/einherjar");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setAgora(Date.now());
    } catch (e) { setErr(String(e)); } finally { setCarregando(false); }
  };

  useEffect(() => { void carregar(); }, []);

  const enviar = async () => {
    if (!assunto.trim() || !corpo.trim()) return;
    setEnviando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/einherjar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ para, assunto, corpo }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detalhe ?? json.error ?? res.status);
      setAssunto(""); setCorpo("");
      await carregar();
    } catch (e) { setErr(String(e)); } finally { setEnviando(false); }
  };

  return (
    <TerminalPanel
      id="einherjar" title="EINHERJAR" icon="ᛝ"
      subtitle="o salão dos escolhidos — o que fizeram, e o que você quer perguntar"
      source="platform_events + einherjar_mensagens"
    >
      {/* ⚠️ A primeira coisa que a tela diz é o que ela NÃO faz. */}
      <div style={{ fontSize: 11, color: "var(--adm-amber)", lineHeight: 1.6, marginBottom: 10,
                    border: "1px solid rgba(245,166,35,0.25)", background: "rgba(245,166,35,0.05)",
                    borderRadius: 4, padding: "6px 9px" }}>
        ⚠ <b>Isto não é chat.</b> Uma página web não consegue interromper um agente
        que está trabalhando. Você deixa a pergunta aqui e ele responde{" "}
        <b>quando voltar a trabalhar</b> — minutos ou horas. O estado de cada
        mensagem mostra se ele já viu.
      </div>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 11, marginBottom: 8 }}>{err}</div>}

      {/* ── A CAIXA ────────────────────────────────────────────────── */}
      <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 4 }}>
        PERGUNTAR
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        {(d?.interlocutores ?? ["nuvem", "vscode", "todos"]).filter((i) => i !== "dono").map((i) => (
          <button key={i} type="button" onClick={() => setPara(i)}
            style={{ fontSize: 11, padding: "3px 9px", borderRadius: 3, cursor: "pointer",
              color: para === i ? "var(--adm-cyan)" : "var(--adm-ink-3)",
              background: para === i ? "rgba(0 229 255 / 0.10)" : "transparent",
              border: `1px solid ${para === i ? "rgba(0 229 255 / 0.35)" : "var(--adm-border)"}` }}>
            {i}
          </button>
        ))}
      </div>
      <input value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="assunto"
        style={{ width: "100%", fontSize: 12, fontFamily: "monospace", padding: "5px 8px", marginBottom: 4,
          background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 3, color: "var(--adm-ink)" }} />
      <textarea value={corpo} onChange={(e) => setCorpo(e.target.value)} rows={3} placeholder="a pergunta"
        style={{ width: "100%", fontSize: 12, fontFamily: "monospace", padding: "5px 8px", marginBottom: 6, resize: "vertical",
          background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 3, color: "var(--adm-ink)" }} />
      <button className="adm-btn" onClick={() => void enviar()} disabled={enviando || !assunto.trim() || !corpo.trim()}
        style={{ marginBottom: 12 }}>
        {enviando ? "deixando o recado…" : `✉ DEIXAR PARA ${para.toUpperCase()}`}
      </button>

      {/* ── AS MENSAGENS ───────────────────────────────────────────── */}
      <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 4 }}>
        A CAIXA {d ? `· ${d.mensagens.length}` : ""}
      </div>
      {d && d.mensagens.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 12 }}>
          {/* ⚠️ Vazio por AUSÊNCIA diz que é ausência — não finge histórico perdido. */}
          Nenhuma mensagem ainda. Até 23/08 as duas sessões nunca trocaram uma —
          a coordenação foi pelo git e pelo ESTADO-ATUAL.
        </div>
      )}
      {d?.mensagens.map((m) => {
        const est = estadoDa(m);
        return (
          <div key={m.id} style={{ border: "1px solid var(--adm-border)", borderRadius: 4,
                                   padding: "6px 9px", marginBottom: 5, background: "var(--adm-bg-raise)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, color: "var(--adm-ink-4)", fontFamily: "monospace" }}>
                {m.de} → {m.para}
              </span>
              <span style={{ fontSize: 10, color: COR_ESTADO[est], letterSpacing: "0.06em" }}>
                {faz(m.criado_em, agora)} · {ROTULO_ESTADO[est]}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--adm-ink-2)", marginTop: 2 }}>{m.assunto}</div>
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)", lineHeight: 1.5, marginTop: 2 }}>{m.corpo}</div>
            {m.resposta && (
              <div style={{ fontSize: 11, color: "var(--adm-green)", lineHeight: 1.5, marginTop: 5,
                            borderLeft: "2px solid var(--adm-green)", paddingLeft: 7 }}>
                {m.resposta}
              </div>
            )}
          </div>
        );
      })}

      {/* ── O SALÃO ────────────────────────────────────────────────── */}
      <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", margin: "12px 0 4px" }}>
        O SALÃO · 7 dias {d?.truncado && <span style={{ color: "var(--adm-amber)" }}>· lista cortada em 400</span>}
      </div>
      <button className="adm-btn" onClick={() => void carregar()} disabled={carregando} style={{ marginBottom: 6 }}>
        {carregando ? "lendo…" : "⟳ ATUALIZAR"}
      </button>
      {d?.linha.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--adm-ink-4)" }}>Nenhum trabalho registrado nos últimos 7 dias.</div>
      )}
      {d?.linha.slice(0, 60).map((e, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, lineHeight: 1.6, alignItems: "baseline" }}>
          <span style={{ color: "var(--adm-ink-4)", fontFamily: "monospace", flexShrink: 0, width: 62 }}>
            {faz(e.quando, agora)}
          </span>
          <span style={{ color: "var(--adm-cyan)", fontFamily: "monospace", flexShrink: 0 }}>{e.tipo}</span>
          {e.fonte && <span style={{ color: "var(--adm-ink-4)", flexShrink: 0 }}>{e.fonte}</span>}
          {e.resumo && <span style={{ color: "var(--adm-ink-3)", minWidth: 0 }}>{e.resumo}</span>}
        </div>
      ))}

      {/* ── O QUE NÃO ESTÁ AQUI ────────────────────────────────────── */}
      {d && (
        <div style={{ borderTop: "1px solid var(--adm-border)", paddingTop: 6, marginTop: 10 }}>
          <div style={{ fontSize: 10, color: "var(--adm-amber)", letterSpacing: "0.08em", marginBottom: 3 }}>
            O QUE ESTA TELA NÃO MOSTRA
          </div>
          {d.naoMostra.map((t, i) => (
            <div key={i} style={{ fontSize: 11, color: "var(--adm-ink-4)", paddingLeft: 10, textIndent: -10, lineHeight: 1.5 }}>
              · {t}
            </div>
          ))}
        </div>
      )}
    </TerminalPanel>
  );
}
