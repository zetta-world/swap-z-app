"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { X, ShieldCheck, ExternalLink } from "lucide-react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { buildTransakUrl } from "@/lib/onramp/transak";
import type { ChainId } from "@/lib/chains";

/**
 * Modal that embeds the Transak fiat onramp widget. The user picks a
 * token + chain in the parent swap card, clicks "Comprar com PIX",
 * and this modal opens with everything pre-filled:
 *   - Destination = their connected wallet (EVM or Solana)
 *   - Buy token + network = whatever's in the swap card "TO" slot
 *   - Fiat currency = BRL
 *   - Payment method = PIX
 *   - Address form locked so the user can't mistype a destination
 *
 * The widget renders fully inside the iframe; KYC, PIX QR, and the
 * actual blockchain delivery are all Transak's responsibility. We see
 * exactly nothing — no CPF, no PIX, no bank, no PII. Z-SWAP's job is
 * to launch the iframe with the right params and stay out of the way.
 *
 * After the user completes the flow, the token lands on-chain at their
 * wallet address. The existing balance hooks pick it up automatically
 * on the next refresh; no /api/transak/webhook required for MVP.
 */
export default function PixOnrampModal({
  open, onOpenChange,
  cryptoSymbol, chain,
  fiatAmount,
}: {
  open:          boolean;
  onOpenChange:  (o: boolean) => void;
  cryptoSymbol:  string;
  chain:         ChainId;
  /** Optional pre-fill — derived from the swap card's notional in BRL. */
  fiatAmount?:   number;
}) {
  const { address: evmAddress } = useAccount();
  const sol = useWallet();
  const solAddress = sol.publicKey?.toBase58() ?? undefined;

  // Pick the right wallet for the chain. Solana goes to Phantom, every
  // other chain in our matrix is EVM.
  const walletAddress = chain === "solana" ? solAddress : evmAddress;

  const widgetUrl = walletAddress
    ? buildTransakUrl({
        cryptoCurrency: cryptoSymbol,
        chain,
        walletAddress,
        fiatAmount,
      })
    : null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[65] bg-bg/80 backdrop-blur-md animate-fade-in" />
        <Dialog.Content
          className="fixed z-[65] outline-none flex flex-col
                     inset-x-2 bottom-2 top-14
                     sm:inset-x-auto sm:bottom-auto sm:top-[6%]
                     sm:left-1/2 sm:-translate-x-1/2
                     sm:w-[95%] sm:max-w-md sm:h-[88vh]
                     animate-scale-in"
        >
          <Dialog.Title className="sr-only">Comprar {cryptoSymbol} com PIX</Dialog.Title>
          <div className="aurora-border p-px flex flex-col h-full">
            <div className="rounded-[19px] glass-strong flex flex-col flex-1 min-h-0">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="w-3.5 h-3.5 text-cyan" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm text-ink leading-none truncate">
                      Comprar {cryptoSymbol} com PIX
                    </div>
                    <div className="font-mono text-[9px] text-ink-3 uppercase tracking-widest mt-0.5">
                      Via Transak · KYC + entrega ON-chain
                    </div>
                  </div>
                </div>
                <Dialog.Close asChild>
                  <button className="w-7 h-7 rounded-md flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/5 flex-shrink-0">
                    <X className="w-4 h-4" />
                  </button>
                </Dialog.Close>
              </div>

              {/* Body */}
              {widgetUrl ? (
                <motion.iframe
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  src={widgetUrl}
                  // Transak requires these allow flags for the PIX QR code
                  // refresh + clipboard copy + payment success deep-link.
                  allow="accelerometer; autoplay; camera; gyroscope; payment; clipboard-write"
                  className="flex-1 w-full border-0 bg-white"
                  title="Transak PIX onramp"
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 gap-3 text-center">
                  <div className="font-display font-bold text-sm text-ink">
                    Onramp indisponível
                  </div>
                  <p className="font-sans text-xs text-ink-3 leading-relaxed max-w-xs">
                    Conecte a sua carteira (MetaMask para EVM, Phantom para Solana) antes
                    de comprar com PIX. O endereço da carteira conectada será o destino dos
                    tokens — você não pode trocar para outro endereço aqui (proteção contra erro).
                  </p>
                </div>
              )}

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-white/5 flex items-center gap-2 flex-shrink-0">
                <ExternalLink className="w-3 h-3 text-ink-4 flex-shrink-0" />
                <p className="font-mono text-[10px] text-ink-4 leading-relaxed flex-1">
                  Transak processa KYC + PIX. Z-SWAP nunca vê seu CPF nem sua conta bancária.
                </p>
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
