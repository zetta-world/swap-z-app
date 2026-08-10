"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * ROTAÇÃO E GRADE — C9 e C10 (Fase 8.2).
 *
 * ⚠️ DUAS MESAS, DOIS VEREDITOS SEPARADOS. Um veredito só para as duas faria a
 * boa carregar a ruim — e elas não têm relação nenhuma além de dividirem a
 * régua de preço.
 *
 * ⚠️ NA GRADE, TOTAL E REALIZADO FICAM LADO A LADO. O realizado é o número das
 * propagandas (só os degraus que fecharam); o total inclui o estoque preso no
 * fundo. Mostrar só o primeiro transformaria ruína em renda constante.
 */

interface Ponto { dia: string; escolhidos: string[]; retornoPct: number; segurarPct: number }
interface Grade {
  simbolo: string; totalPct: number; realizadoPct: number; estoquePct: number;
  fills: number; rompeu: "nao" | "abaixo" | "acima" | "ambos"; segurarPct: number;
}
type Status = "verde" | "cinza" | "morta";
interface Veredito { status: Status; texto: string }
interface Dados {
  janelaDias: number; simbolos: string[]; falhas: string[]; custoPct: number;
  rotacao: {
    capitalUsd: number; olharDias: number; topoN: number; rebalanceDias: number;
    minRebalances: number; medianaPct: number; segurarPct: number; vantagemPct: number;
    pontos: Ponto[]; veredito: Veredito;
  };
  grade: {
    capitalUsd: number; faixaPct: number; degraus: number; minSimbolos: number;
    totalPct: number; realizadoPct: number; segurarPct: number;
    resultados: Grade[]; veredito: Veredito;
  };
  naoMedido: string[]; tookMs: number;
}

const COR: Record<Status, string> = {
  verde: "var(--adm-green)", cinza: "var(--adm-ink-3)", morta: "var(--adm-red)",
};
const ROTULO: Record<Status, string> = {
  verde: "✓ VERDE", cinza: "◌ INCONCLUSIVA", morta: "✕ MORTA",
};
const pct = (n: number | null | undefined, c = 2) =>
  n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(c)}%`;

export default function RotacaoGradePanel() {
  const [data, setData] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [rodando, setRodando] = useState(false);

  const medir = useCallback(async () => {
    setRodando(true); setErro(null);
    try {
      const res = await fetch("/admin/api/rotacao-grade", { method: "POST" });
      const body = await res.json() as Dados & { error?: string; detail?: string };
      if (!res.ok) { setErro(`${body.error ?? res.status}${body.detail ? ` — ${body.detail}` : ""}`); return; }
      setData(body);
    } catch (e) { setErro(String(e).slice(0, 160)); }
    finally { setRodando(false); }
  }, []);

  return (
    <TerminalPanel
      id="rotacao-grade"
      title="ROTAÇÃO E GRADE"
      subtitle="C9 e C10 — escolher os melhores paga? e a grade sobrevive à queda?"
      icon="🔁"
      source="data-api.binance.vision"
    >
      <button className="adm-btn" onClick={() => void medir()} disabled={rodando}>
        {rodando ? "medindo rotação e grade…" : "🔁 MEDIR ROTAÇÃO E GRADE"}
      </button>

      {erro && (
        <div style={{ color: "var(--adm-red)", fontSize: 9, marginTop: 8, lineHeight: 1.6 }}>
          {erro}
          <div style={{ color: "var(--adm-ink-4)", fontSize: 8, marginTop: 3 }}>
            fonte recusada não é resultado — nada foi medido nesta tentativa
          </div>
        </div>
      )}

      {data && (
        <div style={{ marginTop: 10 }}>
          {/* ═══ C9 ═══════════════════════════════════════════════════ */}
          <Cabeca titulo="C9 · ROTAÇÃO POR MOMENTO" v={data.rotacao.veredito} />
          <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <Bloco r="VANTAGEM vs SEGURAR" v={pct(data.rotacao.vantagemPct)}
                   c={data.rotacao.vantagemPct > 0 ? "var(--adm-green)" : "var(--adm-red)"} />
            <Bloco r="ROTAÇÃO (por período)" v={pct(data.rotacao.medianaPct)} c="var(--adm-ink-2)" />
            <Bloco r="SEGURAR TODOS" v={pct(data.rotacao.segurarPct)} c="var(--adm-ink-2)" />
            <Bloco r="CAPITAL" v={`$${data.rotacao.capitalUsd.toLocaleString("pt-BR")}`} c="var(--adm-ink-3)" />
            <Bloco r="REBALANCES (n)" v={`${data.rotacao.pontos.length}/${data.rotacao.minRebalances}`} c="var(--adm-ink-3)" />
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 6, lineHeight: 1.6 }}>
            olha {data.rotacao.olharDias}d para trás · segura o topo {data.rotacao.topoN} ·
            gira a cada {data.rotacao.rebalanceDias}d · custo {data.custoPct}%/perna
          </div>

          {data.rotacao.pontos.length > 0 && (
            <div style={{ overflowX: "auto", marginBottom: 10 }}>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>DIA</th><th>ESCOLHIDOS</th>
                    <th style={{ textAlign: "right" }}>ROTAÇÃO</th>
                    <th style={{ textAlign: "right" }}>SEGURAR</th>
                    <th style={{ textAlign: "right" }}>DIFERENÇA</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rotacao.pontos.map((p) => {
                    const d = p.retornoPct - p.segurarPct;
                    return (
                      <tr key={p.dia}>
                        <td>{p.dia}</td>
                        {/* ⚠️ QUEM foi escolhido, sempre. Agregado sem parcela não é auditável. */}
                        <td style={{ color: "var(--adm-ink-3)" }}>{p.escolhidos.join(" · ")}</td>
                        <td style={{ textAlign: "right" }}>{pct(p.retornoPct)}</td>
                        <td style={{ textAlign: "right" }}>{pct(p.segurarPct)}</td>
                        <td style={{ textAlign: "right", fontWeight: 700, color: d > 0 ? "var(--adm-green)" : "var(--adm-red)" }}>
                          {pct(d)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ═══ C10 ══════════════════════════════════════════════════ */}
          <Cabeca titulo="C10 · GRADE" v={data.grade.veredito} />
          <div style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
            <Bloco r="TOTAL (com estoque)" v={pct(data.grade.totalPct)}
                   c={data.grade.totalPct > data.grade.segurarPct ? "var(--adm-green)" : "var(--adm-red)"} />
            {/* ⚠️ O número das propagandas, rotulado como tal. */}
            <Bloco r="REALIZADO (degraus)" v={pct(data.grade.realizadoPct)} c="var(--adm-amber)" />
            <Bloco r="SEGURAR" v={pct(data.grade.segurarPct)} c="var(--adm-ink-2)" />
            <Bloco r="CAPITAL" v={`$${data.grade.capitalUsd.toLocaleString("pt-BR")}`} c="var(--adm-ink-3)" />
            <Bloco r="SÍMBOLOS (n)" v={`${data.grade.resultados.length}/${data.grade.minSimbolos}`} c="var(--adm-ink-3)" />
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-amber)", marginBottom: 6, lineHeight: 1.6 }}>
            ⚠️ faixa ±{data.grade.faixaPct}% em {data.grade.degraus} degraus. O <b>REALIZADO</b> é
            o que as propagandas mostram — só os degraus que fecharam. O <b>TOTAL</b> inclui o
            estoque preso quando o preço fura a faixa, que é como a grade perde dinheiro.
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>SÍMBOLO</th>
                  <th style={{ textAlign: "right" }}>FILLS</th>
                  <th style={{ textAlign: "right" }}>REALIZADO</th>
                  <th style={{ textAlign: "right" }}>ESTOQUE</th>
                  <th style={{ textAlign: "right" }}>TOTAL</th>
                  <th style={{ textAlign: "right" }}>SEGURAR</th>
                  <th>FAIXA</th>
                </tr>
              </thead>
              <tbody>
                {data.grade.resultados.map((g) => (
                  <tr key={g.simbolo}>
                    <td>{g.simbolo}</td>
                    <td style={{ textAlign: "right" }}>{g.fills}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-amber)" }}>{pct(g.realizadoPct)}</td>
                    <td style={{ textAlign: "right", color: "var(--adm-amber)" }}>{pct(g.estoquePct)}</td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: g.totalPct > g.segurarPct ? "var(--adm-green)" : "var(--adm-red)" }}>
                      {pct(g.totalPct)}
                    </td>
                    <td style={{ textAlign: "right" }}>{pct(g.segurarPct)}</td>
                    <td style={{ color: g.rompeu === "nao" ? "var(--adm-ink-4)" : "var(--adm-red)", fontSize: 8 }}>
                      {g.rompeu === "nao" ? "dentro" : `rompeu ${g.rompeu}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, borderTop: "1px solid var(--adm-border)", paddingTop: 6 }}>
            <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>
              O QUE ESTAS MEDIÇÕES NÃO INCLUEM
            </div>
            <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
              {data.naoMedido.map((n, i) => (
                <li key={i} style={{ color: "var(--adm-ink-4)", fontSize: 8, lineHeight: 1.6 }}>{n}</li>
              ))}
            </ul>
          </div>

          {data.falhas.length > 0 && (
            <div style={{ color: "var(--adm-ink-4)", fontSize: 7.5, marginTop: 5 }}>
              recusas de fonte: {data.falhas.join(" · ")}
            </div>
          )}
        </div>
      )}
    </TerminalPanel>
  );
}

/** ⚠️ Veredito ANTES do número — regra da casa. */
function Cabeca({ titulo, v }: { titulo: string; v: Veredito }) {
  return (
    <div style={{ border: `1px solid ${COR[v.status]}`, borderRadius: 3, padding: "6px 8px", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: "var(--adm-ink-3)", letterSpacing: "0.12em" }}>{titulo}</span>
        <span style={{ color: COR[v.status], fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>
          {ROTULO[v.status]}
        </span>
      </div>
      <div style={{ color: "var(--adm-ink-3)", fontSize: 8.5, lineHeight: 1.6, marginTop: 3 }}>{v.texto}</div>
    </div>
  );
}

function Bloco({ r, v, c }: { r: string; v: string; c: string }) {
  return (
    <div style={{ border: "1px solid var(--adm-border)", borderRadius: 3, padding: "4px 8px", minWidth: 92 }}>
      <div style={{ fontSize: 7.5, color: "var(--adm-ink-4)", letterSpacing: "0.1em" }}>{r}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</div>
    </div>
  );
}
