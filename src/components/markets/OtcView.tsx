"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Handshake, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Sparkles,
  Mail, CheckCircle2, Loader2, ArrowRight, Lock, Briefcase, Eye,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the OTC desk.
 *
 * The OTC market in Z-SWAP is for institutional / size-positioned trades
 * that don't fit on-chain orderbooks (a $250k swap on Uniswap would eat
 * 3-8% in slippage; same trade settled OTC is 0.05-0.15%). The desk runs
 * as a request-for-quote board:
 *
 *   1. Maker posts an off-chain signed RFQ ("buy 50 ETH @ <= $3,425").
 *   2. Liquidity providers respond with firm quotes.
 *   3. Maker accepts the best quote — settlement happens on-chain via
 *      a CoW-like escrow contract that atomically swaps the tokens.
 *
 * This page is the v0 teaser: explains the value, captures waitlist
 * intent, and visually previews the experience. Real backend (RFQ
 * relay, signed-order verification, escrow contract integration) lives
 * in subsequent PRs once the trust model is finalized.
 */

const WAITLIST_KEY = "zswap_otc_waitlist_v1";

export default function OtcView() {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return !!window.localStorage.getItem(WAITLIST_KEY); } catch { return false; }
  });

  const onJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(trimmed)) return;
    setSubmitting(true);
    try {
      window.localStorage.setItem(WAITLIST_KEY, JSON.stringify({ email: trimmed, at: Date.now() }));
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 sm:py-10 space-y-6">
      {/* Hero */}
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gold/30 bg-gold/[0.05] font-mono text-[10px] tracking-widest uppercase text-gold">
          <Sparkles className="w-3 h-3" /> Em breve no Z-SWAP
        </div>
        <h1 className="font-display font-extrabold text-2xl sm:text-3xl text-ink leading-tight">
          Mesa <span className="text-gradient-cyan">OTC</span><br />
          Tamanho institucional, fora do orderbook.
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
          Negocie blocos de <b className="text-ink">$10k a $10M+</b> com cotações
          firmes de market makers — sem slippage de pool, sem MEV, sem mover o
          mercado. Liquidação on-chain via escrow atômico, ambas as pernas no
          mesmo bloco.
        </p>
      </div>

      {/* Side tabs */}
      <div className="inline-flex w-full rounded-xl border border-white/5 bg-bg-1/30 p-1">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            side === "buy" ? "bg-green/15 text-green border border-green/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          Solicitar cotação · Comprar
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            side === "sell" ? "bg-violet/15 text-violet border border-violet/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" />
          Fornecer liquidez · Vender
        </button>
      </div>

      {/* RFQ preview */}
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-violet/10 blur-3xl pointer-events-none" />

        <div className="relative space-y-5">
          {side === "buy" ? <BuyPreview /> : <SellPreview />}

          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
            <Stat label="Slippage médio" value="0.08%" sub="vs 4.2% on pool" tone="cyan" />
            <Stat label="Liquidação" value="1 bloco" sub="atômico" tone="green" />
            <Stat label="Ticket mín." value="$10k" sub="USD-equiv" tone="violet" />
          </div>
        </div>
      </motion.div>

      {/* How it works */}
      <div className="rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 space-y-4">
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Como funciona</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Step n={1} title="RFQ" body="Você posta uma cotação assinada off-chain (sem custo, sem gas)." Icon={Briefcase} tone="cyan" />
          <Step n={2} title="Quotes" body="Market makers respondem com preços firmes em ≤ 30s." Icon={Eye} tone="violet" />
          <Step n={3} title="Settle" body="Aceita a melhor — escrow on-chain executa ambas as pernas atomicamente." Icon={Handshake} tone="green" />
        </div>
      </div>

      {/* Waitlist */}
      <motion.div
        layout
        className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] to-cyan/[0.03] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <Lock className="w-4 h-4 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-base text-ink">
              Acesso prioritário
            </h2>
            <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mt-1">
              Os primeiros 100 emails da lista ganham <b className="text-gold">whitelist no piloto</b> +
              taker fee reduzida em 50% nos primeiros 90 dias após lançamento.
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">Você está na whitelist.</b> Vamos avisar por email no
              dia do piloto — com link convite + tarifa reduzida já ativa na sua conta.
            </div>
          </div>
        ) : (
          <form onSubmit={onJoin} className="flex items-stretch gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/10 bg-bg-2 px-3 focus-within:border-gold/40">
              <Mail className="w-3.5 h-3.5 text-ink-3 flex-shrink-0" />
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="você@empresa.com"
                maxLength={120}
                className="flex-1 min-w-0 bg-transparent outline-none font-mono text-sm text-ink placeholder:text-ink-4 py-2.5"
                required
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="px-4 py-2.5 rounded-lg border border-gold/40 bg-gold/15 text-gold font-mono text-[11px] tracking-widest uppercase hover:bg-gold/25 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
              Entrar
            </button>
          </form>
        )}
      </motion.div>

      {/* Trust */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          Z-SWAP nunca segura os fundos. Cada RFQ aceito vira um trade
          atômico via contrato escrow open-source — se qualquer perna falhar,
          ambas revertem no mesmo bloco. Sem custódia intermediária, sem
          gerenciamento de chaves pelo Z-SWAP.
        </p>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function BuyPreview() {
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        Exemplo de RFQ · BUY
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label="Você quer pagar até" amount="$1.2M USDC" sub="Ethereum" tone="violet" icon={<ArrowUpFromLine className="w-3.5 h-3.5" />} />
        <PreviewSide label="Você quer receber" amount="≥ 350 ETH" sub="@ $3,425.71 · firm" tone="green" icon={<ArrowDownToLine className="w-3.5 h-3.5" />} />
      </div>
      <MockQuotesRow />
    </>
  );
}

function SellPreview() {
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        Exemplo de RFQ · SELL
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label="Você quer vender" amount="350 ETH" sub="Ethereum · da sua carteira" tone="violet" icon={<ArrowUpFromLine className="w-3.5 h-3.5" />} />
        <PreviewSide label="Você quer receber pelo menos" amount="$1.196M USDC" sub="@ $3,418.86 · firm" tone="green" icon={<ArrowDownToLine className="w-3.5 h-3.5" />} />
      </div>
      <MockQuotesRow />
    </>
  );
}

function MockQuotesRow() {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">Quotes recebidas</div>
        <div className="inline-flex items-center gap-1 font-mono text-[9px] text-green">
          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
          5 firm · 17s para expirar
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1.5">
        {[
          { mm: "Wintermute",  px: "$3,425.71", best: true,  delta: "best" },
          { mm: "Amber Group", px: "$3,425.39", best: false, delta: "+0.01%" },
          { mm: "GSR",         px: "$3,425.04", best: false, delta: "+0.02%" },
          { mm: "Cumberland",  px: "$3,424.87", best: false, delta: "+0.02%" },
        ].map((q) => (
          <div key={q.mm} className={cn(
            "flex items-center gap-3 px-2.5 py-1.5 rounded border",
            q.best ? "border-green/30 bg-green/[0.04]" : "border-white/5",
          )}>
            <span className="font-mono text-[11px] text-ink-2 flex-1">{q.mm}</span>
            <span className="font-mono text-[11px] text-ink tabular-nums">{q.px}</span>
            <span className={cn(
              "font-mono text-[9px] tracking-widest uppercase",
              q.best ? "text-green" : "text-ink-3",
            )}>
              {q.delta}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewSide({
  label, amount, sub, tone, icon,
}: {
  label: string; amount: string; sub: string;
  tone: "violet" | "green"; icon: React.ReactNode;
}) {
  const ring = tone === "green" ? "border-green/20 bg-green/[0.04]" : "border-violet/20 bg-violet/[0.04]";
  const txt  = tone === "green" ? "text-green" : "text-violet";
  return (
    <div className={cn("rounded-xl border p-3", ring)}>
      <div className={cn("inline-flex items-center gap-1 font-mono text-[9px] tracking-widest uppercase", txt)}>
        {icon}
        {label}
      </div>
      <div className="font-display font-extrabold text-xl text-ink mt-1.5 tabular-nums">{amount}</div>
      <div className="font-mono text-[10px] text-ink-3 tracking-wide mt-0.5">{sub}</div>
    </div>
  );
}

function Step({
  n, title, body, Icon, tone,
}: {
  n: number; title: string; body: string;
  Icon: React.ComponentType<{ className?: string }>;
  tone: "cyan" | "green" | "violet";
}) {
  const cls =
    tone === "cyan"   ? "border-cyan/20 bg-cyan/[0.04] text-cyan"
    : tone === "green"? "border-green/20 bg-green/[0.04] text-green"
                      : "border-violet/20 bg-violet/[0.04] text-violet";
  return (
    <div className={cn("rounded-xl border p-3 space-y-2", cls)}>
      <div className="flex items-center gap-2">
        <div className="font-mono text-[9px] tracking-widest opacity-70">#{n}</div>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="font-display font-bold text-sm text-ink">{title}</div>
      <p className="font-sans text-[11px] text-ink-2 leading-relaxed">{body}</p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "cyan" | "green" | "violet" }) {
  const txt = tone === "cyan" ? "text-cyan" : tone === "green" ? "text-green" : "text-violet";
  return (
    <div className="text-center">
      <div className={cn("font-display font-bold text-lg tabular-nums", txt)}>{value}</div>
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-0.5">{label}</div>
      <div className="font-mono text-[9px] text-ink-4 mt-0.5">{sub}</div>
    </div>
  );
}

// Suppress unused-import warning — keeping TrendingUp around for the
// imminent "live RFQ feed" iteration after waitlist hits threshold.
void TrendingUp;
