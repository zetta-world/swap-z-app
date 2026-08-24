"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Activity, Target, Calendar, Clock, ChevronDown, AlertCircle, Sparkles } from "lucide-react";
import { CHAINS, type ChainId } from "@/lib/chains";
import { tokensByChain, type Token } from "@/lib/tokens";
import { formatUsd, parseDecimalInput } from "@/lib/format";
import { lerCiclos, porCiclo, sobra, MAX_CICLOS } from "@/lib/orders/plano";
import { savePendingOrder } from "@/lib/zion/orders";
import type { ActionCard } from "@/lib/zion/parse";
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
  /**
   * ⚠️ NASCE VAZIO. Antes era `useState("3600")` — o preço do ETH cravado, que
   * sobrevivia a troca de rede E de par: escolher outro ativo deixava o gatilho
   * em US$ 3.600 para uma moeda que não vale isso. Palpite errado com cara de
   * padrão é pior que campo em branco.
   */
  const [limitPrice, setLimitPrice] = useState("");
  const [intervals, setIntervals] = useState("12");
  const [freq, setFreq] = useState("daily");
  const [fromSelectorOpen, setFromSelectorOpen] = useState(false);
  const [toSelectorOpen,   setToSelectorOpen]   = useState(false);

  const chainTokens = tokensByChain(chain);

  /**
   * ⚠️ O GATILHO MORRE COM O PAR. Trocar de rede troca os dois tokens; um preço
   * digitado para o par anterior não significa nada para o novo.
   */
  const onChainChange = (c: ChainId) => {
    setChain(c);
    const tokens = tokensByChain(c);
    setFromToken(tokens[0]);
    setToToken(tokens[1]);
    setLimitPrice("");
  };

  /** Mesmo motivo: o gatilho é cotado NO token de destino. */
  const onToTokenChange = (tk: Token) => {
    setToToken(tk);
    setLimitPrice("");
  };

  /**
   * ⚠️⚠️ O PLANO É CALCULADO UMA VEZ, E TUDO LÊ DAQUI (auditoria de 24/08).
   *
   * Antes, o "por ciclo" saía do valor parseado e o "ciclos" do texto CRU, e a
   * mesma frase se contradizia: "$1000.00 por ciclo · 1e9 ciclos". Agora
   * `lerCiclos` normaliza, e quem exibe usa SEMPRE o número normalizado.
   */
  const parcelado = tab === "dca" || tab === "twap";
  const plano = useMemo(() => {
    if (!parcelado) return null;
    // ⚠️ União DISCRIMINADA por `ok`. A primeira versão distinguia os dois
    // lados por `"erro" in plano`, e o TypeScript não estreitava — `plano.erro`
    // saía `string | undefined`. Discriminante explícito é mais barato que
    // narrowing esperto que falha calado.
    const c = lerCiclos(intervals);
    if (!c.ok) return { ok: false as const, motivo: c.motivo };
    const dec = fromToken?.decimals ?? 18;
    const cada = porCiclo(amount, c.ciclos, dec);
    if (!cada) return { ok: false as const, motivo: "vazio" as const };
    return { ok: true as const, ciclos: c.ciclos, cada, resto: sobra(amount, c.ciclos, dec) };
  }, [parcelado, intervals, amount, fromToken?.decimals]);

  /** A frase do motivo, para a tela DIZER por que recusou em vez de sumir. */
  const motivoTexto = (m: string): string => {
    if (m === "vazio")        return t("orders.cyclesEmpty");
    if (m === "nao_inteiro")  return t("orders.cyclesNotInteger");
    if (m === "menor_que_um") return t("orders.cyclesTooSmall");
    return t("orders.cyclesTooMany", { max: String(MAX_CICLOS) });
  };

  const summary = useMemo(() => {
    const a = parseDecimalInput(amount) ?? 0;
    if (!a || !fromToken || !toToken) return null;
    if (tab === "limit") {
      // ⚠️ Sem gatilho não há ordem-limite. Antes o campo vinha pré-preenchido
      // com 3600 e isto nunca era exercitado.
      if (!(parseDecimalInput(limitPrice) ?? 0)) return null;
      return t("orders.summaryLimit", { symbol: toToken.symbol, price: limitPrice, fromSymbol: fromToken.symbol });
    }
    if (!plano?.ok) return null;
    if (tab === "dca") return t("orders.summaryDca", {
      freq:     t((FREQS.find((f) => f.v === freq)?.labelKey ?? "orders.freqDaily") as MessageKey),
      perCycle: plano.cada,
      symbol:   fromToken.symbol,
      cycles:   String(plano.ciclos),
    });
    return t("orders.summaryTwap", {
      amount, fromSymbol: fromToken.symbol,
      intervals: String(plano.ciclos), perCycle: plano.cada, symbol: fromToken.symbol,
    });
  }, [tab, amount, freq, fromToken, toToken, limitPrice, plano, t]);

  /**
   * ⚠️⚠️ O NÚMERO QUE O CARD MOSTRA É O NÚMERO QUE O BOTÃO USA.
   *
   * Este era o achado 🔴 da auditoria. `from.amount` levava o ORÇAMENTO TOTAL,
   * e o "Disparar agora" fazia `setAmountIn(card.from.amount)` — então um plano
   * de 1.000 USDC em 12 ciclos abria o swap card com 1.000, não com 83,33. O
   * card exibia os dois números lado a lado e o botão usava o outro.
   *
   * Agora `from.amount` é O VALOR DE UM CICLO, que é o que uma execução faz.
   * O total e a contagem vão em `plan`, para a tela poder mostrar os dois sem
   * ambiguidade sobre qual deles é executável.
   */
  const onPlaceOrder = () => {
    if (!summary || !fromToken || !toToken) return;
    const typeLabel = (() => {
      const k = TABS.find((x) => x.id === tab)?.labelKey;
      return k ? t(k) : tab;
    })();
    const executavel = parcelado && plano?.ok ? plano.cada : amount;
    const card: ActionCard = {
      kind: tab === "limit" ? "buy_limit" : tab,
      title:   `${typeLabel} · ${fromToken.symbol} → ${toToken.symbol}`,
      summary,
      chain:   fromToken.chain,
      from:    { symbol: fromToken.symbol, address: fromToken.address, amount: executavel || undefined },
      to:      { symbol: toToken.symbol,   address: toToken.address },
      triggerPrice: tab === "limit" ? limitPrice : undefined,
      plan: parcelado && plano?.ok
        ? { totalBudget: amount, cycles: plano.ciclos, perCycle: plano.cada, freq: tab === "dca" ? freq : undefined }
        : undefined,
    };
    // ⚠️ Confere se GRAVOU. `savePendingOrder` devolve `null` quando o
    // `localStorage` está cheio — antes engolia e o toast dizia "salva".
    if (!savePendingOrder(card)) {
      toast.error(t("orders.saveFailedToast"));
      return;
    }
    toast.success(t("orders.placedToast", { label: typeLabel }));
    setAmount("");
  };

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
                      {/* ⚠️ `min` e `step` estavam AUSENTES: negativo, fracionário
                          e expoente entravam digitando, e produziam $Infinity,
                          $-200.00 e truncamento calado. */}
                      <input
                        value={intervals}
                        onChange={(e) => setIntervals(e.target.value)}
                        type="number" min={1} max={MAX_CICLOS} step={1}
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

                {/* ⚠️ RECUSA COM MOTIVO. Antes o resumo simplesmente sumia e o
                    botão ficava inerte, sem dizer o que estava errado — ou,
                    pior, aparecia com "$Infinity por ciclo". */}
                {parcelado && plano && !plano.ok && (
                  <div className="rounded-lg border border-gold/25 bg-gold/[0.05] px-3 py-2 font-mono text-[11px] text-gold">
                    {motivoTexto(plano.motivo)}
                  </div>
                )}
                {tab === "limit" && !!(parseDecimalInput(amount) ?? 0) && !(parseDecimalInput(limitPrice) ?? 0) && (
                  <div className="rounded-lg border border-gold/25 bg-gold/[0.05] px-3 py-2 font-mono text-[11px] text-gold">
                    {t("orders.triggerMissing")}
                  </div>
                )}
                {/* ⚠️ A DIVISÃO INTEIRA TRUNCA, e a tela diz quanto sobrou.
                    Truncar e calar é a invariante nº 33: o dono somaria os
                    ciclos, veria menos que o orçamento e não saberia por quê. */}
                {parcelado && plano?.ok && plano.resto && (
                  <div className="font-mono text-[10px] text-ink-4">
                    {t("orders.remainderNote", { rest: plano.resto, symbol: fromToken?.symbol ?? "" })}
                  </div>
                )}

                {summary && (
                  <div className="rounded-lg border border-violet/20 bg-violet/[0.04] p-3 flex items-start gap-2.5">
                    <Sparkles className="w-3.5 h-3.5 text-violet flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-mono text-[10px] text-violet tracking-widest uppercase mb-0.5">{t("orders.zionWillLabel")}</div>
                      <div className="font-sans text-xs text-ink-2 leading-relaxed">{summary}</div>
                    </div>
                  </div>
                )}

                <button onClick={onPlaceOrder} className="w-full btn btn-primary py-3.5 text-sm tracking-widest" disabled={!summary}>
                  {summary
                    ? t("orders.placeBtn", {
                        label: (() => {
                          const k = TABS.find((x) => x.id === tab)?.labelKey;
                          return k ? t(k) : "";
                        })(),
                      })
                    : t("orders.configureBtn")}
                </button>
                {/* ⚠️ A PROMESSA QUE NÃO EXISTIA. A aba dizia "compras
                    recorrentes / recurring schedule" e não há agendador algum —
                    nem rota, nem cron, nem código. Quem lia entendia que algo
                    compraria sozinho todo dia. Agora a tela diz quem dispara. */}
                {parcelado && (
                  <p className="font-sans text-[11px] text-gold/80 leading-relaxed">
                    {t("orders.manualNote")}
                  </p>
                )}
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
        onSelect={onToTokenChange}
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

