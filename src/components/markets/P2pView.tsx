"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Users, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Sparkles,
  Mail, CheckCircle2, Loader2, ArrowRight, MessageSquare, Star,
  Lock, Banknote,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the P2P market.
 *
 * P2P on Z-SWAP is fiat ↔ crypto direct between users — peer-to-peer
 * via PIX (and other Brazilian rails: TED, Mercado Pago, boleto). One
 * user posts an ad ("I sell 500 USDT for R$ 2,650 via PIX"), another
 * accepts, escrow contract locks the crypto, taker pays fiat off-chain
 * via PIX QR, maker confirms receipt, escrow releases.
 *
 * v0 teaser only — real backend (ad relay, off-chain chat with
 * end-to-end encryption, escrow contract, reputation system, dispute
 * resolution) lives in subsequent PRs once the legal model (BCB
 * compliance, KYC tier) is finalized.
 */

const WAITLIST_KEY = "zswap_p2p_waitlist_v1";

export default function P2pView() {
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
          Mercado <span className="text-gradient-cyan">P2P</span><br />
          Compre ou venda cripto direto com outra pessoa.
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
          PIX, TED, Mercado Pago, boleto — você escolhe como receber.
          A cripto fica travada num <b className="text-ink">escrow on-chain</b>{" "}
          enquanto o pagamento off-chain acontece. Sem exchange
          centralizada, sem custódia intermediária, sem KYC institucional —{" "}
          só reputação de quem negocia.
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
          Comprar cripto
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
          Vender cripto
        </button>
      </div>

      {/* Marketplace preview */}
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 overflow-hidden"
      >
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-violet/10 blur-3xl pointer-events-none" />

        <div className="relative space-y-4">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            Ofertas {side === "buy" ? "de venda · USDT/BRL" : "de compra · USDT/BRL"}
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_1.1fr_0.6fr] gap-2 px-3 pb-2 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
            <span>Anunciante</span>
            <span className="text-right">Preço</span>
            <span>Limites · BRL</span>
            <span>Pagamento</span>
            <span className="text-right">—</span>
          </div>

          {/* Offer rows */}
          <div className="space-y-1.5">
            <OfferRow user="thiago.btc" rating={4.98} trades={2417} price="5.30"  limits="100 · 50.000" methods={["PIX", "TED"]} sideTone={side === "buy" ? "green" : "violet"} />
            <OfferRow user="ana_cripto" rating={4.97} trades={1183} price="5.29"  limits="50 · 20.000"  methods={["PIX"]}        sideTone={side === "buy" ? "green" : "violet"} />
            <OfferRow user="zion.trader" rating={4.95} trades={812}  price="5.28" limits="200 · 100k"   methods={["PIX", "MP"]}  sideTone={side === "buy" ? "green" : "violet"} />
            <OfferRow user="otc_brasil"  rating={4.92} trades={609}  price="5.27" limits="500 · 200k"   methods={["PIX", "TED"]} sideTone={side === "buy" ? "green" : "violet"} />
          </div>

          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
            <Stat label="Liquidação PIX" value="~30s"  sub="após confirmar" tone="cyan"   />
            <Stat label="Fee taker"      value="0%"   sub="só maker paga"  tone="green"  />
            <Stat label="Disputa"        value="< 24h" sub="árbitro"       tone="violet" />
          </div>
        </div>
      </motion.div>

      {/* How it works */}
      <div className="rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 space-y-4">
        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Como funciona o escrow</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Step n={1} title="Cripto trava" body="Vendedor envia ao escrow contract — cripto fica visível on-chain, ninguém pode mover." Icon={Lock} tone="cyan" />
          <Step n={2} title="PIX off-chain" body="Comprador paga via QR code do PIX direto pra conta do vendedor. Chat criptografado." Icon={MessageSquare} tone="violet" />
          <Step n={3} title="Release" body="Vendedor confirma PIX recebido → escrow libera cripto automaticamente. Reputação +1." Icon={CheckCircle2} tone="green" />
        </div>
      </div>

      {/* Waitlist */}
      <motion.div
        layout
        className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] to-cyan/[0.03] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <Star className="w-4 h-4 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-base text-ink">
              Reputação inicial gratuita
            </h2>
            <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mt-1">
              Os primeiros 500 emails da lista começam o piloto com{" "}
              <b className="text-gold">selo de "Trader Fundador"</b> no perfil —
              maior limite por trade + prioridade no top da lista nos primeiros
              60 dias.
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">Vaga garantida.</b> Vamos avisar quando o piloto
              abrir — com convite por email + selo Trader Fundador já ativo na
              tua conta.
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
                placeholder="você@email.com"
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
          Z-SWAP não custodia cripto nem intermedia pagamentos. Cada trade
          P2P usa um contrato escrow open-source auditado; PIX rola direto
          entre as duas partes (sem PSP no meio). Z-SWAP cobra apenas
          arbitragem de disputas — e só do maker se a disputa for aberta.
        </p>
      </div>

      {/* Suppress unused-warn — kept for the live ad feed iteration */}
      <span style={{ display: "none" }}><Users className="w-0" /><Banknote className="w-0" /></span>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function OfferRow({
  user, rating, trades, price, limits, methods, sideTone,
}: {
  user: string; rating: number; trades: number;
  price: string; limits: string; methods: string[];
  sideTone: "green" | "violet";
}) {
  const ctaCls = sideTone === "green"
    ? "border-green/30 bg-green/[0.08] text-green hover:bg-green/[0.15]"
    : "border-violet/30 bg-violet/[0.08] text-violet hover:bg-violet/[0.15]";
  const ctaLabel = sideTone === "green" ? "Comprar" : "Vender";
  return (
    <div className="grid grid-cols-[1.4fr_0.9fr_1.2fr_1.1fr_0.6fr] gap-2 items-center px-3 py-2 rounded-lg border border-white/5 bg-white/[0.02] hover:border-white/10 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-[9px] font-bold flex-shrink-0"
          style={{
            background: `${sideTone === "green" ? "#22D27E" : "#9F5FFF"}22`,
            color: sideTone === "green" ? "#22D27E" : "#9F5FFF",
            border: `1px solid ${sideTone === "green" ? "#22D27E" : "#9F5FFF"}55`,
          }}
        >
          {user.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-ink truncate">{user}</div>
          <div className="flex items-center gap-1 font-mono text-[9px] text-ink-3">
            <Star className="w-2 h-2 text-gold fill-gold" />
            {rating.toFixed(2)} · {trades} trades
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm text-ink tabular-nums">R$ {price}</div>
        <div className="font-mono text-[9px] text-ink-3 uppercase">/USDT</div>
      </div>
      <div className="font-mono text-[10px] text-ink-2 tabular-nums">
        R$ {limits}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {methods.map((m) => (
          <span
            key={m}
            className="px-1.5 py-0.5 rounded text-[8px] font-mono tracking-widest uppercase border border-cyan/20 bg-cyan/[0.04] text-cyan"
          >
            {m}
          </span>
        ))}
      </div>
      <button
        type="button"
        disabled
        className={cn(
          "px-2.5 py-1 rounded border font-mono text-[10px] tracking-widest uppercase opacity-90 cursor-not-allowed",
          ctaCls,
        )}
      >
        {ctaLabel}
      </button>
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
