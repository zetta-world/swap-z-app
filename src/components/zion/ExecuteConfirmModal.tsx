"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { CheckCircle2, X, ArrowRight, AlertTriangle, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ActionCard } from "@/lib/zion/parse";
import { cn } from "@/lib/cn";

interface Props {
  card:    ActionCard | null;
  onClose: () => void;
}

export default function ExecuteConfirmModal({ card, onClose }: Props) {
  const [confirming, setConfirming] = useState(false);

  if (!card) return null;

  const handleConfirm = async () => {
    setConfirming(true);
    // Simulate signing latency to make the demo feel real
    await new Promise((r) => setTimeout(r, 1100));
    setConfirming(false);
    toast.success("Proposal logged for execution", {
      description: "Wallet integration ships in Sprint 3. The signed payload would route via the MEV-shielded settlement engine.",
      duration: 5000,
    });
    onClose();
  };

  return (
    <Dialog.Root open={!!card} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="aurora-border p-px"
          >
            <div className="rounded-[20px] glass-strong p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="font-display font-extrabold text-base text-ink">
                  Confirm execution
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3.5">
                  <div className="font-mono text-[10px] text-cyan tracking-widest uppercase mb-1.5">
                    ZION proposal
                  </div>
                  <div className="font-display font-bold text-sm text-ink leading-snug mb-2">{card.title}</div>
                  <div className="font-sans text-xs text-ink-2 leading-relaxed">{card.summary}</div>
                </div>

                {(card.from || card.to) && (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 min-w-0">
                    {card.from && (
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Pay</div>
                        <div className="font-display font-bold text-base text-ink truncate">
                          {card.from.amount && <span>{card.from.amount} </span>}
                          {card.from.symbol}
                        </div>
                      </div>
                    )}
                    <ArrowRight className="w-4 h-4 text-cyan flex-shrink-0" />
                    {card.to && (
                      <div className="flex-1 min-w-0 text-right">
                        <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Receive</div>
                        <div className="font-display font-bold text-base text-ink truncate">{card.to.symbol}</div>
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  {card.estCost && <Cell label="Cost" value={card.estCost} />}
                  {card.estReturn && <Cell label="Output" value={card.estReturn} tone="green" />}
                </div>

                <div className="rounded-xl border border-gold/20 bg-gold/[0.04] p-3.5 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-gold flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-1">Demo environment</div>
                    <div className="font-sans text-xs text-ink-2 leading-relaxed">
                      Wallet signing ships in Sprint 3. Confirming here logs the proposal locally so you can
                      review the full execution flow without on-chain settlement.
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={onClose}
                    className="flex-1 btn btn-secondary text-xs"
                    disabled={confirming}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirm}
                    disabled={confirming}
                    className={cn(
                      "flex-1 btn btn-primary text-xs flex items-center justify-center gap-1.5",
                      confirming && "opacity-70",
                    )}
                  >
                    {confirming ? (
                      <>
                        <Wallet className="w-3 h-3 animate-pulse" />
                        Signing…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3 h-3" />
                        Confirm
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/40 px-3 py-2">
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-0.5">{label}</div>
      <div className={cn("font-mono text-xs truncate", tone === "green" ? "text-green" : "text-ink")}>
        {value}
      </div>
    </div>
  );
}
