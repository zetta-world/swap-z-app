"use client";

import Image from "next/image";
import { Crown } from "lucide-react";
import { trackFoundersPublicEvent } from "@/lib/founders-public/telemetry";
import type { FoundersPublicCopy, FoundersPublicFacts, PublicLocale, PublicTierFact } from "@/lib/founders-public/types";

const ART: Record<PublicTierFact["tier"], string> = {
  free: "/warriors/thrall.jpg", pro: "/nft/pro.jpg", trader: "/nft/trader.png", pilot: "/nft/pilot.jpg",
};
const ACCENT: Record<PublicTierFact["tier"], string> = {
  free: "border-white/10", pro: "border-gold/30", trader: "border-violet/30", pilot: "border-cyan/30",
};

const fmt = (value: number, locale: PublicLocale) => value.toLocaleString(locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : locale === "zh" ? "zh-CN" : "en-US");
const pct = (bps: number, locale: PublicLocale) => `${(bps / 100).toLocaleString(locale === "pt" ? "pt-BR" : locale === "es" ? "es-ES" : locale === "zh" ? "zh-CN" : "en-US")}%`;

function valueRows(tier: PublicTierFact, copy: FoundersPublicCopy, locale: PublicLocale) {
  return [
    [copy.labels.zion, fmt(tier.zionPerDay, locale)],
    [copy.labels.backtests, fmt(tier.backtestsPer24h, locale)],
    [copy.labels.assets, fmt(tier.assetsPerBacktest, locale)],
    [copy.labels.history, `${fmt(tier.historyDays, locale)} d`],
    [copy.labels.saved, fmt(tier.savedStrategies, locale)],
    [copy.labels.paper, fmt(tier.paperDesks, locale)],
    [copy.labels.notional, `$${fmt(tier.simulationNotionalUsd, locale)}`],
    [copy.labels.fee, pct(tier.evmFeeBps, locale)],
    [copy.labels.support, tier.prioritySupport ? copy.labels.priority : copy.labels.standard],
  ] as const;
}

export default function FoundersTierComparison({ facts, copy, locale }: { facts: FoundersPublicFacts; copy: FoundersPublicCopy; locale: PublicLocale }) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {facts.tiers.map((tier) => {
          const localized = copy.tierCopy[tier.tier];
          const publicPrice = tier.tier === "free"
            ? copy.labels.free
            : tier.publicFounderPriceUsd === null
              ? copy.labels.priceValue
              : `$${fmt(tier.publicFounderPriceUsd, locale)}`;
          return (
            <article key={tier.tier} data-tier={tier.tier} className={`overflow-hidden rounded-3xl border ${ACCENT[tier.tier]} bg-bg-1/80`}>
              <div className="relative aspect-[16/11] overflow-hidden bg-black/30">
                <Image src={ART[tier.tier]} alt="" fill sizes="(min-width:1280px) 23vw,(min-width:768px) 46vw,100vw" className="object-cover opacity-80" />
                <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-bg-1 via-transparent to-transparent" />
                <div className="absolute bottom-3 left-4 flex items-center gap-2">
                  <Crown aria-hidden className={`h-4 w-4 ${tier.tier === "free" ? "text-ink-2" : "text-gold"}`} />
                  <h3 className="font-display text-xl font-extrabold text-ink">{localized.name}</h3>
                </div>
              </div>
              <div className="p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink-3">{copy.labels.ideal}</p>
                <p className="mt-1 text-sm font-bold text-ink">{localized.ideal}</p>
                <p className="mt-2 min-h-12 text-sm leading-6 text-ink-2">{localized.summary}</p>
                <div className="mt-4 rounded-2xl border border-white/5 bg-black/15 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-ink-3">{copy.labels.price}</p>
                  <p className="mt-1 font-display text-lg font-bold text-ink">{publicPrice}</p>
                  {tier.tier !== "free" && tier.publicFounderPriceUsd === null ? <p className="mt-1 text-[11px] leading-5 text-ink-3">{copy.labels.priceNote}</p> : null}
                </div>
                <a href="#comparison" onClick={() => trackFoundersPublicEvent("tier_view", { locale, tier: tier.tier })}
                  className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/10 px-3 font-mono text-[11px] uppercase tracking-wider text-ink hover:border-cyan/40 hover:text-cyan">
                  {copy.labels.details}
                </a>
              </div>
            </article>
          );
        })}
      </div>

      <div id="comparison" className="scroll-mt-28 pt-10">
        <div className="hidden overflow-hidden rounded-3xl border border-white/[0.07] bg-bg-1/70 lg:block">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{copy.sections.comparison}</caption>
            <thead><tr className="border-b border-white/[0.07] bg-white/[0.02]"><th scope="col" className="p-4 text-ink-2">—</th>{facts.tiers.map((tier) => <th key={tier.tier} scope="col" className="p-4 font-display font-bold text-ink">{copy.tierCopy[tier.tier].name}</th>)}</tr></thead>
            <tbody>
              {valueRows(facts.tiers[0], copy, locale).map(([label], rowIndex) => (
                <tr key={label} className="border-b border-white/[0.05] last:border-0">
                  <th scope="row" className="p-4 font-medium text-ink-2">{label}</th>
                  {facts.tiers.map((tier) => <td key={tier.tier} className="p-4 font-mono text-xs tabular-nums text-ink">{valueRows(tier, copy, locale)[rowIndex][1]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 lg:hidden">
          {facts.tiers.map((tier) => (
            <article key={tier.tier} className="rounded-2xl border border-white/[0.07] bg-bg-1/70 p-4">
              <h3 className="font-display text-lg font-bold text-ink">{copy.tierCopy[tier.tier].name}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                {valueRows(tier, copy, locale).map(([label, value]) => <div key={label} className="border-t border-white/5 pt-2"><dt className="text-[11px] text-ink-3">{label}</dt><dd className="mt-1 font-mono text-xs text-ink">{value}</dd></div>)}
              </dl>
            </article>
          ))}
        </div>
      </div>
    </>
  );
}
