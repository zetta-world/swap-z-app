"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  CreditCard, ArrowDownToLine, ArrowUpFromLine, Wallet as WalletIcon,
  ShieldCheck, AlertTriangle, ExternalLink, Loader2,
} from "lucide-react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import TokenSelector from "@/components/swap/TokenSelector";
import type { Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import {
  isTransakSupportedChain, isTransakSupportedSymbol,
  fetchTransakWidgetUrl,
} from "@/lib/onramp/transak";
import { cn } from "@/lib/cn";

/**
 * Dedicated fiat ↔ crypto page. Two tabs:
 *
 *   BUY  (BRL → token)  — Transak ON-ramp via PIX.
 *   SELL (token → BRL)  — Transak OFF-ramp via PIX.
 *
 * The page is intentionally separate from the swap card. Mixing fiat
 * onramp into the swap UI clutters the swap experience and overloads
 * the mental model (cripto-cripto vs fiat-cripto are different flows
 * with different inputs, different KYC, different settlement times).
 *
 * Architecture:
 *   - Token + chain picker drives the Transak URL params (chain, token,
 *     wallet address, BRL or crypto amount).
 *   - When the user clicks "Continuar com PIX" the iframe opens in
 *     a full-page slot below the form (not a modal — feels native to
 *     the page, less stacking complexity).
 *   - For SELL, we reuse the same widget but with productsAvailed=SELL.
 *     Transak handles the entire flow including the on-chain transfer
 *     prompt the user has to sign in their wallet.
 *
 * Limitations surfaced clearly:
 *   - If wallet not connected → CTA disabled + hint to connect.
 *   - If token isn't on Transak's coverage → "esse token não tem onramp
 *     PIX agora; troca por outro ou usa swap interno" message.
 *   - If API key not configured (env var missing) → big setup banner.
 */
export default function OnrampView() {
  const [mode, setMode] = useState<"buy" | "sell">("buy");
  const [token, setToken] = useState<Token | undefined>(undefined);
  const [brlAmount, setBrlAmount] = useState<string>("100");
  const [cryptoAmount, setCryptoAmount] = useState<string>("");
  const chain: ChainId = token?.chain ?? "bsc";

  const { address: evmAddress } = useAccount();
  const sol = useWallet();
  const solAddress = sol.publicKey?.toBase58() ?? undefined;

  const walletAddress = chain === "solana" ? solAddress : evmAddress;
  const chainSupported  = isTransakSupportedChain(chain);
  const tokenSupported  = !!token && isTransakSupportedSymbol(token.symbol);
  const formReady = !!walletAddress && !!token && chainSupported && tokenSupported;

  // The widget URL is minted on demand by our backend (Transak's new
  // mandatory API flow). We don't have it until the user clicks the CTA.
  const [widgetUrl, setWidgetUrl] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const onContinue = async () => {
    if (!formReady || !token || !walletAddress) return;
    setLoading(true);
    setSessionError(null);
    setWidgetUrl(null);
    try {
      const amtBrl    = parseFloat(brlAmount);
      const amtCrypto = parseFloat(cryptoAmount);
      const url = await fetchTransakWidgetUrl({
        product:        mode === "buy" ? "BUY" : "SELL",
        chain,
        cryptoCurrency: token.symbol,
        walletAddress,
        fiatAmount:     mode === "buy"  && Number.isFinite(amtBrl)    && amtBrl    > 0 ? amtBrl    : undefined,
        cryptoAmount:   mode === "sell" && Number.isFinite(amtCrypto) && amtCrypto > 0 ? amtCrypto : undefined,
      });
      setWidgetUrl(url);
    } catch (e) {
      setSessionError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-green/10 border border-green/30 flex items-center justify-center">
            <CreditCard className="w-4 h-4 text-green" />
          </div>
          <div>
            <h1 className="font-display font-extrabold text-xl text-ink leading-none">
              Comprar e Vender por PIX
            </h1>
            <p className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mt-1.5">
              Z-SWAP × Transak · KYC + entrega ON-chain
            </p>
          </div>
        </div>
        <p className="font-sans text-sm text-ink-2 leading-relaxed">
          Troque BRL por cripto direto via PIX, sem precisar de exchange centralizada.
          O token é entregue na sua carteira conectada — Z-SWAP nunca toca nos seus fundos
          nem vê seu CPF.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="inline-flex w-full rounded-xl border border-white/5 bg-bg-1/30 p-1">
        <button
          type="button"
          onClick={() => { setMode("buy"); setWidgetUrl(null); setSessionError(null); }}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "buy"
              ? "bg-green/15 text-green border border-green/30"
              : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
          Comprar cripto
        </button>
        <button
          type="button"
          onClick={() => { setMode("sell"); setWidgetUrl(null); setSessionError(null); }}
          className={cn(
            "flex-1 py-2.5 rounded-lg font-mono text-[11px] tracking-widest uppercase inline-flex items-center justify-center gap-1.5 transition-colors",
            mode === "sell"
              ? "bg-violet/15 text-violet border border-violet/30"
              : "text-ink-3 hover:text-ink-2",
          )}
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" />
          Vender por PIX
        </button>
      </div>

      {/* Form */}
      <motion.div
        layout
        className="rounded-2xl border border-white/5 glass-pane p-4 sm:p-5 space-y-4"
      >
        {/* Token + chain picker */}
        <div>
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-2">
            {mode === "buy" ? "Token que você quer receber" : "Token que você quer vender"}
          </div>
          <TokenSelector
            value={token}
            onChange={setToken}
            side={mode === "buy" ? "to" : "from"}
          />
        </div>

        {/* Amount input — BRL for buy, crypto for sell */}
        {mode === "buy" ? (
          <div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-2">
              Quanto você quer gastar
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-bg-2 px-3 py-2.5 focus-within:border-cyan/40">
              <span className="font-mono text-sm text-ink-3 flex-shrink-0">R$</span>
              <input
                type="number"
                inputMode="decimal"
                value={brlAmount}
                onChange={(e) => setBrlAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="100"
                min={50}
                max={50_000}
                className="flex-1 bg-transparent outline-none font-display font-bold text-xl text-ink tabular-nums min-w-0"
              />
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              {[50, 100, 250, 500, 1000].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setBrlAmount(String(v))}
                  className="px-2 py-0.5 rounded border border-white/10 bg-white/[0.02] font-mono text-[10px] text-ink-3 hover:text-ink-2 hover:bg-white/[0.06] tracking-widest"
                >
                  R$ {v}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-2">
              Quanto você quer vender (opcional — deixe vazio pra definir no widget)
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-bg-2 px-3 py-2.5 focus-within:border-violet/40">
              <input
                type="number"
                inputMode="decimal"
                value={cryptoAmount}
                onChange={(e) => setCryptoAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                placeholder="0.05"
                className="flex-1 bg-transparent outline-none font-display font-bold text-xl text-ink tabular-nums min-w-0"
              />
              {token && <span className="font-mono text-sm text-ink-3 flex-shrink-0">{token.symbol}</span>}
            </div>
          </div>
        )}

        {/* Wallet status */}
        <div className={cn(
          "rounded-lg border px-3 py-2 flex items-start gap-2",
          walletAddress
            ? "border-cyan/20 bg-cyan/[0.04]"
            : "border-gold/30 bg-gold/[0.05]",
        )}>
          <WalletIcon className={cn("w-3.5 h-3.5 flex-shrink-0 mt-0.5", walletAddress ? "text-cyan" : "text-gold")} />
          <div className="font-mono text-[10px] text-ink-2 leading-relaxed flex-1 min-w-0 break-all">
            {walletAddress
              ? <>{mode === "buy" ? "Entrega" : "Origem"}: <b className="text-cyan">{walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}</b> · trancado pela conexão da carteira</>
              : <>Conecte a carteira ({chain === "solana" ? "Phantom" : "MetaMask"}) para {mode === "buy" ? "receber" : "vender"} em <b className="text-gold">{chain}</b>.</>}
          </div>
        </div>

        {/* Errors */}
        {token && !tokenSupported && (
          <div className="rounded-lg border border-red/30 bg-red/[0.05] px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
              <b className="text-red">{token.symbol}</b> não tem onramp PIX direto. Use{" "}
              <a href="/" className="text-cyan underline">o swap interno</a> partindo de USDT/USDC.
            </p>
          </div>
        )}
        {!chainSupported && (
          <div className="rounded-lg border border-red/30 bg-red/[0.05] px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
              A rede <b className="text-red">{chain}</b> não está no Transak. Tente uma das suportadas: Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, Avalanche, Solana.
            </p>
          </div>
        )}

        {/* Session error (backend / Transak rejection) */}
        {sessionError && (
          <div className="rounded-lg border border-red/30 bg-red/[0.05] px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-red flex-shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] text-ink-2 leading-relaxed break-words">{sessionError}</p>
          </div>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={onContinue}
          disabled={!formReady || loading}
          className={cn(
            "w-full btn btn-primary py-3.5 text-sm tracking-widest inline-flex items-center justify-center gap-2 transition-opacity",
            (!formReady || loading) && "opacity-50 cursor-not-allowed",
            mode === "buy"
              ? "from-green/20 to-cyan/20 border-green/40 bg-gradient-to-r hover:border-green/60"
              : "from-violet/20 to-cyan/20 border-violet/40 bg-gradient-to-r hover:border-violet/60",
          )}
        >
          {loading
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : mode === "buy" ? <ArrowDownToLine className="w-3.5 h-3.5" /> : <ArrowUpFromLine className="w-3.5 h-3.5" />}
          {loading ? "Gerando sessão segura…" : mode === "buy" ? "Comprar com PIX" : "Vender por PIX"}
        </button>

        {/* Footnotes */}
        <div className="rounded-lg border border-white/5 bg-bg-1/40 p-2.5 flex items-start gap-2">
          <ShieldCheck className="w-3 h-3 text-ink-3 flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            Z-SWAP nunca vê seu CPF, sua selfie, nem sua chave PIX. Tudo isso roda dentro do widget da Transak,
            que é um PSP regulado pelo BCB. Z-SWAP apenas pré-configura o destino dos tokens.
          </p>
        </div>
      </motion.div>

      {/* Widget panel — appears below the form once the backend returns a
          minted, single-use widget URL. */}
      {widgetUrl && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-cyan/30 glass-pane overflow-hidden"
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-bg-1/40">
            <span className="font-mono text-[10px] text-cyan tracking-widest uppercase inline-flex items-center gap-1.5">
              <ExternalLink className="w-3 h-3" />
              Transak · pagamento + KYC + entrega
            </span>
            <button
              type="button"
              onClick={() => setWidgetUrl(null)}
              className="font-mono text-[10px] text-ink-3 hover:text-ink-2 tracking-widest uppercase"
            >
              Fechar
            </button>
          </div>
          <iframe
            src={widgetUrl}
            // strict-origin-when-cross-origin is REQUIRED by Transak's
            // runtime domain validation — do NOT switch to noreferrer or
            // the widget refuses to load (it can't verify referrerDomain).
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; camera; gyroscope; payment; clipboard-write"
            className="w-full bg-white"
            style={{ height: "min(85vh, 760px)" }}
            title={mode === "buy" ? "Transak buy with PIX" : "Transak sell to PIX"}
          />
        </motion.div>
      )}

    </div>
  );
}
