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
  receitaRealTetoUsd: number;
  taxaPorPlano: Record<Tier, number>;
  projecao: Array<{ volumeUsd: number; porPlano: Record<Tier, number> }>;
  solanaSemTaxa: string[];
  naoMedido: string[];
  fetchedAt: string;
}

const PLANOS: Tier[] = ["free", "pro", "trader", "pilot"];
const usd = (n: number) => `$${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
      {erro && <div style={{ color: "var(--adm-red)", fontSize: 9 }}>{erro}</div>}
      {!data && !erro && <div className="adm-shimmer" style={{ height: 60 }} />}

      {data && (
        <>
          {/* ── O REAL ───────────────────────────────────────────────── */}
          <div style={{ fontSize: 9, color: "var(--adm-ink-3)", letterSpacing: "0.12em", marginBottom: 4 }}>
            MEDIDO — o que de fato passou pelo livro
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <Bloco r="VOLUME REAL" v={usd(data.real.volumeUsd)} c="var(--adm-ink-2)" />
            <Bloco r="OPERAÇÕES" v={String(data.real.operacoes)} c="var(--adm-ink-2)" />
            {/* ⚠️ TETO, não estimativa — o livro não guarda o plano de quem operou. */}
            <Bloco r="RECEITA (TETO, a 1%)" v={usd(data.receitaRealTetoUsd)} c="var(--adm-green)" />
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", lineHeight: 1.6, marginBottom: 8 }}>
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
                ⚠️ {data.semVolume} operação(ões) CONFIRMADAS sem volume gravado — não são sonda,
                são receita que o livro não consegue medir
              </span></>
            )}
          </div>

          {/* ── A PROJEÇÃO, separada e rotulada ──────────────────────── */}
          <div style={{ fontSize: 9, color: "var(--adm-amber)", letterSpacing: "0.12em", marginBottom: 2 }}>
            PROJEÇÃO — aritmética sobre volume HIPOTÉTICO, não previsão
          </div>
          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginBottom: 5, lineHeight: 1.6 }}>
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
            <div style={{ fontSize: 8.5, color: "var(--adm-ink-3)" }}>
              <b>SOLANA: sem taxa por DECISÃO</b> — não por falta de endereço
            </div>
            <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
              {data.solanaSemTaxa.map((m, i) => (
                <li key={i} style={{ color: "var(--adm-ink-4)", fontSize: 8, lineHeight: 1.6 }}>{m}</li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 8, borderTop: "1px solid var(--adm-border)", paddingTop: 6 }}>
            <div style={{ fontSize: 8, color: "var(--adm-ink-3)", letterSpacing: "0.1em" }}>
              O QUE ESTE PAINEL NÃO MEDE
            </div>
            <ul style={{ margin: "3px 0 0", paddingLeft: 14 }}>
              {data.naoMedido.map((n, i) => (
                <li key={i} style={{ color: "var(--adm-ink-4)", fontSize: 8, lineHeight: 1.6 }}>{n}</li>
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
      <div style={{ fontSize: 7.5, color: "var(--adm-ink-4)", letterSpacing: "0.1em" }}>{r}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: c }}>{v}</div>
    </div>
  );
}
