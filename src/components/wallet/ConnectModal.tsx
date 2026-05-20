"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { useConnect, type Connector } from "wagmi";
import { X, Wallet, ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/**
 * Wallet picker modal. Lists every connector wagmi resolves:
 *   - All EIP-6963 injected wallets (MetaMask, Rabby, Brave, OKX, Phantom EVM…)
 *   - Coinbase Wallet (always — Coinbase SDK provides popup fallback)
 *   - WalletConnect (only if NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set)
 *
 * If no wallet is detected, surfaces a CTA to install one.
 */
export default function ConnectModal({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { connectors, connectAsync, isPending } = useConnect();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Dedupe connectors that share the same name (some wallets register both
  // legacy 'injected' AND EIP-6963 entries — we prefer the EIP-6963 one).
  const sorted = dedupeConnectors(connectors);

  const onConnect = async (c: Connector) => {
    setError(null);
    setPendingId(c.uid);
    try {
      await connectAsync({ connector: c });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("User rejected") || msg.includes("rejected") ? "Connection rejected." : msg);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[55] bg-bg/80 backdrop-blur-md animate-fade-in" />
        <Dialog.Content
          className={cn(
            "fixed z-[55] outline-none flex flex-col",
            "inset-x-2 bottom-2 top-14",
            "sm:inset-x-auto sm:bottom-auto sm:top-[12%]",
            "sm:left-1/2 sm:-translate-x-1/2",
            "sm:w-[95%] sm:max-w-md",
            "animate-scale-in",
          )}
        >
          <Dialog.Title className="sr-only">Connect a wallet</Dialog.Title>
          <div className="aurora-border p-px flex flex-col h-full">
            <div className="rounded-[19px] glass-strong flex flex-col flex-1 min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 flex-shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-cyan" />
                  </div>
                  <div>
                    <div className="font-display font-bold text-sm text-ink leading-none">Connect a wallet</div>
                    <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest mt-1">
                      EVM · 9 chains supported
                    </div>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button className="w-8 h-8 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Mobile hint banner — only visible on touch devices */}
              <div className="md:hidden px-4 pt-3 flex-shrink-0">
                <div className="rounded-lg border border-cyan/20 bg-cyan/[0.04] p-2.5 flex gap-2 items-start">
                  <Wallet className="w-3.5 h-3.5 text-cyan flex-shrink-0 mt-0.5" />
                  <p className="font-sans text-[11px] text-ink-2 leading-relaxed">
                    Mobile tip: tap MetaMask to deep-link into the app. If it hangs, open <span className="font-mono text-cyan">z-swap-app.vercel.app</span> directly inside MetaMask&apos;s browser.
                  </p>
                </div>
              </div>

              {/* Wallet list */}
              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                {sorted.length === 0 && (
                  <div className="text-center py-8 px-4">
                    <div className="w-12 h-12 rounded-full bg-white/[0.03] border border-white/5 mx-auto mb-3 flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-ink-3" />
                    </div>
                    <div className="font-display font-bold text-sm text-ink mb-1">No wallets detected</div>
                    <p className="font-sans text-xs text-ink-3 leading-relaxed max-w-xs mx-auto mb-4">
                      Install a browser wallet to get started. MetaMask, Rabby, and Coinbase Wallet are popular options.
                    </p>
                    <a
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 font-mono text-[11px] text-cyan hover:text-cyan-dim tracking-wider uppercase"
                    >
                      Get MetaMask <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {sorted.map((c, i) => {
                  const meta = getWalletMeta(c);
                  const isPendingThis = pendingId === c.uid;
                  const disabled = isPending && !isPendingThis;
                  return (
                    <motion.button
                      key={c.uid}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      onClick={() => onConnect(c)}
                      disabled={disabled}
                      className={cn(
                        "w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all text-left group",
                        "border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-cyan/20",
                        disabled && "opacity-40 cursor-not-allowed",
                        isPendingThis && "border-cyan/40 bg-cyan/[0.06]",
                      )}
                    >
                      <WalletIcon meta={meta} />
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-bold text-sm text-ink truncate">
                          {meta.name}
                        </div>
                        <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider truncate">
                          {meta.subtitle}
                        </div>
                      </div>
                      {isPendingThis ? (
                        <Loader2 className="w-4 h-4 text-cyan animate-spin flex-shrink-0" />
                      ) : (
                        <span className="font-mono text-[10px] text-ink-4 group-hover:text-cyan tracking-widest uppercase">
                          Connect →
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {/* Error toast */}
              {error && (
                <div className="mx-3 mb-3 rounded-lg border border-red/30 bg-red/5 p-3 flex-shrink-0">
                  <div className="font-mono text-[10px] text-red tracking-widest uppercase mb-1">Connection error</div>
                  <p className="font-sans text-xs text-ink-2 leading-relaxed">{error}</p>
                </div>
              )}

              {/* Footer */}
              <div className="px-5 py-3 border-t border-white/5 flex-shrink-0">
                <p className="font-mono text-[10px] text-ink-4 text-center leading-relaxed">
                  By connecting you accept Z-SWAP&apos;s advisory-only posture.
                  ZION suggests · you confirm · we settle.
                </p>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

interface WalletMeta {
  name:     string;
  subtitle: string;
  color:    string;
  iconUrl?: string;
}

function getWalletMeta(c: Connector): WalletMeta {
  // wagmi's connector exposes .icon as a data URL when EIP-6963 wallet provides it
  const iconUrl = (c as { icon?: string }).icon;
  const id = c.id.toLowerCase();
  const name = c.name;

  // Known wallets — friendlier subtitles + brand colors
  if (id.includes("metamask") || /metamask/i.test(name))   return { name, subtitle: "Browser extension", color: "#F6851B", iconUrl };
  if (id.includes("rabby") || /rabby/i.test(name))         return { name, subtitle: "Pro EVM wallet",    color: "#7084FF", iconUrl };
  if (id.includes("phantom") || /phantom/i.test(name))     return { name, subtitle: "Multi-chain",       color: "#AB9FF2", iconUrl };
  if (id.includes("trust") || /trust/i.test(name))         return { name, subtitle: "Mobile wallet",     color: "#3375BB", iconUrl };
  if (id.includes("brave") || /brave/i.test(name))         return { name, subtitle: "Brave browser",     color: "#FB542B", iconUrl };
  if (id.includes("okx") || /okx/i.test(name))             return { name, subtitle: "OKX wallet",        color: "#FFFFFF", iconUrl };
  if (id.includes("coinbase") || /coinbase/i.test(name))   return { name: "Coinbase Wallet", subtitle: "Coinbase native + popup fallback", color: "#0052FF", iconUrl };
  if (id.includes("walletconnect") || c.type === "walletConnect") {
    return { name: "WalletConnect", subtitle: "Scan QR with mobile wallet", color: "#3B99FC", iconUrl };
  }
  if (id === "injected" || c.type === "injected") {
    return { name: name || "Browser Wallet", subtitle: "Detected extension", color: "#00E8FF", iconUrl };
  }
  return { name, subtitle: c.type, color: "#9F5FFF", iconUrl };
}

function WalletIcon({ meta }: { meta: WalletMeta }) {
  if (meta.iconUrl) {
    /* eslint-disable @next/next/no-img-element */
    return (
      <img
        src={meta.iconUrl}
        alt=""
        className="w-9 h-9 rounded-lg object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div
      className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 font-display font-extrabold text-xs"
      style={{
        background: `${meta.color}22`,
        color:      meta.color,
        border:     `1px solid ${meta.color}55`,
      }}
    >
      {meta.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function dedupeConnectors(connectors: readonly Connector[]): Connector[] {
  // Strategy: prefer connectors that handle mobile deep-link properly
  // (metaMask SDK over plain "MetaMask" via injected EIP-6963).
  const byKey = new Map<string, Connector>();

  for (const c of connectors) {
    const name = c.name.toLowerCase();
    const isMetaMask = name === "metamask" || c.id === "metaMask" || c.id === "io.metamask";
    const isCoinbase = name.includes("coinbase") || c.id === "coinbaseWallet" || c.id === "coinbaseWalletSDK";
    const isWC       = c.type === "walletConnect" || c.id === "walletConnect";

    // Group by canonical wallet name
    const key = isMetaMask ? "metamask"
              : isCoinbase ? "coinbase"
              : isWC       ? "walletconnect"
              : name;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, c);
      continue;
    }

    // For MetaMask, prefer the SDK-based `metaMask` connector over the
    // injected duplicate — it handles mobile deep-link properly.
    if (isMetaMask) {
      const existingIsSdk = existing.id === "metaMask";
      const currentIsSdk  = c.id === "metaMask";
      if (currentIsSdk && !existingIsSdk) byKey.set(key, c);
      continue;
    }

    // For other wallets, prefer the connector that has an EIP-6963 icon
    const cHasIcon = !!(c as { icon?: string }).icon;
    const eHasIcon = !!(existing as { icon?: string }).icon;
    if (cHasIcon && !eHasIcon) byKey.set(key, c);
  }
  return Array.from(byKey.values());
}
