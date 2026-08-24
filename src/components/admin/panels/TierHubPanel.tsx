"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import TerminalPanel from "../TerminalPanel";
import type { Tier } from "@/lib/tier/types";

interface Faixa {
  tier: Tier; deus: string; runa: string; epiteto: string;
  carta: string;
  guerreiro: string; guerreiroDesc: string; guerreiroRuna: string;
  avatar: string; brasao: string;
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
        <div className="hub-corpo-painel">
          {/* ── AS TRÊS FAIXAS ─────────────────────────────────────

                 ⚠️ CARTA HORIZONTAL, não vertical. A primeira versão usava
                 arte em 4:3 e empilhava em duas colunas — a terceira faixa
                 quebrava para outra fileira e saía cortada pela dobra. Numa
                 tela que ninguém rola, isso escondia um terço do produto.
                 Miniatura + dados ao lado cabe as três em ~240px. */}
          <div className="hub-faixas">
            {d.faixas.map((f, i) => (
              <article
                key={f.tier}
                className={`hub-carta${i === foco ? " ativa" : ""}`}
                onMouseEnter={() => setFoco(i)}
              >
                {/* ⚠️ AS DUAS ARTES, LADO A LADO. Cada faixa vende DOIS
                    produtos: o passe (NFT do deus, compra única de 3 anos) e a
                    Hird (o guerreiro que serve aquele deus, mensal). Mostrar
                    só o passe escondia metade da oferta — e justamente a
                    metade recorrente, que é a que sustenta o negócio. */}
                <div className="hub-artes">
                  <figure className="hub-arte passe">
                    <Image src={f.carta} alt={`Passe ${f.deus}`} fill sizes="52px"
                           style={{ objectFit: "cover" }} />
                    <figcaption>PASSE</figcaption>
                  </figure>
                  <figure className="hub-arte hird">
                    <Image src={f.avatar} alt={`Hird ${f.guerreiro}`} fill sizes="52px"
                           style={{ objectFit: "cover" }} />
                    <figcaption>HIRD</figcaption>
                  </figure>
                </div>

                <div className="hub-corpo">
                  <h4>
                    <span className="hub-runa" aria-hidden>{f.runa}</span>
                    {f.deus}
                    <span className="hub-tier">{f.tier}</span>
                  </h4>
                  <p className="hub-epiteto">{f.epiteto}</p>

                  <p className="hub-precos">
                    <span className="passe">passe <b>{usd(f.precoUsd)}</b> <i>3 anos</i></span>
                    <span className="hird">
                      <span className="hub-runa-h" aria-hidden>{f.guerreiroRuna}</span>
                      {f.guerreiro} <b>{usd(f.mensalUsd)}</b><i>/mês</i>
                    </span>
                  </p>
                </div>

                <div className="hub-conta">
                  {/* ⚠️ O NÚMERO GRANDE É O DE COMPRAS. Contagem sem origem
                      vira cortesia lida como tração. */}
                  <strong className={f.compradas > 0 ? "vendeu" : "zerado"}>
                    {f.compradas}
                  </strong>
                  <span className="hub-rot">comprados</span>
                  {f.cortesia > 0 && (
                    <span className="hub-cortesia">+{f.cortesia} cortesia</span>
                  )}
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
        </div>
      )}
    </TerminalPanel>
  );
}
