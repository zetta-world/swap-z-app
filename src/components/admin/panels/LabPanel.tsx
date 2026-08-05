"use client";

import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";

/**
 * O LABORATÓRIO — as 26 estratégias, uma família por vez.
 *
 * ⚠️ O QUE ESTE PAINEL CONSERTA (auditoria visual de 05/08).
 *
 * O dono mandou 11 prints e disse: "se eu mostrar a um leigo ele não vai saber
 * o que é o quê, qual mesa é, e o que mede o quê". Os defeitos catalogados:
 *
 *  · 11 painéis empilhados numa aba só, sem hierarquia
 *  · a mesma carteira com números diferentes em painéis diferentes
 *  · nomes vikings sem legenda — MÍMIR não diz nada para quem não construiu
 *  · 23 chips de filtro numa fileira
 *  · CAPITAL invisível, e é a variável que mais explica o resultado
 *  · AMOSTRA em cinza claro do lado de um número grande e colorido
 *
 * As regras que este painel segue, e que valem para todos os próximos:
 *
 *  1. UMA FAMÍLIA POR VEZ. Não 26 cartões empilhados — abas por quem paga você.
 *  2. VEREDITO ANTES DO NÚMERO. Placar antes do veredito convida a ler retorno
 *     como aprovação, e foi assim que os +34% duraram três semanas.
 *  3. TRÊS ESTADOS, e CINZA é cinza. Não medido não é âmbar: ausência de
 *     informação não é aviso, é vazio.
 *  4. CAPITAL SEMPRE VISÍVEL. Resultado sem o capital que o produziu não é
 *     comparável com nada.
 *  5. AMOSTRA SEMPRE VISÍVEL. Número sem `n` é opinião.
 */

type Estrategia = {
  id: string; slug: string; name: string; subtitle: string; family: string;
  capitalRequiredUsd: number; capitalWhy: string;
  status: "verde" | "cinza" | "morta";
  hypothesis?: string; killedWhy?: string;
  lastRunAt: string | null;
  lastStatus: "ok" | "falhou" | "rodando" | null;
  lastNetPct: number | null; lastNetAnnualizedPct: number | null;
  lastSampleN: number | null; lastVerdict: string | null; lastVerdictText: string | null;
  runs: number;
};
type Familia = { id: string; label: string; hint: string };
type Dados = { familias: Familia[]; estrategias: Estrategia[]; sincronizadoAgora: boolean };

const usd = (n: number) => (n <= 1 ? "—" : `$${n.toLocaleString("pt-BR")}`);
const pct = (n: number | null, d = 2) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

/** Os três estados. CINZA é neutro de propósito — ver a regra 3. */
const COR: Record<string, string> = {
  verde: "var(--adm-green)", morta: "var(--adm-red)", cinza: "var(--adm-ink-4)",
};
const ROTULO: Record<string, string> = {
  verde: "MEDIDA · positiva", morta: "MEDIDA · negativa", cinza: "NÃO MEDIDA",
};

export default function LabPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [aba, setAba] = useState<string>("direcional");
  const [aberta, setAberta] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/admin/api/lab");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.status);
      setD(json); setErr(null);
    } catch (e) { setErr(String(e)); } finally { setCarregando(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const daFamilia = (d?.estrategias ?? []).filter((e) => e.family === aba);
  const capitalDaFamilia = daFamilia.reduce((s, e) => s + (e.capitalRequiredUsd > 1 ? e.capitalRequiredUsd : 0), 0);
  const medidas = daFamilia.filter((e) => e.status !== "cinza").length;

  return (
    <TerminalPanel
      id="lab" title="LABORATÓRIO DE ESTRATÉGIAS"
      subtitle="26 formas de lucro — o que cada uma pede de capital, e o que já foi medido"
      icon="🔬" source="supabase/lab_strategies"
    >
      {carregando && <div className="adm-shimmer" style={{ height: 120 }} />}
      {err && <div style={{ color: "var(--adm-red)", fontSize: 10 }}>{err}</div>}

      {d && (
        <>
          {/* ── ABAS POR FAMÍLIA. A família diz QUEM paga você — é a única
                 classificação que importa, e evita comparar carrego com
                 direcional na mesma tabela. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {d.familias.map((f) => {
              const n = d.estrategias.filter((e) => e.family === f.id).length;
              const ativa = f.id === aba;
              return (
                <button
                  key={f.id} onClick={() => { setAba(f.id); setAberta(null); }}
                  className="adm-btn"
                  style={{
                    padding: "4px 9px", fontSize: 9,
                    borderColor: ativa ? "var(--adm-cyan)" : undefined,
                    color: ativa ? "var(--adm-cyan)" : undefined,
                  }}
                >
                  {f.label} <span style={{ opacity: 0.6 }}>({n})</span>
                </button>
              );
            })}
          </div>

          {/* O que a família É, em uma linha, mais o capital que ela exige
              somado — o número que diz se dá para rodar tudo de uma vez. */}
          <div style={{ fontSize: 9, color: "var(--adm-ink-3)", marginBottom: 10, lineHeight: 1.6 }}>
            {d.familias.find((f) => f.id === aba)?.hint}
            {" · "}<b>{daFamilia.length}</b> estratégias
            {" · "}capital somado <b>{usd(capitalDaFamilia)}</b>
            {" · "}<b style={{ color: medidas > 0 ? "var(--adm-green)" : "var(--adm-ink-4)" }}>
              {medidas} medidas
            </b>{" "}de {daFamilia.length}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            {daFamilia.map((e) => {
              const aberto = aberta === e.slug;
              return (
                <div
                  key={e.slug}
                  style={{
                    border: "1px solid var(--adm-border)", borderRadius: 4,
                    borderLeft: `2px solid ${COR[e.status]}`,
                    background: "var(--adm-bg-2, transparent)",
                  }}
                >
                  <button
                    onClick={() => setAberta(aberto ? null : e.slug)}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      background: "none", border: "none", cursor: "pointer",
                      padding: "8px 10px", color: "inherit", font: "inherit",
                    }}
                  >
                    {/* NOME + SUBTÍTULO FUNCIONAL. A decisão de 05/08: mantém a
                        identidade e resolve a legibilidade. */}
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 11, color: "var(--adm-ink-1, var(--adm-ink-2))", fontWeight: 600 }}>
                        {e.name}
                      </span>
                      <span style={{ fontSize: 7.5, letterSpacing: "0.08em", color: COR[e.status], whiteSpace: "nowrap" }}>
                        {ROTULO[e.status]}
                      </span>
                    </div>
                    <div style={{ fontSize: 8.5, color: "var(--adm-ink-4)", marginTop: 2 }}>
                      {e.subtitle}
                    </div>

                    {/* O RESULTADO, com a AMOSTRA colada nele. Número sem `n`
                        é opinião — e um `n` em cinza claro do lado de um número
                        grande e colorido não conta como visível. */}
                    <div style={{ display: "flex", gap: 12, marginTop: 5, fontSize: 9, alignItems: "baseline" }}>
                      {e.lastStatus === "ok" ? (
                        <>
                          <span style={{ color: "var(--adm-ink-4)" }}>
                            líquido{" "}
                            <b style={{
                              color: (e.lastNetPct ?? 0) > 0 ? "var(--adm-green)" : "var(--adm-red)",
                              fontSize: 11,
                            }}>
                              {pct(e.lastNetPct)}
                            </b>
                          </span>
                          <span style={{ color: "var(--adm-ink-4)" }}>
                            ao ano <b>{pct(e.lastNetAnnualizedPct, 1)}</b>
                          </span>
                          <span style={{
                            color: (e.lastSampleN ?? 0) >= 30 ? "var(--adm-ink-3)" : "var(--adm-amber)",
                          }}>
                            n={e.lastSampleN ?? 0}
                            {(e.lastSampleN ?? 0) < 30 && " · amostra curta"}
                          </span>
                        </>
                      ) : e.lastStatus === "falhou" ? (
                        <span style={{ color: "var(--adm-red)" }}>última rodada FALHOU — abra para ver o motivo</span>
                      ) : (
                        <span style={{ color: "var(--adm-ink-4)" }}>
                          nunca rodou · aguarda a fase que a mede
                        </span>
                      )}
                      <span style={{ marginLeft: "auto", color: "var(--adm-ink-4)", fontSize: 8 }}>
                        {aberto ? "▲" : "▼"}
                      </span>
                    </div>
                  </button>

                  {aberto && (
                    <div style={{
                      borderTop: "1px solid var(--adm-border)", padding: "8px 10px",
                      fontSize: 8.5, color: "var(--adm-ink-3)", lineHeight: 1.7,
                    }}>
                      {/* O CAPITAL E O PORQUÊ DELE. É a variável que mais
                          explica o resultado, e ela era invisível no painel
                          antigo — 23 mesas com $1.000 independentemente do que
                          a estratégia exige. */}
                      <div>
                        <span style={{ color: "var(--adm-cyan)" }}>capital exigido</span>{" "}
                        <b style={{ color: "var(--adm-ink-2)" }}>{usd(e.capitalRequiredUsd)}</b>
                        <div style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>{e.capitalWhy}</div>
                      </div>

                      {e.hypothesis && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "var(--adm-cyan)" }}>hipótese registrada antes do dado</span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>{e.hypothesis}</div>
                        </div>
                      )}
                      {e.killedWhy && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "var(--adm-red)" }}>por que foi reprovada</span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>{e.killedWhy}</div>
                        </div>
                      )}
                      {e.lastVerdictText && (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ color: "var(--adm-cyan)" }}>veredito da última rodada</span>
                          <div style={{ color: "var(--adm-ink-4)", fontSize: 8 }}>{e.lastVerdictText}</div>
                        </div>
                      )}
                      <div style={{ marginTop: 6, color: "var(--adm-ink-4)", fontSize: 8 }}>
                        {e.runs} rodada(s) registrada(s)
                        {e.lastRunAt && ` · última em ${new Date(e.lastRunAt).toLocaleString("pt-BR")}`}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 8, color: "var(--adm-ink-4)", marginTop: 10, lineHeight: 1.7 }}>
            <b style={{ color: COR.cinza }}>NÃO MEDIDA</b> é cinza de propósito: ausência de
            informação não é aviso, é vazio — não confundir com reprovada.
            {" · "}O capital de cada uma é o que a ESTRATÉGIA exige, não o que ela tem hoje:
            mesa sub-capitalizada não rende menos, rende negativo por custo fixo.
          </div>
        </>
      )}
    </TerminalPanel>
  );
}
