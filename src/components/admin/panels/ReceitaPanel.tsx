"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * RECEITA DE TAXA — C21/C22 (Fase 9.3).
 *
 * ⚠️ O REAL E A PROJEÇÃO FICAM SEPARADOS NA TELA, com rótulos diferentes e
 * cores diferentes. Colar os dois produziria exatamente o número que este
 * laboratório passou nove fases evitando: uma projeção lida como resultado.
 */

type Tier = "free" | "pro" | "trader" | "pilot";
interface Dados {
  real: { operacoes: number; volumeUsd: number; desde: string | null; ate: string | null };
  sonda: number; semVolume: number; falha: string | null;
  arrecadado: { usd: number; operacoes: number };
  porOrigem: Array<{
    kind: string; operacoes: number; volumeUsd: number;
    arrecadadoUsd: number; comTaxa: number; cobravel: boolean;
  }>;
  receitaRealTetoUsd: number;
  taxaPorPlano: Record<Tier, number>;
  projecao: Array<{ volumeUsd: number; porPlano: Record<Tier, number> }>;
  solanaSemTaxa: string[];
  naoMedido: string[];
  fetchedAt: string;
}

const PLANOS: Tier[] = ["free", "pro", "trader", "pilot"];
const usd = (n: number) => `$${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/**
 * ⚠️ ARRECADAÇÃO PEQUENA PRECISA DE CASAS, senão some (Fase 11).
 *
 * A primeira retenção da história foi $0,092. Com duas casas ela vira "$0,09",
 * e a segunda vira "$0,00" — um valor que existe mostrado como se não
 * existisse. Enquanto o número for pequeno, ele é escrito por inteiro.
 */
const usdFino = (n: number) =>
  n === 0 ? "$0" : n < 1 ? `$${n.toFixed(4)}` : usd(n);

/** Nome legível da origem. `?` quando algo novo aparecer sem tradução. */
const ORIGEM: Record<string, string> = {
  dex_swap:      "Swap DEX",
  dex_bridge:    "Ponte entre cadeias",
  autopilot_cex: "Autopiloto (corretora)",
  cex_spot:      "Spot na corretora",
};

export default function ReceitaPanel() {
  const [data, setData] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/receita");
      if (!res.ok) { setErro(`HTTP ${res.status}`); return; }
      setData(await res.json() as Dados); setErro(null);
    } catch (e) { setErro(String(e).slice(0, 140)); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <TerminalPanel
      id="receita-taxa"
      title="RECEITA DE TAXA"
      subtitle="C21/C22 — o que a plataforma arrecada por operar, não por acertar direção"
      icon="💵"
      source="supabase/operations + tier/fees"
      onRefresh={carregar}
    >
      {erro && <div style={{ color: "var(--adm-red)", fontSize: 12 }}>{erro}</div>}
      {!data && !erro && <div className="adm-shimmer" style={{ height: 60 }} />}

      {data && (
        <>
          {/* ── ARRECADADO — dinheiro que MUDOU DE MÃOS (Fase 11) ──────

                 ⚠️ ESTE BLOCO VEM PRIMEIRO, e o TETO desceu para baixo dele.

                 Durante meses o topo do painel dizia "RECEITA (TETO, a 1%)
                 $1,27" — 1% do volume. Em 11/08 descobrimos que a cotação
                 FIRME nunca mandava a taxa: de 13/06 até as 10:42 daquele dia,
                 toda troca cobrou ZERO. O teto não era estimativa conservadora
                 do que houve; era a resposta de outra pergunta ("quanto TERIA
                 rendido SE") ocupando o lugar do resultado.

                 Aqui é soma de PARCELA: cada operação declara quanto foi
                 retido, e a contagem ao lado diz de quantas. Sem parcela o
                 número é zero, e a contagem zero explica por quê. */}
          <div style={{ fontSize: 12, color: "var(--adm-green)", letterSpacing: "0.12em", marginBottom: 4 }}>
            ARRECADADO — taxa retida em operação confirmada
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <Bloco r="DINHEIRO QUE ENTROU" v={usdFino(data.arrecadado.usd)} c="var(--adm-green)" />
            <Bloco r="OPERAÇÕES QUE RETIVERAM" v={String(data.arrecadado.operacoes)} c="var(--adm-ink-2)" />
          </div>
          {data.arrecadado.operacoes === 0 && (
            <div style={{ fontSize: 11, color: "var(--adm-amber)", lineHeight: 1.6, marginBottom: 8 }}>
              ⚠️ nenhuma operação com retenção gravada ainda — a arrecadação passou a ser
              gravada por operação em 11/08; o que veio antes não tem como ser recuperado
            </div>
          )}

          {/* ── DE ONDE VEM O DINHEIRO ──────────────────────────────────

                 ⚠️ A COLUNA `cobravel` É O PONTO DESTA TABELA. `autopilot_cex`
                 e `cex_spot` são ordens do usuário na corretora dele: não
                 passam por `/api/quote` e não têm onde reter nada. A receita
                 deles é zero POR CONSTRUÇÃO, não por falha — e sem dizer isso,
                 "VOLUME $127" ao lado de "RECEITA" faz qualquer um concluir
                 que os $127 renderam. Onze das dezessete operações não podiam
                 render nada. */}
          <div style={{ fontSize: 12, color: "var(--adm-cyan)", letterSpacing: "0.12em", marginBottom: 2, marginTop: 8 }}>
            DE ONDE VEM — por origem
          </div>
          <div style={{ overflowX: "auto", marginBottom: 8 }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--adm-ink-4)", textAlign: "right" }}>
                  <th style={{ textAlign: "left", padding: "2px 6px 2px 0", fontWeight: 400 }}>ORIGEM</th>
                  <th style={{ padding: "2px 6px", fontWeight: 400 }}>OPS</th>
                  <th style={{ padding: "2px 6px", fontWeight: 400 }}>VOLUME</th>
                  <th style={{ padding: "2px 6px", fontWeight: 400 }}>ARRECADADO</th>
                </tr>
              </thead>
              <tbody>
                {data.porOrigem.map((o) => (
                  <tr key={o.kind} style={{ borderTop: "1px solid var(--adm-line)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "3px 6px 3px 0", color: "var(--adm-ink-2)" }}>
                      {ORIGEM[o.kind] ?? o.kind}
                      {!o.cobravel && (
                        <span style={{ color: "var(--adm-ink-4)", fontSize: 11 }}> · não cobra</span>
                      )}
                    </td>
                    <td style={{ padding: "3px 6px", color: "var(--adm-ink-3)" }}>{o.operacoes}</td>
                    <td style={{ padding: "3px 6px", color: "var(--adm-ink-3)" }}>{usd(o.volumeUsd)}</td>
                    <td style={{ padding: "3px 6px", color: o.cobravel ? "var(--adm-green)" : "var(--adm-ink-4)" }}>
                      {o.cobravel ? usdFino(o.arrecadadoUsd) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 10 }}>
            <b>&quot;não cobra&quot; não é falha</b>: corretora e autopiloto são ordens do usuário na
            conta dele — não passam pela nossa cotação e não há onde reter taxa. O volume é
            real; a receita é zero por construção.
            {" · "}<b>Passes (tier)</b> não aparecem aqui: são receita ATRIBUÍDA (assinantes ×
            preço), não caixa arrecadado — ficam no painel 💰 RECEITA ao lado.
          </div>

          {/* ── O VOLUME MEDIDO, e o TETO que ele geraria ─────────────── */}
          <div style={{ fontSize: 12, color: "var(--adm-ink-3)", letterSpacing: "0.12em", marginBottom: 4 }}>
            VOLUME MEDIDO — e o teto que ele TERIA gerado
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <Bloco r="VOLUME REAL" v={usd(data.real.volumeUsd)} c="var(--adm-ink-2)" />
            <Bloco r="OPERAÇÕES" v={String(data.real.operacoes)} c="var(--adm-ink-2)" />
            {/* ⚠️ TETO, não estimativa — o livro não guarda o plano de quem operou. */}
            {/* ⚠️ ÂMBAR, NÃO VERDE, e o rótulo diz "teria". Verde ao lado de um
                   valor maior que o arrecadado é a mentira que este painel
                   contou por meses. */}
            <Bloco r="TETO — TERIA RENDIDO a 1%" v={usd(data.receitaRealTetoUsd)} c="var(--adm-amber)" />
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
            {data.real.desde
              ? <>de {data.real.desde.slice(0, 10)} a {data.real.ate?.slice(0, 10)}</>
              : "nenhuma operação com volume registrado"}
            {data.sonda > 0 && (
              <> · <span style={{ color: "var(--adm-ink-4)" }}>
                {data.sonda} linha(s) de SONDA fora da conta (volume zero DECLARADO, do banco de ataque)
              </span></>
            )}
            {/* ⚠️ ISTO NÃO É SONDA, E ESSA É A DIFERENÇA QUE FALTAVA (11/08).
                   Operação de cliente CONFIRMADA cujo volume nunca foi gravado.
                   Ela estava sendo contada como tráfego de teste e sumindo da
                   conta — a causa era o `ExecuteSwap` não passar `valueUsd`, e
                   TODA troca DEX desde 13/06 entrou assim. Fica em âmbar e com
                   nome porque, ao contrário da sonda, ela PEDE alguma coisa: é
                   receita que existiu e o livro não sabe medir. */}
            {data.semVolume > 0 && (
              <> · <span style={{ color: "var(--adm-amber)" }}>
                ⚠️ {data.semVolume} operação(ões) CONFIRMADAS sem volume gravado — TODAS
                anteriores a 11/08, quando o valor em dólar passou a ser gravado. Não são
                sonda; são operações reais cujo volume o livro não tem como recuperar
                (o preço do dia da troca não existe em lugar nenhum)
              </span></>
            )}
          </div>

          {/* ── A PROJEÇÃO, separada e rotulada ──────────────────────── */}
          <div style={{ fontSize: 12, color: "var(--adm-amber)", letterSpacing: "0.12em", marginBottom: 2 }}>
            PROJEÇÃO — aritmética sobre volume HIPOTÉTICO, não previsão
          </div>
          <div style={{ fontSize: 11, color: "var(--adm-ink-4)", marginBottom: 5, lineHeight: 1.6 }}>
            responde &quot;quanto renderia SE&quot;, nunca &quot;quanto vai render&quot;
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>VOLUME/MÊS</th>
                  {PLANOS.map((t) => (
                    <th key={t} style={{ textAlign: "right" }}>
                      {t.toUpperCase()} <span style={{ color: "var(--adm-ink-4)" }}>
                        {(data.taxaPorPlano[t] / 100).toFixed(2)}%
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.projecao.map((f) => (
                  <tr key={f.volumeUsd}>
                    <td>${f.volumeUsd.toLocaleString("pt-BR")}</td>
                    {PLANOS.map((t) => (
                      <td key={t} style={{ textAlign: "right", fontWeight: t === "free" ? 700 : 400 }}>
                        {usd(f.porPlano[t])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── A SOLANA, e por que não cobra ────────────────────────── */}
          <div style={{ marginTop: 8, borderTop: "1px solid var(--adm-border)", paddingTop: 6 }}>
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)" }}>
              <b>SOLANA: sem taxa por DECISÃO</b> — não por falta de endereço
            </div>
            <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
              {data.solanaSemTaxa.map((m, i) => (
                <li key={i} style={{ color: "var(--adm-ink-4)", fontSize: 11, lineHeight: 1.6 }}>{m}</li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 8, borderTop: "1px solid var(--adm-border)", paddingTop: 6 }}>
            <div style={{ fontSize: 11, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>
              O QUE ESTE PAINEL NÃO MEDE
            </div>
            <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
              {data.naoMedido.map((n, i) => (
                <li key={i} style={{ color: "var(--adm-ink-4)", fontSize: 11, lineHeight: 1.6 }}>{n}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </TerminalPanel>
  );
}

function Bloco({ r, v, c }: { r: string; v: string; c: string }) {
  return (
    <div style={{ border: "1px solid var(--adm-border)", borderRadius: 3, padding: "4px 8px", minWidth: 92 }}>
      <div style={{ fontSize: 10, color: "var(--adm-ink-4)", letterSpacing: "0.1em" }}>{r}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
    </div>
  );
}
