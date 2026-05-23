"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowLeft, Globe, Shield, Zap, Workflow, Clock } from "lucide-react";
import SwapCard from "@/components/swap/SwapCard";
import { useSwap } from "@/lib/store/swap";
import { findToken } from "@/lib/tokens";

/**
 * Dedicated cross-chain page — purpose-built UX for users coming here to
 * bridge specifically. Reuses the SwapCard locked to "cross" mode (no tabs,
 * recipient field always visible, banner always on), wrapped in a hero
 * that explains the path and a sidebar of "what to expect" cards.
 *
 * Why this exists separately from /swap: the home swap card auto-detects
 * cross-chain pairs, which is great for power users but confusing for
 * newcomers. /bridge is the explicit, opinionated cross-chain entry point.
 */
export default function BridgeView() {
  const { fromToken, toToken, setFromToken, setToToken } = useSwap();

  // On first mount, if the user landed here with a same-chain pair selected
  // we seed a sensible cross-chain default (ETH on Ethereum → USDC on Base).
  // Power users with an already-cross-chain pair keep theirs.
  useEffect(() => {
    if (fromToken && toToken && fromToken.chain !== toToken.chain) return;
    const ethEth  = findToken("ethereum", "ETH");
    const usdcBase = findToken("base",     "USDC");
    if (ethEth)   setFromToken(ethEth);
    if (usdcBase) setToToken(usdcBase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-1/4 left-1/3 w-[55vw] max-w-[420px] aspect-square rounded-full bg-violet/15 blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[50vw] max-w-[360px] aspect-square rounded-full bg-cyan/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-6 lg:py-10 max-w-[1280px] mx-auto w-full">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-3 hover:text-cyan tracking-widest uppercase mb-4"
        >
          <ArrowLeft className="w-3 h-3" />
          back to swap
        </Link>

        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="max-w-3xl mb-6 lg:mb-8">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Globe className="w-4 h-4 text-violet flex-shrink-0" />
            <span className="font-mono text-[10px] text-violet/90 tracking-widest uppercase">
              Cross-Chain Bridge · 30+ networks
            </span>
          </div>
          <h1 className="font-display font-extrabold text-[clamp(1.8rem,4.6vw,3rem)] leading-[0.98] tracking-[-0.02em] text-ink mb-3">
            Move <span className="text-grad-aurora">across chains</span> in one transaction.
          </h1>
          <p className="font-sans text-base text-ink-2/95 leading-relaxed max-w-2xl">
            Pick the source and destination chains, pick the tokens, and Z-SWAP routes through the
            best bridge automatically. You sign once on your wallet — the bridge delivers on the
            other side. Want to send to someone else? Drop their address in the recipient field.
          </p>
        </motion.div>

        {/* Main grid: card + benefits sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-start">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="lg:col-span-7 lg:order-2"
          >
            <SwapCard lockedMode="cross" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-5 lg:order-1 space-y-3"
          >
            <Benefit
              Icon={Workflow}
              label="One signature"
              body="The bridge protocol delivers on the destination chain — no second wallet pop-up, no manual claim."
            />
            <Benefit
              Icon={Clock}
              label="ETA visible upfront"
              body="Most routes settle in 5-15 minutes. You see the bridge name, processing time and platform fee before you sign."
            />
            <Benefit
              Icon={Shield}
              label="Non-custodial"
              body="Z-SWAP never holds your funds. The router LiFi aggregates Stargate, Across, Hop, LayerZero and others on the fly."
            />
            <Benefit
              Icon={Zap}
              label="Custom recipient"
              body="The destination defaults to your wallet — open the Recipient field to send to a friend, a cold wallet, or a CEX deposit."
            />
            <div className="rounded-xl border border-gold/15 bg-gold/[0.04] p-3 mt-2">
              <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-1">
                Need same-chain instead?
              </div>
              <Link href="/" className="font-mono text-[11px] text-cyan hover:underline">
                ← Use the simple Swap on the home page
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Benefit({
  Icon, label, body,
}: {
  Icon:  React.ComponentType<{ className?: string }>;
  label: string;
  body:  string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3.5 flex gap-3 min-w-0">
      <div className="w-8 h-8 rounded-lg bg-violet/10 border border-violet/30 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3.5 h-3.5 text-violet" />
      </div>
      <div className="min-w-0">
        <div className="font-display font-bold text-sm text-ink mb-0.5">{label}</div>
        <p className="font-sans text-xs text-ink-2 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
