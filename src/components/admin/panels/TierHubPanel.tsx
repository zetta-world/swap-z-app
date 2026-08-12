"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import type { Tier } from "@/lib/tier/types";

interface Faixa {
  tier: Tier; deus: string; runa: string; epiteto: string;
  guerreiro: string; carta: string;
  precoUsd: number; mensalUsd: number;
  ativos: number; compradas: number; cortesia: number;
}
interface Ativacao { quando: string; carteira: string; tier: string; comprou: boolean }
interface Dados {
  faixas: Faixa[]; ativacoes: Ativacao[];
  total: number; free: number; vendidas: number; cortesias: number;
}

const usd = (n: number) => `$${n.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

/**
 * O HUB DE PLANOS — a coluna 3 do centro de comando.
 *
 * ⚠️ CADA CARTA MOSTRA A ORIGEM, NÃO SÓ A CONTAGEM.
 *
 * Hoje todos os planos pagos são cortesia nossa — zero vendas. Um cartão
 * dizendo apenas "TRADER · 2 ativos" transformaria concessão em tração, que é
 * a leitura mais cara que este painel pode induzir, e justamente na tela que
 * fica aberta numa reunião. Por isso o número grande é o de COMPRAS, e a
 * cortesia aparece ao lado com nome próprio.
 *
 * ⚠️ E OS NOMES SÃO OS NOSSOS. A referência trazia "Valkyrie / Einherjar /
 * Aesir", inventados pela geração da imagem. O projeto já tem a sua mitologia
 * escrita em `PLAN_TIERS` — Freyr, Thor, Odin nos passes de lançamento; Drengr,
 * Berserkr, Einherjar nos guerreiros da Hird. Trocar por nomes de mockup
 * jogaria fora identidade que já existe e está no produto.
 */
export default function TierHubPanel() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [foco, setFoco] = useState(0);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/admin/api/tier-hub", { cache: "no-store" });
      if (!r.ok) { setErro(`HTTP ${r.status}`); return; }
      setD(await r.json() as Dados); setErro(null);
    } catch (e) { setErro(String(e).slice(0, 120)); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  /** A galeria gira sozinha — é vitrine, e vitrine parada não é vitrine. */
  useEffect(() => {
    if (!d?.faixas.length) return;
    const t = window.setInterval(() => setFoco((i) => (i + 1) % d.faixas.length), 6000);
    return () => window.clearInterval(t);
  }, [d?.faixas.length]);

  return (
    <TerminalPanel
      id="tier-hub"
      title="HUB DE PLANOS"
      subtitle="quem está em cada faixa — e se comprou ou ganhou"
      icon="🛡️"
      source="supabase/tier_cache + pricing/plans"
      onRefresh={carregar}
    >
      {erro && <div style={{ color: "var(--adm-red)", fontSize: 12 }}>{erro}</div>}
      {!d && !erro && <div className="adm-shimmer" style={{ height: 200 }} />}

      {d && (
        <>
          {/* ── AS TRÊS FAIXAS ─────────────────────────────────────── */}
          <div className="hub-faixas">
            {d.faixas.map((f, i) => (
              <article
                key={f.tier}
                className={`hub-carta${i === foco ? " ativa" : ""}`}
                onMouseEnter={() => setFoco(i)}
              >
                <div className="hub-arte">
                  <Image src={f.carta} alt={`Passe ${f.deus}`} fill sizes="220px"
                         style={{ objectFit: "cover" }} />
                </div>
                <div className="hub-corpo">
                  <span className="hub-runa" aria-hidden>{f.runa}</span>
                  <h4>{f.deus}</h4>
                  <p className="hub-epiteto">{f.epiteto} · {f.tier}</p>

                  {/* ⚠️ O NÚMERO GRANDE É O DE COMPRAS. Ver a nota do topo:
                         contagem sem origem vira cortesia lida como tração. */}
                  <strong className={f.compradas > 0 ? "vendeu" : "zerado"}>
                    {f.compradas}
                  </strong>
                  <span className="hub-rot">passe(s) COMPRADO(s)</span>

                  {f.cortesia > 0 && (
                    <span className="hub-cortesia">
                      + {f.cortesia} cortesia — concedida por nós, não é venda
                    </span>
                  )}
                  <span className="hub-preco">
                    {usd(f.precoUsd)} · Hird {usd(f.mensalUsd)}/mês
                  </span>
                </div>
              </article>
            ))}
          </div>

          {/* ── O PLACAR HONESTO ───────────────────────────────────── */}
          <div className="hub-placar">
            <span>VENDIDOS <b className={d.vendidas > 0 ? "vendeu" : "zerado"}>{d.vendidas}</b></span>
            <span className="sep">·</span>
            <span>CORTESIA <b>{d.cortesias}</b></span>
            <span className="sep">·</span>
            <span>FREE <b>{d.free}</b></span>
            <span className="sep">·</span>
            <span>CARTEIRAS <b>{d.total}</b></span>
          </div>

          {/* ── ATIVAÇÕES ──────────────────────────────────────────── */}
          <h5 className="hub-titulo">ATIVAÇÕES RECENTES</h5>
          {d.ativacoes.length === 0 ? (
            <p className="hub-vazio">nenhuma faixa paga ativada ainda</p>
          ) : (
            <ul className="hub-ativacoes">
              {d.ativacoes.map((a, i) => (
                <li key={`${a.carteira}-${i}`}>
                  <span className="q">{new Date(a.quando).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="w">{a.carteira}</span>
                  <span className="t">{a.tier}</span>
                  {/* ⚠️ A ORIGEM NA PRÓPRIA LINHA. "Virou trader" é a mesma
                      frase para comprou e ganhou — e numa lista que rola
                      ninguém volta para conferir. */}
                  <span className={a.comprou ? "o vendeu" : "o"}>
                    {a.comprou ? "COMPROU" : "cortesia"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </TerminalPanel>
  );
}
