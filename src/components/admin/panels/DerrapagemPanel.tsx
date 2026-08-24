"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { corDoPnl } from "@/lib/admin/cor-resultado";

/**
 * A DERRAPAGEM — quanto o livro cobra além da taxa.
 *
 * ⚠️ POR QUE ESTE PAINEL FECHA O MODELO DE CUSTO. O painel da taxa (15/08)
 * mostrou que a Gate.io cobra 0,2% por ordem contra um orçamento de 0,2% por
 * perna: **sobra zero** para impacto de preço. Ele terminava dizendo "os
 * resultados provavelmente são otimistas" — uma frase, sem quantidade.
 *
 * Aqui a quantidade aparece, e por TAMANHO: derrapagem não é propriedade do
 * par, é propriedade do par naquele tamanho. O valor da tabela está em ver
 * ONDE ela vira vermelha.
 */

type Tamanho = {
  usd: number;
  idaEVoltaPct: number | null;
  sobraPct: number | null;
  cabe: boolean;
  medido: boolean;
  paresComLivroCurto: number;
  pares: number;
  leitura: string;
  porPar: Array<{ simbolo: string; idaEVoltaPct: number | null; livroAcabou: boolean }>;
};

type Resposta = {
  corretora: string;
  taxaPorPernaPct: number | null;
  orcamentoPorPernaPct: number;
  pares: number;
  falhas: string[];
  porTamanho: Tamanho[];
  naoMedido: string[];
  fetchedAt: string;
};

const usd = (n: number) => (n < 1000 ? `$${n}` : `$${n / 1000}k`);

export default function DerrapagemPanel() {
  const [d, setD] = useState<Resposta | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/derrapagem");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  const hoje = d?.porTamanho.find((t) => t.usd === 50);

  return (
    <TerminalPanel
      id="derrapagem" title="DERRAPAGEM" icon="🌊"
      subtitle="quanto o livro cobra além da taxa — e até que tamanho ainda cabe"
      source="GATEIO/ORDER_BOOK"
    >
      <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
        Anda o livro REAL da Gate.io — a mesma corretora onde as mesas preenchem e
        de onde vem a taxa — e mede o quanto o preço piora em cada tamanho. O
        número que decide é a <b style={{ color: "var(--adm-ink-2)" }}>SOBRA</b>:
        o orçamento do laboratório menos a taxa menos o impacto.
      </div>

      <button className="adm-btn" onClick={() => void rodar()} disabled={rodando}
              style={{ marginBottom: 8 }}>
        {rodando ? "andando os livros…" : "⟳ MEDIR A DERRAPAGEM"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 11 }}>{err}</div>}

      {d && (
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
            {[
              { label: "ORÇAMENTO/PERNA", v: `${d.orcamentoPorPernaPct.toFixed(3)}%`, c: "var(--adm-ink-2)" },
              { label: "TAXA/PERNA", v: d.taxaPorPernaPct == null ? "—" : `${d.taxaPorPernaPct.toFixed(3)}%`, c: "var(--adm-ink-2)" },
              {
                label: "SOBRA A $50",
                v: hoje?.sobraPct == null ? "—" : `${hoje.sobraPct.toFixed(3)}`,
                c: hoje?.sobraPct == null ? "var(--adm-ink-4)" : corDoPnl(hoje.sobraPct),
              },
            ].map((t) => (
              <div key={t.label} style={{ background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ fontSize: 10, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{t.label}</div>
                <div style={{ fontSize: 17, color: t.c, fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
              </div>
            ))}
          </div>

          {hoje && (
            <div style={{ color: hoje.cabe ? "var(--adm-green)" : "var(--adm-red)", marginBottom: 8 }}>
              {hoje.leitura}
            </div>
          )}

          {/* ⚠️ A TABELA É O PRODUTO. Um número só responderia "quanto custa";
              a tabela responde "até quanto posso crescer", que é a pergunta
              que o dono de fato tem. */}
          <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>
            POR TAMANHO · {d.pares} pares
          </div>
          <table className="adm-table">
            <thead><tr><th>NOCIONAL</th><th>IMPACTO I/V</th><th>SOBRA</th><th></th></tr></thead>
            <tbody>
              {d.porTamanho.map((t) => (
                <tr key={t.usd} style={{ cursor: "pointer" }}
                    onClick={() => setAberto(aberto === t.usd ? null : t.usd)}>
                  <td style={{ color: "var(--adm-ink-2)", fontVariantNumeric: "tabular-nums" }}>{usd(t.usd)}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-3)" }}>
                    {t.idaEVoltaPct == null ? "—" : `${t.idaEVoltaPct.toFixed(3)}%`}
                    {/* ⚠️ Livro curto = o número é PISO, não valor. Sem esta
                        marca a linha diria "cabe" sobre um tamanho que a
                        corretora não atende. */}
                    {t.paresComLivroCurto > 0 && (
                      <span style={{ color: "var(--adm-amber)" }} title={`${t.paresComLivroCurto} de ${t.pares} pares esgotaram o livro — o impacto real é MAIOR`}>
                        {" "}⚠{t.paresComLivroCurto}
                      </span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", color: t.sobraPct == null ? "var(--adm-ink-4)" : corDoPnl(t.sobraPct) }}>
                    {t.sobraPct == null ? "—" : t.sobraPct.toFixed(3)}
                  </td>
                  <td style={{ color: "var(--adm-ink-4)" }}>{aberto === t.usd ? "▲" : "▼"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {aberto != null && (
            <div style={{ background: "var(--adm-bg-raise)", borderRadius: 4, padding: "6px 8px", marginTop: 6 }}>
              {d.porTamanho.find((t) => t.usd === aberto)?.porPar.map((p) => (
                <div key={p.simbolo} style={{ display: "flex", gap: 8 }}>
                  <span style={{ width: 60, color: "var(--adm-ink-2)", fontFamily: "monospace" }}>{p.simbolo}</span>
                  <span style={{ color: "var(--adm-ink-3)", fontVariantNumeric: "tabular-nums" }}>
                    {p.idaEVoltaPct == null ? "—" : `${p.idaEVoltaPct.toFixed(3)}%`}
                  </span>
                  {p.livroAcabou && <span style={{ color: "var(--adm-amber)" }}>livro curto</span>}
                </div>
              ))}
            </div>
          )}

          {d.falhas.length > 0 && (
            <div style={{ color: "var(--adm-amber)", marginTop: 6 }}>
              ⚠️ {d.falhas.length} par(es) sem livro: {d.falhas.join(", ")}
            </div>
          )}

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
