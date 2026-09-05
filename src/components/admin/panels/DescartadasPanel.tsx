"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * AS DESCARTADAS — o teto de credibilidade do arbitrador está cego?
 *
 * ⚠️ POR QUE ESTE PAINEL EXISTE (17/08). As quatro mesas de arbitragem estão
 * com a janela de disparo VAZIA por aritmética: o piso de custo (0,55%/0,60%)
 * está acima do teto de credibilidade (0,30%). Nenhum spread satisfaz as duas
 * condições — elas nunca vão operar.
 *
 * A derrapagem do mesmo dia tirou o PISO da lista de suspeitos (impacto 0,000%
 * a $50). Sobrou o TETO — e ele descarta ~83 rotas por dia marcadas com
 * "pagaria se fosse real". Aqui o livro dessas rotas é lido.
 */

type Realista = {
  theoreticalNetPct: number;
  realisticNetPct: number;
  slippagePct: number;
  fullyFilled: boolean;
} | null;

type Linha = {
  symbol: string; buy: string; sell: string;
  anuncios: number; spreadTopoPct: number; venuesMin: number; ultimoEm: string;
  classe: "real" | "raso" | "cadaver";
  motivo: string;
  realista: Realista;
};

type Resposta = {
  horas: number;
  janela: { ceilPct: number; floorPct: number; vazia: boolean };
  custo: { costPct: number; minNetPct: number; sizeUsd: number };
  rotasNoHistorico: number;
  rotasLidas: number;
  rotasIgnoradas: number;
  historicoTruncado?: boolean;
  resumo: { real: number; raso: number; cadaver: number; total: number };
  veredito: string;
  linhas: Linha[];
  naoMedido: string[];
  fetchedAt: string;
};

const COR: Record<Linha["classe"], string> = {
  real: "var(--adm-green)",
  raso: "var(--adm-amber)",
  cadaver: "var(--adm-ink-4)",
};

const ROTULO: Record<Linha["classe"], string> = {
  real: "REAL",
  raso: "RASO",
  cadaver: "CADÁVER",
};

export default function DescartadasPanel() {
  const [d, setD] = useState<Resposta | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/descartadas");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  return (
    <TerminalPanel
      id="descartadas" title="AS DESCARTADAS" icon="🚮"
      subtitle="o teto de credibilidade está barrando dinheiro real?"
      source="EVENTOS + ORDER_BOOK"
    >
      <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
        As mesas de arbitragem descartam spreads acima do{" "}
        <b style={{ color: "var(--adm-ink-2)" }}>teto de credibilidade</b> por achá-los
        bons demais para serem verdade. Isto pega essas rotas e{" "}
        <b style={{ color: "var(--adm-ink-2)" }}>lê o livro delas</b> — pelo mesmo
        caminho que decide abrir posição. Não muda gate nenhum.
      </div>

      <button className="adm-btn" onClick={() => void rodar()} disabled={rodando}
              style={{ marginBottom: 8 }}>
        {rodando ? "lendo os livros…" : "⟳ JULGAR AS DESCARTADAS"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 11 }}>{err}</div>}

      {d && (
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          {/* A janela vazia é a AFIRMAÇÃO que abriu tudo isto — fica no topo. */}
          {d.janela.vazia && (
            <div style={{ color: "var(--adm-red)", marginBottom: 8 }}>
              ⚠ janela de disparo VAZIA: piso {d.janela.floorPct.toFixed(2)}% acima do
              teto {d.janela.ceilPct.toFixed(2)}% — nenhum spread satisfaz as duas
              condições, e as mesas não vão operar enquanto isso valer.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
            {([
              { label: "REAL", v: d.resumo.real, c: COR.real },
              { label: "RASO", v: d.resumo.raso, c: COR.raso },
              { label: "CADÁVER", v: d.resumo.cadaver, c: COR.cadaver },
            ]).map((t) => (
              <div key={t.label} style={{ background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ fontSize: 10, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{t.label}</div>
                <div style={{ fontSize: 17, color: t.c, fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
              </div>
            ))}
          </div>

          <div style={{ color: d.resumo.real > 0 ? "var(--adm-green)" : "var(--adm-ink-3)", marginBottom: 8 }}>
            {d.veredito}
          </div>

          {/* ⚠️ Corte anunciado: silêncio aqui leria como "cobri tudo". */}
          <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>
            {d.rotasLidas} de {d.rotasNoHistorico} rotas · janela {d.horas}h · ${d.custo.sizeUsd}
            {/* ⚠️ O TRUNCAMENTO VIAJAVA NA RESPOSTA E MORRIA NELA (01/09). A rota
                calcula `historicoTruncado` e o tipo do painel não o listava, então
                o `setD(json)` o descartava — a tela imprimia "12 de 87 rotas" como
                se 87 fosse tudo o que houve na janela. */}
            {d.historicoTruncado && (
              <div style={{ color: "var(--adm-amber)", marginTop: 3 }}>
                ⚠️ histórico truncado no teto de eventos — as anomalias mais antigas
                da janela ficaram <b>fora desta contagem</b>
              </div>
            )}
            {d.rotasIgnoradas > 0 && (
              <span style={{ color: "var(--adm-amber)" }}>
                {" "}· {d.rotasIgnoradas} não lidas (teto de custo, as de MENOR spread são as lidas)
              </span>
            )}
          </div>

          <table className="adm-table">
            <thead>
              <tr><th>ROTA</th><th>TOPO</th><th>REAL</th><th>CLASSE</th><th></th></tr>
            </thead>
            <tbody>
              {d.linhas.map((l) => {
                const k = `${l.symbol}:${l.buy}>${l.sell}`;
                return (
                  <tr key={k} style={{ cursor: "pointer" }}
                      onClick={() => setAberta(aberta === k ? null : k)}>
                    <td style={{ color: "var(--adm-ink-2)", fontFamily: "monospace" }}>
                      {l.symbol}{" "}
                      <span style={{ color: "var(--adm-ink-4)" }}>{l.buy}→{l.sell}</span>
                      {/* Testemunha fraca: com o mínimo de venues a suspeita vale menos. */}
                      {l.venuesMin <= 3 && (
                        <span style={{ color: "var(--adm-amber)" }} title={`só ${l.venuesMin} venues cotando — testemunha fraca`}> ⚠</span>
                      )}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-3)" }}>
                      {l.spreadTopoPct.toFixed(2)}%
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: COR[l.classe] }}>
                      {l.realista ? `${l.realista.realisticNetPct.toFixed(3)}%` : "—"}
                    </td>
                    <td style={{ color: COR[l.classe] }}>{ROTULO[l.classe]}</td>
                    <td style={{ color: "var(--adm-ink-4)" }}>{aberta === k ? "▲" : "▼"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {aberta != null && (() => {
            const l = d.linhas.find((x) => `${x.symbol}:${x.buy}>${x.sell}` === aberta);
            if (!l) return null;
            return (
              <div style={{ background: "var(--adm-bg-raise)", borderRadius: 4, padding: "6px 8px", marginTop: 6, color: "var(--adm-ink-3)" }}>
                <div style={{ color: COR[l.classe] }}>{l.motivo}</div>
                {l.realista && (
                  <div style={{ fontVariantNumeric: "tabular-nums", marginTop: 3 }}>
                    topo prometia {l.realista.theoreticalNetPct.toFixed(3)}% · profundidade
                    comeu {l.realista.slippagePct.toFixed(3)}%
                    {!l.realista.fullyFilled && (
                      <span style={{ color: "var(--adm-amber)" }}> · livro curto para ${d.custo.sizeUsd}</span>
                    )}
                  </div>
                )}
                <div style={{ color: "var(--adm-ink-4)", marginTop: 3 }}>
                  {l.anuncios} anúncio(s) · {l.venuesMin} venues · último {new Date(l.ultimoEm).toLocaleString("pt-BR")}
                </div>
              </div>
            );
          })()}

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
