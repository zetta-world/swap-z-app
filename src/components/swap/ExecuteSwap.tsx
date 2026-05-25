"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { CheckCircle2, X, ArrowRight, AlertTriangle, Loader2, ExternalLink, Globe } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useAccount, useChainId, usePublicClient, useSendTransaction,
  useSignTypedData, useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { concat, erc20Abi, maxUint256, numberToHex, size, type Hex } from "viem";
import type { Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import { CHAIN_BY_ID } from "@/lib/chains";
import type { ZxQuoteResponse, ZxPermit2Eip712 } from "@/lib/api/zerox";
import { ZEROX_CHAIN_IDS } from "@/lib/api/zerox";
import { LIFI_CHAIN_IDS } from "@/lib/api/lifi";
import type { LfQuote } from "@/lib/api/lifi";
import type { JupQuote, JupSwapResponse } from "@/lib/api/jupiter";
import type { QuoteSource } from "@/lib/api/quote-types";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";
import { useT, t as tImp } from "@/lib/i18n";

interface Props {
  open:        boolean;
  onClose:     () => void;
  fromToken:   Token;
  toToken:     Token;
  fromChain:   ChainId;
  toChain:     ChainId;
  sellAmount:  string;        // BASE UNITS
  slippageBps: number;
  source:      QuoteSource;
  /** Cross-chain only: deliver to this address instead of the connected wallet. */
  recipient?:  string;
}

type Phase =
  | "idle"
  | "fetching_quote"
  | "needs_chain_switch"
  | "needs_approval"
  | "approving"
  | "needs_permit2_sig"
  | "needs_tx_signature"
  | "tx_pending"
  | "tx_confirmed"
  | "tx_failed";

export default function ExecuteSwap({
  open, onClose, fromToken, toToken, fromChain, toChain, sellAmount, slippageBps, source, recipient,
}: Props) {
  const t = useT();
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  // Solana — used for source=jupiter; idle for EVM flows.
  const sol = useWallet();
  const { connection: solConn } = useConnection();

  const [phase, setPhase] = useState<Phase>("idle");
  const [zxQuote, setZxQuote] = useState<ZxQuoteResponse | null>(null);
  const [lfQuote, setLfQuote] = useState<LfQuote | null>(null);
  const [jupResult, setJupResult] = useState<{ quote: JupQuote; swap: JupSwapResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [solSig, setSolSig] = useState<string | null>(null);

  const isCrossChain = fromChain !== toChain;
  const isJupiter    = source === "jupiter";
  const isSolanaSrc  = fromChain === "solana";
  const evmWallet    = isConnected && !!address;
  const solWallet    = sol.connected && !!sol.publicKey;
  const walletReady  = isJupiter ? solWallet : evmWallet;
  const taker        = isJupiter ? sol.publicKey?.toBase58() : address;

  const targetChainId = source === "0x"
    ? ZEROX_CHAIN_IDS[fromChain]
    : source === "lifi"
      ? LIFI_CHAIN_IDS[fromChain]
      : undefined; // Jupiter has no EVM chain ID

  const { data: receipt, isLoading: receiptLoading } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: targetChainId,
    query: { enabled: !!txHash && !isJupiter },
  });

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setPhase("idle");
        setZxQuote(null);
        setLfQuote(null);
        setJupResult(null);
        setError(null);
        setTxHash(null);
        setSolSig(null);
      }, 300);
    }
  }, [open]);

  // Pull firm quote when the modal opens
  useEffect(() => {
    if (!open || !taker) return;
    // EVM-targeting sources need a numeric chain id to proceed
    if (!isJupiter && !targetChainId) return;

    let cancelled = false;
    setPhase("fetching_quote");
    setError(null);

    (async () => {
      try {
        const params = new URLSearchParams({
          mode:        "quote",
          source,
          fromChain,
          toChain,
          sellToken:   fromToken.address === "native" ? "native" : fromToken.address,
          buyToken:    toToken.address   === "native" ? "native" : toToken.address,
          sellAmount,
          taker,
          slippageBps: String(slippageBps),
        });
        if (recipient) params.set("recipient", recipient);
        const res = await fetch(`/api/quote?${params.toString()}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.ok) {
          throw new Error(body.message || body.error || `HTTP ${res.status}`);
        }

        if (source === "0x") {
          const q = body.result as ZxQuoteResponse;
          setZxQuote(q);
          if (currentChainId !== targetChainId) {
            setPhase("needs_chain_switch");
          } else if (q.permit2) {
            setPhase("needs_permit2_sig");
          } else {
            setPhase("needs_tx_signature");
          }
        } else if (source === "lifi") {
          const q = body.result as LfQuote;
          setLfQuote(q);
          if (currentChainId !== targetChainId) {
            setPhase("needs_chain_switch");
          } else if (
            fromToken.address !== "native" &&
            q.estimate.approvalAddress &&
            publicClient
          ) {
            const allowance = await publicClient.readContract({
              address: fromToken.address as Hex,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address as Hex, q.estimate.approvalAddress as Hex],
            });
            if (allowance < BigInt(sellAmount)) {
              setPhase("needs_approval");
            } else {
              setPhase("needs_tx_signature");
            }
          } else {
            setPhase("needs_tx_signature");
          }
        } else {
          // Jupiter — body.result = { quote, swap }
          setJupResult(body.result as { quote: JupQuote; swap: JupSwapResponse });
          setPhase("needs_tx_signature");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("tx_failed");
      }
    })();

    return () => { cancelled = true; };
  }, [open, taker, isJupiter, address, fromChain, toChain, fromToken, toToken, sellAmount, slippageBps, source, recipient, targetChainId, currentChainId, publicClient]);

  // Track receipt
  useEffect(() => {
    if (!receipt) return;
    if (receipt.status === "success") {
      setPhase("tx_confirmed");
      toast.success(isCrossChain ? tImp("swap.bridgingToast") : tImp("swap.swapConfirmed"), {
        description: `Tx ${receipt.transactionHash.slice(0, 10)}…${receipt.transactionHash.slice(-6)}`,
      });
    } else {
      setPhase("tx_failed");
      setError(tImp("swap.txReverted"));
    }
  }, [receipt, isCrossChain]);

  const onSwitchChain = useCallback(async () => {
    if (!targetChainId) return;
    try {
      await switchChainAsync({ chainId: targetChainId });
      // Re-decide next phase
      if (source === "0x") {
        setPhase(zxQuote?.permit2 ? "needs_permit2_sig" : "needs_tx_signature");
      } else if (
        lfQuote &&
        fromToken.address !== "native" &&
        lfQuote.estimate.approvalAddress &&
        publicClient
      ) {
        const allowance = await publicClient.readContract({
          address: fromToken.address as Hex,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address as Hex, lfQuote.estimate.approvalAddress as Hex],
        });
        setPhase(allowance < BigInt(sellAmount) ? "needs_approval" : "needs_tx_signature");
      } else {
        setPhase("needs_tx_signature");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [targetChainId, switchChainAsync, source, zxQuote, lfQuote, fromToken, sellAmount, publicClient, address]);

  const onApprove = useCallback(async () => {
    if (!lfQuote || !targetChainId || !address) return;
    setError(null);
    setPhase("approving");
    try {
      const hash = await writeContractAsync({
        address:      fromToken.address as Hex,
        abi:          erc20Abi,
        functionName: "approve",
        args:         [lfQuote.estimate.approvalAddress as Hex, maxUint256],
        chainId:      targetChainId,
      });
      if (publicClient) {
        await publicClient.waitForTransactionReceipt({ hash });
        // Re-check allowance — guards against rare reorg / RPC inconsistencies
        const fresh = await publicClient.readContract({
          address:      fromToken.address as Hex,
          abi:          erc20Abi,
          functionName: "allowance",
          args:         [address as Hex, lfQuote.estimate.approvalAddress as Hex],
        });
        if (fresh < BigInt(sellAmount)) {
          setError(tImp("swap.approvalShort"));
          setPhase("tx_failed");
          return;
        }
      }
      setPhase("needs_tx_signature");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("user denied");
      setError(denied ? tImp("swap.approvalRejected") : msg);
      setPhase("tx_failed");
    }
  }, [lfQuote, fromToken, targetChainId, writeContractAsync, publicClient, address, sellAmount]);

  const onExecute = useCallback(async () => {
    setError(null);
    try {
      // ─── Jupiter (Solana) path ───────────────────────────────────
      if (isJupiter) {
        if (!jupResult || !sol.publicKey) return;
        if (!sol.signTransaction) {
          setError(tImp("swap.solNoSign"));
          setPhase("tx_failed");
          return;
        }
        setPhase("needs_tx_signature");
        const swapTxBytes = Buffer.from(jupResult.swap.swapTransaction, "base64");
        const tx = VersionedTransaction.deserialize(swapTxBytes);
        const signed = await sol.signTransaction(tx);
        const sig = await solConn.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          maxRetries:    3,
        });
        setSolSig(sig);
        setPhase("tx_pending");

        // Wait for confirmation against the lastValidBlockHeight Jupiter returned.
        try {
          await solConn.confirmTransaction(
            {
              signature:            sig,
              blockhash:            tx.message.recentBlockhash,
              lastValidBlockHeight: jupResult.swap.lastValidBlockHeight,
            },
            "confirmed",
          );
          setPhase("tx_confirmed");
          toast.success(tImp("swap.swapConfirmed"), {
            description: `${sig.slice(0, 10)}…${sig.slice(-6)}`,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : tImp("swap.confirmationFailed"));
          setPhase("tx_failed");
        }
        return;
      }

      // ─── EVM paths ───────────────────────────────────────────────
      // Re-verify wallet is on the source chain before broadcasting. The user
      // could have switched networks externally between approval and send.
      if (!targetChainId) {
        setError(tImp("swap.chainUnsupported"));
        setPhase("tx_failed");
        return;
      }
      if (currentChainId !== targetChainId) {
        setPhase("needs_chain_switch");
        return;
      }

      if (source === "0x") {
        if (!zxQuote) return;
        if (!zxQuote.transaction?.to || !zxQuote.transaction?.data) {
          setError("0x returned an incomplete quote. Please retry.");
          setPhase("tx_failed");
          return;
        }
        let data = zxQuote.transaction.data as Hex;

        if (zxQuote.permit2) {
          setPhase("needs_permit2_sig");
          const eip712 = zxQuote.permit2.eip712 as ZxPermit2Eip712;
          const typedPayload = {
            types:       eip712.types,
            domain:      eip712.domain,
            primaryType: eip712.primaryType,
            message:     eip712.message,
          } as unknown as Parameters<typeof signTypedDataAsync>[0];
          const signature = (await signTypedDataAsync(typedPayload)) as Hex;
          const sigLenHex = numberToHex(size(signature), { size: 32 });
          data = concat([data, sigLenHex, signature]) as Hex;
        }

        setPhase("needs_tx_signature");
        const hash = await sendTransactionAsync({
          to:      zxQuote.transaction.to as Hex,
          data,
          value:   BigInt(zxQuote.transaction.value || "0"),
          chainId: targetChainId,
        });
        setTxHash(hash);
        setPhase("tx_pending");
        return;
      }

      // LiFi path
      if (!lfQuote) return;
      const tx = lfQuote.transactionRequest;
      if (!tx || !tx.to || !tx.data) {
        setError("LiFi returned an incomplete transaction. Please retry.");
        setPhase("tx_failed");
        return;
      }
      setPhase("needs_tx_signature");
      const hash = await sendTransactionAsync({
        to:      tx.to as Hex,
        data:    tx.data as Hex,
        value:   BigInt(tx.value || "0"),
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
  }, [source, isJupiter, jupResult, sol, solConn, zxQuote, lfQuote, signTypedDataAsync, sendTransactionAsync, targetChainId, currentChainId]);

  // Quote-derived display values
  const estIn = Number(sellAmount) / Math.pow(10, fromToken.decimals);
  const { estOut, minOut, routeText, durationText } = useMemo(() => {
    if (source === "0x" && zxQuote) {
      return {
        estOut: Number(zxQuote.buyAmount) / Math.pow(10, toToken.decimals),
        minOut: Number(zxQuote.minBuyAmount) / Math.pow(10, toToken.decimals),
        routeText: zxQuote.route.fills.length === 1
          ? zxQuote.route.fills[0].source
          : `${zxQuote.route.fills.length} hops · ${zxQuote.route.fills.map((f) => f.source).slice(0, 3).join(" · ")}${zxQuote.route.fills.length > 3 ? "…" : ""}`,
        durationText: "~12s · 1 block",
      };
    }
    if (source === "lifi" && lfQuote) {
      const steps = lfQuote.includedSteps ?? [];
      const dur = lfQuote.estimate.executionDuration;
      return {
        estOut: Number(lfQuote.estimate.toAmount)    / Math.pow(10, toToken.decimals),
        minOut: Number(lfQuote.estimate.toAmountMin) / Math.pow(10, toToken.decimals),
        routeText: steps.length > 0
          ? steps.map((s) => s.toolDetails?.name ?? s.tool).filter(Boolean).slice(0, 4).join(" → ")
          : (lfQuote.toolDetails?.name ?? lfQuote.tool ?? "LiFi"),
        durationText: dur < 60 ? `~${dur}s` : dur < 3600 ? `~${Math.round(dur / 60)}min` : `~${Math.round(dur / 3600)}h`,
      };
    }
    if (source === "jupiter" && jupResult) {
      const q = jupResult.quote;
      const labels = (q.routePlan ?? [])
        .map((s) => s.swapInfo.label).filter((x): x is string => !!x);
      return {
        estOut: Number(q.outAmount) / Math.pow(10, toToken.decimals),
        minOut: Number(q.otherAmountThreshold) / Math.pow(10, toToken.decimals),
        routeText: labels.length > 0
          ? labels.slice(0, 4).join(" → ") + (labels.length > 4 ? " …" : "")
          : "Jupiter",
        durationText: "~2s · 1 slot",
      };
    }
    return { estOut: null, minOut: null, routeText: "", durationText: "" };
  }, [source, zxQuote, lfQuote, jupResult, toToken.decimals]);

  const explorerBase = isJupiter ? "https://solscan.io" : explorerForChain(fromChain);
  const sourceLabel  = source === "0x"      ? t("swap.routerZeroEx")
                     : source === "lifi"    ? t("swap.routerLiFi")
                     :                        t("swap.routerJupiter");
  // For Solana, the explorer URL path is /tx/<sig>; we reuse the same prop.
  const txDisplayHash: string | null = isJupiter ? solSig : (txHash ?? null);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-bg/80 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="aurora-border p-px">
            <div className="rounded-[20px] glass-strong p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="font-display font-extrabold text-base text-ink">
                  {t("swap.executeSwap")}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Aggregator badge */}
              <div className="flex items-center gap-2 mb-3">
                <span className={cn(
                  "font-mono text-[9px] px-2 py-0.5 rounded border tracking-widest uppercase",
                  source === "0x"
                    ? "border-cyan/30 bg-cyan/10 text-cyan"
                    : source === "lifi"
                      ? "border-violet/30 bg-violet/10 text-violet"
                      : "border-[#14F195]/40 bg-[#14F195]/10",
                )}
                style={source === "jupiter" ? { color: "#14F195" } : undefined}>
                  {sourceLabel}
                </span>
                {isCrossChain && (
                  <span className="font-mono text-[9px] px-2 py-0.5 rounded border border-violet/30 bg-violet/5 text-violet tracking-widest uppercase inline-flex items-center gap-1">
                    <Globe className="w-2.5 h-2.5" />
                    {CHAIN_BY_ID[fromChain]?.short} → {CHAIN_BY_ID[toChain]?.short}
                  </span>
                )}
              </div>

              {/* Pair summary */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5 min-w-0 mb-3">
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("zion.pay")}</div>
                  <div className="font-display font-bold text-base text-ink truncate">
                    {formatAmount(estIn, 6)} {fromToken.symbol}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-cyan flex-shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                  <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("zion.receive")}</div>
                  <div className="font-display font-bold text-base text-ink truncate">
                    {estOut !== null ? `~${formatAmount(estOut, 6)}` : "—"} {toToken.symbol}
                  </div>
                </div>
              </div>

              {/* Recipient override notice — bridge will deliver to a non-wallet address */}
              {isCrossChain && recipient && address && recipient.toLowerCase() !== address.toLowerCase() && (
                <div className="rounded-xl border border-gold/30 bg-gold/[0.05] p-2.5 mb-3 flex items-start gap-2">
                  <Globe className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-mono text-[10px] text-gold tracking-widest uppercase mb-0.5">
                      Custom recipient
                    </div>
                    <p className="font-mono text-[11px] text-ink-2 truncate">
                      Deliver to {recipient.slice(0, 8)}…{recipient.slice(-6)}
                    </p>
                  </div>
                </div>
              )}

              {/* Quote details */}
              {(zxQuote || lfQuote || jupResult) && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <Cell label={t("swap.cellSlippage")}    value={`${(slippageBps / 100).toFixed(2)}%`} />
                  <Cell label={t("swap.cellMinReceived")} value={minOut !== null ? `${formatAmount(minOut, 6)} ${toToken.symbol}` : "—"} tone="green" />
                  {routeText && <Cell label={t("swap.cellRoute")} value={routeText} />}
                  {durationText && <Cell label="Est. time" value={durationText} />}
                </div>
              )}

              {/* Phase-driven status */}
              <PhaseBlock
                phase={phase}
                error={error}
                txHash={txDisplayHash}
                explorerBase={explorerBase}
                receiptLoading={receiptLoading}
                isConnected={walletReady}
                isCrossChain={isCrossChain}
                source={source}
                t={t}
              />

              {/* CTA */}
              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 btn btn-secondary text-xs"
                  disabled={phase === "approving" || phase === "needs_permit2_sig" || phase === "needs_tx_signature" || phase === "tx_pending"}
                >
                  {phase === "tx_confirmed" ? t("swap.btnDone") : t("common.cancel")}
                </button>
                {phase === "needs_chain_switch" && !isJupiter && (
                  <button type="button" onClick={onSwitchChain} className="flex-1 btn btn-primary text-xs">
                    Switch network
                  </button>
                )}
                {phase === "needs_approval" && (
                  <button type="button" onClick={onApprove} className="flex-1 btn btn-primary text-xs">
                    Approve {fromToken.symbol}
                  </button>
                )}
                {(phase === "needs_permit2_sig" || phase === "needs_tx_signature") && (
                  <button type="button" onClick={onExecute} className="flex-1 btn btn-primary text-xs">
                    Sign &amp; send
                  </button>
                )}
                {phase === "tx_failed" && (zxQuote || lfQuote || jupResult) && (
                  <button type="button" onClick={onExecute} className="flex-1 btn btn-primary text-xs">
                    Retry
                  </button>
                )}
              </div>

              {/* Disclaimer */}
              <p className="font-mono text-[10px] text-ink-4 text-center mt-3 leading-relaxed">
                {(zxQuote || lfQuote || jupResult)
                  ? source === "0x"
                    ? "Powered by 0x Settler · Permit2 · no custody"
                    : source === "lifi"
                      ? "Powered by LiFi · bridges + DEX aggregators · no custody"
                      : "Powered by Jupiter · Solana DEX aggregator · no custody"
                  : `Fetching firm quote from ${sourceLabel}…`}
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
  phase, error, txHash, explorerBase, receiptLoading, isConnected, isCrossChain, source, t,
}: {
  phase: Phase;
  error: string | null;
  txHash: string | null;
  explorerBase: string;
  receiptLoading: boolean;
  isConnected: boolean;
  isCrossChain: boolean;
  source: QuoteSource;
  t: (k: import("@/lib/i18n").MessageKey, vars?: Record<string, string | number>) => string;
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
      return <Stepper text={t("swap.fetchingFirm", { label: source === "0x" ? "0x" : source === "lifi" ? "LiFi" : "Jupiter" })} />;
    case "needs_chain_switch":
      return (
        <Card tone="gold" Icon={AlertTriangle}>
          <div className="font-display font-bold text-xs text-gold mb-0.5">Wrong network</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            Switch your wallet to the source chain to continue.
          </p>
        </Card>
      );
    case "needs_approval":
      return (
        <Card tone="cyan" Icon={CheckCircle2}>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">Approval needed</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            {source === "lifi"
              ? "LiFi needs permission to spend your tokens. One-time approval, then the swap signs."
              : "Approve token spending. One-time, then the swap signs."}
          </p>
        </Card>
      );
    case "approving":
      return <Stepper text="Waiting for approval to be mined…" />;
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
            {isCrossChain
              ? "Your wallet will confirm the source-chain transaction. The bridge then delivers and swaps on the destination chain."
              : "Your wallet will prompt you to confirm the transaction."}
          </p>
        </Card>
      );
    case "tx_pending":
      return (
        <Card tone="cyan" Icon={Loader2} spinning>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">
            {isCrossChain ? "Confirming source tx…" : "Confirming on-chain…"}
          </div>
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
          <div className="font-display font-bold text-xs text-green mb-0.5">
            {isCrossChain ? t("swap.sourceConfirmed") : t("swap.swapConfirmed")}
          </div>
          {isCrossChain && (
            <p className="font-sans text-[11px] text-ink-2 leading-relaxed mb-1">
              Funds are being bridged. Final delivery typically takes a few minutes depending on the route.
            </p>
          )}
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
