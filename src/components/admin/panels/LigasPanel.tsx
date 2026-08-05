"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * AS TRÊS LIGAS — onde a nossa conta pode fechar, e onde não pode.
 *
 * O dono perguntou como competir com quem lucra de verdade com arbitragem. A
 * curva de equilíbrio sobre 4.085 medições reais respondeu que a barreira NÃO é
 * taxa nem velocidade: com custo ZERO, 95% das oportunidades continuam
 * perdendo. O que come o spread é o bid-ask, pago duas vezes.
 *
 * Daí saíram três perguntas separadas, e cada botão responde uma:
 *
 *  🔬 CENSO SPOT   — nos MAJORS o pedágio é menor que a discordância? (a sonda
 *                    antiga só media altcoins rasas, viés que eu construí)
 *  ⚡ CENSO PERP   — o livro de futuros é mais estreito que o spot?
 *  📮 MESA MAKER   — postar o spread em vez de atravessá-lo paga?
 *
 * ⚠️ A COLUNA QUE IMPEDE A LEITURA ERRADA É "BORDA", NÃO "DISPERSÃO".
 *
 * Dispersão alta com pedágio alto é o quadro da MANA: parece oportunidade e é
 * livro raso. Borda = dispersão − pedágio, e é ela que diz se existe mesa
 * ANTES de qualquer taxa. Borda negativa fecha a questão — não há tier VIP nem
 * colocation que salve.
 */

type Linha = {
  s: string; pedagio: number | null; disp: number | null; borda: number | null;
  barata: string | null; cara: string | null;
};
type Resumo = {
  n: number; medianaPedagio: number | null; medianaDispersao: number | null;
  medianaBorda: number | null; positivos: number;
};
type Censo = {
  resumo: { majors: Resumo; controle: Resumo; semLivro: string[] };
  veredito: { verdict: string; positivos: number; total: number };
  majors: Array<{ symbol: string; crossCostPct: number | null; dispersionPct: number | null; edgeBeforeFeesPct: number | null; cheapVenue: string | null; richVenue: string | null }>;
  controle: Censo["majors"];
  naoMedido?: string[];
  aviso: string; tookMs: number;
};
type Curva = {
  larguraPct: number; netPerCyclePct: number; hedgeRate: number; fillRate: number;
  avgAdversePct: number; ciclos: number; stops: number; hedged: number; unfilled: number;
};
type Maker = {
  curva: Curva[]; veredito: string; algumPositivo: boolean;
  feePct: number; barras: number; naoMedido: string[]; aviso: string; tookMs: number;
};
/** A sonda de venue nova: mede se o ADAPTADOR lê, não se há spread. */
type Venues = {
  resumo: { tentadas: number; funcionando: number; adaptadorQuebrado: number; naoResponderam: number };
  linhas: Array<{
    venue: string; ok: boolean; status: number | string; simbolos: number;
    amostra: Array<{ s: string; p: number | null }>; diagnostico: string;
  }>;
  recusadas: Record<string, string>;
  portao: string[];
};

const pct = (n: number | null | undefined, d = 3) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;

export default function LigasPanel() {
  const [spot, setSpot] = useState<Censo | null>(null);
  const [perp, setPerp] = useState<Censo | null>(null);
  const [maker, setMaker] = useState<Maker | null>(null);
  const [venues, setVenues] = useState<Venues | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function rodar(qual: "spot" | "perp" | "maker" | "venues") {
    setRodando(qual); setErr(null);
    const rota = qual === "spot" ? "depth-census"
      : qual === "perp" ? "perp-census"
      : qual === "maker" ? "maker-backtest"
      : "venue-probe";
    try {
      const res = await fetch(`/admin/api/${rota}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      if (qual === "spot") setSpot(json);
      else if (qual === "perp") setPerp(json);
      else if (qual === "maker") setMaker(json);
      else setVenues(json);
    } catch (e) { setErr(String(e)); } finally { setRodando(null); }
  }

  const tabela = (linhas: Censo["majors"], titulo: string) => (
    <div style={{ marginTop: 6, overflowX: "auto" }}>
      <div style={{ fontSize: 8, color: "var(--adm-ink-4)" }}>{titulo}</div>
      <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
            <th style={{ textAlign: "left", padding: "2px 4px" }}>SÍMB</th>
            <th style={{ padding: "2px 4px" }}>PEDÁGIO</th>
            <th style={{ padding: "2px 4px" }}>DISPERSÃO</th>
            <th style={{ padding: "2px 4px" }}>BORDA</th>
            <th style={{ textAlign: "left", padding: "2px 4px" }}>ROTA</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.symbol} style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
              <td style={{ textAlign: "left", padding: "2px 4px", color: "var(--adm-ink-2)" }}>{l.symbol}</td>
              <td style={{ padding: "2px 4px", color: "var(--adm-ink-3)" }}>{pct(l.crossCostPct)}</td>
              <td style={{ padding: "2px 4px", color: "var(--adm-ink-3)" }}>{pct(l.dispersionPct)}</td>
              <td style={{
                padding: "2px 4px",
                color: (l.edgeBeforeFeesPct ?? -1) > 0 ? "var(--adm-green)" : "var(--adm-red)",
              }}>
                <b>{pct(l.edgeBeforeFeesPct)}</b>
              </td>
              <td style={{ textAlign: "left", padding: "2px 4px", color: "var(--adm-ink-4)", fontSize: 8 }}>
                {l.cheapVenue} → {l.richVenue}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const censo = (d: Censo, nome: string) => (
    <div style={{ marginTop: 8 }}>
      <div style={{
        border: `1px solid ${d.veredito.positivos > 0 ? "var(--adm-amber)" : "var(--adm-border)"}`,
        borderRadius: 4, padding: "6px 8px", fontSize: 10, lineHeight: 1.6,
        color: d.veredito.positivos > 0 ? "var(--adm-amber)" : "var(--adm-ink-2)",
      }}>
        {nome}: {d.veredito.verdict}
      </div>
      <div style={{ fontSize: 9, color: "var(--adm-ink-3)", marginTop: 4 }}>
        majors — pedágio {pct(d.resumo.majors.medianaPedagio)} · dispersão{" "}
        {pct(d.resumo.majors.medianaDispersao)} · borda <b>{pct(d.resumo.majors.medianaBorda)}</b>
        <div style={{ color: "var(--adm-ink-4)" }}>
          controle (rasas) — pedágio {pct(d.resumo.controle.medianaPedagio)} · borda{" "}
          {pct(d.resumo.controle.medianaBorda)}
        </div>
      </div>
      {tabela(d.majors, "MAJORS")}
      {d.controle.length > 0 && tabela(d.controle, "CONTROLE — as rasas, para o número dos majors ter contra o que ser lido")}
      {d.naoMedido && (
        <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 5, lineHeight: 1.6 }}>
          <span style={{ color: "var(--adm-amber)" }}>⚠️ não medido:</span>{" "}
          {d.naoMedido.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <TerminalPanel
      id="ligas" title="AS TRÊS LIGAS"
      subtitle="onde a conta pode fechar — pedágio, futuros e postar o spread"
      icon="🏟" source="orderbooks ao vivo + klines 1m"
    >
      <div style={{ fontSize: 9, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
        A curva de equilíbrio sobre 4.085 medições disse que a barreira não é taxa nem
        velocidade: <b>com custo ZERO, 95% das oportunidades continuam perdendo</b>. O que come o
        spread é o bid-ask, atravessado duas vezes. <b>BORDA = dispersão − pedágio</b>, e é ela
        que decide se existe mesa antes de qualquer taxa.
      </div>

      <button className="adm-btn" onClick={() => rodar("spot")} disabled={!!rodando}>
        {rodando === "spot" ? "lendo livros spot…" : "🔬 CENSO SPOT · majors + controle"}
      </button>
      <button className="adm-btn" onClick={() => rodar("perp")} disabled={!!rodando} style={{ marginTop: 6 }}>
        {rodando === "perp" ? "lendo livros de perp…" : "⚡ CENSO PERP · a mesa de futuros"}
      </button>
      <button className="adm-btn" onClick={() => rodar("maker")} disabled={!!rodando} style={{ marginTop: 6 }}>
        {rodando === "maker" ? "simulando ordens limitadas…" : "📮 MESA MAKER · postar em vez de atravessar"}
      </button>

      {/* A SONDA DE VENUE NOVA. Rótulo distinto dos outros três de propósito —
          ela não mede spread, mede se o ADAPTADOR lê. */}
      <button className="adm-btn" onClick={() => rodar("venues")} disabled={!!rodando} style={{ marginTop: 6 }}>
        {rodando === "venues" ? "testando adaptadores…" : "🔌 VENUES NOVAS · o adaptador lê?"}
      </button>

      {venues && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 9, color: "var(--adm-ink-3)", lineHeight: 1.6 }}>
            {venues.resumo.funcionando} de {venues.resumo.tentadas} adaptadores funcionam
            {venues.resumo.adaptadorQuebrado > 0 && (
              <span style={{ color: "var(--adm-red)" }}>
                {" · "}{venues.resumo.adaptadorQuebrado} respondeu e eu li ERRADO
              </span>
            )}
            {venues.resumo.naoResponderam > 0 && (
              <span style={{ color: "var(--adm-amber)" }}>
                {" · "}{venues.resumo.naoResponderam} não responderam
              </span>
            )}
          </div>
          <div style={{ overflowX: "auto", marginTop: 4 }}>
            <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
              <tbody>
                {venues.linhas.map((l) => (
                  <tr key={l.venue} style={{ borderTop: "1px solid var(--adm-border)" }}>
                    <td style={{ padding: "2px 4px", color: "var(--adm-ink-2)" }}>{l.venue}</td>
                    <td style={{ padding: "2px 4px", textAlign: "right", color: "var(--adm-ink-4)" }}>
                      {String(l.status)}
                    </td>
                    <td style={{
                      padding: "2px 4px", textAlign: "right",
                      color: l.simbolos > 0 ? "var(--adm-green)" : "var(--adm-red)",
                    }}>
                      <b>{l.simbolos}</b> símb
                    </td>
                    <td style={{ padding: "2px 4px", color: "var(--adm-ink-4)", fontSize: 8 }}>
                      {l.amostra.map((a) => `${a.s} ${a.p}`).join(" · ") || l.diagnostico}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 5, lineHeight: 1.7 }}>
            <div style={{ color: "var(--adm-amber)" }}>
              ⚠️ recusadas, com motivo — nenhuma some em silêncio:
            </div>
            {Object.entries(venues.recusadas).map(([v, m]) => <div key={v}>· <b>{v}</b>: {m}</div>)}
            <div style={{ marginTop: 4, color: "var(--adm-amber)" }}>portão para promover:</div>
            {venues.portao.map((p) => <div key={p}>· {p}</div>)}
          </div>
        </div>
      )}

      {err && <div style={{ color: "var(--adm-red)", fontSize: 10, marginTop: 6 }}>{err}</div>}

      {spot && censo(spot, "SPOT")}
      {perp && censo(perp, "PERP")}

      {maker && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            border: `1px solid ${maker.algumPositivo ? "var(--adm-amber)" : "var(--adm-border)"}`,
            borderRadius: 4, padding: "6px 8px", fontSize: 10, lineHeight: 1.6,
            color: maker.algumPositivo ? "var(--adm-amber)" : "var(--adm-ink-2)",
          }}>
            MAKER: {maker.veredito}
          </div>
          <div style={{ overflowX: "auto", marginTop: 6 }}>
            <table style={{ width: "100%", fontSize: 9, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>LARGURA</th>
                  <th style={{ padding: "2px 4px" }}>LÍQ/CICLO</th>
                  <th style={{ padding: "2px 4px" }}>HEDGE</th>
                  <th style={{ padding: "2px 4px" }}>ENCHEU</th>
                  <th style={{ padding: "2px 4px" }}>STOPS</th>
                  <th style={{ padding: "2px 4px" }}>ADVERSO</th>
                </tr>
              </thead>
              <tbody>
                {maker.curva.map((c) => (
                  <tr key={c.larguraPct} style={{ borderTop: "1px solid var(--adm-border)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "2px 4px", color: "var(--adm-ink-2)" }}>
                      ±{c.larguraPct}%
                    </td>
                    <td style={{
                      padding: "2px 4px",
                      color: c.netPerCyclePct > 0 ? "var(--adm-green)" : "var(--adm-red)",
                    }}>
                      <b>{pct(c.netPerCyclePct, 4)}</b>
                    </td>
                    <td style={{ padding: "2px 4px", color: "var(--adm-ink-3)" }}>
                      {(c.hedgeRate * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: "2px 4px", color: "var(--adm-ink-4)" }}>
                      {(c.fillRate * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: "2px 4px", color: "var(--adm-ink-4)" }}>{c.stops}</td>
                    <td style={{ padding: "2px 4px", color: "var(--adm-ink-4)" }}>
                      {c.avgAdversePct.toFixed(3)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 5, lineHeight: 1.6 }}>
            <span style={{ color: "var(--adm-amber)" }}>⚠️ não medido:</span> {maker.naoMedido.join(" · ")}
            <div>
              Os três empurram o resultado para CIMA. Negativo aqui é conclusão sólida;
              positivo é convite para medir com livro real, não mesa aprovada.
              {" · "}taxa maker {maker.feePct}% por perna · {maker.barras} barras de 1m
              {" · "}{(maker.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
