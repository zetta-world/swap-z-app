"use client";

import { useCallback, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import { useAutoRefresh } from "../useAutoRefresh";

/**
 * O CELEIRO — a segunda arena, na tela.
 *
 * ⚠️⚠️ POR QUE ESTE PAINEL NÃO PARECE COM O TORNEIO, DE PROPÓSITO.
 *
 * O mandato foi explícito: *"tem que identificar no painel esse novo torneio de
 * uma forma que não confunda"* e *"nada de painel amontoado um em cima de outro
 * misturando tudo"*.
 *
 * Três decisões saem disso, e nenhuma é estética:
 *
 *  · **UMA TABELA POR FAIXA DE CAPITAL.** O portão de profundidade mostra que o
 *    mesmo livro aprova 100 USD com 0% de derrapagem e reprova 800 com 7,45%.
 *    Uma tabela única compararia coisas distintas.
 *
 *  · **A COLUNA PRINCIPAL É USDT, e win-rate não aparece.** Mediu-se mesas com
 *    70,2% e 60,0% de acerto PERDENDO dinheiro. Taxa de acerto na tela de
 *    ranking é um número que mente com cara de placar.
 *
 *  · **O CONTROLE EM TODA FAIXA, marcado.** Agente abaixo do Aluguel de Ocioso
 *    está destruindo valor — bastaria deixar o USDT rendendo. Sem o piso na
 *    MESMA tela, curva bonita e inútil passa por vitória.
 */

type Linha = {
  agente: string; nome: string; usdt: number; acimaDoControle: number;
  ehControle: boolean; convidado: boolean; semDado: boolean; lancamentos: number;
  modalidade: string; ritmo: string; motor: string; capitalMinimoUsd: number;
  mecanismo: string; naoFaz: string;
  porCausa: Record<string, number>;
  vazamentos: Array<{ causa: string; usdt: number; fatiaDoVazamento: number }>;
  fontes: Array<{ causa: string; usdt: number; fatiaDoVazamento: number }>;
};

type Faixa = { faixa: string; rotulo: string; linhas: Linha[] };

type Dados = {
  controle: string;
  semNenhumLancamento: boolean;
  totalDeLancamentos: number;
  faixas: Faixa[];
};

const MODALIDADE: Record<string, string> = {
  spot_gate: "spot · gate", margem_gate: "margem · gate",
  futuros_gate: "futuros · gate", dex: "dex",
};

function usd(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}

export default function CeleiroPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/admin/api/celeiro", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErro(j?.erro ?? "falhou"); return; }
      setErro(null); setD(j);
    } catch (e) { setErro(String(e)); }
  }, []);

  useAutoRefresh({ onRefresh: carregar, intervalMs: 60_000 });

  return (
    <TerminalPanel
      id="celeiro" title="CELEIRO" icon="🌾"
      subtitle="a segunda arena · placar em USDT acumulado, por faixa de capital"
      source="CELEIRO_FLUXOS"
    >
      {erro && <div className="adm-warn">{erro}</div>}

      {/*
        ⚠️ O ESTADO DE ARRANQUE É DITO, NÃO DEDUZIDO. Um painel todo zerado é
        ambíguo: pode ser "ninguém rendeu nada" (resultado) ou "nada foi lançado
        ainda" (ausência de medição). Confundir as duas é o começo de toda
        leitura errada, e a tela é onde a confusão nasce.
      */}
      {d?.semNenhumLancamento && (
        <div className="adm-note">
          <b>O Celeiro ainda não recebeu nenhum lançamento.</b> Isto não é
          resultado zero — é ausência de medição. Os agentes estão registrados e
          os portões construídos; nenhum escreveu no extrato ainda.
        </div>
      )}

      {d?.faixas.map((f) => (
        <section key={f.faixa} style={{ marginBottom: 22 }}>
          <h4 style={{ margin: "12px 0 6px", letterSpacing: ".04em" }}>
            {f.rotulo.toUpperCase()}
          </h4>

          <div style={{ overflowX: "auto" }}>
            <table className="adm-table" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>agente</th>
                  <th style={{ textAlign: "left" }}>onde · ritmo</th>
                  <th style={{ textAlign: "right" }}>USDT</th>
                  <th style={{ textAlign: "right" }}>vs. piso</th>
                  <th style={{ textAlign: "right" }}>lanç.</th>
                </tr>
              </thead>
              <tbody>
                {f.linhas.map((l) => (
                  <tr
                    key={l.agente}
                    onClick={() => setAberto(aberto === `${f.faixa}:${l.agente}` ? null : `${f.faixa}:${l.agente}`)}
                    style={{ cursor: "pointer", opacity: l.convidado ? 0.62 : 1 }}
                  >
                    <td>
                      {l.ehControle && <span title="o piso do Celeiro">⚖ </span>}
                      {l.nome}
                      {l.convidado && (
                        <span className="adm-dim" title="não é desta faixa — está aqui só como piso">
                          {" "}· piso
                        </span>
                      )}
                    </td>
                    <td className="adm-dim">
                      {MODALIDADE[l.modalidade] ?? l.modalidade} · {l.ritmo}
                      {l.motor === "bot" ? " · bot" : " · bot+ia"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {l.semDado ? <span className="adm-dim">sem dado</span> : <b>{usd(l.usdt)}</b>}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {l.ehControle || l.semDado
                        ? <span className="adm-dim">—</span>
                        : <span className={l.acimaDoControle >= 0 ? "adm-ok" : "adm-bad"}>
                            {usd(l.acimaDoControle)}
                          </span>}
                    </td>
                    <td style={{ textAlign: "right" }} className="adm-dim">{l.lancamentos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
            ⚠️ O EXTRATO DE VAZAMENTO, ABERTO NO CLIQUE. É a diferença entre
            "perdi 4 USDT" e "paguei 3,10 de taxa, 0,70 de derrapagem, recebi
            1,20 de funding e o preço levou 2,40". O placar antigo guardava o
            RESULTADO e nunca as PARTES — e por isso não conseguia explicar como
            uma mesa acerta 70% e perde dinheiro.
          */}
          {f.linhas.filter((l) => aberto === `${f.faixa}:${l.agente}`).map((l) => (
            <div key={l.agente} className="adm-note" style={{ marginTop: 8 }}>
              <div><b>{l.nome}</b> — {l.mecanismo}</div>
              <div className="adm-dim" style={{ marginTop: 4 }}>
                <b>não faz:</b> {l.naoFaz}
              </div>
              <div className="adm-dim" style={{ marginTop: 4 }}>
                capital mínimo {l.capitalMinimoUsd > 0 ? `$${l.capitalMinimoUsd}` : "nenhum"}
              </div>

              {l.semDado ? (
                <div style={{ marginTop: 8 }}>
                  Nenhum lançamento — <b>sem dado não há diagnóstico</b>.
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <div>
                    <b>entrou:</b>{" "}
                    {l.fontes.length === 0
                      ? "nada"
                      : l.fontes.map((v) => `${v.causa} ${usd(v.usdt)}`).join(" · ")}
                  </div>
                  <div>
                    <b>vazou:</b>{" "}
                    {l.vazamentos.length === 0
                      ? "nada"
                      : l.vazamentos.map((v) =>
                          `${v.causa} ${usd(v.usdt)} (${(v.fatiaDoVazamento * 100).toFixed(0)}%)`,
                        ).join(" · ")}
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      {d && (
        <div className="adm-dim" style={{ marginTop: 10, fontSize: 11 }}>
          {d.totalDeLancamentos} lançamentos no extrato · ⚖ = o piso (Aluguel de
          Ocioso). <b>Win-rate não aparece de propósito</b>: mediu-se mesas com
          70% de acerto perdendo dinheiro.
        </div>
      )}
    </TerminalPanel>
  );
}
