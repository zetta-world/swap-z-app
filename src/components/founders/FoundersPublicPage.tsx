"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo } from "react";
import {
  ArrowLeftRight, ArrowRight, BarChart3, BrainCircuit, CheckCircle2, ChevronRight,
  CircleDashed, Clock3, Crown, Droplets, FlaskConical, Languages,
  LayoutDashboard, ListOrdered, LockKeyhole, Network, PauseCircle, SearchCheck, ShieldCheck,
  Sparkles, TriangleAlert, WalletCards,
} from "lucide-react";
import { foundersPublicCopy } from "@/lib/founders-public/content";
import { trackFoundersPublicEvent } from "@/lib/founders-public/telemetry";
import type { BenefitStatus, FoundersPublicFacts, PublicLocale, PublicProductFact, PublicStatus } from "@/lib/founders-public/types";
import { useUI } from "@/lib/store/ui";
import FoundersFaq from "./FoundersFaq";
import FoundersTierComparison from "./FoundersTierComparison";

const LANGS: Array<{ id: PublicLocale; label: string }> = [
  { id: "en", label: "EN" }, { id: "pt", label: "PT" }, { id: "es", label: "ES" }, { id: "zh", label: "中文" },
];
const PRODUCT_ICON: Record<PublicProductFact["id"], React.ComponentType<{ className?: string }>> = {
  swap: ArrowLeftRight, zion: BrainCircuit, workbench: FlaskConical, paper: BarChart3,
  dashboard: LayoutDashboard, portfolio: WalletCards, orders: ListOrdered, pools: Droplets,
};
const STATUS_CLASS: Record<PublicStatus | BenefitStatus, string> = {
  AVAILABLE: "border-green/35 bg-green/[0.08] text-green",
  BETA: "border-cyan/35 bg-cyan/[0.08] text-cyan",
  PARTIAL: "border-gold/35 bg-gold/[0.08] text-gold",
  ROADMAP: "border-violet/35 bg-violet/[0.08] text-violet",
  AVAILABLE_AT_LAUNCH: "border-green/35 bg-green/[0.08] text-green",
  IMPLEMENTED_DISABLED: "border-gold/35 bg-gold/[0.08] text-gold",
  COMING_SOON_ROADMAP: "border-violet/35 bg-violet/[0.08] text-violet",
  A_CONFIRMAR: "border-white/15 bg-white/[0.04] text-ink-2",
  NOT_PART_OF_THE_OFFER: "border-red/25 bg-red/[0.05] text-red",
};

function StatusBadge({ status, label }: { status: PublicStatus | BenefitStatus; label: string }) {
  const Icon = status === "AVAILABLE" || status === "AVAILABLE_AT_LAUNCH" ? CheckCircle2
    : status === "IMPLEMENTED_DISABLED" ? PauseCircle : CircleDashed;
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider ${STATUS_CLASS[status]}`}><Icon aria-hidden className="h-3 w-3" />{label}</span>;
}

function Section({ id, eyebrow, title, children, className = "" }: { id: string; eyebrow: string; title: string; children: React.ReactNode; className?: string }) {
  return <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-24 py-14 sm:py-20 ${className}`}>
    <div className="mb-7 max-w-3xl"><p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan">{eyebrow}</p><h2 id={`${id}-title`} className="mt-2 font-display text-2xl font-extrabold leading-tight text-ink sm:text-4xl">{title}</h2></div>
    {children}
  </section>;
}

function useSectionEvent(id: string, event: "price_view" | "sale_mechanics_view", locale: PublicLocale) {
  useEffect(() => {
    const element = document.getElementById(id);
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      trackFoundersPublicEvent(event, { locale });
      observer.disconnect();
    }, { threshold: 0.35 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [event, id, locale]);
}

export default function FoundersPublicPage({ facts }: { facts: FoundersPublicFacts }) {
  const { lang, setLang } = useUI();
  const locale = lang as PublicLocale;
  const copy = useMemo(() => foundersPublicCopy(locale, facts), [facts, locale]);
  const pricesArePublic = facts.tiers.filter((tier) => tier.tier !== "free").every((tier) => tier.publicFounderPriceUsd !== null);
  useSectionEvent("tiers", "price_view", locale);
  useSectionEvent("sale", "sale_mechanics_view", locale);

  useEffect(() => {
    trackFoundersPublicEvent("founders_page_view", { locale });
  }, [locale]);

  const productStatus = (status: PublicStatus) => copy.statusLabels[status];
  const benefits = [
    { id: "cex", ...copy.benefitCopy.cexAutopilot, status: facts.benefitStatus.cexAutopilot },
    { id: "arb", ...copy.benefitCopy.arbScanner, status: facts.benefitStatus.arbScanner },
    { id: "support", ...copy.benefitCopy.prioritySupport, status: facts.benefitStatus.prioritySupport },
    { id: "automation", ...copy.benefitCopy.pilotAdvancedAutomation, status: facts.benefitStatus.pilotAdvancedAutomation },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg text-ink">
      <a href="#main" className="skip-link">{copy.labels.skip}</a>
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" onClick={() => trackFoundersPublicEvent("platform_click", { locale })}>
            <Image src="/brand/yggdrasil-z-transparent.png" alt="Z-SWAP" width={42} height={42} priority className="h-10 w-10 object-contain" />
            <span className="font-display text-sm font-extrabold tracking-wide text-ink">Z-SWAP</span>
          </Link>
          <nav aria-label="Founders" className="ml-auto hidden items-center gap-5 lg:flex">
            {(["products", "founder", "tiers", "sale", "faq"] as const).map((item) => <a key={item} href={`#${item}`} className="text-xs text-ink-2 hover:text-cyan">{copy.nav[item]}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-1 lg:ml-5" role="group" aria-label={copy.labels.language}>
            <Languages aria-hidden className="mr-1 hidden h-4 w-4 text-ink-3 sm:block" />
            {LANGS.map((item) => <button key={item.id} type="button" onClick={() => setLang(item.id)} aria-pressed={locale === item.id} className={`min-h-11 min-w-11 rounded-lg px-2 font-mono text-[10px] ${locale === item.id ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:bg-white/5 hover:text-ink"}`}>{item.label}</button>)}
          </div>
        </div>
      </header>

      <main id="main">
        <section className="relative isolate overflow-hidden border-b border-white/[0.06]">
          <div aria-hidden className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_18%_18%,rgba(0,232,255,0.16),transparent_35%),radial-gradient(circle_at_78%_18%,rgba(159,95,255,0.18),transparent_38%),radial-gradient(circle_at_50%_95%,rgba(245,166,35,0.08),transparent_40%)]" />
          <div aria-hidden className="grid-bg absolute inset-0 -z-10 opacity-60" />
          <div className="mx-auto grid min-h-[720px] max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-gold"><Sparkles aria-hidden className="h-3.5 w-3.5" />{copy.hero.eyebrow}</div>
              <h1 className="mt-6 max-w-4xl font-display text-[clamp(2.5rem,7vw,5.8rem)] font-extrabold leading-[0.95] tracking-[-0.045em] text-ink"><span className="text-grad-cyan">Z-SWAP.</span> {copy.hero.title}</h1>
              <p className="mt-6 max-w-2xl text-base leading-8 text-ink-2 sm:text-lg">{copy.hero.body}</p>
              <p className="mt-5 inline-flex items-center gap-2 rounded-xl border border-violet/25 bg-violet/[0.05] px-3 py-2 font-mono text-[11px] text-violet"><Clock3 aria-hidden className="h-4 w-4" />{copy.hero.saleClosed}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/" onClick={() => trackFoundersPublicEvent("platform_click", { locale })} className="btn btn-primary min-h-12">{copy.hero.primary}<ArrowRight aria-hidden className="h-4 w-4" /></Link>
                <a href="#tiers" onClick={() => trackFoundersPublicEvent("tier_compare", { locale })} className="btn btn-secondary min-h-12">{copy.hero.secondary}</a>
                <a href={facts.links.community} target="_blank" rel="noopener noreferrer" onClick={() => trackFoundersPublicEvent("community_click", { locale })} className="btn min-h-12 border border-gold/30 bg-gold/[0.06] text-gold hover:bg-gold/10">{copy.hero.community}</a>
              </div>
              <p className="mt-4 text-xs text-ink-3">{copy.labels.noBuy}</p>
            </div>
            <div className="relative mx-auto w-full max-w-xl">
              <div aria-hidden className="absolute inset-10 rounded-full bg-violet/20 blur-3xl" />
              <Image src="/brand/yggdrasil-z-transparent.png" alt="Z-SWAP Yggdrasil emblem" width={640} height={640} priority className="relative mx-auto h-auto w-full max-w-[520px] drop-shadow-[0_0_50px_rgba(0,232,255,0.18)]" />
              <div className="relative -mt-8 grid grid-cols-3 gap-2">
                {[[copy.labels.saleDate, copy.labels.saleDateValue], [copy.labels.finalSupply, copy.labels.finalSupplyValue], [copy.labels.price, pricesArePublic ? copy.labels.priceConfirmed : copy.labels.priceValue]].map(([label, value]) => <div key={label} className="rounded-2xl border border-white/10 bg-bg-1/85 p-3 backdrop-blur"><p className="font-mono text-[9px] uppercase tracking-wider text-ink-3">{label}</p><p className="mt-1 text-xs font-bold text-ink sm:text-sm">{value}</p></div>)}
              </div>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <Section id="products" eyebrow="01 · Z-SWAP" title={copy.sections.product}>
            <p className="-mt-3 mb-8 max-w-3xl text-sm leading-7 text-ink-2">{copy.sections.platform}. {copy.labels.statusHelp}</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {facts.products.map((product) => {
                const Icon = PRODUCT_ICON[product.id]; const text = copy.productCopy[product.id];
                return <Link key={product.id} href={product.href} onClick={() => trackFoundersPublicEvent("platform_click", { locale })} className="group rounded-3xl border border-white/[0.07] bg-bg-1/70 p-5 transition hover:-translate-y-1 hover:border-cyan/25 hover:bg-cyan/[0.025]">
                  <div className="flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan/20 bg-cyan/[0.06]"><Icon aria-hidden className="h-5 w-5 text-cyan" /></span><StatusBadge status={product.status} label={productStatus(product.status)} /></div>
                  <h3 className="mt-5 font-display text-lg font-bold text-ink">{text.title}</h3><p className="mt-2 text-sm leading-6 text-ink-2">{text.body}</p><span className="mt-4 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-cyan">{copy.hero.primary}<ChevronRight aria-hidden className="h-3 w-3" /></span>
                </Link>;
              })}
            </div>
            <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="rounded-2xl border border-cyan/15 bg-cyan/[0.025] p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-cyan">{copy.labels.networks}</p><p className="mt-2 text-sm leading-7 text-ink-2">{facts.networks.available.join(" · ")}</p></div>
              <div className="rounded-2xl border border-violet/20 bg-violet/[0.03] p-4"><p className="font-mono text-[10px] uppercase tracking-wider text-violet">{copy.labels.roadmap}</p><p className="mt-2 text-sm text-ink-2">{facts.networks.roadmap.join(" · ")}</p></div>
            </div>
          </Section>

          <Section id="founder" eyebrow="02 · Founder Pass" title={copy.sections.founder}>
            <div className="grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-gold/25 bg-[radial-gradient(circle_at_top_left,rgba(245,166,35,0.12),transparent_45%),rgba(8,11,34,0.82)] p-6 sm:p-8">
                <Crown aria-hidden className="h-8 w-8 text-gold" /><h3 className="mt-4 font-display text-2xl font-extrabold text-ink">{copy.labels.founderStatus}</h3><p className="mt-3 text-sm leading-7 text-ink-2">{copy.faqs.find((item) => item.id === "founder-vs-premium")!.answer}</p><p className="mt-5 rounded-xl border border-gold/20 bg-gold/[0.04] p-3 text-sm text-gold">{copy.labels.currentHolder}</p>
              </article>
              <article className="rounded-3xl border border-cyan/25 bg-[radial-gradient(circle_at_top_right,rgba(0,232,255,0.11),transparent_45%),rgba(8,11,34,0.82)] p-6 sm:p-8">
                <Clock3 aria-hidden className="h-8 w-8 text-cyan" /><h3 className="mt-4 font-display text-2xl font-extrabold text-ink">{copy.labels.premium}</h3><ul className="mt-4 space-y-3 text-sm leading-7 text-ink-2"><li className="flex gap-2"><CheckCircle2 aria-hidden className="mt-1 h-4 w-4 flex-shrink-0 text-cyan" />{copy.labels.premiumStart}</li><li className="flex gap-2"><CheckCircle2 aria-hidden className="mt-1 h-4 w-4 flex-shrink-0 text-cyan" />{copy.labels.transfer}</li><li className="flex gap-2"><TriangleAlert aria-hidden className="mt-1 h-4 w-4 flex-shrink-0 text-gold" />{copy.faqs.find((item) => item.id === "after-36")!.answer}</li></ul>
              </article>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{benefits.map((item) => <article key={item.id} className="rounded-2xl border border-white/[0.07] bg-bg-1/65 p-4"><StatusBadge status={item.status} label={copy.statusLabels[item.status]} /><h3 className="mt-3 font-display font-bold text-ink">{item.title}</h3><p className="mt-2 text-xs leading-6 text-ink-2">{item.body}</p></article>)}</div>
          </Section>

          <Section id="tiers" eyebrow="03 · Free / Pro / Trader / Pilot" title={copy.sections.tiers}>
            <FoundersTierComparison facts={facts} copy={copy} locale={locale} />
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-cyan/15 bg-cyan/[0.025] p-4"><h3 className="font-display font-bold text-ink">{copy.labels.fee}</h3><p className="mt-2 text-sm leading-7 text-ink-2">{copy.faqs.find((item) => item.id === "fees")!.answer} {copy.faqs.find((item) => item.id === "solana-other-fees")!.answer}</p></article>
              <article className="rounded-2xl border border-gold/15 bg-gold/[0.025] p-4"><h3 className="font-display font-bold text-ink">Pilot · {copy.labels.backtests}</h3><p className="mt-2 text-sm leading-7 text-ink-2">{copy.faqs.find((item) => item.id === "pilot-backtests")!.answer}</p></article>
            </div>
          </Section>

          <Section id="sale" eyebrow={`04 · ${copy.nav.sale}`} title={copy.sections.sale}>
            <div className="grid gap-4 md:grid-cols-5">{[copy.labels.saleStep1, copy.labels.saleStep2, copy.labels.saleStep3, copy.labels.saleStep4, copy.labels.saleStep5].map((step, index) => <article key={step} className="rounded-2xl border border-white/[0.07] bg-bg-1/70 p-4"><span className="font-display text-2xl font-extrabold text-cyan/50">0{index + 1}</span><p className="mt-3 text-sm font-bold leading-6 text-ink">{step}</p></article>)}</div>
            <dl className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4"><dt className="font-mono text-[10px] uppercase text-ink-3">{copy.labels.allowlist}</dt><dd className="mt-2 text-sm text-ink">{facts.sale.allowlistHours}h · Pro {facts.sale.allowlistLimits.pro} · Trader {facts.sale.allowlistLimits.trader} · Pilot {facts.sale.allowlistLimits.pilot}</dd></div>
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4"><dt className="font-mono text-[10px] uppercase text-ink-3">{copy.labels.total}</dt><dd className="mt-2 text-sm text-ink">Pro {facts.sale.eventLimits.pro} · Trader {facts.sale.eventLimits.trader} · Pilot {facts.sale.eventLimits.pilot}</dd></div>
              <div className="rounded-2xl border border-white/10 bg-black/15 p-4"><dt className="font-mono text-[10px] uppercase text-ink-3">{copy.labels.deadline}</dt><dd className="mt-2 text-sm text-ink">{facts.sale.calendarDays} {copy.labels.days} · {copy.labels.realSoldOutOnly}</dd></div>
            </dl>
            <div className="mt-6 rounded-2xl border border-violet/25 bg-violet/[0.05] p-4 text-sm leading-7 text-ink-2"><strong className="text-violet">{copy.labels.saleDateValue}.</strong> {copy.labels.finalSupplyValue}. {copy.labels.priceNote} {copy.labels.noBuy}</div>
          </Section>

          <Section id="custody" eyebrow={`05 · ${copy.labels.securityAndControl}`} title={copy.sections.custody}>
            <div className="grid gap-4 lg:grid-cols-2">
              <article className="rounded-3xl border border-cyan/20 bg-cyan/[0.03] p-6"><WalletCards aria-hidden className="h-7 w-7 text-cyan" /><h3 className="mt-4 font-display text-xl font-bold text-ink">{copy.labels.dex}</h3><p className="mt-3 text-sm leading-7 text-ink-2">{copy.faqs.find((item) => item.id === "dex-authorization")!.answer}</p></article>
              <article className="rounded-3xl border border-violet/20 bg-violet/[0.03] p-6"><LockKeyhole aria-hidden className="h-7 w-7 text-violet" /><h3 className="mt-4 font-display text-xl font-bold text-ink">{copy.labels.cex}</h3><p className="mt-3 text-sm leading-7 text-ink-2">{copy.faqs.find((item) => item.id === "cex-authorization")!.answer}</p></article>
            </div>
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-red/20 bg-red/[0.04] p-3 text-sm text-red"><ShieldCheck aria-hidden className="h-4 w-4" />{copy.labels.security}</p>
          </Section>

          <Section id="workflow" eyebrow={`06 · ${copy.labels.startWithoutPressure}`} title={copy.sections.workflow}>
            <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[
              [SearchCheck, copy.hero.primary], [WalletCards, copy.faqs.find((item) => item.id === "wallet-account-free")!.question], [FlaskConical, copy.productCopy.workbench.title], [Crown, copy.hero.secondary], [Network, copy.labels.saleDateValue],
            ].map(([Icon, label], index) => { const StepIcon = Icon as typeof SearchCheck; return <li key={String(label)} className="rounded-2xl border border-white/[0.07] bg-bg-1/60 p-4"><StepIcon aria-hidden className="h-5 w-5 text-cyan" /><p className="mt-3 font-mono text-[10px] text-ink-3">0{index + 1}</p><p className="mt-1 text-sm font-bold text-ink">{String(label)}</p></li>; })}</ol>
          </Section>

          <Section id="faq" eyebrow={`07 · ${copy.faqs.length} ${copy.faqCount}`} title={copy.sections.faq}>
            <FoundersFaq copy={copy} locale={locale} />
          </Section>

          <Section id="risk" eyebrow={`08 · ${copy.labels.noGuarantees}`} title={copy.sections.risk}>
            <ul className="grid gap-3 md:grid-cols-2">{copy.riskItems.map((item) => <li key={item} className="flex gap-3 rounded-2xl border border-gold/15 bg-gold/[0.025] p-4 text-sm leading-7 text-ink-2"><TriangleAlert aria-hidden className="mt-1 h-4 w-4 flex-shrink-0 text-gold" />{item}</li>)}</ul>
            <p className="mt-5 text-sm leading-7 text-ink-3">{copy.labels.disclaimer}</p>
          </Section>
        </div>
      </main>

      <footer className="border-t border-white/[0.07] bg-black/20">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between"><div><p className="font-display font-extrabold text-ink">Z-SWAP</p><p className="mt-1 max-w-xl text-xs leading-6 text-ink-3">{copy.footer}</p></div><div className="flex flex-wrap gap-3"><Link href="/" className="text-sm text-cyan hover:underline">{copy.hero.primary}</Link><a href={facts.links.community} target="_blank" rel="noopener noreferrer" onClick={() => trackFoundersPublicEvent("community_click", { locale })} className="text-sm text-gold hover:underline">{copy.hero.community}</a></div></div>
      </footer>
    </div>
  );
}
