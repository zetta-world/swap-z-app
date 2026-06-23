"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Activity, Target, Calendar, Clock, ChevronDown, AlertCircle, Sparkles } from "lucide-react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { tokensByChain, type Token } from "@/lib/tokens";
import { formatUsd, parseDecimalInput } from "@/lib/format";
import ZionOrdersList from "./ZionOrdersList";
import OrderTokenSelector from "./OrderTokenSelector";
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
  const [fromSelectorOpen, setFromSelectorOpen] = useState(false);
  const [toSelectorOpen,   setToSelectorOpen]   = useState(false);

  const chainTokens = tokensByChain(chain);

  const onChainChange = (c: ChainId) => {
    setChain(c);
    const tokens = tokensByChain(c);
    setFromToken(tokens[0]);
    setToToken(tokens[1]);
  };

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
                    <ChainSelect chain={chain} onChange={onChainChange} />
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
                    <TokenTrigger token={fromToken} onClick={() => setFromSelectorOpen(true)} />
                  </Field>
                  <Field label={t("orders.fieldReceive")}>
                    <TokenTrigger token={toToken} onClick={() => setToSelectorOpen(true)} />
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

          {/* ZION saved orders */}
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

      {/* Token selectors */}
      <OrderTokenSelector
        open={fromSelectorOpen}
        onClose={() => setFromSelectorOpen(false)}
        tokens={chainTokens}
        selected={fromToken}
        onSelect={setFromToken}
        title={t("orders.fieldPay")}
      />
      <OrderTokenSelector
        open={toSelectorOpen}
        onClose={() => setToSelectorOpen(false)}
        tokens={chainTokens}
        selected={toToken}
        onSelect={setToToken}
        title={t("orders.fieldReceive")}
      />
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

// ─── Chain logo with fallback dot ─────────────────────────────────────────
function ChainLogoImg({ chain }: { chain: (typeof CHAINS)[number] }) {
  const [failed, setFailed] = useState(false);
  if (chain.logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={chain.logo}
        alt={chain.name}
        width={16} height={16}
        className="w-4 h-4 rounded-full object-cover flex-shrink-0"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      className="w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center font-mono text-[7px] font-bold text-bg"
      style={{ background: chain.color }}
    >
      {chain.short.slice(0, 1)}
    </span>
  );
}

// ─── Custom chain selector with logos ────────────────────────────────────
function ChainSelect({ chain, onChange }: { chain: ChainId; onChange: (c: ChainId) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const cur = CHAINS.find((c) => c.id === chain);
  const options = CHAINS.filter((c) => !c.comingSoon);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t("common.chain")}
        className="w-full flex items-center gap-2 bg-bg-2 border border-white/10 rounded-lg px-2.5 py-2 hover:border-white/20 focus:outline-none focus:border-violet/30 transition-colors min-w-0"
      >
        {cur && <ChainLogoImg chain={cur} />}
        <span className="flex-1 text-left font-mono text-sm uppercase tracking-wider text-ink-2 truncate min-w-0">
          {cur?.short ?? chain}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-ink-3 flex-shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-white/10 bg-bg-1 shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
            {options.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => { onChange(c.id as ChainId); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 transition-colors text-left",
                  c.id === chain ? "bg-white/[0.06]" : "hover:bg-white/[0.04]",
                )}
              >
                <ChainLogoImg chain={c} />
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm text-ink-2 uppercase tracking-wider truncate">{c.short}</div>
                  <div className="font-mono text-[9px] text-ink-4 truncate">{c.evm ? "EVM" : c.id === "solana" ? "SVM" : "ZVM"}</div>
                </div>
                {c.id === chain && (
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }} />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Token trigger button showing logo + symbol ───────────────────────────
function TokenTrigger({ token, onClick }: { token: Token | undefined; onClick: () => void }) {
  const [logoFailed, setLogoFailed] = useState(false);

  const logoSrc = token
    ? (token.logo ?? `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/32/icon/${token.symbol.toLowerCase()}.png`)
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 bg-bg-2 border border-white/10 rounded-lg px-2.5 py-2 hover:border-white/20 focus:outline-none focus:border-violet/30 transition-colors min-w-0"
    >
      {token ? (
        logoSrc && !logoFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt={token.symbol}
            width={24} height={24}
            className="w-6 h-6 rounded-full object-cover flex-shrink-0 bg-white/5"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center font-display font-extrabold text-[9px] flex-shrink-0"
            style={{ background: `${token.color ?? "#00E8FF"}22`, color: token.color ?? "#00E8FF", border: `1px solid ${token.color ?? "#00E8FF"}44` }}
          >
            {token.symbol.slice(0, 2)}
          </span>
        )
      ) : (
        <span className="w-6 h-6 rounded-full bg-white/10 flex-shrink-0" />
      )}
      <span className="flex-1 text-left font-display font-bold text-sm text-ink truncate min-w-0">
        {token?.symbol ?? "—"}
      </span>
      <ChevronDown className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
    </button>
  );
}

// avoid unused import warning
void formatUsd;

