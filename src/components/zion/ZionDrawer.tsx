"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import { Sparkles, X, Send, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * ZION AI advisory drawer — slides in from the right.
 *
 * In Sprint 1 (current): typewriter terminal with curated lines based on the
 * current swap pair. In Sprint 2: connects to a /api/zion streaming endpoint
 * backed by the Anthropic SDK (claude-sonnet-4-6).
 */
export default function ZionDrawer() {
  const { zionOpen, setZion } = useUI();
  const { fromToken, toToken } = useSwap();

  const lines = buildAdvisoryLines(fromToken?.symbol, toToken?.symbol);
  const [visible, setVisible] = useState(0);

  // Re-run typewriter whenever the drawer opens or the pair changes
  const linesCount = lines.length;
  useEffect(() => {
    if (!zionOpen) return;
    setVisible(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setVisible(i);
      if (i >= linesCount) clearInterval(id);
    }, 220);
    return () => clearInterval(id);
  }, [zionOpen, fromToken?.symbol, toToken?.symbol, linesCount]);

  return (
    <Dialog.Root open={zionOpen} onOpenChange={setZion}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-bg/60 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[440px] outline-none">
          <Dialog.Title className="sr-only">ZION AI Advisory</Dialog.Title>
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="h-full glass-strong border-l border-white/10 flex flex-col"
          >
            {/* Header */}
            <div className="h-16 flex items-center justify-between px-5 border-b border-white/5 flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="relative w-9 h-9">
                  <div className="absolute inset-0 rounded-xl bg-gold/30 blur-md animate-pulse-glow" />
                  <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-gold to-gold-dim flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-bg" />
                  </div>
                </div>
                <div>
                  <div className="font-display font-bold text-sm text-ink leading-none">ZION</div>
                  <div className="font-mono text-[9px] text-gold/70 tracking-widest uppercase mt-1">Advisory Intelligence</div>
                </div>
              </div>
              <Dialog.Close asChild>
                <button className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                  <X className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Pair header */}
              <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3.5">
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">Analyzing</div>
                <div className="font-display font-bold text-base text-ink">
                  {fromToken?.symbol ?? "—"} <span className="text-ink-3 mx-1.5">→</span> {toToken?.symbol ?? "—"}
                </div>
              </div>

              {/* Terminal-style stream */}
              <div className="rounded-xl border border-gold/15 bg-black/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
                  <span className="w-2 h-2 rounded-full bg-red/60" />
                  <span className="w-2 h-2 rounded-full bg-gold/60" />
                  <span className="w-2 h-2 rounded-full bg-green/60" />
                  <span className="ml-2 font-mono text-[10px] text-ink-3 tracking-wider">ZION · stream</span>
                  <div className="flex-1" />
                  <span className="flex items-center gap-1 font-mono text-[9px] text-gold/70 tracking-widest uppercase">
                    <Zap className="w-2.5 h-2.5" /> Live
                  </span>
                </div>
                <div className="p-4 font-mono text-[11px] sm:text-xs leading-[1.75] min-h-[280px]">
                  {lines.slice(0, visible).map((l, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={l.color}
                    >
                      {l.text}
                    </motion.div>
                  ))}
                  {visible < lines.length && <span className="term-cursor" />}
                </div>
              </div>

              {/* Capability cards */}
              <div className="space-y-2.5">
                <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">ZION capabilities</div>
                {ZION_CAPS.map((c) => (
                  <div key={c.title} className="flex gap-3 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:border-gold/20 transition-colors">
                    <div className="w-1.5 self-stretch bg-gold/60 rounded-full" />
                    <div>
                      <div className="font-display font-semibold text-sm text-ink mb-0.5">{c.title}</div>
                      <div className="font-sans text-xs text-ink-3 leading-relaxed">{c.desc}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Disclaimer */}
              <div className="rounded-xl border border-gold/20 bg-gold/[0.04] p-3.5">
                <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-1.5">Advisory Protocol</div>
                <p className="font-sans text-xs text-ink-2 leading-relaxed">
                  ZION operates in advisory mode exclusively. All suggestions require manual user review and confirmation. No automated execution.
                </p>
              </div>
            </div>

            {/* Input bar */}
            <div className="border-t border-white/5 p-4 flex-shrink-0">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/8 focus-within:border-gold/30">
                <input
                  placeholder="Ask ZION anything about this swap…"
                  className="flex-1 bg-transparent outline-none text-sm font-sans text-ink placeholder:text-ink-4"
                />
                <button className="w-7 h-7 rounded-md flex items-center justify-center text-gold hover:bg-gold/10 transition-colors">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const ZION_CAPS = [
  { title: "Pool & Route Analysis",   desc: "Deep inspection of liquidity, fee tiers, and the optimal execution path." },
  { title: "Risk Pattern Detection",  desc: "Honeypot, fake-volume, sandwich, and protocol-risk indicators." },
  { title: "Scenario Simulation",     desc: "Model hypothetical sizes, slippage, and market conditions before committing." },
  { title: "Context Intelligence",    desc: "Entry/exit context from continuous on-chain data evaluation." },
];

function buildAdvisoryLines(from?: string, to?: string) {
  const f = from ?? "?";
  const t = to ?? "?";
  return [
    { color: "text-cyan",     text: `$ zion analyze --pair ${f}/${t} --depth full`            },
    { color: "text-ink-3",    text: `→ Resolving pools across 11 chains…`                       },
    { color: "text-ink-3",    text: `→ Connecting to GoPlus + Honeypot.is + DexScreener`        },
    { color: "text-green",    text: `✓ Pair found on 4 aggregators · 14 candidate routes`        },
    { color: "text-green",    text: `✓ Pool TVL: $142,830,200 · 24h vol: $892K · util 73.2%`     },
    { color: "text-gold",     text: `⚠ Liquidity concentration above threshold on hop 2`        },
    { color: "text-ink-3",    text: `→ Simulating 1.0 ${f} @ Uniswap V3 fee 0.05%…`              },
    { color: "text-ink-2",    text: `  Impact: 0.42% · MEV shield reduces slip by 64%`           },
    { color: "text-green",    text: `✓ Contract verified · no malicious patterns`                },
    { color: "text-green",    text: `✓ LP lock confirmed · 18 months remaining`                  },
    { color: "text-ink-2",    text: `  Holder concentration: top-10 hold 21% (healthy)`          },
    { color: "text-ink-2",    text: `  Risk Score: 12/100 · LOW RISK`                            },
    { color: "text-ink-3",    text: `→ Route optimization:`                                      },
    { color: "text-ink-2",    text: `  Uniswap 62% · Curve 23% · Balancer 15% · gas saved $18`   },
    { color: "text-green",    text: `✓ Analysis complete · awaiting user decision`              },
    { color: "text-red/70",   text: `  Note: ZION is advisory only · execute manually`           },
  ];
}
