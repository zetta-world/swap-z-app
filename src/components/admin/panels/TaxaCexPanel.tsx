"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * O CUSTO DA CORRETORA versus o que o laboratório SUPÕE.
 *
 * ⚠️⚠️ POR QUE ESTE PAINEL EXISTE — e é uma cicatriz minha, do mesmo dia.
 *
 * Em 15/08 eu construí `GET /admin/api/taxa-cex`, com módulo puro, dez testes e
 * três mutações verificadas. E **não liguei botão nenhum**. O dono foi procurar
 * e não achou.
 *
 * É a invariante nº 25 — *"um controle que nenhum importador chama não
 * existe"* — cometida por mim horas depois de eu tê-la registrado, e no mesmo
 * dia em que a nº 31 dizia que a lição não viaja sozinha entre telas. Não
 * viajou nem do meu próprio texto para o meu próprio código.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O NÚMERO QUE IMPORTA AQUI NÃO É A TAXA. É A SOBRA.
 *
 * Todo resultado direcional deste laboratório é líquido de `BACKTEST_COST_PCT`
 * (0,2% por perna), que é uma PREMISSA nossa. Se a taxa publicada da corretora
 * consome quase todo esse orçamento, não resta com que pagar derrapagem — e aí
 * os resultados gravados são OTIMISTAS, não conservadores.
 *
 * Foi essa a descoberta no lado DEX: o 0x cobra 0,15% medidos, sobrando 0,05
 * ponto para impacto e gás.
 *
 * Dois vereditos dependem disso e passaram por margem MENOR que a incerteza do
 * próprio custo: LP em AMM (+0,82%) e DEX↔CEX (+0,019%).
 */

type Comparacao = {
  corretora: string;
  modeloPorPernaPct: number;
  taxaPublicadaPct: number | null;
  sobraParaDerrapagemPct: number | null;
  pares: number;
  veredito: string;
  porPar: Array<{ par: string; simbolo: string; taxaPct: number }>;
  falha: string | null;
  naoMedido: string[];
  fetchedAt: string;
};

/**
 * ⚠️ A COR SAI DA SOBRA, NUNCA DA TAXA. Taxa baixa com orçamento baixo é tão
 * ruim quanto taxa alta — o que decide é quanto sobra depois dela.
 */
function corDaSobra(sobra: number | null): string {
  if (sobra === null) return "var(--adm-ink-4)";
  if (sobra < 0) return "var(--adm-red)";
  if (sobra < 0.05) return "var(--adm-amber)";
  return "var(--adm-green)";
}

export default function TaxaCexPanel() {
  const [d, setD] = useState<Comparacao | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/taxa-cex");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  return (
    <TerminalPanel
      id="taxa-cex" title="CUSTO DA CORRETORA" icon="💱"
      subtitle="a taxa que a corretora publica contra a que o laboratório supõe"
      source="GATEIO/CURRENCY_PAIRS"
    >
      <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
        Compara a taxa <b>publicada</b> da corretora com o custo que o laboratório
        <b> supõe</b> (<code>BACKTEST_COST_PCT</code>). O número que decide é a{" "}
        <b style={{ color: "var(--adm-ink-2)" }}>SOBRA</b> — o que resta do orçamento
        para pagar derrapagem depois da taxa.
      </div>

      <button className="adm-btn" onClick={() => void rodar()} disabled={rodando}
              style={{ marginBottom: 8 }}>
        {rodando ? "consultando…" : "⟳ CONSULTAR A TAXA REAL"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 11 }}>{err}</div>}

      {d && (
        <div style={{ fontSize: 11, lineHeight: 1.7 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
            {[
              { label: "MODELO/PERNA", v: `${d.modeloPorPernaPct.toFixed(3)}%`, c: "var(--adm-ink-2)" },
              { label: "TAXA PUBLICADA", v: d.taxaPublicadaPct === null ? "—" : `${d.taxaPublicadaPct.toFixed(3)}%`, c: "var(--adm-ink-2)" },
              { label: "SOBRA", v: d.sobraParaDerrapagemPct === null ? "—" : `${d.sobraParaDerrapagemPct.toFixed(3)}`, c: corDaSobra(d.sobraParaDerrapagemPct) },
            ].map((t) => (
              <div key={t.label} style={{ background: "var(--adm-bg-raise)", border: "1px solid var(--adm-border)", borderRadius: 6, padding: "5px 8px" }}>
                <div style={{ fontSize: 10, color: "var(--adm-ink-3)", letterSpacing: "0.08em" }}>{t.label}</div>
                <div style={{ fontSize: 17, color: t.c, fontVariantNumeric: "tabular-nums" }}>{t.v}</div>
              </div>
            ))}
          </div>

          <div style={{ color: corDaSobra(d.sobraParaDerrapagemPct), marginBottom: 8 }}>
            {d.veredito}
          </div>

          {d.falha && (
            <div style={{ color: "var(--adm-amber)", marginBottom: 8 }}>⚠️ {d.falha}</div>
          )}

          {d.porPar.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.08em", marginBottom: 3 }}>
                POR PAR ({d.pares})
              </div>
              {d.porPar.map((p) => (
                <div key={p.par} style={{ display: "flex", gap: 8, padding: "1px 0" }}>
                  <span style={{ color: "var(--adm-ink-2)", fontFamily: "monospace", width: 90 }}>{p.par}</span>
                  <span style={{ color: "var(--adm-ink-3)", fontVariantNumeric: "tabular-nums" }}>{p.taxaPct.toFixed(3)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* ⚠️ O que NÃO foi medido viaja na tela, não no comentário. Uma
              calibração lida sem as ressalvas vira "o custo está resolvido". */}
          <div style={{ borderTop: "1px solid var(--adm-border)", paddingTop: 6 }}>
            <div style={{ fontSize: 10, color: "var(--adm-amber)", letterSpacing: "0.08em", marginBottom: 3 }}>
              O QUE ISTO NÃO MEDE
            </div>
            {d.naoMedido.map((m, i) => (
              <div key={i} style={{ color: "var(--adm-ink-4)", paddingLeft: 10, textIndent: -10 }}>· {m}</div>
            ))}
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
