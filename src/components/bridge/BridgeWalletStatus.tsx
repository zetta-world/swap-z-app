"use client";

import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { Wallet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useUI } from "@/lib/store/ui";
import { useSwap } from "@/lib/store/swap";
import { CHAIN_BY_ID } from "@/lib/chains";
import { useT, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/**
 * Source / destination wallet status row for the bridge page.
 *
 * Cross-chain swaps mostly need an EVM signer for the source side, but
 * when the destination is Solana you also need a Solana wallet (or a
 * custom recipient address). This panel shows the user at a glance:
 *   • which wallet family is required for source
 *   • whether they're connected
 *   • same for destination (or whether they're using a custom recipient)
 *
 * It's a status surface, not a connect modal — tapping a chip with no
 * wallet opens the global connector (rendered in AppShell) via useUI.
 */
export default function BridgeWalletStatus() {
  const { fromToken, toToken, recipient } = useSwap();
  const { setWalletModal } = useUI();
  const { address, isConnected } = useAccount();
  const sol = useWallet();
  const t = useT();

  if (!fromToken || !toToken) return null;

  const srcChain = fromToken.chain;
  const dstChain = toToken.chain;
  const srcMeta = CHAIN_BY_ID[srcChain];
  const dstMeta = CHAIN_BY_ID[dstChain];

  const srcIsSolana = srcChain === "solana";
  const dstIsSolana = dstChain === "solana";

  const srcWalletReady = srcIsSolana ? sol.connected : isConnected;
  // A custom recipient counts as "ready" only when the address actually
  // matches the destination chain family. A malformed string used to slip
  // through here and only fail downstream at quote time.
  const recipientValid = recipient
    ? (dstIsSolana
        ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(recipient.trim())
        : /^0x[0-9a-fA-F]{40}$/.test(recipient.trim()))
    : false;
  const dstWalletReady = recipient
    ? recipientValid
    : dstIsSolana ? sol.connected : isConnected;

  return (
    <div className="rounded-xl border border-white/5 bg-bg-1/40 p-3 space-y-2">
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1">
        {t("bridge.walletsTitle")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <WalletChip
          role="source"
          chainShort={srcMeta?.short ?? srcChain}
          chainColor={srcMeta?.color ?? "#00E8FF"}
          family={srcIsSolana ? "Solana" : "EVM"}
          address={srcIsSolana ? sol.publicKey?.toBase58() : address}
          ready={srcWalletReady}
          onConnect={() => setWalletModal(true)}
          tLabelKey="bridge.walletSource"
          tConnectKey="bridge.walletConnectNeeded"
        />
        <WalletChip
          role="destination"
          chainShort={dstMeta?.short ?? dstChain}
          chainColor={dstMeta?.color ?? "#9F5FFF"}
          family={dstIsSolana ? "Solana" : "EVM"}
          address={recipient ?? (dstIsSolana ? sol.publicKey?.toBase58() : address)}
          ready={dstWalletReady}
          customRecipient={!!recipient}
          onConnect={() => setWalletModal(true)}
          tLabelKey="bridge.walletDestination"
          tConnectKey="bridge.walletConnectNeeded"
        />
      </div>
      {/* If source and destination need different wallet families AND user
          hasn't set a custom recipient, surface a small hint. */}
      {srcIsSolana !== dstIsSolana && !recipient && (
        <div className="rounded-md border border-gold/20 bg-gold/[0.04] px-2.5 py-1.5 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 text-gold flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
            {t("bridge.differentFamilies")}
          </p>
        </div>
      )}
    </div>
  );
}

function WalletChip({
  role: _role, chainShort, chainColor, family, address, ready, customRecipient,
  tLabelKey, tConnectKey, onConnect,
}: {
  role:             "source" | "destination";
  chainShort:       string;
  chainColor:       string;
  family:           "EVM" | "Solana";
  address?:         string;
  ready:            boolean;
  customRecipient?: boolean;
  tLabelKey:        MessageKey;
  tConnectKey:      MessageKey;
  onConnect:        () => void;
}) {
  void _role;
  const t = useT();
  const short = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;
  return (
    <button
      type="button"
      onClick={ready ? undefined : onConnect}
      className={cn(
        "rounded-lg border p-2.5 flex items-start gap-2 text-left min-w-0 transition-colors",
        ready
          ? "border-cyan/20 bg-cyan/[0.04]"
          : "border-gold/30 bg-gold/[0.06] hover:bg-gold/[0.10]",
      )}
    >
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: `${chainColor}1A`, border: `1px solid ${chainColor}55`, color: chainColor }}
      >
        <Wallet className="w-3.5 h-3.5" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="font-mono text-[9px] text-ink-3 tracking-widest uppercase">
            {t(tLabelKey)}
          </span>
          <span
            className="font-mono text-[9px] tracking-widest uppercase px-1 rounded border"
            style={{ color: chainColor, borderColor: `${chainColor}55`, background: `${chainColor}10` }}
          >
            {chainShort}
          </span>
        </div>
        <div className="font-mono text-[10px] text-ink truncate">
          {ready
            ? customRecipient
              ? t("bridge.customRecipient")
              : `${family} · ${short ?? "—"}`
            : t(tConnectKey, { family })}
        </div>
      </div>
      <span className="flex-shrink-0">
        {ready
          ? <CheckCircle2 className="w-3.5 h-3.5 text-green" />
          : <AlertTriangle className="w-3.5 h-3.5 text-gold" />}
      </span>
    </button>
  );
}
