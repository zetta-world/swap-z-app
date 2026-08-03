"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { sampleLabel, shouldTint } from "@/lib/admin/sample";

/**
 * QUAL ESTRATÉGIA PAGA — medida, não chutada.
 *
 * A coluna `priority` da biblioteca decide qual playbook o seletor mecânico
 * tenta primeiro, e sempre foi um palpite declarado como tal no código. Este
 * painel é o que vai substituí-la por medição.
 *
 * TRÊS COISAS QUE ELE MOSTRA E QUASE NENHUM BACKTEST MOSTRA:
 *
 *  1. A JANELA. ~32 dias úteis por símbolo — teto da API, não escolha. Um
 *     resultado sem a janela ao lado convida a ler como se valesse para sempre.
 *  2. O `n` DE CADA LINHA, com cinza abaixo do limiar. Playbook raro vai ter
 *     amostra pequena nesta janela, e exibi-lo com a mesma tinta de um frequente
 *     seria o defeito do Valhalla com a autoridade de um "backtest".
 *  3. QUEM NÃO DISPAROU. Ausência não é aprovação: um playbook que não achou
 *     setup nenhum é um dado sobre ELE. Sumir com a linha faria parecer que ele
 *     nem existe.
 */

type Regime = "RANGING" | "TRENDING_UP" | "TRENDING_DOWN" | "TRANSITIONING";
type Stat = {
  playbook: string; label: string; thesis: string;
  decided: number; wins: number; losses: number; expired: number;
  netPerTrade: number | null; winRate: number | null;
  byRegime: Partial<Record<Regime, { decided: number; netPerTrade: number }>>;
};
type Report = {
  symbols: string[]; symbolsFailed: string[];
  windowDays: number; warmupBars: number; barsTested: number; noiseThreshold: number;
  stats: Stat[];
  silent: Array<{ playbook: string; label: string; reason: string }>;
  gaps: Array<{ id: string; label: string; blockedBy: string }>;
  tookMs: number; ranAt: string;
};

const REGIME_SHORT: Record<Regime, string> = {
  RANGING: "lateral", TRENDING_UP: "alta", TRENDING_DOWN: "baixa", TRANSITIONING: "transição",
};

const pct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);

export default function PlaybookBacktestPanel() {
  const [data, setData] = useState<Report | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const run = async () => {
    setRunning(true); setErr(null);
    try {
      const res = await fetch("/admin/api/playbook-backtest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? res.status);
      setData(json);
    } catch (e) { setErr(String(e)); }
    finally { setRunning(false); }
  };

  return (
    <TerminalPanel
      id="playbook-backtest" title="QUAL ESTRATÉGIA PAGA"
      subtitle="cada playbook medido ISOLADO no histórico — substitui o palpite da prioridade"
      icon="⚖" source="binance/klines + playbooks.ts"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 10 }}>
        Roda a biblioteca inteira sobre o histórico real e mede CADA estratégia sozinha —
        inclusive as que o seletor não escolheria. Sem isso, não há como saber se o mecânico
        acerta a ordem: ele seguiria um palpite para sempre.
      </div>

      <button className="adm-btn" onClick={run} disabled={running}>
        {running ? "medindo…" : "⚖ rodar backtest por playbook"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 8 }}>{err}</div>}

      {data && (
        <div style={{ marginTop: 12 }}>
          {/* A JANELA VEM ANTES DO RESULTADO, de propósito. Um número sem ela
              convida a ser lido como se valesse para sempre. */}
          <div style={{
            fontSize: 9, color: "var(--adm-amber)", lineHeight: 1.6,
            border: "1px solid var(--adm-border)", borderRadius: 4, padding: "6px 8px", marginBottom: 10,
          }}>
            ⏳ janela de <b>~{data.windowDays} dias</b> por símbolo ({data.symbols.length} símbolos ·{" "}
            {data.barsTested.toLocaleString("pt-BR")} barras) — teto da API de candles, não escolha.
            Playbook raro tende a ficar abaixo de {data.noiseThreshold} trades nesta janela, e sai em cinza.
            {data.symbolsFailed.length > 0 && ` Sem dado: ${data.symbolsFailed.join(", ")}.`}
          </div>

          {data.stats.map((s) => (
            <div key={s.playbook} style={{ borderTop: "1px solid var(--adm-border)", padding: "5px 0" }}>
              <div
                style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 10, cursor: "pointer" }}
                onClick={() => setOpen(open === s.playbook ? null : s.playbook)}
              >
                <span style={{ flex: 1, color: "var(--adm-ink-2)" }}>{s.label}</span>
                <span style={{ color: "var(--adm-ink-4)", fontSize: 8, width: 74, textAlign: "right" }}>
                  {sampleLabel(s.decided, data.noiseThreshold)}
                </span>
                <span style={{
                  width: 62, textAlign: "right", fontVariantNumeric: "tabular-nums",
                  color: !shouldTint(s.decided, data.noiseThreshold) ? "var(--adm-ink-4)"
                    : (s.netPerTrade ?? 0) > 0 ? "var(--adm-green)" : "var(--adm-red)",
                }}>{pct(s.netPerTrade)}</span>
                <span style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>{open === s.playbook ? "▲" : "▼"}</span>
              </div>

              {open === s.playbook && (
                <div style={{ fontSize: 8, color: "var(--adm-ink-4)", paddingLeft: 6, lineHeight: 1.7, marginTop: 3 }}>
                  <div style={{ fontStyle: "italic" }}>{s.thesis}</div>
                  <div>
                    {s.wins} ganho(s) · {s.losses} perda(s) · {s.expired} expirada(s)
                    {s.winRate != null && ` · acerto ${(s.winRate * 100).toFixed(0)}% (expirada fora das duas pontas)`}
                  </div>
                  {/* POR REGIME é a resposta útil: uma estratégia raramente é boa
                      ou ruim em geral — ela é boa NUM terreno e péssima noutro. */}
                  {Object.entries(s.byRegime).map(([r, v]) => (
                    <div key={r}>
                      em {REGIME_SHORT[r as Regime]}: {pct(v.netPerTrade)}{" "}
                      <span style={{ color: "var(--adm-ink-4)" }}>({sampleLabel(v.decided, data.noiseThreshold)})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Quem não disparou. Ausência não é aprovação. */}
          {data.silent.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.6 }}>
              <div style={{ color: "var(--adm-ink-3)", marginBottom: 3 }}>
                ◌ sem disparo na janela — é dado sobre o playbook, não aprovação:
              </div>
              {data.silent.map((x) => <div key={x.playbook}>· {x.label}</div>)}
            </div>
          )}

          {/* Os buracos declarados: a biblioteca não está completa, e a tabela
              acima sozinha daria a impressão contrária. */}
          {data.gaps.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.6 }}>
              <div style={{ color: "var(--adm-ink-3)", marginBottom: 3 }}>
                ⛔ fora da biblioteca — falta o dado, não a vontade:
              </div>
              {data.gaps.map((g) => <div key={g.id}>· {g.label} — {g.blockedBy}</div>)}
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 7, color: "var(--adm-ink-4)", fontStyle: "italic", lineHeight: 1.6 }}>
            Sem lookahead: o retrato de cada barra usa só a história até ela, e a resolução só as
            barras depois. Um trade por playbook por vez, para o mesmo movimento não virar dez
            observações. O que isto NÃO cobre: liquidez e slippage reais, viés de sobrevivência,
            e a premissa de que o passado se repita — um playbook lucrativo aqui lucrou NAQUELE
            mercado. Evidência, não promessa. · {(data.tookMs / 1000).toFixed(1)}s
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
