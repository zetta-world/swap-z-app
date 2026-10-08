"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { trackFoundersPublicEvent } from "@/lib/founders-public/telemetry";
import type { FaqCategory, FoundersPublicCopy, PublicLocale } from "@/lib/founders-public/types";

const CATEGORIES: FaqCategory[] = ["general", "founder", "sale", "tiers", "tools", "fees", "security", "risk", "support"];
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function FoundersFaq({ copy, locale }: { copy: FoundersPublicCopy; locale: PublicLocale }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FaqCategory | "all">("all");
  const deferredQuery = useDeferredValue(query);
  const filtered = useMemo(() => {
    const needle = normalize(deferredQuery.trim());
    return copy.faqs.filter((item) => (category === "all" || item.category === category)
      && (!needle || normalize(`${item.question} ${item.answer}`).includes(needle)));
  }, [category, copy.faqs, deferredQuery]);

  useEffect(() => {
    if (deferredQuery.trim().length < 2) return;
    const timer = window.setTimeout(() => trackFoundersPublicEvent("faq_search", {
      locale, category: category === "all" ? "all" : category,
      queryLength: deferredQuery.trim().length, resultCount: filtered.length,
    }), 500);
    return () => window.clearTimeout(timer);
  }, [category, deferredQuery, filtered.length, locale]);

  return (
    <div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <label className="relative block">
          <span className="sr-only">{copy.faqSearchPlaceholder}</span>
          <Search aria-hidden className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.faqSearchPlaceholder}
            maxLength={120}
            className="min-h-12 w-full rounded-2xl border border-white/10 bg-bg-1/80 py-3 pl-11 pr-4 text-sm text-ink placeholder:text-ink-4 focus:border-cyan/50"
          />
        </label>
        <p role="status" aria-live="polite" className="min-h-12 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3 font-mono text-xs text-ink-2">
          {filtered.length} {copy.faqCount}
        </p>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label={copy.sections.faq}>
        <button type="button" onClick={() => setCategory("all")} aria-pressed={category === "all"}
          className={`min-h-11 flex-shrink-0 rounded-full border px-4 font-mono text-[11px] uppercase tracking-wider ${category === "all" ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-white/10 text-ink-2 hover:border-white/20"}`}>
          {copy.labels.faqAll}
        </button>
        {CATEGORIES.map((item) => (
          <button key={item} type="button" onClick={() => setCategory(item)} aria-pressed={category === item}
            className={`min-h-11 flex-shrink-0 rounded-full border px-4 font-mono text-[11px] uppercase tracking-wider ${category === item ? "border-cyan/50 bg-cyan/10 text-cyan" : "border-white/10 text-ink-2 hover:border-white/20"}`}>
            {copy.faqCategories[item]}
          </button>
        ))}
      </div>

      {filtered.length ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {filtered.map((item) => (
            <details
              key={item.id}
              id={`faq-${item.id}`}
              className="group scroll-mt-28 rounded-2xl border border-white/[0.07] bg-bg-1/70 px-4 open:border-cyan/25 open:bg-cyan/[0.025]"
              onToggle={(event) => {
                if (event.currentTarget.open) trackFoundersPublicEvent("faq_open", { locale, faq: item.id, category: item.category });
              }}
            >
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 font-display text-sm font-bold text-ink marker:hidden">
                <span>{item.question}</span>
                <ChevronDown aria-hidden className="h-4 w-4 flex-shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
              </summary>
              <p className="border-t border-white/5 pb-4 pt-3 text-sm leading-7 text-ink-2">{item.answer}</p>
              <a href={`#faq-${item.id}`} className="mb-4 inline-block font-mono text-[10px] uppercase tracking-wider text-cyan hover:underline" aria-label={`${item.question} — ${copy.labels.directLink}`}>
                #{item.id}
              </a>
            </details>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-2xl border border-white/10 bg-bg-1/60 p-6 text-center text-sm text-ink-2">{copy.faqNoResults}</p>
      )}
    </div>
  );
}
