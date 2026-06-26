"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { CheckCircle2, X, ArrowRight, AlertTriangle, Loader2, ExternalLink, Globe } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  useAccount, useChainId, usePublicClient, useSendTransaction,
  useSwitchChain, useWaitForTransactionReceipt, useWriteContract,
} from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { erc20Abi, type Hex } from "viem";
import type { Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import { CHAIN_BY_ID } from "@/lib/chains";
import type { ZxQuoteResponse } from "@/lib/api/zerox";
import { ZEROX_CHAIN_IDS } from "@/lib/api/zerox";
import { LIFI_CHAIN_IDS } from "@/lib/api/lifi";
import type { LfQuote } from "@/lib/api/lifi";
import type { JupQuote, JupSwapResponse } from "@/lib/api/jupiter";
import type { QuoteSource } from "@/lib/api/quote-types";
import { cn } from "@/lib/cn";
import { formatAmount } from "@/lib/format";
import { useT, t as tImp } from "@/lib/i18n";
import { useTxHistory } from "@/lib/store/txHistory";
import { fireSwapStrike } from "@/lib/tier/strike";

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
  | "needs_tx_signature"
  | "tx_pending"
  | "tx_confirmed"
  | "tx_failed";

/** Firm 0x calldata embeds pricing — refetch before sending if older than this. */
const ZX_QUOTE_TTL_MS = 30_000;

export default function ExecuteSwap({
  open, onClose, fromToken, toToken, fromChain, toChain, sellAmount, slippageBps, source, recipient,
}: Props) {
  const t = useT();
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  // Solana — used for source=jupiter; idle for EVM flows.
  const sol = useWallet();
  const { connection: solConn } = useConnection();

  const [phase, setPhase] = useState<Phase>("idle");
  const [zxQuote, setZxQuote] = useState<ZxQuoteResponse | null>(null);
  const zxQuoteAtRef = useRef(0);
  const [lfQuote, setLfQuote] = useState<LfQuote | null>(null);
  const [jupResult, setJupResult] = useState<{ quote: JupQuote; swap: JupSwapResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [solSig, setSolSig] = useState<string | null>(null);
  const historyId = useRef<string | null>(null);
  // Guards the firm-quote fetch so it runs once per unique param set per open —
  // not on every currentChainId / publicClient / token-object identity change.
  const fetchKeyRef = useRef("");
  const { push: pushHistory, update: updateHistory } = useTxHistory();

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
      fetchKeyRef.current = "";   // next open refetches a firm quote
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

  // Pull firm quote when the modal opens.
  //
  // Keyed on PRIMITIVES only. Earlier this effect also depended on
  // `currentChainId` and `publicClient`: clicking "Sign & send" runs
  // switchChainAsync, which bumps currentChainId, which re-fired this effect
  // mid-execution — cancelling the in-flight swap, resetting the phase back to
  // "fetching_quote" (the visible flicker) and forcing the user to reconfirm.
  // The key guard makes it fetch exactly once per unique param set per open.
  useEffect(() => {
    if (!open || !taker) return;
    // EVM-targeting sources need a numeric chain id to proceed
    if (!isJupiter && !targetChainId) return;

    const fetchKey = `${source}|${fromChain}|${toChain}|${fromToken.address}|${toToken.address}|${sellAmount}|${slippageBps}|${taker}|${recipient ?? ""}`;
    if (fetchKeyRef.current === fetchKey) return;
    fetchKeyRef.current = fetchKey;

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
          zxQuoteAtRef.current = Date.now();
          if (currentChainId !== targetChainId) {
            setPhase("needs_chain_switch");
          } else if (q.issues?.allowance && fromToken.address !== "native") {
            // AllowanceHolder spender needs a one-time ERC-20 approve()
            setPhase("needs_approval");
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
    // currentChainId / publicClient / token objects are read inside but
    // intentionally excluded from deps — they're captured at fetch time and
    // re-evaluated live in onExecute. See the comment above the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, taker, isJupiter, targetChainId, source, fromChain, toChain, fromToken.address, toToken.address, sellAmount, slippageBps, recipient]);

  // Announce confirmed swaps to the god theme layer (no-op without a
  // listener — free tier / reduced motion). Covers all three sources,
  // since both the receipt effect and the Jupiter path land on this phase.
  useEffect(() => {
    if (phase === "tx_confirmed") fireSwapStrike();
  }, [phase]);

  // Auto-close 2.5 s after confirmation so the user sees the success state
  // briefly without having to dismiss manually.
  useEffect(() => {
    if (phase !== "tx_confirmed") return;
    const timer = setTimeout(() => onClose(), 2500);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  // Track receipt + update history
  useEffect(() => {
    if (!receipt) return;
    if (receipt.status === "success") {
      setPhase("tx_confirmed");
      toast.success(isCrossChain ? tImp("swap.bridgingToast") : tImp("swap.swapConfirmed"), {
        description: `Tx ${receipt.transactionHash.slice(0, 10)}…${receipt.transactionHash.slice(-6)}`,
      });
      if (historyId.current) {
        updateHistory(historyId.current, { status: "confirmed", txHash: receipt.transactionHash });
      }
    } else {
      setPhase("tx_failed");
      setError(tImp("swap.txReverted"));
      if (historyId.current) {
        updateHistory(historyId.current, { status: "failed" });
      }
    }
  }, [receipt, isCrossChain, updateHistory]);

  /** Re-pull a firm 0x quote — calldata embeds pricing and goes stale fast. */
  const fetchFreshZxQuote = useCallback(async (): Promise<ZxQuoteResponse> => {
    const params = new URLSearchParams({
      mode:        "quote",
      source:      "0x",
      fromChain,
      toChain,
      sellToken:   fromToken.address === "native" ? "native" : fromToken.address,
      buyToken:    toToken.address   === "native" ? "native" : toToken.address,
      sellAmount,
      taker:       taker ?? "",
      slippageBps: String(slippageBps),
    });
    const res  = await fetch(`/api/quote?${params.toString()}`);
    const body = await res.json();
    if (!res.ok || !body.ok) {
      throw new Error(body.message || body.error || `HTTP ${res.status}`);
    }
    const q = body.result as ZxQuoteResponse;
    setZxQuote(q);
    zxQuoteAtRef.current = Date.now();
    return q;
  }, [fromChain, toChain, fromToken, toToken, sellAmount, taker, slippageBps]);

  /**
   * One click does the whole journey: switch network → one-time approval →
   * fresh quote → send. The wallet only ever sees plain transactions (no
   * EIP-712 popups), and the user never has to come back to this modal to
   * push a second button.
   */
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
        historyId.current = pushHistory({
          type: "dex_swap", status: "pending",
          fromSymbol: fromToken.symbol, fromChain, fromAmount: String(Number(sellAmount) / Math.pow(10, fromToken.decimals)),
          toSymbol: toToken.symbol, toChain, route: "jupiter",
          toAmount: String(Number(jupResult.quote.outAmount) / Math.pow(10, toToken.decimals)),
        });

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
          if (historyId.current) {
            updateHistory(historyId.current, { status: "confirmed", txHash: sig });
          }
          toast.success(tImp("swap.swapConfirmed"), {
            description: `${sig.slice(0, 10)}…${sig.slice(-6)}`,
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : tImp("swap.confirmationFailed"));
          setPhase("tx_failed");
          if (historyId.current) {
            updateHistory(historyId.current, { status: "failed" });
          }
        }
        return;
      }

      // ─── EVM paths ───────────────────────────────────────────────
      if (!targetChainId) {
        setError(tImp("swap.chainUnsupported"));
        setPhase("tx_failed");
        return;
      }
      // Wrong network? Switch in-line and keep going — no extra click.
      if (currentChainId !== targetChainId) {
        setPhase("needs_chain_switch");
        await switchChainAsync({ chainId: targetChainId });
      }

      if (source === "0x") {
        let q = zxQuote;
        if (!q) return;

        // One-time ERC-20 approval of the 0x AllowanceHolder spender.
        // MaxUint256 so the user never sees this step again for this token.
        if (q.issues?.allowance && fromToken.address !== "native") {
          setPhase("approving");
          const approveHash = await writeContractAsync({
            address:      fromToken.address as Hex,
            abi:          erc20Abi,
            functionName: "approve",
            args:         [q.issues.allowance.spender as Hex, 2n ** 256n - 1n],
            chainId:      targetChainId,
          });
          if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash });
          zxQuoteAtRef.current = 0;   // force a fresh quote below
        }

        // Stale calldata is the top cause of on-chain reverts — refetch if
        // the quote sat around (modal idle, approval wait, chain switch).
        if (Date.now() - zxQuoteAtRef.current > ZX_QUOTE_TTL_MS) {
          setPhase("fetching_quote");
          q = await fetchFreshZxQuote();
        }
        if (!q.transaction?.to || !q.transaction?.data) {
          setError(tImp("swap.executeIncompleteQuote0x"));
          setPhase("tx_failed");
          return;
        }

        // AllowanceHolder = a single plain transaction. No EIP-712 signature.
        setPhase("needs_tx_signature");
        const hash = await sendTransactionAsync({
          to:      q.transaction.to as Hex,
          data:    q.transaction.data as Hex,
          value:   BigInt(q.transaction.value || "0"),
          gas:     q.transaction.gas ? BigInt(q.transaction.gas) : undefined,
          chainId: targetChainId,
        });
        setTxHash(hash);
        setPhase("tx_pending");
        historyId.current = pushHistory({
          type: isCrossChain ? "dex_bridge" : "dex_swap", status: "pending",
          fromSymbol: fromToken.symbol, fromChain, fromAmount: String(Number(sellAmount) / Math.pow(10, fromToken.decimals)),
          toSymbol: toToken.symbol, toChain, txHash: hash, route: "0x",
          toAmount: String(Number(q.buyAmount) / Math.pow(10, toToken.decimals)),
        });
        return;
      }

      // LiFi path — approval (when short) chained into the same click
      if (!lfQuote) return;
      const tx = lfQuote.transactionRequest;
      if (!tx || !tx.to || !tx.data) {
        setError(tImp("swap.executeIncompleteTxLiFi"));
        setPhase("tx_failed");
        return;
      }
      if (
        fromToken.address !== "native" &&
        lfQuote.estimate.approvalAddress &&
        publicClient && address
      ) {
        const allowance = await publicClient.readContract({
          address:      fromToken.address as Hex,
          abi:          erc20Abi,
          functionName: "allowance",
          args:         [address as Hex, lfQuote.estimate.approvalAddress as Hex],
        });
        if (allowance < BigInt(sellAmount)) {
          setPhase("approving");
          const approveHash = await writeContractAsync({
            address:      fromToken.address as Hex,
            abi:          erc20Abi,
            functionName: "approve",
            args:         [lfQuote.estimate.approvalAddress as Hex, BigInt(sellAmount)],
            chainId:      targetChainId,
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }
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
      historyId.current = pushHistory({
        type: isCrossChain ? "dex_bridge" : "dex_swap", status: "pending",
        fromSymbol: fromToken.symbol, fromChain, fromAmount: String(Number(sellAmount) / Math.pow(10, fromToken.decimals)),
        toSymbol: toToken.symbol, toChain, txHash: hash, route: "lifi",
        toAmount: String(Number(lfQuote.estimate.toAmount) / Math.pow(10, toToken.decimals)),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = msg.toLowerCase().includes("rejected") || msg.toLowerCase().includes("denied");
      setError(denied ? tImp("swap.executeSigRejected") : msg);
      setPhase("tx_failed");
      if (historyId.current) updateHistory(historyId.current, { status: "failed" });
    }
  }, [source, isJupiter, jupResult, sol, solConn, zxQuote, lfQuote, fetchFreshZxQuote, sendTransactionAsync, writeContractAsync, switchChainAsync, publicClient, address, sellAmount, fromToken, isCrossChain, toChain, toToken, targetChainId, currentChainId, pushHistory, updateHistory]);

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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none max-h-[90vh]">
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="aurora-border p-px max-h-[90vh] overflow-y-auto rounded-[20px]">
            <div className="rounded-[20px] glass-strong p-5 sm:p-6">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title className="font-display font-extrabold text-base text-ink">
                  {t("swap.executeSwap")}
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" aria-label={t("common.close")} className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
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
                      {t("swap.executeCustomRecipient")}
                    </div>
                    <p className="font-mono text-[11px] text-ink-2 truncate">
                      {t("swap.executeDeliverTo", { addr: `${recipient.slice(0, 8)}…${recipient.slice(-6)}` })}
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
                  {durationText && <Cell label={t("swap.executeEstTime")} value={durationText} />}
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
                  disabled={phase === "approving" || phase === "needs_tx_signature" || phase === "tx_pending"}
                >
                  {phase === "tx_confirmed" ? t("swap.btnDone") : t("common.cancel")}
                </button>
                {/* Single CTA — network switch, approval and send are all
                    chained behind this one click. */}
                {(phase === "needs_chain_switch" || phase === "needs_approval" || phase === "needs_tx_signature") && (
                  <button type="button" onClick={onExecute} className="flex-1 btn btn-primary text-xs">
                    {t("swap.executeSignAndSend")}
                  </button>
                )}
                {phase === "tx_failed" && (zxQuote || lfQuote || jupResult) && (
                  <button type="button" onClick={onExecute} className="flex-1 btn btn-primary text-xs">
                    {t("swap.executeRetry")}
                  </button>
                )}
              </div>

              {/* Disclaimer */}
              <p className="font-mono text-[10px] text-ink-4 text-center mt-3 leading-relaxed">
                {(zxQuote || lfQuote || jupResult)
                  ? source === "0x"
                    ? t("swap.executePoweredBy0x")
                    : source === "lifi"
                      ? t("swap.executePoweredByLiFi")
                      : t("swap.executePoweredByJupiter")
                  : t("swap.fetchingFirm", { label: sourceLabel })}
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
        <div className="font-display font-bold text-xs text-gold mb-0.5">{t("swap.executeWalletNotConnected")}</div>
        <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
          {t("swap.executeWalletConnectBody")}
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
          <div className="font-display font-bold text-xs text-gold mb-0.5">{t("swap.executeWrongNetwork")}</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            {t("swap.executeWrongNetworkBody")}
          </p>
        </Card>
      );
    case "needs_approval":
      return (
        <Card tone="cyan" Icon={CheckCircle2}>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">{t("swap.executeApprovalNeeded")}</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            {source === "lifi"
              ? t("swap.executeApprovalLiFi")
              : t("swap.executeApprovalGeneric")}
          </p>
        </Card>
      );
    case "approving":
      return <Stepper text={t("swap.executeWaitingApproval")} />;
    case "needs_tx_signature":
      return (
        <Card tone="cyan" Icon={CheckCircle2}>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">{t("swap.executeReadyToSend")}</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            {isCrossChain
              ? t("swap.executeReadyToSendCross")
              : t("swap.executeReadyToSendSame")}
          </p>
        </Card>
      );
    case "tx_pending":
      return (
        <Card tone="cyan" Icon={Loader2} spinning>
          <div className="font-display font-bold text-xs text-cyan mb-0.5">
            {isCrossChain ? t("swap.executeConfirmingSource") : t("swap.executeConfirmingOnChain")}
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
            <p className="font-sans text-[11px] text-ink-3 mt-1">{t("swap.executeBlockInclusion")}</p>
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
              {t("swap.executeBridgeInProgress")}
            </p>
          )}
          {txHash && (
            <a
              href={`${explorerBase}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[11px] text-green/80 hover:text-green"
            >
              {t("swap.executeViewExplorer")} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </Card>
      );
    case "tx_failed":
      return (
        <Card tone="red" Icon={AlertTriangle}>
          <div className="font-display font-bold text-xs text-red mb-0.5">{t("swap.executeFailed")}</div>
          <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
            {error ?? t("swap.executeTxFailedGeneric")}
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
