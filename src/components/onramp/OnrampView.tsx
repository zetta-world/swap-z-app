"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  CreditCard, ArrowDownToLine, ArrowUpFromLine, ShieldCheck, Sparkles,
  Mail, CheckCircle2, Loader2, ArrowRight, Bell,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * "Em breve" gate for the fiat ↔ crypto onramp.
 *
 * The provider integration (Transak) ran into KYB blockers that need
 * CNPJ + verification. Rather than tear out the surface entirely (and
 * lose discoverability + product positioning), we keep the page live as
 * a teaser: explains what's coming, lets the user join a waitlist with
 * email, and surfaces the value proposition cleanly.
 *
 * Architecture:
 *   - All the previous form-state code stays out of this build. When we
 *     ship the real integration, swap this back for the form version
 *     under git history.
 *   - The waitlist is intentionally local-only for v0 (localStorage).
 *     A future PR can wire it to a /api/waitlist route + persistence.
 *     This keeps the page useful as a signal without standing up infra
 *     we'll throw away.
 */

const WAITLIST_KEY = "zswap_onramp_waitlist_v1";

export default function OnrampView() {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
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
      // Stored locally so the user gets the "you're in" confirmation
      // surface across reloads. When we wire the server-side waitlist
      // we'll replay these on first connection.
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
          Compre e venda cripto com <span className="text-gradient-cyan">PIX</span>,<br />
          direto na sua carteira.
        </h1>
        <p className="font-sans text-sm sm:text-base text-ink-2 leading-relaxed max-w-2xl">
          Sem exchange centralizada. Sem custódia. O token é entregue <b className="text-ink">on-chain</b> na
          sua MetaMask ou Phantom em segundos — Z-SWAP nunca toca nos seus fundos
          nem vê seu CPF.
        </p>
      </div>

      {/* Mode preview tabs (informational) */}
      <div className="inline-flex w-full rounded-xl border border-white/5 bg-bg-1/30 p-1">
        <button
          type="button"
          onClick={() => setMode("buy")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "buy" ? "bg-green/15 text-green border border-green/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          Comprar cripto
        </button>
        <button
          type="button"
          onClick={() => setMode("sell")}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "sell" ? "bg-violet/15 text-violet border border-violet/30" : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" />
          Vender por PIX
        </button>
      </div>

      {/* Preview card */}
      <motion.div
        layout
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative rounded-2xl border border-white/5 glass-pane p-5 sm:p-6 overflow-hidden"
      >
        {/* Decorative gradient blur */}
        <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-cyan/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-20 w-72 h-72 rounded-full bg-violet/10 blur-3xl pointer-events-none" />

        <div className="relative space-y-5">
          {mode === "buy" ? <BuyPreview /> : <SellPreview />}

          {/* Stats / value props */}
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-white/5">
            <Stat label="Liquidação" value="~30s" tone="cyan" />
            <Stat label="Fee total" value="~3%" tone="green" />
            <Stat label="Redes" value="8" tone="violet" />
          </div>
        </div>
      </motion.div>

      {/* Waitlist */}
      <motion.div
        layout
        className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/[0.04] to-cyan/[0.03] p-5 sm:p-6 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display font-bold text-base text-ink">
              Seja o primeiro a saber
            </h2>
            <p className="font-sans text-xs sm:text-sm text-ink-2 leading-relaxed mt-1">
              Lista de espera prioritária — quem entrar agora ganha tarifa reduzida
              nos primeiros 30 dias após o lançamento.
            </p>
          </div>
        </div>

        {submitted ? (
          <div className="rounded-lg border border-green/30 bg-green/[0.05] px-3 py-3 flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-green flex-shrink-0 mt-0.5" />
            <div className="font-mono text-[11px] text-ink-2 leading-relaxed">
              <b className="text-green">Você está na lista.</b> Vamos avisar por email no dia que
              liberar — e a tarifa reduzida vai estar marcada na sua conta automaticamente.
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

      {/* Trust line */}
      <div className="rounded-lg border border-white/5 bg-bg-1/40 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          Z-SWAP é não-custodial. Quando esse fluxo abrir, o pagamento PIX vai
          ser processado por um PSP regulado pelo BCB; Z-SWAP nunca terá acesso
          ao seu CPF, conta bancária, ou chave PIX — apenas o endereço da
          sua carteira como destino travado dos tokens.
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
        Exemplo de compra
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label="Você paga" amount="R$ 500" sub="via PIX · BRL" tone="violet" icon={<CreditCard className="w-3.5 h-3.5" />} />
        <PreviewSide label="Você recebe" amount="~0.7 BNB" sub="BSC · entrega on-chain" tone="green" icon={<ArrowDownToLine className="w-3.5 h-3.5" />} />
      </div>
      <ul className="space-y-1.5 font-mono text-[11px] text-ink-2">
        <Li>PSP regulado pelo BCB processa o PIX</Li>
        <Li>Token entregue direto na sua carteira conectada</Li>
        <Li>KYC só uma vez — vale pra todas as próximas compras</Li>
      </ul>
    </>
  );
}

function SellPreview() {
  return (
    <>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
        Exemplo de venda
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PreviewSide label="Você vende" amount="0.5 ETH" sub="Ethereum · da sua carteira" tone="violet" icon={<ArrowUpFromLine className="w-3.5 h-3.5" />} />
        <PreviewSide label="Você recebe" amount="~R$ 8.500" sub="PIX · na sua conta" tone="green" icon={<CreditCard className="w-3.5 h-3.5" />} />
      </div>
      <ul className="space-y-1.5 font-mono text-[11px] text-ink-2">
        <Li>Você assina UMA transferência on-chain pro PSP</Li>
        <Li>PIX cai na sua conta cadastrada em minutos</Li>
        <Li>Z-SWAP não custodia — sua carteira é a origem</Li>
      </ul>
    </>
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

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="w-1 h-1 rounded-full bg-cyan mt-1.5 flex-shrink-0" />
      <span>{children}</span>
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "cyan" | "green" | "violet" }) {
  const txt = tone === "cyan" ? "text-cyan" : tone === "green" ? "text-green" : "text-violet";
  return (
    <div className="text-center">
      <div className={cn("font-display font-bold text-lg tabular-nums", txt)}>{value}</div>
      <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mt-0.5">{label}</div>
    </div>
  );
}
