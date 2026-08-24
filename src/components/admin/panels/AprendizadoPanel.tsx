"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAutoRefresh } from "../useAutoRefresh";

/**
 * O VOLANTE DE APRENDIZADO — está girando?
 *
 * ⚠️ POR QUE ESTE PAINEL EXISTE, e é a cicatriz mais cara até agora.
 *
 * De 27/07 a 16/08 nenhuma mesa produziu uma lição. O `runRetroSweep` rodou a
 * cada 30 minutos o tempo todo, sem erro e sem escrever nada — o gatilho estava
 * quebrado e o modo de falha era SILÊNCIO. Vinte dias de mercado passaram, e
 * descobrimos por acaso.
 *
 * O conserto do gatilho tira o sistema da parede uma vez. Este mostrador é o
 * que faz a próxima parada ser vista no mesmo dia.
 *
 * ⚠️ E ELE SEPARA AS TRÊS RAZÕES DE NÃO APRENDER, que na tela pareciam a mesma
 * coisa: quebrou · decidimos (VÖLUNDR é o controle) · não tem onde pousar
 * (código determinístico não tem prompt). A diferença entre um experimento e um
 * defeito não pode viver só num comentário de código.
 */

type Mesa = {
  source: string; nome: string; canal: string; rotulo: string;
  ultimaLicaoMs: number | null; diasParado: number | null;
  naoRefletidos: number; faltam: number | null; travado: boolean; porque: string;
};

type Volante = {
  mesas: Mesa[]; comLicao: number; travadas: number;
  diasDesdeAUltimaLicao: number | null; veredito: string;
  limiar: number; naoMedido: string[]; fetchedAt: string;
};

/** ⚠️ A COR SAI DO CANAL, e travado sempre vence. Uma mesa de controle em
 *  cinza e uma mesa quebrada em cinza foi o que custou os 20 dias. */
function cor(m: Mesa): string {
  if (m.travado) return "var(--adm-red)";
  if (m.canal === "licao") return "var(--adm-green)";
  if (m.canal === "registro") return "var(--adm-ink-2)";
  if (m.canal === "controle") return "var(--adm-amber)";
  return "var(--adm-ink-4)";
}

export default function AprendizadoPanel() {
  const [d, setD] = useState<Volante | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/aprendizado");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); }
  }, []);

  /**
   * ⚠️ ESTE ATUALIZA SOZINHO, ao contrário dos painéis de medição. Ele é
   * LEITURA PURA — não dispara reflexão, não gasta chamada de IA, não grava
   * `lab_runs`. E um mostrador de "o motor parou?" que só fala quando alguém
   * aperta um botão tem o mesmo defeito que ele existe para consertar.
   */
  useAutoRefresh({ onRefresh: carregar, intervalMs: 120_000 });

  const alarme = d ? (d.travadas > 0 || d.veredito.includes("⚠️")) : false;

  return (
    <TerminalPanel
      id="aprendizado" title="VOLANTE DE APRENDIZADO" icon="🎓"
      subtitle="as mesas ainda estão aprendendo com o próprio histórico?"
      source="AGENT_LESSONS/ZION_SUGGESTIONS"
    >
      {err && <div style={{ color: "var(--adm-red)", fontSize: 11 }}>{err}</div>}
      {!d && !err && <div style={{ fontSize: 11, color: "var(--adm-ink-4)" }}>carregando…</div>}

      {d && (
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
            {[
              { label: "NO VOLANTE", v: String(d.comLicao), c: "var(--adm-ink-2)" },
              { label: "TRAVADAS", v: String(d.travadas), c: d.travadas > 0 ? "var(--adm-red)" : "var(--adm-green)" },
              {
                label: "ÚLTIMA LIÇÃO",
                v: d.diasDesdeAUltimaLicao === null ? "nunca" : `${d.diasDesdeAUltimaLicao}d`,
                c: (d.diasDesdeAUltimaLicao ?? 99) >= 7 ? "var(--adm-red)" : "var(--adm-green)",
              },
            ].map((t) => (
              <div key={t.label} style={{ background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ fontSize: 10, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{t.label}</div>
                <div style={{ fontSize: 17, color: t.c, fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
              </div>
            ))}
          </div>

          <div style={{ color: alarme ? "var(--adm-red)" : "var(--adm-green)", marginBottom: 8 }}>
            {d.veredito}
          </div>

          <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>
            POR MESA · limiar {d.limiar} decididos
          </div>
          {d.mesas.map((m) => (
            <div key={m.source} style={{ padding: "2px 0", borderBottom: "1px solid var(--adm-border)" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ color: cor(m), width: 150, flexShrink: 0 }}>
                  {m.travado ? "⚠️ " : ""}{m.nome}
                </span>
                <span style={{ color: "var(--adm-ink-3)", width: 130, flexShrink: 0, fontSize: 10 }}>{m.rotulo}</span>
                <span style={{ color: "var(--adm-ink-4)", fontVariantNumeric: "tabular-nums", fontSize: 10 }}>
                  {m.naoRefletidos > 0 && `${m.naoRefletidos} esperando`}
                  {m.diasParado !== null && ` · ${m.diasParado}d`}
                </span>
              </div>
              <div style={{ color: "var(--adm-ink-4)", fontSize: 10, paddingLeft: 8 }}>{m.porque}</div>
            </div>
          ))}

          {/* ⚠️ O que ISTO não mede vai na tela, não no comentário — um
              mostrador lido sem ressalva vira "aprendizado resolvido". */}
          <div style={{ borderTop: "1px solid var(--adm-border)", paddingTop: 6, marginTop: 6 }}>
            <div style={{ fontSize: 10, color: "var(--adm-amber)", letterSpacing: "0.08em", marginBottom: 3 }}>
              O QUE ISTO NÃO MEDE
            </div>
            {d.naoMedido.map((t, i) => (
              <div key={i} style={{ color: "var(--adm-ink-4)", paddingLeft: 10, textIndent: -10 }}>· {t}</div>
            ))}
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
