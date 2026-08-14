"use client";

import { useState } from "react";
import TerminalPanel from "../TerminalPanel";
import AvisoRodadaNova from "../AvisoRodadaNova";
import { corDoResultado } from "@/lib/admin/cor-resultado";

/**
 * DEX ↔ CEX — a última arbitragem do mapa.
 *
 * ⚠️ O QUE ESTE PAINEL EXISTE PARA NÃO DEIXAR ACONTECER.
 *
 * 1. LER BORDA POSITIVA COMO DINHEIRO DISPONÍVEL. MEV compete no mesmo bloco e
 *    chega antes por construção. Tudo aqui é TETO da borda que EXISTE, não do
 *    que seria capturado. O aviso é fixo, não condicional ao resultado.
 *
 * 2. COMPARAR RÉGUAS DIFERENTES. Os dois lados são medidos para o MESMO
 *    notional: o DEX por cotação real (taxa, impacto e gás dentro) e a CEX
 *    andando o livro com `vwapBuy`/`vwapSell` — a mesma função que produziu as
 *    4.085 medições em que +0,451% teóricos viraram −0,629% reais.
 *
 * 3. ESQUECER QUE OS DOIS SENTIDOS SÃO DIFERENTES. Poça e livro cobram
 *    diferente em cada direção; a tabela mostra o melhor E o outro.
 */

type Linha = {
  symbol: string; cadeia: string; venueCex: string; notionalUsd: number;
  melhorRota: "dex→cex" | "cex→dex";
  brutaPct: number; liquidaPct: number; outraRotaPct: number;
  precoDexCompra: number; precoDexVenda: number;
  precoCexCompra: number; precoCexVenda: number;
  livroCompleto: boolean;
  /** ⚠️ Ida e volta na mesma poça fecha coerente? Ver `idaEVoltaCoerente`. */
  dexCoerente: boolean;
  usdtPorUsdc: number;
};
type Dados = {
  veredito: { readable: boolean; status: "verde" | "cinza" | "morta"; verdict: string };
  resumo: {
    pares: number; comLivroCompleto: number; incoerentes: number;
    usdtPorUsdc: number; notionalUsd: number; taxaCexPct: number;
    medianaLiquidaPct: number | null; positivos: number; excluidos: string[];
  };
  linhas: Linha[];
  falhas: string[] | null;
  /** ⚠️ Vazio = a rodada foi gravada no laboratório. */
  falhasGravacao: string[] | null;
  naoMedido: string[];
  tookMs: number;
};

const pct = (n: number | null | undefined, d = 3) =>
  n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const usd = (n: number) => `$${n.toLocaleString("pt-BR")}`;

const COR: Record<Dados["veredito"]["status"], string> = {
  verde: "var(--adm-green)", morta: "var(--adm-red)", cinza: "var(--adm-ink-4)",
};

export default function DexCexPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [rodando, setRodando] = useState(false);
  /** Quando a tela recebeu o que mostra — alimenta o aviso de rodada nova. */
  const [vistoEm, setVistoEm] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function rodar() {
    setRodando(true); setErr(null);
    try {
      const res = await fetch("/admin/api/dex-cex", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(`${json.error ?? res.status}${json.detail ? ` — ${json.detail}` : ""}`);
      setD(json); setVistoEm(Date.now());
    } catch (e) { setErr(String(e)); } finally { setRodando(false); }
  }

  const r = d?.resumo;

  return (
    <TerminalPanel
      id="dex-cex" title="DEX ↔ CEX"
      subtitle="o atraso do bloco contra o preço vivo — a última arbitragem do mapa"
      icon="⛓" source="li.quest (cotação real de DEX) + livro de CEX andado por tamanho"
    >
      <AvisoRodadaNova slugs={["dex_cex_arb"]} vistoEm={vistoEm} />
      <div style={{ fontSize: 12, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
        A arbitragem CEX↔CEX foi reprovada por <b>velocidade</b>. O DEX não tem esse problema:
        o preço on-chain só muda quando um bloco fecha, então existe uma janela lenta <b>por
        construção</b>. Só que <i>&quot;existe janela&quot;</i> e <i>&quot;sobra dinheiro na
        janela&quot;</i> são coisas diferentes — e a segunda é o que esta medição responde.
      </div>

      <button className="adm-btn" onClick={rodar} disabled={rodando}>
        {rodando ? "cotando DEX e andando os livros…" : "⛓ MEDIR A BORDA DEX ↔ CEX · mesmo tamanho dos dois lados"}
      </button>

      {err && <div style={{ color: "var(--adm-red)", fontSize: 13, marginTop: 6 }}>{err}</div>}

      {d && r && (
        <div style={{ marginTop: 10 }}>
          <div style={{
            border: `1px solid ${d.veredito.readable ? "var(--adm-border)" : "var(--adm-amber)"}`,
            borderRadius: 4, padding: "7px 9px", marginBottom: 10, fontSize: 13, lineHeight: 1.6,
            color: d.veredito.readable ? "var(--adm-ink-2)" : "var(--adm-amber)",
          }}>
            <span style={{ color: COR[d.veredito.status] }}>● {d.veredito.status.toUpperCase()}</span>
            {" — "}{d.veredito.verdict}
          </div>

          {/* ⚠️⚠️ "APARECEU NA TELA" NÃO É "FOI GRAVADO" (09/08).
                 A rodada de 09/08 passou `windowDays: 0` contra um
                 `check (window_days > 0)`: o startRun estourou, o catch de
                 best-effort engoliu, e a medição inteira existiu só no
                 navegador. Best-effort sim, silencioso não. */}
          {d.falhasGravacao && (
            <div style={{
              border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
              marginBottom: 8, fontSize: 11, color: "var(--adm-red)", lineHeight: 1.6,
            }}>
              ⚠️ ESTA RODADA <b>NÃO FOI GRAVADA</b> no laboratório: {d.falhasGravacao.join(" · ")}.
              O que está na tela existe só aqui — não dá para comparar com as próximas.
            </div>
          )}

          {/* ⚠️ O AVISO DE MEV É FIXO, NÃO CONDICIONAL AO RESULTADO. Se ele só
                 aparecesse quando a borda é positiva, viraria ressalva de
                 ocasião — e é justamente no resultado bom que ele mais importa. */}
          <div style={{
            border: "1px solid var(--adm-red)", borderRadius: 3, padding: "5px 7px",
            marginBottom: 8, fontSize: 11, color: "var(--adm-red)", lineHeight: 1.6,
          }}>
            ⚠️ ISTO É <b>TETO</b>, NÃO CAPTURA. Quem vê a mesma diferença no bloco monta um
            pacote e entra antes — somos os últimos da fila por construção. A medição diz se a
            borda <b>existe</b>; quem fica com ela é outra pergunta, e não é esta que responde.
          </div>

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.7, marginBottom: 8 }}>
            notional <b style={{ color: "var(--adm-ink-3)" }}>{usd(r.notionalUsd)}</b> dos DOIS
            lados · taxa de CEX {r.taxaCexPct}% · {r.comLivroCompleto} de {r.pares} pares
            utilizáveis
            {r.incoerentes > 0 && (
              <span style={{ color: "var(--adm-red)" }}>
                {" "}(−{r.incoerentes} por ida e volta incoerente)
              </span>
            )}
            {/* ⚠️ AS DUAS MOEDAS. A CEX cota USDT, o DEX cota USDC — sem
                converter, o basis dos dois stablecoins vira "borda". */}
            <div style={{ color: "var(--adm-amber)" }}>
              a CEX cota em <b>USDT</b> e o DEX em <b>USDC</b>: os preços da CEX foram
              convertidos pela taxa <b>{r.usdtPorUsdc.toFixed(4)}</b> USDT/USDC da mesma venue.
              Sem isso, o basis dos dois stablecoins entraria na conta como se fosse borda — e
              ele é negócio próprio, igual ao WBTC que ficou fora.
            </div>
            {r.medianaLiquidaPct != null && (
              <div style={{ fontSize: 14, color: "var(--adm-ink-3)", marginTop: 3 }}>
                mediana da borda LÍQUIDA:{" "}
                <b style={{
                  fontSize: 17,
                  color: corDoResultado(r.medianaLiquidaPct),
                }}>
                  {pct(r.medianaLiquidaPct)}
                </b>
                <span style={{ fontSize: 11, color: "var(--adm-ink-4)" }}>
                  {" "}· {r.positivos} de {r.comLivroCompleto} positivos
                </span>
              </div>
            )}
            {/* Os pares descartados, com motivo — omissão que só existe no
                comentário vira número lido como completo. */}
            <div>
              fora da lista de propósito: <b>{r.excluidos.join(", ")}</b> — WBTC é BTC
              EMBRULHADO (o basis é do custodiante, negócio próprio) e MATIC/POL é o padrão de
              ticker em migração que este repo já documentou como fonte de spread falso
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "3px 5px" }}>PAR</th>
                  <th style={{ textAlign: "left", padding: "3px 5px" }}>ROTA</th>
                  <th style={{ padding: "3px 5px" }}>LÍQUIDA</th>
                  <th style={{ padding: "3px 5px" }}>BRUTA</th>
                  {/* ⚠️ O OUTRO SENTIDO NA MESMA LINHA: poça e livro cobram
                      diferente em cada direção, e supor simetria inventaria
                      metade da medição. */}
                  <th style={{ padding: "3px 5px" }}>OUTRO SENTIDO</th>
                  <th style={{ padding: "3px 5px" }}>DEX C/V</th>
                  <th style={{ padding: "3px 5px" }}>CEX C/V</th>
                  {/* ⚠️ Marca as DUAS condições: livro fundo E ida e volta
                      coerente no DEX. Linha marcada não entra em conta nenhuma. */}
                  <th style={{ padding: "3px 5px" }}>LIVRO</th>
                </tr>
              </thead>
              <tbody>
                {d.linhas.map((l) => (
                  <tr key={`${l.symbol}-${l.cadeia}`} style={{
                    borderTop: "1px solid var(--adm-border)", textAlign: "right",
                    // Linha fora da conta não pode parecer um resultado.
                    opacity: l.dexCoerente && l.livroCompleto ? 1 : 0.45,
                  }}>
                    <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-2)" }}>
                      {l.symbol}
                      <span style={{ fontSize: 10, color: "var(--adm-ink-4)" }}> @{l.cadeia}</span>
                    </td>
                    <td style={{ textAlign: "left", padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                      {l.melhorRota}
                    </td>
                    <td style={{
                      padding: "3px 5px",
                      color: corDoResultado(l.liquidaPct),
                    }}>
                      <b>{pct(l.liquidaPct)}</b>
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>{pct(l.brutaPct)}</td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)" }}>
                      {pct(l.outraRotaPct)}
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)", fontSize: 11 }}>
                      {l.precoDexCompra.toFixed(4)} / {l.precoDexVenda.toFixed(4)}
                    </td>
                    <td style={{ padding: "3px 5px", color: "var(--adm-ink-4)", fontSize: 11 }}>
                      {l.precoCexCompra.toFixed(4)} / {l.precoCexVenda.toFixed(4)}
                    </td>
                    {/* ⚠️ LIVRO RASO NÃO ENTRA EM NENHUMA CONTA. Preenchimento
                        parcial dá preço médio MELHOR que o real — mente a
                        favor, e é o defeito que a mesa anterior teve. */}
                    <td style={{
                      padding: "3px 5px",
                      color: !l.dexCoerente
                        ? "var(--adm-red)"
                        : l.livroCompleto ? "var(--adm-ink-4)" : "var(--adm-amber)",
                    }}>
                      {!l.dexCoerente ? "incoerente ⚠" : l.livroCompleto ? "ok" : "raso ⚠"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: "var(--adm-ink-4)", marginTop: 3, lineHeight: 1.6 }}>
              Os dois lados medidos para o MESMO notional: o DEX por cotação real (taxa,
              impacto e gás dentro) e a CEX <b>andando o livro</b> — a mesma função que
              transformou +0,451% teóricos em −0,629% reais em 4.085 medições. Par com livro
              raso não entra em nenhuma conta: preenchimento parcial mente a favor. E par
              marcado <b style={{ color: "var(--adm-red)" }}>incoerente</b> teve venda ACIMA da
              compra na mesma poça — impossível com taxa e impacto, então a cotação está
              inconsistente e a linha sai de todas as contas.
            </div>
          </div>

          {d.falhas && (
            <div style={{ fontSize: 11, color: "var(--adm-amber)", marginTop: 6, lineHeight: 1.6 }}>
              ⚠️ o que não entrou: {d.falhas.join(" · ")}
            </div>
          )}

          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginTop: 8, lineHeight: 1.7 }}>
            <div style={{ color: "var(--adm-amber)" }}>⚠️ NÃO está nesta conta:</div>
            {d.naoMedido.map((n) => <div key={n}>· {n}</div>)}
            <div style={{ marginTop: 4 }}>
              LÍQUIDA = borda depois da taxa de tomador da CEX, com taxa de poça, impacto e gás
              já dentro da cotação do DEX. {(d.tookMs / 1000).toFixed(1)}s
            </div>
          </div>
        </div>
      )}
    </TerminalPanel>
  );
}
