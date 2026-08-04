"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * O QUE TERIA DADO LUCRO — a pergunta que a semana de ajustes não respondia.
 *
 * O dono: "traders conseguem lucrar com consistência em queda e em subida" e
 * "todas as moedas seguem um padrão de movimento, principalmente as majors".
 *
 * As duas frases viraram medição. A primeira aponta o buraco estrutural (a
 * biblioteca é long-only, e num mercado que caiu 18% ela está proibida de fazer
 * a única coisa que funcionaria). A segunda aponta um erro de MEDIÇÃO nosso.
 *
 * ⚠️ A COLUNA QUE IMPEDE A LEITURA ERRADA É "SÍMBOLOS +", NÃO A MEDIANA.
 *
 * Uma mediana boa com 2 de 10 símbolos positivos é um bilhete premiado, não uma
 * estratégia. Com as moedas a 80% de correlação, é ainda pior: os símbolos nem
 * são testemunhas independentes.
 */

type Estrategia = {
  name: string; what: string; usesShort: boolean;
  avgTotalPct: number; medianTotalPct: number;
  symbolsPositive: number; symbols: number;
  avgTrades: number; avgExposurePct: number; avgMaxDrawdownPct: number;
  perSymbol: Array<{ symbol: string; totalPct: number }>;
};
type Dados = {
  estrategias: Estrategia[];
  correlacao: { rho: number | null; symbols: number; effectiveSymbols: number; nota: string };
  backDays: number; windowDays: number; endedAt: string | null; symbols: string[];
  aviso: string; tookMs: number;
};

const pct = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;

export default function WhatWorkedPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  async function rodar(backDays = 0) {
    setRodando(true); setErr(null);
    try {
      const res = await fetch(`/admin/api/what-worked?backDays=${backDays}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  return (
    <TerminalPanel
      id="what-worked" title="O QUE TERIA DADO LUCRO"
      subtitle="estratégias canônicas na mesma janela — inclusive as que VENDEM"
      icon="🧭" source="binance/klines + benchmarks.ts"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 10 }}>
        Média móvel, canal de Donchian e RSI com parâmetro de livro (50, 20, 14) — comprado E
        vendido. A pergunta é binária: alguma coisa simples extraía lucro daquela janela? Se
        nada extraía, nenhum ajuste na nossa biblioteca mudaria isso.
      </div>

      {/* ⚠️ RÓTULOS DISTINTOS DO OUTRO PAINEL (04/08).
          A primeira versão usava "⏮ 6 meses ANTES" e "⏮ 12 meses ANTES" — as
          MESMAS palavras dos botões do backtest, dois painéis acima. O dono
          rodou "nas 3 janelas" e o que disparou foi o backtest: dois painéis
          diferentes, botões idênticos, nenhuma forma de saber qual foi clicado.
          Botão que não diz o que faz é o mesmo defeito do `adm-btn` sem CSS,
          num degrau acima. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button className="adm-btn" onClick={() => rodar(0)} disabled={rodando}>
          {rodando ? "medindo…" : "🧭 O QUE FUNCIONOU · hoje"}
        </button>
        <button className="adm-btn" onClick={() => rodar(180)} disabled={rodando}>
          🧭 O QUE FUNCIONOU · 6 meses atrás
        </button>
        <button className="adm-btn" onClick={() => rodar(360)} disabled={rodando}>
          🧭 O QUE FUNCIONOU · 12 meses atrás
        </button>
      </div>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 8 }}>{err}</div>}

      {d && (
        <div style={{ marginTop: 12 }}>
          {/* A CORRELAÇÃO VEM PRIMEIRO porque ela muda como TODO o resto se lê —
              inclusive tudo que já foi medido neste laboratório. */}
          <div style={{
            fontSize: 9, lineHeight: 1.6, marginBottom: 10, color: "var(--adm-amber)",
            border: "1px solid var(--adm-amber)", borderRadius: 4, padding: "6px 8px",
          }}>
            🔗 {d.correlacao.nota}
          </div>

          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 8, fontStyle: "italic" }}>
            ⚠ {d.aviso}
            {" · "}janela de ~{d.windowDays} dias, a MESMA do backtest — sem isso, comparar a nossa
            biblioteca com estas estratégias atribuiria a elas uma diferença que veio do calendário
            {d.backDays > 0 && `, terminando em ${d.endedAt ? new Date(d.endedAt).toLocaleDateString("pt-BR") : "—"}`}
          </div>

          <table className="adm-table">
            <thead><tr>
              <th style={{ textAlign: "left" }}>ESTRATÉGIA</th><th>MEDIANA</th><th>SÍMBOLOS +</th><th>EXP.</th><th>TOMBO</th>
            </tr></thead>
            <tbody>
              {d.estrategias.map((e) => {
                const maioria = e.symbolsPositive > e.symbols / 2;
                return (
                  <tr key={e.name} style={{ cursor: "pointer" }} onClick={() => setAberta(aberta === e.name ? null : e.name)}>
                    <td style={{ color: "var(--adm-ink-2)" }}>
                      {e.usesShort && <span style={{ color: "var(--adm-cyan)" }}>⇅ </span>}
                      {e.name}
                      <div style={{ fontSize: 7, color: "var(--adm-ink-4)" }}>{e.what}</div>
                      {aberta === e.name && (
                        <div style={{ fontSize: 7, color: "var(--adm-ink-4)", marginTop: 3 }}>
                          {e.perSymbol.map((s) => `${s.symbol} ${pct(s.totalPct, 0)}`).join(" · ")}
                        </div>
                      )}
                    </td>
                    <td style={{
                      fontVariantNumeric: "tabular-nums",
                      color: e.medianTotalPct > 0 ? "var(--adm-green)" : "var(--adm-red)",
                    }}>{pct(e.medianTotalPct)}</td>
                    {/* O JUIZ. Mediana boa com poucos símbolos positivos é
                        bilhete premiado, não estratégia. */}
                    <td style={{
                      fontVariantNumeric: "tabular-nums",
                      color: maioria ? "var(--adm-green)" : "var(--adm-red)",
                    }}>{e.symbolsPositive}/{e.symbols}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-ink-4)" }}>
                      {e.avgExposurePct.toFixed(0)}%
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--adm-red)" }}>
                      −{e.avgMaxDrawdownPct.toFixed(0)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 8, fontSize: 7, color: "var(--adm-ink-4)", fontStyle: "italic", lineHeight: 1.6 }}>
            ⇅ = opera VENDIDO. A diferença entre as linhas com e sem ⇅ é o preço exato da
            restrição long-only da nossa biblioteca, em número. EXP. é quanto tempo a estratégia
            passa posicionada: render pouco ficando fora quase sempre é diferente de render
            pouco exposto o tempo todo. TOMBO é a maior queda do pico ao vale — é onde quem
            opera com dinheiro desiste. · {d.symbols.length} símbolos · {(d.tookMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
