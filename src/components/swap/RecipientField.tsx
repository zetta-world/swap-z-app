"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, MapPin, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { isAddress } from "viem";
import { isSolanaAddress } from "@/lib/solana";
import { useT } from "@/lib/i18n";
import type { ChainId } from "@/lib/chains";

interface Props {
  /** Resolved recipient. `undefined` ⇒ deliver to the connected wallet. */
  value:        string | undefined;
  onChange:     (v: string | undefined) => void;
  /** Connected wallet address — used as the default-state hint. */
  connected?:   string;
  /** Target chain name (e.g. "Ethereum") shown in the label. */
  toChainName?: string;
  /** Destination chain — controls address format validation (EVM vs Solana). */
  destChain?:   ChainId;
}

/**
 * Recipient input that appears in Cross-Chain mode. Defaults to the connected
 * wallet; users can override to deliver bridge output to a different EVM
 * address. Validates with viem so we never forward malformed addresses to LiFi.
 */
export default function RecipientField({ value, onChange, connected, toChainName, destChain }: Props) {
  const t = useT();
  const [open,  setOpen]  = useState<boolean>(!!value);
  const [draft, setDraft] = useState<string>(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
    if (value) setOpen(true);
  }, [value]);

  const isAddressValid = (s: string): boolean => {
    if (destChain === "solana") return isSolanaAddress(s);
    return isAddress(s);
  };

  const validity = useMemo<"empty" | "valid" | "invalid">(() => {
    if (!draft) return "empty";
    return isAddressValid(draft) ? "valid" : "invalid";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, destChain]);

  const handleCommit = (next: string) => {
    setDraft(next);
    if (!next) {
      onChange(undefined);
      return;
    }
    if (isAddressValid(next)) {
      onChange(next);
    } else {
      onChange(undefined);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/5 bg-bg-1/30 hover:border-violet/30 hover:bg-violet/[0.04] transition-colors group"
      >
        <MapPin className="w-3.5 h-3.5 text-ink-3 group-hover:text-violet" />
        <span className="font-mono text-[11px] text-ink-3 group-hover:text-ink-2 tracking-wide flex-1 text-left">
          {t("swap.sendToMyWallet")}
          {connected && (
            <span className="text-ink-4 ml-1">
              · {connected.slice(0, 6)}…{connected.slice(-4)}
            </span>
          )}
        </span>
        <span className="font-mono text-[9px] text-violet/70 tracking-widest uppercase">
          {t("swap.change")}
        </span>
        <ChevronRight className="w-3 h-3 text-ink-4 group-hover:translate-x-0.5 transition-transform" />
      </button>
    );
  }

  const tone =
    validity === "valid"   ? "border-green/40 bg-green/[0.04]" :
    validity === "invalid" ? "border-red/40 bg-red/[0.04]"   :
                              "border-violet/30 bg-violet/[0.04]";

  return (
    <div className={cn("rounded-xl border p-3 transition-colors", tone)}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-mono text-[10px] text-violet tracking-widest uppercase">
          {t("swap.recipientOnChain", { chain: toChainName ?? t("swap.destination") })}
        </span>
        <button
          type="button"
          onClick={() => { setDraft(""); onChange(undefined); setOpen(false); }}
          className="text-ink-3 hover:text-ink-2"
          aria-label={t("swap.useMyWallet")}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <input
        type="text"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        value={draft}
        onChange={(e) => handleCommit(e.target.value.trim())}
        placeholder={connected ?? (destChain === "solana" ? t("swap.addrPlaceholderSol") : t("swap.addrPlaceholderEvm"))}
        className={cn(
          "w-full bg-transparent text-xs font-mono text-ink outline-none placeholder:text-ink-4 truncate min-w-0",
          validity === "invalid" && "text-red",
        )}
      />
      {validity === "invalid" && (
        <p className="mt-1 font-mono text-[10px] text-red/90">
          {destChain === "solana"
            ? t("swap.notValidSolana")
            : t("swap.notValidEvm")}
        </p>
      )}
      {validity === "valid" && draft.toLowerCase() !== (connected ?? "").toLowerCase() && (
        <p className="mt-1 font-mono text-[10px] text-gold/80">
          {t("swap.bridgeDifferent")}
        </p>
      )}
    </div>
  );
}
