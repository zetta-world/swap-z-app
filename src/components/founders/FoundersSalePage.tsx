"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ShieldCheck, Lock, Network, Fingerprint, Landmark, Info, ChevronLeft, ChevronRight, Crown, CheckCircle2, CircleDashed } from "lucide-react";
import { useT, type MessageKey } from "@/lib/i18n";
import { useUI } from "@/lib/store/ui";
import FoundersSalePanel from "./FoundersSalePanel";
import type { QuadroPrevia } from "@/lib/founders-sale/previa";

/**
 * PÁGINA DA VENDA FOUNDERS — 17 seções, identidade Z-SWAP (obsidiana, ciano/violeta, ouro contido, deuses nórdicos).
 *
 * Só RENDERIZA quadros calculados no servidor (`founders-sale/previa.ts` / futuramente o serviço real):
 * nenhum estado é decidido no navegador. Preço público = "preço em definição" enquanto não for FINAL; o valor
 * provisório só aparece com o rótulo PROVISÓRIO quando `previa` (rota local atrás de flag).
 * Sem estatística em tempo real fabricada, sem urgência falsa, sem promessa financeira.
 */
const TIERS = ["PRO", "TRADER", "PILOT"] as const;
const FEATURES: Record<(typeof TIERS)[number], MessageKey[]> = {
  PRO: ["founders.pg_feat_zion", "founders.pg_feat_autopilot"],
  TRADER: ["founders.pg_feat_zion", "founders.pg_feat_autopilot", "founders.pg_feat_arb", "founders.pg_feat_support"],
  PILOT: ["founders.pg_feat_zion", "founders.pg_feat_autopilot", "founders.pg_feat_arb", "founders.pg_feat_support"],
};
const DEUS: Record<(typeof TIERS)[number], { arte: string; tom: string }> = {
  PRO: { arte: "/nft/pro.jpg", tom: "from-cyan/30" },
  TRADER: { arte: "/nft/trader.png", tom: "from-violet/30" },
  PILOT: { arte: "/nft/pilot.jpg", tom: "from-gold/30" },
};
const PASSOS_TX = ["PREPARING", "WALLET_CONFIRMATION", "SUBMITTED", "PENDING", "CONFIRMED"] as const;
const ORDEM_TX: Record<string, number> = { IDLE: -1, PREPARING: 0, WALLET_CONFIRMATION: 1, SUBMITTED: 2, PENDING: 3, CONFIRMED: 4, FAILED: -2, EXPIRED: -2, CANCELLED: -2 };

function Secao({ id, titulo, children, className = "" }: { id: string; titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`rounded-3xl border border-border-soft bg-bg-1/70 p-5 sm:p-7 ${className}`}>
      <h2 id={id} className="font-display font-extrabold text-xl sm:text-2xl text-ink mb-4">{titulo}</h2>
      {children}
    </section>
  );
}

export default function FoundersSalePage({ quadros, previa, inicial }: { quadros: QuadroPrevia[]; previa: boolean; inicial?: string }) {
  const t = useT();
  const lang = useUI((s) => s.lang);
  const id = useId();
  const [i, setI] = useState(() => Math.max(0, quadros.findIndex((q) => q.id === inicial)));
  const q = quadros[i] ?? quadros[0];
  const onbRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (q?.onboarding) onbRef.current?.focus(); }, [q?.id, q?.onboarding]);
  if (!q) return null;
  const fmtData = (ms: number) => new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : lang === "pt" ? "pt-BR" : lang === "es" ? "es-ES" : "en-US", { dateStyle: "long", timeZone: "UTC" }).format(ms);
  const pctFee = (bps: number) => `${(bps / 100).toLocaleString("en-US")}%`;
  const passoAtual = ORDEM_TX[q.tx] ?? -1;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6 sm:py-10 flex flex-col gap-6">
      {previa ? (
        <div role="note" className="rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3 font-mono text-xs text-gold flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
          <span className="flex items-center gap-2"><Info aria-hidden className="w-4 h-4 flex-shrink-0" />{t("founders.pg_previewBanner")}</span>
          <nav aria-label={t("founders.pg_scenarioLabel")} className="flex items-center gap-2 w-full lg:w-auto min-w-0">
            <button type="button" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} aria-label={t("founders.pg_scenarioPrev")}
              className="min-h-11 min-w-11 flex-shrink-0 rounded-xl border border-gold/40 flex items-center justify-center disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
              <ChevronLeft aria-hidden className="w-4 h-4" />
            </button>
            <label className="sr-only" htmlFor={`${id}-quadro`}>{t("founders.pg_scenarioLabel")}</label>
            <select id={`${id}-quadro`} value={i} onChange={(e) => setI(Number(e.target.value))}
              className="min-h-11 min-w-0 flex-1 lg:flex-none lg:w-72 rounded-xl bg-bg-2 border border-gold/40 text-ink px-2 font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
              {quadros.map((x, k) => <option key={x.id} value={k}>{k + 1}. {x.estadoUI}</option>)}
            </select>
            <button type="button" onClick={() => setI((x) => Math.min(quadros.length - 1, x + 1))} disabled={i === quadros.length - 1} aria-label={t("founders.pg_scenarioNext")}
              className="min-h-11 min-w-11 flex-shrink-0 rounded-xl border border-gold/40 flex items-center justify-center disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">
              <ChevronRight aria-hidden className="w-4 h-4" />
            </button>
          </nav>
        </div>
      ) : null}

      {/* 1. HERO */}
      <header className="relative overflow-hidden rounded-3xl border border-border-soft bg-bg-1 p-6 sm:p-10">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(159,95,255,0.18),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(0,232,255,0.12),transparent_55%)]" />
        <div className="relative flex flex-col gap-4 max-w-3xl">
          <p className="font-mono text-[11px] tracking-widest uppercase text-cyan">{t("founders.pg_heroEyebrow")}</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-5xl text-ink leading-tight">{t("founders.pg_heroTitle")}</h1>
          <p className="font-sans text-base sm:text-lg text-ink-1 leading-relaxed">{t("founders.pg_heroSub")}</p>
          <p className="font-mono text-xs text-ink-2 flex items-center gap-2"><ShieldCheck aria-hidden className="w-4 h-4 text-gold" />{t("founders.pg_heroNotInvestment")}</p>
        </div>
      </header>

      {/* 2. TESE */}
      <Secao id={`${id}-tese`} titulo={t("founders.pg_thesisTitle")}>
        <ul className="grid gap-3 sm:grid-cols-3">
          {(["pg_thesis1", "pg_thesis2", "pg_thesis3"] as const).map((k) => (
            <li key={k} className="rounded-2xl border border-border-faint bg-bg-2/60 p-4 font-sans text-sm text-ink-1 leading-relaxed">{t(`founders.${k}` as MessageKey)}</li>
          ))}
        </ul>
      </Secao>

      {/* 3. COMPARAÇÃO DE TIERS (+ preço sem número público) */}
      <Secao id={`${id}-tiers`} titulo={t("founders.pg_tiersTitle")}>
        <ul className="grid gap-4 md:grid-cols-3">
          {TIERS.map((tier) => (
            <li key={tier} className={`rounded-2xl border border-border-soft bg-gradient-to-b ${DEUS[tier].tom} to-bg-2/40 p-4 flex flex-col gap-3`}>
              <div className="flex items-center gap-3">
                <span aria-hidden className="w-10 h-10 rounded-xl border border-gold/40 bg-bg flex items-center justify-center"><Crown className="w-5 h-5 text-gold" /></span>
                <h3 className="font-display font-extrabold text-lg text-ink">{t(`founders.pg_tier_${tier}` as MessageKey)}</h3>
              </div>
              <dl className="grid grid-cols-2 gap-2 font-mono text-xs">
                <div><dt className="text-ink-3 uppercase tracking-wider text-[10px]">{t("founders.pg_tierSupply")}</dt><dd className="text-ink tabular-nums">{q.supplyPago[tier].toLocaleString("en-US")}</dd></div>
                <div><dt className="text-ink-3 uppercase tracking-wider text-[10px]">{t("founders.pg_tierReserved")}</dt><dd className="text-ink tabular-nums">{q.reservaPorTier[tier].toLocaleString("en-US")}</dd></div>
                <div><dt className="text-ink-3 uppercase tracking-wider text-[10px]">{t("founders.pg_tierFee")}</dt><dd className="text-ink tabular-nums">{pctFee(q.taxaBps[tier])}</dd></div>
                <div className="col-span-2"><dt className="text-ink-3 uppercase tracking-wider text-[10px]">{t("founders.pg_priceLabel")}</dt>
                  <dd className="text-ink">{q.preco.status === "FINAL" ? `$${q.preco.porTier[tier].usd}` : t("founders.pg_priceFinalizing")}</dd>
                  {previa && q.preco.status !== "FINAL" ? (
                    <dd className="text-gold text-[11px] mt-1">{t("founders.pg_priceProvisional", { usd: q.preco.porTier[tier].usd, sol: q.preco.porTier[tier].sol ?? "—" })}</dd>
                  ) : null}
                </div>
              </dl>
              <ul className="flex flex-col gap-1 font-sans text-sm text-ink-1">
                {FEATURES[tier].map((f) => <li key={f} className="flex items-center gap-2"><CheckCircle2 aria-hidden className="w-4 h-4 text-cyan flex-shrink-0" />{t(f)}</li>)}
              </ul>
              {tier === "PILOT" && q.pilotSomenteAllowlist ? <p className="font-mono text-[11px] text-violet">{t("founders.pg_pilotAllowlistOnly")}</p> : null}
            </li>
          ))}
        </ul>
      </Secao>

      {/* 4. BENEFÍCIOS */}
      <Secao id={`${id}-ben`} titulo={t("founders.pg_benefitsTitle")}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="font-mono text-[11px] tracking-widest uppercase text-green mb-2">{t("founders.pg_benefitsNow")}</h3>
            <ul className="flex flex-col gap-1.5 font-sans text-sm text-ink-1">
              {["zion_advisory", "cex_autopilot", "arb_scanner", "priority_support", "reduced_swap_fee", "founder_badge_onchain"].map((b) => (
                <li key={b} className="flex items-center gap-2"><CheckCircle2 aria-hidden className="w-4 h-4 text-green flex-shrink-0" />{t(`founders.pg_ben_${b}` as MessageKey)}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-mono text-[11px] tracking-widest uppercase text-ink-2 mb-2">{t("founders.pg_benefitsPlanned")}</h3>
            <ul className="flex flex-col gap-1.5 font-sans text-sm text-ink-2">
              {["founder_theme", "hall_of_fame_opt_in", "early_access_priority", "product_polls", "beta_access", "elevated_api_limits"].map((b) => (
                <li key={b} className="flex items-center gap-2"><CircleDashed aria-hidden className="w-4 h-4 text-ink-3 flex-shrink-0" />{t(`founders.pg_ben_${b}` as MessageKey)}</li>
              ))}
            </ul>
          </div>
        </div>
      </Secao>

      {/* 5–11. STATUS, CONTAGEM, ELEGIBILIDADE, ALOCAÇÃO, PROGRESSO, CTA (painel) + CARTEIRA + PROGRESSO POR TIER */}
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <FoundersSalePanel estado={q.estadoUI} contagem={q.contagem} progresso={q.progressoTotal} alocacao={q.alocacao} txRef={q.txRef} />
        <div className="flex flex-col gap-6">
          <Secao id={`${id}-carteira`} titulo={t("founders.pg_walletTitle")}>
            <p role="status" aria-live="polite" className="font-sans text-sm text-ink-1 flex items-center gap-2">
              <Network aria-hidden className="w-4 h-4 text-cyan" />{t(`founders.pg_wallet_${q.carteira}` as MessageKey)}
            </p>
          </Secao>
          <Secao id={`${id}-prog`} titulo={t("founders.progressLabel")}>
            <dl className="grid gap-2 font-mono text-xs">
              {TIERS.map((tier) => {
                const p = q.progressoPorTier[tier];
                return (
                  <div key={tier} className="flex items-center justify-between gap-3">
                    <dt className="text-ink-2">{t(`founders.pg_tier_${tier}` as MessageKey)}</dt>
                    <dd className="text-ink tabular-nums">{p.tipo === "ok" ? `${p.mintados} / ${p.supply}` : p.tipo === "indisponivel" ? t("founders.progressUnavailable") : t("founders.progressInconsistent")}</dd>
                  </div>
                );
              })}
            </dl>
          </Secao>
        </div>
      </div>

      {/* 12. CICLO DA TRANSAÇÃO */}
      <Secao id={`${id}-tx`} titulo={t("founders.pg_txTitle")}>
        <ol className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PASSOS_TX.map((p, k) => {
            const feito = passoAtual >= k, atual = passoAtual === k;
            return (
              <li key={p} aria-current={atual ? "step" : undefined}
                className={`rounded-xl border px-3 py-2 font-mono text-[11px] ${feito ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-border-faint text-ink-3"}`}>
                {k + 1}. {t(`founders.pg_txStep_${p}` as MessageKey)}
              </li>
            );
          })}
        </ol>
        <p className="font-sans text-xs text-ink-2 mt-3">{t("founders.pg_txNote")}</p>
      </Secao>

      {/* 16. ESGOTADO */}
      {q.estadoUI === "SOLD_OUT" ? (
        <Secao id={`${id}-esg`} titulo={t("founders.pg_soldOutTitle")}>
          <p className="font-sans text-sm text-ink-1">{t("founders.pg_soldOutBody")}</p>
        </Secao>
      ) : null}

      {/* 17. ONBOARDING */}
      {q.onboarding ? (
        <section aria-labelledby={`${id}-onb`} className="rounded-3xl p-px bg-[linear-gradient(150deg,rgba(245,166,35,0.5),rgba(159,95,255,0.35))]">
          <div className="rounded-[23px] bg-bg-1/95 p-5 sm:p-7 flex flex-col gap-4">
            <h2 id={`${id}-onb`} ref={onbRef} tabIndex={-1} className="font-display font-extrabold text-2xl text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold">{t("founders.pg_onbTitle")}</h2>
            <dl className="grid gap-3 sm:grid-cols-2 font-mono text-xs">
              <div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_onbTier")}</dt><dd className="text-ink">{t(`founders.pg_tier_${q.onboarding.tier}` as MessageKey)}</dd></div>
              <div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_onbStatus")}</dt><dd className="text-ink">{t("founders.pg_onbStatusValue")}</dd></div>
              <div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_onbPremium")}</dt>
                <dd className="text-ink">{t("founders.pg_onbPremiumRule")}{q.onboarding.premiumAte ? ` · ${t("founders.pg_onbPremiumUntil", { date: fmtData(q.onboarding.premiumAte) })}` : ""}</dd></div>
              <div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_onbTx")}</dt><dd className="text-ink break-all">{q.txRef}</dd></div>
            </dl>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="font-mono text-[11px] tracking-widest uppercase text-green mb-2">{t("founders.pg_onbNow")}</h3>
                <ul className="flex flex-col gap-1 font-sans text-sm text-ink-1">{q.onboarding.beneficiosAgora.map((b) => <li key={b}>{t(`founders.pg_ben_${b}` as MessageKey)}</li>)}</ul>
              </div>
              <div>
                <h3 className="font-mono text-[11px] tracking-widest uppercase text-ink-2 mb-2">{t("founders.pg_benefitsPlanned")}</h3>
                <ul className="flex flex-col gap-1 font-sans text-sm text-ink-2">{q.onboarding.beneficiosPlanejados.map((b) => <li key={b}>{t(`founders.pg_ben_${b}` as MessageKey)}</li>)}</ul>
              </div>
            </div>
            <div>
              <h3 className="font-mono text-[11px] tracking-widest uppercase text-ink-3 mb-2">{t("founders.pg_onbNext")}</h3>
              <ol className="list-decimal pl-5 font-sans text-sm text-ink-1 flex flex-col gap-1"><li>{t("founders.pg_onbNext1")}</li><li>{t("founders.pg_onbNext2")}</li></ol>
            </div>
          </div>
        </section>
      ) : null}

      {/* 13. CONFIANÇA E SEGURANÇA */}
      <Secao id={`${id}-conf`} titulo={t("founders.pg_trustTitle")}>
        <dl className="grid gap-3 sm:grid-cols-2 font-mono text-xs">
          <div className="flex gap-2"><Lock aria-hidden className="w-4 h-4 text-cyan flex-shrink-0" /><div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_trustCollection")}</dt><dd className="text-ink-1">{t("founders.pg_trustNotDeployed")}</dd></div></div>
          <div className="flex gap-2"><Landmark aria-hidden className="w-4 h-4 text-gold flex-shrink-0" /><div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_trustTreasury")}</dt><dd className="text-ink-1">{t("founders.pg_trustTreasuryValue")}</dd></div></div>
          <div className="flex gap-2"><Fingerprint aria-hidden className="w-4 h-4 text-violet flex-shrink-0" /><div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_trustSnapshot")}</dt><dd className="text-ink-1 break-all">{q.snapshot ? `v${q.snapshot.versao} · ${q.snapshot.id.slice(0, 16)}…` : t("founders.pg_trustSnapshotPending")}</dd></div></div>
          <div className="flex gap-2"><Fingerprint aria-hidden className="w-4 h-4 text-violet flex-shrink-0" /><div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_trustConfig")}</dt><dd className="text-ink-1 break-all">{q.configFingerprint.slice(0, 16)}…</dd></div></div>
          <div className="flex gap-2 sm:col-span-2"><Network aria-hidden className="w-4 h-4 text-cyan flex-shrink-0" /><div><dt className="text-ink-3 uppercase text-[10px] tracking-wider">{t("founders.pg_trustChain")}</dt><dd className="text-ink-1">{t("founders.pg_trustChainValue")}</dd></div></div>
        </dl>
      </Secao>

      {/* 14. FAQ */}
      <Secao id={`${id}-faq`} titulo={t("founders.pg_faqTitle")}>
        <div className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <details key={n} className="group rounded-2xl border border-border-faint bg-bg-2/60 px-4 py-3">
              <summary className="cursor-pointer min-h-11 flex items-center font-display font-bold text-sm text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan">{t(`founders.pg_faq${n}Q` as MessageKey)}</summary>
              <p className="font-sans text-sm text-ink-1 mt-2 leading-relaxed">{t(`founders.pg_faq${n}A` as MessageKey)}</p>
            </details>
          ))}
        </div>
      </Secao>

      {/* 15. RISCO / JURÍDICO */}
      <Secao id={`${id}-risco`} titulo={t("founders.pg_riskTitle")}>
        <ul className="list-disc pl-5 font-sans text-sm text-ink-1 flex flex-col gap-1">
          <li>{t("founders.pg_risk1")}</li><li>{t("founders.pg_risk2")}</li><li>{t("founders.pg_risk3")}</li>
        </ul>
        <p className="mt-3 rounded-xl border border-border-soft bg-bg-2/70 px-3 py-2 font-sans text-sm text-ink-2">{t("founders.pg_legalPending")}</p>
      </Secao>
    </main>
  );
}
