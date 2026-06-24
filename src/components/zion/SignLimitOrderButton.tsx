"use client";

import { useState } from "react";
import { useAccount, useChainId, useSwitchChain, usePublicClient, useSignTypedData, useWriteContract } from "wagmi";
import { erc20Abi, maxUint256, type Hex } from "viem";
import { toast } from "sonner";
import { ShieldCheck, Loader2, AlertTriangle, Zap } from "lucide-react";
import type { ActionCard } from "@/lib/zion/parse";
import { findToken } from "@/lib/tokens";
import { WAGMI_CHAIN_IDS } from "@/lib/wagmi";
import type { ChainId } from "@/lib/chains";
import {
  buildCowOrder, submitCowOrder, isCowEligibleCard, isCowSupportedChain,
  COW_VAULT_RELAYER,
} from "@/lib/limit/cow";
import { savePendingOrder, attachCowOrder } from "@/lib/zion/orders";
import { cn } from "@/lib/cn";
import { useT, type MessageKey } from "@/lib/i18n";

/**
 * Pre-sign a ZION limit / sell card so CoW Protocol's solvers fill it
 * automatically when the trigger price prints — no popup at trigger
 * time, no missed entries.
 *
 * Flow (each step prompts the user; nothing happens silently):
 *   1. Switch chain in the wallet if needed.
 *   2. Read ERC-20 allowance toward CoW Vault Relayer. If insufficient,
 *      send an approval transaction (one-time per token).
 *   3. Build the EIP-712 typed-data, prompt signTypedData.
 *   4. POST the signed order to api.cow.fi. Persist orderUid locally
 *      so /orders can render the status badge.
 *
 * The button gracefully no-ops on cards that aren't CoW-eligible (kind
 * not in buy_limit/sell_*, chain not in mainnet/arbitrum/base,
 * native ETH as sell token); those cards still get the existing
 * "Save as pending" manual flow via the sibling button.
 */
export default function SignLimitOrderButton({
  card, onDone,
}: {
  card:    ActionCard;
  onDone:  () => void;
}) {
  const t = useT();
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [phase, setPhase] = useState<
    | "idle"
    | "switching_chain"
    | "checking_allowance"
    | "needs_approval"
    | "approving"
    | "signing"
    | "submitting"
    | "done"
    | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);

  const eligible = isCowEligibleCard(card);
  const cardChain = card.chain as ChainId;

  // Resolve the EVM tokens off the curated list. If we can't, the card
  // can't be pre-signed — the user has to wire it manually.
  const sellTok = card.from?.symbol ? findToken(cardChain, card.from.symbol) : undefined;
  const buyTok  = card.to?.symbol   ? findToken(cardChain, card.to.symbol)   : undefined;
  const fromAddr = card.from?.address ?? sellTok?.address;
  const isNativeSell = fromAddr === "native";

  const ready = isConnected && address && eligible && sellTok && buyTok && fromAddr && !isNativeSell;

  // Skip rendering entirely on cards that can't be pre-signed. The
  // sibling "Save as pending" button always renders, so the user
  // always has an action.
  if (!eligible) return null;

  const onSign = async () => {
    if (!ready || !address) return;
    setError(null);

    try {
      // ── 1. Chain switch ───────────────────────────────────────────────
      const targetChainNum = WAGMI_CHAIN_IDS[cardChain];
      if (targetChainNum && currentChainId !== targetChainNum) {
        setPhase("switching_chain");
        await switchChainAsync({ chainId: targetChainNum });
      }

      // ── 2. Allowance check ────────────────────────────────────────────
      setPhase("checking_allowance");
      if (!publicClient) throw new Error("Public client not ready");
      const sellTokenAddr = sellTok!.address as Hex;
      const allowance = await publicClient.readContract({
        address:      sellTokenAddr,
        abi:          erc20Abi,
        functionName: "allowance",
        args:         [address, COW_VAULT_RELAYER],
      });

      const built = buildCowOrder({
        card,
        maker:        address,
        sellToken:    sellTokenAddr,
        buyToken:     buyTok!.address as Hex,
        sellDecimals: sellTok!.decimals,
        buyDecimals:  buyTok!.decimals,
      });

      const requiredWei = BigInt(built.message.sellAmount);
      if (allowance < requiredWei) {
        // ── 3. Approve CoW Vault Relayer ─────────────────────────────
        setPhase("needs_approval");
        toast.info(`First-time setup: approve ${sellTok!.symbol} for CoW Protocol`, {
          description: "One transaction. Future limit orders on this token won't need this step.",
          duration: 6000,
        });
        setPhase("approving");
        const txHash = await writeContractAsync({
          address:      sellTokenAddr,
          abi:          erc20Abi,
          functionName: "approve",
          args:         [COW_VAULT_RELAYER, maxUint256],
        });
        // Wait for the approval to mine before we sign — otherwise CoW
        // rejects the order with "ZeroBalance" when it can't reach the
        // allowance at validation time.
        await publicClient.waitForTransactionReceipt({ hash: txHash });
      }

      // ── 4. Sign EIP-712 ───────────────────────────────────────────────
      setPhase("signing");
      const typedPayload = {
        domain:      built.domain,
        types:       built.types,
        primaryType: built.primaryType,
        message:     built.message,
      } as unknown as Parameters<typeof signTypedDataAsync>[0];
      const signature = (await signTypedDataAsync(typedPayload)) as Hex;

      // ── 5. Submit to CoW ──────────────────────────────────────────────
      setPhase("submitting");
      const { orderUid } = await submitCowOrder(cardChain, built, signature, address);

      // Persist locally so /orders can show status.
      const saved = savePendingOrder(card);
      attachCowOrder(saved.id, {
        chain:     cardChain,
        orderUid,
        signedAt:  Date.now(),
        expiresAt: built.meta.expiresAt,
      });

      setPhase("done");
      toast.success(`Limit order pre-signed: ${built.meta.sellAmount} → ${built.meta.buyAmount}`, {
        description: `Fills automatically when market hits ${built.meta.limitPrice}. Valid for ${Math.round((built.meta.expiresAt - Date.now()) / 86_400_000)} days.`,
        duration: 8000,
      });
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const denied = /reject|denied|cancel/i.test(msg);
      setError(denied ? "Signature canceled in wallet." : msg.slice(0, 200));
      setPhase("error");
    }
  };

  const busy = phase !== "idle" && phase !== "done" && phase !== "error";
  const disabled = busy || !ready;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onSign}
        disabled={disabled}
        className={cn(
          "w-full btn btn-primary text-xs flex items-center justify-center gap-1.5 transition-opacity",
          "bg-gradient-to-r from-cyan/20 to-violet/20 border border-cyan/40 hover:border-cyan/60",
          disabled && "opacity-50 cursor-not-allowed",
        )}
        title={!ready
          ? (!eligible ? "Card kind / chain not eligible"
            : isNativeSell ? "Native ETH must be wrapped to WETH first"
            : !sellTok || !buyTok ? "Tokens not in curated list — manual flow only"
            : "Connect wallet to pre-sign")
          : undefined}
      >
        {busy
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : phase === "done"
            ? <ShieldCheck className="w-3.5 h-3.5 text-green" />
            : phase === "error"
              ? <AlertTriangle className="w-3.5 h-3.5 text-red" />
              : <Zap className="w-3.5 h-3.5" />}
        <span>{phaseLabel(phase, !!ready, !!isNativeSell, t as (k: string) => string)}</span>
      </button>

      {error && (
        <div className="rounded-md border border-red/30 bg-red/[0.05] px-2.5 py-1.5 font-mono text-[10px] text-red break-words">
          {error}
        </div>
      )}

      {ready && phase === "idle" && (
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed text-center">
          {t("zion.signGasless" as MessageKey)}
        </p>
      )}
    </div>
  );
}

function phaseLabel(
  phase: string,
  ready: boolean,
  isNativeSell: boolean,
  t: (k: string) => string,
): string {
  if (!ready) {
    if (isNativeSell) return t("zion.signWrapEth");
    return t("zion.signUnavail");
  }
  switch (phase) {
    case "switching_chain":      return t("zion.signSwitchingChain");
    case "checking_allowance":   return t("zion.signCheckingAllowance");
    case "needs_approval":       return t("zion.signNeedsApproval");
    case "approving":            return t("zion.signApproving");
    case "signing":              return t("zion.signSigning");
    case "submitting":           return t("zion.signPosting");
    case "done":                 return t("zion.signDone");
    case "error":                return t("common.retry");
    default:                     return t("zion.signDefault");
  }
}
