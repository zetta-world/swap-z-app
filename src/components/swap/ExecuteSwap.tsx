"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { CheckCircle2, X, ArrowRight, AlertTriangle, Loader2, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useAccount, useChainId, useSendTransaction, useSignTypedData, useSwitchChain, useWaitForTransactionReceipt,
} from "wagmi";
import { concat, numberToHex, size, type Hex } from "viem";
import type { Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import type { ZxQuoteResponse, ZxPermit2Eip712 } from "@/lib/api/zerox";
import { ZEROX_CHAIN_IDS, ZEROX_NATIVE } from "@/lib/api/zerox";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";

interface Props {
  open:        boolean;
  onClose:     () => void;
  fromToken:   Token;
  toToken:     Token;
  chain:       ChainId;
  sellAmount:  string;        // BASE UNITS
  slippageBps: number;
}

type Phase =
  | "idle"
  | "fetching_quote"
  | "needs_chain_switch"
  | "needs_permit2_sig"
  | "needs_tx_signature"
  | "tx_pending"
  | "tx_confirmed"
  | "tx_failed";

export default function ExecuteSwap({
  open, onClose, fromToken, toToken, chain, sellAmount, slippageBps,
}: Props) {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();

  const [phase, setPhase] = useState<Phase>("idle");
  const [quote, setQuote] = useState<ZxQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const targetChainId = ZEROX_CHAIN_IDS[chain];

  const { data: receipt, isLoading: receiptLoading } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: targetChainId,
    query: { enabled: !!txHash },
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setPhase("idle");
        setQuote(null);
        setError(null);
        setTxHash(null);
      }, 300);
    }
  }, [open]);

  // Pull firm quote when the modal opens
  useEffect(() => {
    if (!open || !address || !targetChainId) return;
    let cancelled = false;
    setPhase("fetching_quote");
    setError(null);

    (async () => {
      try {
        const params = new URLSearchParams({
          mode:       "quote",
          chain,
          sellToken:  fromToken.address === "native" ? "native" : fromToken.address,
          buyToken:   toToken.address   === "native" ? "native" : toToken.address,
          sellAmount,
          taker:      address,
          slippageBps: String(slippageBps),
        });
        const res = await fetch(`/api/quote?${params.toString()}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          throw new Error(body.message || body.error || `HTTP ${res.status}`);
        }
        const q = body.result as ZxQuoteResponse;
        setQuote(q);

        // Decide next step
        if (currentChainId !== targetChainId) {
          setPhase("needs_chain_switch");
        } else if (q.permit2) {
          setPhase("needs_permit2_sig");
        } else {
          setPhase("needs_tx_signature");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("tx_failed");
      }
    })();

    return () => { cancelled = true; };
  }, [open, address, chain, fromToken, toToken, sellAmount, slippageBps, targetChainId, currentChainId]);

  // Track receipt
  useEffect(() => {
    if (!receipt) return;
    if (receipt.status === "success") {
      setPhase("tx_confirmed");
      toast.success("Swap confirmed", {
        description: `Tx ${receipt.transactionHash.slice(0, 10)}…${receipt.transactionHash.slice(-6)}`,
      });
    } else {
      setPhase("tx_failed");
      setError("Transaction reverted on-chain.");
    }
  }, [receipt]);

  const onSwitchChain = useCallback(async () => {
    if (!targetChainId) return;
    try {
      await switchChainAsync({ chainId: targetChainId });
      setPhase(quote?.permit2 ? "needs_permit2_sig" : "needs_tx_signature");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [targetChainId, switchChainAsync, quote]);

  const onExecute = useCallback(async () => {
    if (!quote) return;
    setError(null);
    try {
      let data = quote.transaction.data as Hex;

      // If selling ERC-20 → need Permit2 signature appended to calldata
      if (quote.permit2) {
        setPhase("needs_permit2_sig");
        const eip712 = quote.permit2.eip712 as ZxPermit2Eip712;
        // wagmi's signTypedData expects strictly-typed EIP-712 — cast the
        // 0x payload to the generic shape it accepts at runtime.
        const typedPayload = {
          types:       eip712.types,
          domain:      eip712.domain,
          primaryType: eip712.primaryType,
          message:     eip712.message,
        } as unknown as Parameters<typeof signTypedDataAsync>[0];
        const signature = (await signTypedDataAsync(typedPayload)) as Hex;

        // 0x v2 expects: calldata + 32-byte length + signature
        const sigLenHex = numberToHex(size(signature), { size: 32 });
        data = concat([data, sigLenHex, signature]) as Hex;
      }

      setPhase("needs_tx_signature");
      const hash = await sendTransactionAsync({
        to:    quote.transaction.to as Hex,
        data,
        value: BigInt(quote.transaction.value || "0"),
        chainId: targetChainId,
      });
      setTxHash(hash);
      setPhase("tx_pending");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("user denied");
      setError(denied ? "Signature rejected by user." : msg);
      setPhase("tx_failed");
    }
  }, [quote, signTypedDataAsync, sendTransactionAsync, targetChainId]);

  // Pretty estimated output amount (firm quote)
  const estOut = quote
    ? Number(quote.buyAmount) / Math.pow(10, toToken.decimals)
    : null;
  const minOut = quote
    ? Number(quote.minBuyAmount) / Math.pow(10, toToken.decimals)
    : null;
  const estIn  = Number(sellAmount) / Math.pow(10, fromToken.decimals);

  const explorerBase = explorerForChain(chain);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="aurora-border p-px">
            <div className="rounded-[20px] glass-strong p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="font-display font-extrabold text-base text-ink">
                  Execute swap
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Pair summary */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 min-w-0 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Pay</div>
                  <div className="font-display font-bold text-base text-ink truncate">
                    {formatAmount(estIn, 6)} {fromToken.symbol}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-cyan flex-shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">Receive (est.)</div>
                  <div className="font-display font-bold text-base text-ink truncate">
                    {estOut !== null ? `~${formatAmount(estOut, 6)}` : "—"} {toToken.symbol}
                  </div>
                </div>
              </div>

              {/* Quote details */}
              {quote && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <Cell label="Slippage"  value={`${(slippageBps / 100).toFixed(2)}%`} />
                  <Cell label="Min received" value={minOut !== null ? `${formatAmount(minOut, 6)} ${toToken.symbol}` : "—"} tone="green" />
                  {quote.route.fills.length > 0 && (
                    <Cell
                      label="Route"
                      value={
                        quote.route.fills.length === 1
                          ? quote.route.fills[0].source
                          : `${quote.route.fills.length} hops · ${quote.route.fills.map((f) => f.source).slice(0, 3).join(" · ")}${quote.route.fills.length > 3 ? "…" : ""}`
                      }
                    />
                  )}
                  {quote.totalNetworkFee && (
                    <Cell label="Network fee" value={`~$${(Number(quote.totalNetworkFee) / 1e18 * 0).toFixed(2) || "—"}`} />
                  )}
                </div>
              )}

              {/* Phase-driven status */}
              <PhaseBlock
                phase={phase}
                error={error}
                txHash={txHash}
                explorerBase={explorerBase}
                receiptLoading={receiptLoading}
                isConnected={isConnected}
              />

              {/* CTA */}
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 btn btn-secondary text-xs"
                  disabled={phase === "needs_permit2_sig" || phase === "needs_tx_signature" || phase === "tx_pending"}
                >
                  {phase === "tx_confirmed" ? "Done" : "Cancel"}
                </button>
                {phase === "needs_chain_switch" && (
                  <button type="button" onClick={onSwitchChain} className="flex-1 btn btn-primary text-xs">
                    Switch network
                  </button>
                )}
                {(phase === "needs_permit2_sig" || phase === "needs_tx_signature") && (
                  <button type="button" onClick={onExecute} className="flex-1 btn btn-primary text-xs">
                    Sign &amp; send
                  </button>
                )}
                {phase === "tx_failed" && quote && (
                  <button type="button" onClick={onExecute} className="flex-1 btn btn-primary text-xs">
                    Retry
                  </button>
                )}
              </div>

              {/* Disclaimer */}
              <p className="font-mono text-[10px] text-ink-4 text-center mt-3 leading-relaxed">
                {quote ? "Powered by 0x Settler · MEV-shielded routing · no custody" : "Fetching firm quote from 0x…"}
              </p>
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function PhaseBlock({
  phase, error, txHash, explorerBase, receiptLoading, isConnected,
}: {
  phase: Phase;
  error: string | null;
  txHash: Hex | null;
  explorerBase: string;
  receiptLoading: boolean;
  isConnected: boolean;
}) {
  if (!isConnected) {
    return (
      <Card tone="gold" Icon={AlertTriangle}>
        <div className="font-display font-bold text-xs text-gold mb-0.5">Wallet not connected</div>
        <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
          Connect a wallet to execute the swap. Top-right of the topbar.
        </p>
      </Card>
    );
  }

  switch (phase) {
    case "fetching_quote":
      return <Stepper text="Fetching firm quote from 0x…" />;
    case "needs_chain_switch":
      return (
        <Card tone="gold" Icon={AlertTriangle}>
          <div className="font-display font-bold text-xs text-gold mb-0.5">Wrong network</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            Switch your wallet to the target chain to continue.
          </p>
        </Card>
      );
    case "needs_permit2_sig":
      return (
        <Card tone="cyan" Icon={CheckCircle2}>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">Ready to sign</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            You&apos;ll first sign a gasless <b>Permit2</b> approval, then a single transaction. No separate approve tx.
          </p>
        </Card>
      );
    case "needs_tx_signature":
      return (
        <Card tone="cyan" Icon={CheckCircle2}>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">Ready to send</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            Your wallet will prompt you to confirm the transaction.
          </p>
        </Card>
      );
    case "tx_pending":
      return (
        <Card tone="cyan" Icon={Loader2} spinning>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">Confirming on-chain…</div>
          {txHash && (
            <a
              href={`${explorerBase}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-cyan/80 hover:text-cyan"
            >
              {txHash.slice(0, 10)}…{txHash.slice(-6)} <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {receiptLoading && (
            <p className="font-sans text-[11px] text-ink-3 mt-1">Waiting for block inclusion…</p>
          )}
        </Card>
      );
    case "tx_confirmed":
      return (
        <Card tone="green" Icon={CheckCircle2}>
          <div className="font-display font-bold text-xs text-green mb-0.5">Swap confirmed</div>
          {txHash && (
            <a
              href={`${explorerBase}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-green/80 hover:text-green"
            >
              View on explorer <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </Card>
      );
    case "tx_failed":
      return (
        <Card tone="red" Icon={AlertTriangle}>
          <div className="font-display font-bold text-xs text-red mb-0.5">Failed</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            {error ?? "Transaction failed. Try again or refresh the quote."}
          </p>
        </Card>
      );
    default:
      return null;
  }
}

function Card({
  tone, Icon, spinning, children,
}: {
  tone: "cyan" | "gold" | "green" | "red";
  Icon: React.ComponentType<{ className?: string }>;
  spinning?: boolean;
  children: React.ReactNode;
}) {
  const cfg = {
    cyan:  { border: "border-cyan/20",  bg: "bg-cyan/[0.04]",  text: "text-cyan"  },
    gold:  { border: "border-gold/20",  bg: "bg-gold/[0.04]",  text: "text-gold"  },
    green: { border: "border-green/20", bg: "bg-green/[0.04]", text: "text-green" },
    red:   { border: "border-red/20",   bg: "bg-red/[0.04]",   text: "text-red"   },
  }[tone];
  return (
    <div className={cn("rounded-xl border p-3.5 flex items-start gap-2.5", cfg.border, cfg.bg)}>
      <Icon className={cn("w-4 h-4 flex-shrink-0 mt-0.5", cfg.text, spinning && "animate-spin")} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Stepper({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-cyan/20 bg-cyan/[0.04] p-3.5 flex items-center gap-2.5">
      <Loader2 className="w-4 h-4 text-cyan animate-spin flex-shrink-0" />
      <span className="font-mono text-xs text-ink-2">{text}</span>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="rounded-lg border border-white/5 bg-bg-1/40 px-3 py-2 min-w-0">
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-0.5">{label}</div>
      <div className={cn("font-mono text-xs truncate", tone === "green" ? "text-green" : "text-ink")}>
        {value}
      </div>
    </div>
  );
}

function explorerForChain(chain: ChainId): string {
  const map: Record<string, string> = {
    ethereum:  "https://etherscan.io",
    bsc:       "https://bscscan.com",
    polygon:   "https://polygonscan.com",
    base:      "https://basescan.org",
    arbitrum:  "https://arbiscan.io",
    optimism:  "https://optimistic.etherscan.io",
    avalanche: "https://snowtrace.io",
    linea:     "https://lineascan.build",
  };
  return map[chain] ?? "https://etherscan.io";
}
