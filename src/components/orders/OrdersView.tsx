"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Target, Calendar, Clock, ChevronDown, AlertCircle, Sparkles } from "lucide-react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { tokensByChain, type Token } from "@/lib/tokens";
import { formatUsd, parseDecimalInput } from "@/lib/format";
import ZionOrdersList from "./ZionOrdersList";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

type OrderType = "limit" | "dca" | "twap";

const TABS: { id: OrderType; labelKey: MessageKey; Icon: React.ComponentType<{ className?: string }>; descKey: MessageKey }[] = [
  { id: "limit", labelKey: "orders.tabLimit", Icon: Target,    descKey: "orders.descLimit" },
  { id: "dca",   labelKey: "orders.tabDca",   Icon: Calendar,  descKey: "orders.descDca"   },
  { id: "twap",  labelKey: "orders.tabTwap",  Icon: Clock,     descKey: "orders.descTwap"  },
];

const FREQS: { v: string; labelKey: MessageKey }[] = [
  { v: "hourly",  labelKey: "orders.freqHourly"  },
  { v: "daily",   labelKey: "orders.freqDaily"   },
  { v: "weekly",  labelKey: "orders.freqWeekly"  },
  { v: "monthly", labelKey: "orders.freqMonthly" },
];


export default function OrdersView() {
  const t = useT();
  const [tab, setTab] = useState<OrderType>("limit");
  const [chain, setChain] = useState<ChainId>("ethereum");
  const [fromToken, setFromToken] = useState<Token | undefined>(() => tokensByChain("ethereum").find((t) => t.symbol === "USDC"));
  const [toToken,   setToToken]   = useState<Token | undefined>(() => tokensByChain("ethereum").find((t) => t.symbol === "ETH"));
  const [amount,    setAmount]    = useState("");
  const [limitPrice, setLimitPrice] = useState("3600");
  const [intervals, setIntervals] = useState("12");
  const [freq, setFreq] = useState("daily");

  const summary = useMemo(() => {
    const a = parseDecimalInput(amount) ?? 0;
    if (!a) return null;
    if (tab === "limit") return t("orders.summaryLimit", { symbol: toToken?.symbol ?? "", price: limitPrice, fromSymbol: fromToken?.symbol ?? "" });
    if (tab === "dca")   return t("orders.summaryDca",   {
      freq:     t((FREQS.find((f) => f.v === freq)?.labelKey ?? "orders.freqDaily") as MessageKey),
      perCycle: (a / parseInt(intervals || "1")).toFixed(2),
      cycles:   intervals,
    });
    return t("orders.summaryTwap", { amount, fromSymbol: fromToken?.symbol ?? "", intervals });
  }, [tab, amount, intervals, freq, fromToken, toToken, limitPrice, t]);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[60vw] max-w-[400px] aspect-square rounded-full bg-violet/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-6xl mx-auto w-full">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Activity className="w-4 h-4 text-violet flex-shrink-0" />
            <span className="font-mono text-[10px] text-violet/80 tracking-widest uppercase">
              {t("orders.eyebrow")}
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3 break-words">
            {t("orders.pageTitleA")} <span className="text-grad-aurora">{t("orders.pageTitleHL")}</span>
          </h1>
          <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
            {t("orders.pageBody")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Order builder */}
          <div className="lg:col-span-7 space-y-4">
            {/* Tabs */}
            <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-xl border border-white/5 glass-pane">
              {TABS.map((tab2) => {
                const Icon = tab2.Icon;
                const active = tab === tab2.id;
                return (
                  <button
                    key={tab2.id}
                    onClick={() => setTab(tab2.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 px-3 py-3 rounded-lg transition-all",
                      active ? "bg-violet/15 border border-violet/30 text-violet" : "text-ink-3 hover:text-ink-2 border border-transparent",
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="font-display font-bold text-[11px] tracking-widest uppercase">{t(tab2.labelKey)}</span>
                  </button>
                );
              })}
            </div>

            <div className="font-sans text-xs text-ink-3 leading-relaxed">
              {(() => {
                const k = TABS.find((x) => x.id === tab)?.descKey;
                return k ? t(k) : "";
              })()}
            </div>

            {/* Form */}
            <div className="aurora-border p-px">
              <div className="rounded-[18px] glass p-5 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("orders.fieldChain")}>
                    <ChainSelect chain={chain} onChange={(c) => { setChain(c); setFromToken(tokensByChain(c)[0]); setToToken(tokensByChain(c)[1]); }} />
                  </Field>
                  <Field label={t("orders.fieldType")}>
                    <div className="bg-bg-2 border border-white/10 rounded-lg px-2.5 py-2 text-sm font-mono text-ink-2 uppercase tracking-widest">
                      {(() => {
                        const k = TABS.find((x) => x.id === tab)?.labelKey;
                        return k ? t(k) : "";
                      })()}
                    </div>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label={t("orders.fieldPay")}>
                    <TokenSelect token={fromToken} tokens={tokensByChain(chain)} onChange={setFromToken} />
                  </Field>
                  <Field label={t("orders.fieldReceive")}>
                    <TokenSelect token={toToken} tokens={tokensByChain(chain)} onChange={setToToken} />
                  </Field>
                </div>

                <Field label={tab === "dca" ? t("orders.fieldTotalBudget") : t("orders.fieldAmount")}>
                  <div className="flex items-center gap-2 bg-bg-2 border border-white/10 rounded-lg px-3 py-2 focus-within:border-violet/30 min-w-0">
                    <input
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 min-w-0 bg-transparent outline-none text-2xl font-display font-bold text-ink placeholder:text-ink-4"
                    />
                    <span className="font-display font-bold text-sm text-ink-2 flex-shrink-0">{fromToken?.symbol}</span>
                  </div>
                </Field>

                {/* Type-specific fields */}
                {tab === "limit" && (
                  <Field label={t("orders.fieldTriggerPrice", { symbol: toToken?.symbol ?? "" })}>
                    <div className="flex items-center gap-2 bg-bg-2 border border-white/10 rounded-lg px-3 py-2 focus-within:border-violet/30 min-w-0">
                      <span className="font-mono text-ink-3 flex-shrink-0">$</span>
                      <input
                        inputMode="decimal"
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 min-w-0 bg-transparent outline-none text-xl font-display font-bold text-ink placeholder:text-ink-4"
                      />
                    </div>
                  </Field>
                )}

                {tab === "dca" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={t("orders.fieldFrequency")}>
                      <select
                        value={freq}
                        onChange={(e) => setFreq(e.target.value)}
                        className="bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 uppercase tracking-widest w-full"
                      >
                        {FREQS.map((f) => <option key={f.v} value={f.v}>{t(f.labelKey)}</option>)}
                      </select>
                    </Field>
                    <Field label={t("orders.fieldCycles")}>
                      <input
                        value={intervals}
                        onChange={(e) => setIntervals(e.target.value)}
                        type="number"
                        className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 outline-none focus:border-violet/30"
                      />
                    </Field>
                  </div>
                )}

                {tab === "twap" && (
                  <Field label={t("orders.fieldIntervals")}>
                    <input
                      value={intervals}
                      onChange={(e) => setIntervals(e.target.value)}
                      type="number"
                      className="w-full bg-bg-2 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono text-ink-2 outline-none focus:border-violet/30"
                    />
                  </Field>
                )}

                {summary && (
                  <div className="rounded-lg border border-violet/20 bg-violet/[0.04] p-3 flex items-start gap-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-mono text-[10px] text-violet tracking-widest uppercase mb-0.5">ZION will</div>
                      <div className="font-sans text-xs text-ink-2 leading-relaxed">{summary}</div>
                    </div>
                  </div>
                )}

                <button className="w-full btn btn-primary py-3.5 text-sm tracking-widest" disabled={!summary}>
                  {summary
                    ? t("orders.placeBtn", {
                        label: (() => {
                          const k = TABS.find((x) => x.id === tab)?.labelKey;
                          return k ? t(k) : "";
                        })(),
                      })
                    : t("orders.configureBtn")}
                </button>
                <p className="font-mono text-[10px] text-ink-4 text-center">
                  {t("orders.placerFooter")}
                </p>
              </div>
            </div>
          </div>

          {/* ZION saved orders — real, from localStorage */}
          <div className="lg:col-span-5 space-y-4">
            <ZionOrdersList />

            <div className="rounded-2xl border border-gold/15 bg-gold/[0.04] p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-display font-bold text-sm text-gold">{t("orders.saveNowTitle")}</div>
                <p className="font-sans text-xs text-ink-2 leading-relaxed mt-1">
                  {t("orders.saveNowBody")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ChainSelect({ chain, onChange }: { chain: ChainId; onChange: (c: ChainId) => void }) {
  const cur = CHAINS.find((c) => c.id === chain);
  return (
    <div className="relative min-w-0">
      <select
        value={chain}
        onChange={(e) => onChange(e.target.value as ChainId)}
        aria-label="Chain"
        className="appearance-none bg-bg-2 border border-white/10 rounded-lg pl-6 pr-7 py-2 text-sm font-mono uppercase tracking-wider text-ink-2 outline-none focus:border-violet/30 cursor-pointer w-full truncate"
      >
        {CHAINS.filter((c) => !c.comingSoon).map((c) => (
          <option key={c.id} value={c.id}>{c.short}</option>
        ))}
      </select>
      <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full pointer-events-none" style={{ background: cur?.color }} />
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3 pointer-events-none" />
    </div>
  );
}

function TokenSelect({ token, tokens, onChange }: { token: Token | undefined; tokens: Token[]; onChange: (t: Token) => void }) {
  return (
    <div className="relative min-w-0">
      <select
        value={token?.address ?? ""}
        onChange={(e) => {
          const t = tokens.find((x) => x.address === e.target.value);
          if (t) onChange(t);
        }}
        aria-label="Token"
        className="appearance-none w-full bg-bg-2 border border-white/10 rounded-lg pl-3 pr-7 py-2 text-sm font-display font-bold text-ink outline-none focus:border-violet/30 cursor-pointer truncate"
      >
        {tokens.map((t) => (
          <option key={t.address} value={t.address}>{t.symbol}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-3 pointer-events-none" />
    </div>
  );
}

// avoid unused import warning
void formatUsd;
