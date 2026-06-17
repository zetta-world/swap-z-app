"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine, ArrowUpFromLine, Copy, Check, AlertTriangle,
  Loader2, Shield, ExternalLink, Wallet as WalletIcon, RefreshCw,
  PackageX, Send,
} from "lucide-react";
import { toast } from "sonner";
import {
  useAccount, useChainId, usePublicClient, useSendTransaction,
  useSwitchChain, useWriteContract,
} from "wagmi";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, createTransferInstruction } from "@solana/spl-token";
import { erc20Abi, parseUnits, formatUnits, type Hex } from "viem";
import { CEX_META, type CexId, type CexCredentials, type CexBalance } from "@/lib/cex/types";
import { useTxHistory } from "@/lib/store/txHistory";
import { DEFAULT_TOKENS, type Token } from "@/lib/tokens";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { CHAIN_BY_ID, type ChainId } from "@/lib/chains";
import { WAGMI_CHAIN_IDS } from "@/lib/wagmi";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** Maps a CEX network slug to our internal ChainId, best-effort. */
function networkToChainId(network: string): ChainId | undefined {
  const n = network.toUpperCase();
  if (n === "ERC20" || n === "ETH" || n === "ETHEREUM")  return "ethereum";
  if (n === "BSC"   || n === "BEP20" || n === "BNB")     return "bsc";
  if (n === "POLYGON"|| n === "MATIC")                    return "polygon";
  if (n === "ARBITRUM"|| n === "ARB")                     return "arbitrum";
  if (n === "OPTIMISM"|| n === "OP")                      return "optimism";
  if (n === "BASE")                                        return "base";
  if (n === "AVAX"  || n === "AVAXC")                     return "avalanche";
  if (n === "SOL"   || n === "SPL" || n === "SOLANA")     return "solana";
  return undefined;
}

/**
 * Wallet ↔ CEX bridge — two flows side-by-side on /cex once the vault
 * is unlocked.
 *
 * DEPOSIT (wallet → CEX): auto-fetches the deposit address as soon as the
 *   user picks a currency + network, then presents a direct-send panel so
 *   the user can push funds without leaving the page. The signing still
 *   happens in MetaMask / Phantom — we only build + submit the tx.
 *   A "copy address manually" toggle is available as a secondary option.
 *
 * WITHDRAW (CEX → wallet): collects the destination (pre-filled with the
 *   connected wallet), amount, network and optional 2FA code. On confirm,
 *   calls /api/cex/withdraw which runs the ccxt withdraw call.
 *
 * THREAT MODEL & UX rails:
 *   - Network selector is mandatory and prominent.
 *   - Memo / tag disables the auto-send and forces manual copy.
 *   - Withdraw requires a two-step confirmation.
 */

interface Props {
  exchangeId: CexId;
  credentials: CexCredentials;
}

type Mode = "deposit" | "withdraw";

interface DepositAddress {
  address:  string;
  tag?:     string;
  network?: string;
}

const COMMON_NETWORKS: Record<string, string[]> = {
  USDT: ["ERC20", "BSC", "TRC20", "POLYGON", "ARBITRUM", "OPTIMISM", "SOL"],
  USDC: ["ERC20", "BSC", "POLYGON", "ARBITRUM", "OPTIMISM", "BASE", "SOL"],
  ETH:  ["ERC20", "BSC", "ARBITRUM", "OPTIMISM", "BASE"],
  BTC:  ["BTC", "BSC", "LIGHTNING"],
  BNB:  ["BSC", "BEP2"],
  SOL:  ["SOL"],
  MATIC: ["POLYGON", "ERC20"],
  LINK: ["ERC20", "BSC"],
  JUP:  ["SOL"],
  JTO:  ["SOL"],
  BONK: ["SOL"],
  PYTH: ["SOL"],
  WIF:  ["SOL"],
  RAY:  ["SOL"],
  ORCA: ["SOL"],
  MSOL: ["SOL"],
  JITOSOL: ["SOL"],
  RNDR: ["SOL", "ERC20"],
};

type NetworkKind = "solana" | "evm" | "btc" | "other";
function networkKind(network: string): NetworkKind {
  const n = network.toUpperCase();
  if (n === "SOL" || n === "SPL" || n === "SOLANA") return "solana";
  if (n === "BTC" || n === "BITCOIN" || n === "LIGHTNING") return "btc";
  if (
    n === "ERC20"   || n === "ETH"     || n === "ETHEREUM" ||
    n === "BSC"     || n === "BEP20"   || n === "BNB"      ||
    n === "POLYGON" || n === "MATIC"   ||
    n === "ARBITRUM"|| n === "ARB"     ||
    n === "OPTIMISM"|| n === "OP"      ||
    n === "BASE"    || n === "AVAX"    || n === "AVAXC"
  ) return "evm";
  return "other";
}

function validateAddressForNetwork(address: string, network: string): string | null {
  const a = address.trim();
  if (!a) return null;
  const kind = networkKind(network);
  if (kind === "evm") {
    if (!/^0x[a-fA-F0-9]{40}$/.test(a)) {
      return "EVM networks expect a 0x… address (42 chars). This looks wrong — verify before sending.";
    }
  } else if (kind === "solana") {
    if (a.startsWith("0x")) {
      return "Solana addresses are base58 (no 0x prefix). EVM addresses sent to SOL are permanently lost.";
    }
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
      return "This doesn't look like a Solana base58 address (32–44 chars). Double-check before sending.";
    }
  } else if (kind === "btc") {
    if (a.startsWith("0x")) return "BTC addresses don't start with 0x.";
  }
  return null;
}

export default function WalletCexBridge({ exchangeId, credentials }: Props) {
  const meta = CEX_META[exchangeId];
  const [mode, setMode] = useState<Mode>("deposit");

  return (
    <div className="rounded-2xl border border-white/5 bg-bg-1/40 p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span
            className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
          >
            {meta.label.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <div className="font-display font-bold text-sm text-ink">Wallet ↔ {meta.label}</div>
            <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
              Move value between MetaMask / Phantom and {meta.label}
            </div>
          </div>
        </div>
        <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
          <button
            type="button"
            onClick={() => setMode("deposit")}
            className={cn(
              "px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase inline-flex items-center gap-1.5",
              mode === "deposit" ? "bg-cyan/15 text-cyan" : "text-ink-3 hover:bg-white/5",
            )}
          >
            <ArrowDownToLine className="w-3 h-3" /> Depositar
          </button>
          <button
            type="button"
            onClick={() => setMode("withdraw")}
            className={cn(
              "px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase inline-flex items-center gap-1.5 border-l border-white/10",
              mode === "withdraw" ? "bg-gold/15 text-gold" : "text-ink-3 hover:bg-white/5",
            )}
          >
            <ArrowUpFromLine className="w-3 h-3" /> Sacar
          </button>
        </div>
      </div>

      {mode === "deposit"
        ? <DepositPanel exchangeId={exchangeId} credentials={credentials} />
        : <WithdrawPanel exchangeId={exchangeId} credentials={credentials} />}
    </div>
  );
}

// ─── Deposit (wallet → CEX) ─────────────────────────────────────────────

function DepositPanel({ exchangeId, credentials }: Props) {
  const t = useT();
  const { address: evmAddress } = useAccount();
  const sol = useWallet();
  const solAddress = sol.publicKey?.toBase58() ?? null;
  const phantomLabel = sol.wallet?.adapter?.name ?? "Phantom";

  const [currency, setCurrency] = useState("USDT");
  const [network,  setNetwork]  = useState<string>("BSC");
  const [addr, setAddr] = useState<DepositAddress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<{ code: string; detail?: string; notListed?: boolean; addrNotGenerated?: boolean } | null>(null);
  const [copied,  setCopied]  = useState<"addr" | "tag" | null>(null);
  const [showManual, setShowManual] = useState(false);

  const walletToken = useMemo(() => {
    const chain = networkToChainId(network);
    if (!chain) return undefined;
    return DEFAULT_TOKENS.find(
      (t) => t.chain === chain && t.symbol.toUpperCase() === currency.toUpperCase(),
    );
  }, [currency, network]);
  const walletBal = useTokenBalance(walletToken, null);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const networks = useMemo(() => COMMON_NETWORKS[currency.toUpperCase()] ?? [], [currency]);
  const kind = networkKind(network);

  useEffect(() => {
    if (networks.length > 0 && !networks.includes(network)) {
      setNetwork(networks[0]);
    }
  }, [networks, network]);

  const walletHint = (() => {
    if (kind === "solana" && !solAddress) {
      return { msg: `Conecte ${phantomLabel} para enviar na rede Solana.` };
    }
    if (kind === "evm" && !evmAddress) {
      return { msg: "Conecte MetaMask (ou outra carteira EVM) para enviar nesta rede." };
    }
    return null;
  })();

  const fetchAddr = async () => {
    setLoading(true);
    setError(null);
    setAddr(null);
    try {
      const res = await fetch("/api/cex/deposit-address", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:   exchangeId,
          currency,
          network,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
        }),
      });
      const body = await res.json() as { ok: boolean; address?: string; tag?: string; network?: string; error?: string; detail?: string };
      if (!res.ok || !body.ok || !body.address) {
        const detail = (body.detail ?? "").toLowerCase();
        // "notListed" = the currency itself isn't supported by this exchange.
        // Must NOT trigger on "not found on chain BSC" (wrong network name) or
        // "address does not exist" (address not yet generated on the exchange).
        const notListed =
          body.error === "currency_not_found" ||
          detail.includes("invalid currency") ||
          detail.includes("currency not") ||
          detail.includes("not listed") ||
          (detail.includes("not support") && (detail.includes("currenc") || detail.includes("coin") || detail.includes("asset") || detail.includes("token")));
        // "addrNotGenerated" = currency IS supported but the deposit address hasn't
        // been created yet (Gate.io returns "Not found USDT on chain BSC" until the
        // user visits the exchange and generates the address for that chain).
        const addrNotGenerated =
          !notListed && (
            body.error === "deposit_address_unavailable" ||
            detail.includes("does not exist") ||
            (detail.includes("not found") && (detail.includes("chain") || detail.includes("network") || detail.includes(" on ")))
          );
        setError({ code: body.error ?? `HTTP ${res.status}`, detail: body.detail, notListed, addrNotGenerated });
        return;
      }
      setAddr({ address: body.address, tag: body.tag, network: body.network ?? network });
    } catch (e) {
      setError({ code: "network_error", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch whenever currency / network / exchange changes (debounced 500 ms).
  // Ref pattern avoids stale-closure issues without adding fetchAddr to deps.
  const fetchAddrRef = useRef(fetchAddr);
  fetchAddrRef.current = fetchAddr;
  useEffect(() => {
    if (!currency || !network) return;
    setAddr(null);
    setError(null);
    const timer = setTimeout(() => { void fetchAddrRef.current(); }, 500);
    return () => clearTimeout(timer);
  }, [currency, network, exchangeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (which: "addr" | "tag", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy — long-press to select instead.");
    }
  };

  const canDirectSend = !!(walletToken && (kind === "evm" || kind === "solana"));
  const hasTag = !!addr?.tag;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Moeda</div>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
            placeholder="USDT"
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40"
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Rede</div>
          {networks.length > 0 ? (
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40"
            >
              {networks.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <input
              value={network}
              onChange={(e) => setNetwork(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32))}
              placeholder={t("common.networkPlaceholder")}
              className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40"
            />
          )}
        </label>
      </div>

      {/* Live wallet balance */}
      {walletToken && walletBal.loading && (
        <div className="flex items-center gap-1.5 -mt-1 px-0.5">
          <Loader2 className="w-3 h-3 text-ink-4 animate-spin" />
          <span className="font-mono text-[10px] text-ink-4">Lendo saldo da carteira…</span>
        </div>
      )}
      {walletToken && !walletBal.loading && (
        <div className="flex items-center gap-1.5 -mt-1 px-0.5">
          <WalletIcon className="w-3 h-3 text-ink-4" />
          <span className="font-mono text-[10px] text-ink-3">
            Saldo na carteira:{" "}
            <span className={cn("tabular-nums", walletBal.isZero ? "text-ink-4" : "text-cyan")}>
              {walletBal.isZero ? "0" : walletBal.formatted} {currency.toUpperCase()}
            </span>
          </span>
        </div>
      )}

      {walletHint && (
        <div className="rounded-md border border-gold/30 bg-gold/[0.05] px-3 py-2 inline-flex items-start gap-2 w-full">
          <WalletIcon className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] text-ink-2 leading-relaxed">{walletHint.msg}</p>
        </div>
      )}

      {/* Error states */}
      {error && error.notListed ? (
        <div className="rounded-md border border-gold/30 bg-gold/[0.05] px-3 py-2 space-y-1">
          <div className="font-mono text-[10px] text-gold flex items-center gap-1.5">
            <PackageX className="w-3.5 h-3.5 flex-shrink-0" />
            {currency.toUpperCase()} não está disponível no {CEX_META[exchangeId].label}
          </div>
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            Esta moeda não é suportada para depósito nessa corretora. Verifique a lista oficial de ativos disponíveis.
          </p>
        </div>
      ) : error && error.addrNotGenerated ? (
        <div className="rounded-md border border-gold/30 bg-gold/[0.05] px-3 py-2 space-y-1.5">
          <div className="font-mono text-[10px] text-gold flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            Endereço de depósito não encontrado
          </div>
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            O endereço para <b className="text-ink-2">{currency.toUpperCase()}</b> na rede <b className="text-ink-2">{network}</b> ainda
            não foi gerado na sua conta do <b className="text-ink-2">{CEX_META[exchangeId].label}</b>.
          </p>
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            Acesse <b className="text-ink-2">{CEX_META[exchangeId].label}</b> → Carteira → Depósito → selecione{" "}
            <b className="text-ink-2">{currency.toUpperCase()}</b> e a rede <b className="text-ink-2">{network}</b> e clique em
            &ldquo;Gerar endereço&rdquo;. Depois volte aqui e clique em &ldquo;Tentar novamente&rdquo;.
          </p>
          <button
            type="button"
            onClick={fetchAddr}
            className="text-cyan hover:text-cyan/80 uppercase tracking-widest text-[9px] mt-0.5"
          >
            Tentar novamente
          </button>
        </div>
      ) : error && (
        <div className="rounded-md border border-red/20 bg-red/[0.04] px-3 py-2 font-mono text-[10px] text-red space-y-1">
          <div>{error.code}</div>
          {error.detail && <div className="text-red/70 break-words">{error.detail}</div>}
          <button
            type="button"
            onClick={fetchAddr}
            className="text-cyan hover:text-cyan/80 uppercase tracking-widest text-[9px] mt-0.5"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Memo/tag warning — direct send disabled */}
      {hasTag && (
        <div className="rounded-md border border-gold/30 bg-gold/[0.06] p-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
            Esta rede exige memo/tag — envie manualmente anexando o memo abaixo. O envio
            automático foi desativado para evitar perda de fundos.
          </p>
        </div>
      )}

      {/* PRIMARY: direct-send panel for EVM / Solana without memo */}
      {canDirectSend && walletToken && !hasTag && !error && (
        <WalletSendToCex
          token={walletToken}
          destination={addr?.address ?? null}
          loadingDestination={loading}
          networkKindHint={kind as "evm" | "solana"}
          exchangeLabel={CEX_META[exchangeId].label}
          exchangeId={exchangeId}
          currency={currency}
        />
      )}

      {/* Non-EVM/SOL networks: show loader or retry button until address arrives */}
      {!canDirectSend && !error && !addr && (
        loading ? (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="w-3.5 h-3.5 text-ink-4 animate-spin" />
            <span className="font-mono text-[10px] text-ink-4">Obtendo endereço de depósito…</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={fetchAddr}
            disabled={!currency || !network}
            className="w-full btn btn-secondary text-xs disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            Obter endereço de depósito
          </button>
        )
      )}

      {/* Deposit address — always visible for non-direct-send networks;
          toggled as a secondary option for EVM/SOL direct-send */}
      {addr && (
        <div className="space-y-2">
          {canDirectSend && !hasTag && (
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3 hover:text-ink-2 tracking-widest uppercase"
            >
              <Copy className="w-3 h-3" />
              {showManual ? "Ocultar endereço" : "Copiar endereço manualmente"}
            </button>
          )}

          {(!canDirectSend || hasTag || showManual) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-lg border border-cyan/20 bg-cyan/[0.04] p-3 space-y-2.5"
            >
              <div className="rounded-md border border-gold/30 bg-gold/[0.06] p-2 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
                <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
                  Envie <b className="text-gold">{currency}</b> APENAS pela rede <b className="text-gold">{addr.network ?? network}</b>.
                  Enviar pela rede errada resulta em perda permanente dos fundos.
                </p>
              </div>

              <div>
                <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Endereço de depósito</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 px-2 py-2 rounded bg-bg-1 border border-white/10 font-mono text-[11px] text-ink break-all">
                    {addr.address}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy("addr", addr.address)}
                    className="flex-shrink-0 px-2.5 py-2 rounded border border-cyan/30 bg-cyan/10 text-cyan inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase hover:bg-cyan/20"
                  >
                    {copied === "addr" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copied === "addr" ? "Copiado" : "Copiar"}
                  </button>
                </div>
              </div>

              {addr.tag && (
                <div className="rounded-md border border-red/30 bg-red/[0.06] p-2 space-y-1.5">
                  <div className="font-mono text-[9px] text-red tracking-widest uppercase inline-flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Memo / tag OBRIGATÓRIO
                  </div>
                  <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
                    Você DEVE incluir este memo na transação ou seus fundos serão perdidos.
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1.5 rounded bg-bg-1 border border-white/10 font-mono text-[11px] text-ink break-all">
                      {addr.tag}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy("tag", addr.tag!)}
                      className="flex-shrink-0 px-2 py-1.5 rounded border border-red/30 bg-red/10 text-red inline-flex items-center gap-1 font-mono text-[10px] tracking-widest uppercase hover:bg-red/20"
                    >
                      {copied === "tag" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied === "tag" ? "Copiado" : "Copiar memo"}
                    </button>
                  </div>
                </div>
              )}

              {!addr.tag && (
                <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
                  {kind === "solana"
                    ? <>Abra <b className="text-ink-2">{phantomLabel}</b> e envie para este endereço.</>
                    : kind === "evm"
                      ? <>Abra <b className="text-ink-2">MetaMask</b> (ou outra carteira EVM) e envie para este endereço.</>
                      : <>Abra sua carteira e envie para este endereço.</>}
                  {" "}Aguarde o crédito na corretora (normalmente 1–12 minutos).
                </p>
              )}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Direct send (wallet → CEX deposit address) ─────────────────────────
//
// Shown as the PRIMARY UI in DepositPanel for EVM and Solana without memo.
// The deposit address is fetched automatically in the background — no button
// click required. Once it arrives the user enters an amount and signs in
// their wallet (MetaMask / Phantom).

function WalletSendToCex({
  token, destination, loadingDestination, networkKindHint, exchangeLabel, exchangeId, currency,
}: {
  token: Token;
  destination: string | null;
  loadingDestination: boolean;
  networkKindHint: "evm" | "solana";
  exchangeLabel: string;
  exchangeId: string;
  currency: string;
}) {
  const isSolana = networkKindHint === "solana";
  const chainMeta = CHAIN_BY_ID[token.chain];

  // EVM hooks
  const { address: evmAddress } = useAccount();
  const currentChainId          = useChainId();
  const publicClient            = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync }     = useSwitchChain();
  const { writeContractAsync }   = useWriteContract();

  // Solana hooks
  const sol = useWallet();
  const { connection } = useConnection();
  const solAddress = sol.publicKey?.toBase58() ?? null;

  const bal = useTokenBalance(token, null);

  const [amount,       setAmount]       = useState("");
  const [stage,        setStage]        = useState<"form" | "confirm" | "sending" | "sent">("form");
  const [error,        setError]        = useState<string | null>(null);
  const [txHash,       setTxHash]       = useState<string | null>(null);
  const [estimatingMax, setEstimatingMax] = useState(false);
  const { push: pushHistory } = useTxHistory();

  const amountNum   = parseFloat(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const walletReady = isSolana ? !!solAddress : !!evmAddress;

  /**
   * MAX with gas reservation.
   *
   * Native EVM (ETH/BNB/MATIC/…): estimate the actual gas cost for this
   *   transfer, add a 20% safety buffer, subtract from the wallet balance.
   *   Without this, sending MAX fails because there's nothing left to pay gas.
   *
   * ERC-20: token amount = full balance; gas is paid in the native token,
   *   so we don't need to reduce the token amount. If the native balance
   *   is too low to cover gas the wallet will reject at signing time.
   *
   * Native SOL: reserve a fixed 10,000-lamport cushion (~0.00001 SOL).
   *   A simple SOL transfer costs ~5,000 lamports; the 2× buffer covers
   *   priority fees and future network changes.
   *
   * SPL token: amount = full balance; fee is in SOL, not the token.
   */
  const handleMax = async () => {
    if (bal.isZero || bal.loading || estimatingMax) return;

    if (isSolana) {
      if (token.address === "native") {
        const FEE_LAMPORTS = 10_000; // ~0.00001 SOL cushion
        const balLamports = Math.floor(parseFloat(bal.formatted) * LAMPORTS_PER_SOL);
        const maxLamports = Math.max(0, balLamports - FEE_LAMPORTS);
        const maxSol = maxLamports / LAMPORTS_PER_SOL;
        setAmount(maxSol > 0 ? maxSol.toFixed(9).replace(/\.?0+$/, "") : "0");
      } else {
        setAmount(bal.formatted);
      }
      return;
    }

    // EVM path
    if (token.address === "native" && publicClient && evmAddress && destination) {
      setEstimatingMax(true);
      try {
        const rawBal = parseUnits(bal.formatted, token.decimals);
        const [gasPrice, gasLimit] = await Promise.all([
          publicClient.getGasPrice(),
          publicClient.estimateGas({
            account: evmAddress as Hex,
            to:      destination as Hex,
            value:   rawBal,
          }).catch(() => 21_000n), // standard ETH transfer fallback
        ]);
        // 20% safety buffer on top of the estimate
        const safeGasCost = (gasPrice * gasLimit * 120n) / 100n;
        const maxRaw = rawBal > safeGasCost ? rawBal - safeGasCost : 0n;
        setAmount(maxRaw > 0n ? formatUnits(maxRaw, token.decimals) : "0");
      } catch {
        setAmount(bal.formatted);
      } finally {
        setEstimatingMax(false);
      }
    } else {
      // ERC-20: full token balance; gas is in native token
      setAmount(bal.formatted);
    }
  };

  const explorerHref = txHash
    ? `${chainMeta?.explorer ?? ""}/tx/${txHash}`
    : null;

  const send = async () => {
    if (!destination) { setError("Endereço de destino não disponível — aguarde."); return; }
    setStage("sending");
    setError(null);
    let sentTxHash: string | null = null;
    try {
      if (isSolana) {
        if (!sol.publicKey) throw new Error("Phantom não conectado.");
        const toOwner = new PublicKey(destination);
        const tx = new Transaction();
        if (token.address === "native") {
          const lamports = BigInt(Math.round(amountNum * LAMPORTS_PER_SOL));
          tx.add(SystemProgram.transfer({
            fromPubkey: sol.publicKey,
            toPubkey:   toOwner,
            lamports,
          }));
        } else {
          const mint    = new PublicKey(token.address);
          const fromAta = await getAssociatedTokenAddress(mint, sol.publicKey);
          const toAta   = await getAssociatedTokenAddress(mint, toOwner);
          const raw     = parseUnits(amount, token.decimals);
          tx.add(createTransferInstruction(fromAta, toAta, sol.publicKey, raw));
        }
        const sig = await sol.sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, "confirmed");
        setTxHash(sig);
        sentTxHash = sig;
      } else {
        const targetChainId = WAGMI_CHAIN_IDS[token.chain];
        if (targetChainId && currentChainId !== targetChainId) {
          await switchChainAsync({ chainId: targetChainId });
        }
        const raw = parseUnits(amount, token.decimals);
        let hash: Hex;
        if (token.address === "native") {
          hash = await sendTransactionAsync({
            to: destination as Hex,
            value: raw,
            chainId: targetChainId,
          });
        } else {
          hash = await writeContractAsync({
            address: token.address as Hex,
            abi: erc20Abi,
            functionName: "transfer",
            args: [destination as Hex, raw],
            chainId: targetChainId,
          });
        }
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }
        setTxHash(hash);
        sentTxHash = hash;
      }
      setStage("sent");
      toast.success("Enviado — aguarde o crédito na corretora.");
      pushHistory({
        type: "dex_swap",
        status: "confirmed",
        fromSymbol: currency || token.symbol,
        fromChain: token.chain,
        fromAmount: amount,
        toSymbol: currency || token.symbol,
        toChain: exchangeId,
        exchange: exchangeId,
        txHash: sentTxHash ?? undefined,
        route: isSolana ? "solana" : token.chain,
        notes: `Depósito → ${exchangeLabel}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/reject|denied|user/i.test(msg) ? "Assinatura cancelada na carteira." : msg);
      setStage("confirm");
    }
  };

  if (stage === "sent") {
    return (
      <div className="rounded-md border border-green/30 bg-green/[0.05] p-3 space-y-2">
        <div className="inline-flex items-center gap-1.5 font-mono text-[10px] text-green tracking-widest uppercase">
          <Check className="w-3 h-3" /> Enviado para {exchangeLabel}
        </div>
        <div className="font-mono text-[10px] text-ink-2 tabular-nums">
          {amount} {token.symbol} · {chainMeta?.short ?? token.chain}
        </div>
        {explorerHref && (
          <a
            href={explorerHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[10px] text-cyan/80 hover:text-cyan break-all"
          >
            <ExternalLink className="w-3 h-3 flex-shrink-0" /> ver no explorer
          </a>
        )}
        <button
          type="button"
          onClick={() => { setStage("form"); setAmount(""); setTxHash(null); }}
          className="block font-mono text-[10px] text-ink-3 hover:text-ink-2 tracking-widest uppercase"
        >
          Novo envio
        </button>
      </div>
    );
  }

  /* Loading: deposit address not yet available */
  if (!destination && loadingDestination) {
    return (
      <div className="rounded-lg border border-cyan/20 bg-cyan/[0.03] p-3 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 text-cyan animate-spin" />
        <span className="font-mono text-[10px] text-ink-2">Obtendo endereço de depósito da corretora…</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan/20 bg-cyan/[0.03] p-3 space-y-2.5">
      <div className="flex items-center gap-1.5">
        <Send className="w-3.5 h-3.5 text-cyan" />
        <span className="font-mono text-[10px] text-ink-2 tracking-widest uppercase">
          Depositar da carteira → {exchangeLabel}
        </span>
        <span className="ml-auto font-mono text-[9px] text-ink-4 tabular-nums">
          {chainMeta?.short ?? token.chain} · {token.symbol}
        </span>
      </div>

      {!walletReady ? (
        <p className="font-mono text-[10px] text-gold/80 leading-relaxed inline-flex items-start gap-1">
          <WalletIcon className="w-3 h-3 mt-0.5 flex-shrink-0" />
          {isSolana
            ? "Conecte a Phantom para enviar SOL/SPL diretamente."
            : "Conecte uma carteira EVM (MetaMask) para enviar diretamente."}
        </p>
      ) : !destination ? (
        <p className="font-mono text-[10px] text-red/80 leading-relaxed inline-flex items-start gap-1">
          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
          Não foi possível obter o endereço de depósito. Use "Tentar novamente" acima.
        </p>
      ) : (
        <>
          <label className="block">
            <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1 flex items-center justify-between">
              <span>Valor a depositar</span>
              {!bal.isZero && stage === "form" && (
                <button
                  type="button"
                  onClick={handleMax}
                  disabled={estimatingMax}
                  className="font-mono text-[9px] text-cyan tracking-widest uppercase hover:text-cyan/80 inline-flex items-center gap-1 disabled:opacity-60"
                >
                  {estimatingMax
                    ? <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Calculando taxa…</>
                    : <>MAX · {bal.display} {token.symbol}</>}
                </button>
              )}
            </div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").slice(0, 24))}
              disabled={stage !== "form"}
              placeholder="0"
              inputMode="decimal"
              className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
            />
          </label>

          {error && (
            <div className="rounded-md border border-red/20 bg-red/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-red break-words">
              {error}
            </div>
          )}

          {stage === "form" && (
            <button
              type="button"
              onClick={() => setStage("confirm")}
              disabled={!amountValid}
              className="w-full btn btn-primary text-xs disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Revisar depósito
            </button>
          )}

          {stage === "confirm" && (
            <div className="rounded-md border border-cyan/30 bg-cyan/[0.05] p-2.5 space-y-2">
              <div className="font-mono text-[11px] text-ink-2 leading-relaxed space-y-0.5 tabular-nums">
                <div>{amount} {token.symbol} <span className="text-ink-3">via {chainMeta?.short ?? token.chain}</span></div>
                <div className="text-ink-3 break-all">→ {destination}</div>
                <div className="text-ink-4 text-[9px]">Destino: {exchangeLabel}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setStage("form")} className="flex-1 btn btn-secondary text-xs">
                  Voltar
                </button>
                <button type="button" onClick={send} className="flex-1 btn btn-primary text-xs inline-flex items-center justify-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Enviar
                </button>
              </div>
            </div>
          )}

          {stage === "sending" && (
            <div className="rounded-md border border-cyan/30 bg-cyan/[0.05] p-2.5 inline-flex items-center gap-2 w-full">
              <Loader2 className="w-3.5 h-3.5 text-cyan animate-spin" />
              <span className="font-mono text-[11px] text-ink-2">Enviando… confirme na carteira.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Withdraw (CEX → wallet) ────────────────────────────────────────────

function WithdrawPanel({ exchangeId, credentials }: Props) {
  const { address: evmAddress } = useAccount();
  const sol = useWallet();
  const solAddress = sol.publicKey?.toBase58() ?? null;
  const phantomLabel = sol.wallet?.adapter?.name ?? "Phantom";

  const [currency, setCurrency] = useState("USDT");
  const [network,  setNetwork]  = useState<string>("BSC");
  const [amount,   setAmount]   = useState<string>("");
  const [destination, setDestination] = useState<string>("");
  const [tag,      setTag]      = useState("");
  const [twoFa,    setTwoFa]    = useState("");

  const [stage,   setStage]   = useState<"form" | "confirm" | "sending" | "done">("form");
  const [error,   setError]   = useState<{ code: string; detail?: string } | null>(null);
  const [receipt, setReceipt] = useState<{ id: string; status: string; txid?: string; network?: string; address?: string } | null>(null);

  const [cexBalances,    setCexBalances]    = useState<CexBalance[] | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const { push: pushHistory } = useTxHistory();

  const fetchCexBalances = async () => {
    setBalanceLoading(true);
    try {
      const res = await fetch("/api/cex/balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exchange:   exchangeId,
          apiKey:     credentials.apiKey,
          apiSecret:  credentials.apiSecret,
          passphrase: credentials.passphrase,
        }),
      });
      const data = await res.json() as { ok: boolean; balances?: CexBalance[] };
      if (data.ok && data.balances) setCexBalances(data.balances);
    } catch { /* silently ignore */ }
    finally { setBalanceLoading(false); }
  };

  useEffect(() => { void fetchCexBalances(); }, [exchangeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCexBal = useMemo(() => {
    if (!cexBalances) return null;
    return cexBalances.find((b) => b.asset.toUpperCase() === currency.toUpperCase()) ?? null;
  }, [cexBalances, currency]);

  const notListed = cexBalances !== null && activeCexBal === null;

  const networks = useMemo(() => COMMON_NETWORKS[currency.toUpperCase()] ?? [], [currency]);
  const kind = networkKind(network);

  const expectedDestination = useMemo(() => {
    if (kind === "solana") return solAddress ?? "";
    if (kind === "evm")    return evmAddress ?? "";
    return "";
  }, [kind, solAddress, evmAddress]);

  const prevExpectedRef = useRef(expectedDestination);
  const userEditedRef   = useRef(false);
  useEffect(() => {
    setDestination((current) => {
      if (!userEditedRef.current || current === prevExpectedRef.current) {
        prevExpectedRef.current = expectedDestination;
        return expectedDestination;
      }
      prevExpectedRef.current = expectedDestination;
      return current;
    });
  }, [expectedDestination]);

  useEffect(() => {
    if (networks.length > 0 && !networks.includes(network)) {
      setNetwork(networks[0]);
    }
  }, [networks, network]);

  useEffect(() => {
    if (stage === "confirm") setStage("form");
  }, [network, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const amountNum = parseFloat(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const addressWarn = validateAddressForNetwork(destination, network);
  const destinationValid = destination.length >= 20 && !addressWarn;
  const isAutoFilled = !!expectedDestination && destination === expectedDestination;
  const walletHint = (() => {
    if (kind === "solana" && !solAddress) {
      return `${phantomLabel} não conectado — cole seu endereço Solana manualmente ou conecte para preencher automaticamente.`;
    }
    if (kind === "evm" && !evmAddress) {
      return "Nenhuma carteira EVM conectada — cole seu endereço 0x… manualmente ou conecte o MetaMask.";
    }
    return null;
  })();

  const submit = async () => {
    setStage("sending");
    setError(null);
    try {
      const res = await fetch("/api/cex/withdraw", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          exchange:      exchangeId,
          currency:      currency.toUpperCase(),
          amount:        amountNum,
          address:       destination,
          network,
          tag:           tag || undefined,
          twoFactorCode: twoFa || undefined,
          confirm:       "I-CONFIRM-REAL-WITHDRAWAL",
          apiKey:        credentials.apiKey,
          apiSecret:     credentials.apiSecret,
          passphrase:    credentials.passphrase,
        }),
      });
      const body = await res.json() as {
        ok: boolean;
        receipt?: { id: string; status: string; txid?: string; network?: string; address?: string };
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.ok || !body.receipt) {
        setError({ code: body.error ?? `HTTP ${res.status}`, detail: body.detail });
        setStage("confirm");
        return;
      }
      setReceipt(body.receipt);
      setStage("done");
      toast.success(`Saque enviado: ${body.receipt.id || "(sem id)"}`);
      pushHistory({
        type: "rebalance",
        status: "pending",
        fromSymbol: currency.toUpperCase(),
        fromChain: exchangeId,
        fromAmount: String(amountNum),
        toSymbol: currency.toUpperCase(),
        toChain: networkToChainId(network) ?? network.toLowerCase(),
        exchange: exchangeId,
        orderId: body.receipt.id,
        route: network,
        txHash: body.receipt.txid ?? undefined,
        notes: `Saque ${exchangeId} → carteira`,
      });
    } catch (e) {
      setError({ code: "network_error", detail: e instanceof Error ? e.message : String(e) });
      setStage("confirm");
    }
  };

  if (stage === "done" && receipt) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-md border border-green/30 bg-green/[0.05] p-3 space-y-2">
        <div className="inline-flex items-center gap-1.5 font-mono text-[10px] text-green tracking-widest uppercase">
          <Check className="w-3 h-3" /> Saque aceito pela corretora
        </div>
        <div className="font-mono text-[10px] text-ink-2 space-y-0.5 tabular-nums">
          <div>id: {receipt.id || "—"}</div>
          <div>status: {receipt.status}</div>
          {receipt.network && <div>rede: {receipt.network}</div>}
          {receipt.address && <div className="break-all">para: {receipt.address}</div>}
          {receipt.txid && <div className="break-all">tx: {receipt.txid}</div>}
        </div>
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          A corretora normalmente leva 1–30 minutos para transmitir, dependendo da fila interna e da rede.
        </p>
        <button
          type="button"
          onClick={() => { setStage("form"); setAmount(""); setTwoFa(""); setReceipt(null); }}
          className="font-mono text-[10px] text-cyan/80 hover:text-cyan tracking-widest uppercase"
        >
          Novo saque
        </button>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-gold/30 bg-gold/[0.05] p-2 flex items-start gap-2">
        <Shield className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
          O endereço de destino deve estar <b className="text-gold">pré-autorizado na corretora</b>. A maioria das corretoras
          (Binance, Coinbase, Kraken, OKX…) exige confirmação por e-mail/SMS e um período de 24–48h para novos endereços.
          Se ainda não autorizou esta carteira, a chamada abaixo falhará com um erro específico da corretora.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Moeda</div>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
            disabled={stage !== "form"}
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Rede</div>
          {networks.length > 0 ? (
            <select
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
              disabled={stage !== "form"}
              className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
            >
              {networks.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <input
              value={network}
              onChange={(e) => setNetwork(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32))}
              disabled={stage !== "form"}
              className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
            />
          )}
        </label>
      </div>

      {/* CEX live balance + "not listed" warning */}
      {notListed ? (
        <div className="rounded-md border border-gold/30 bg-gold/[0.05] px-3 py-2 space-y-1">
          <div className="font-mono text-[10px] text-gold flex items-center gap-1.5">
            <PackageX className="w-3.5 h-3.5 flex-shrink-0" />
            {currency.toUpperCase()} não está disponível no {CEX_META[exchangeId].label}
          </div>
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            Esta moeda não aparece no seu saldo da corretora. Verifique o símbolo ou consulte a lista oficial de ativos.
          </p>
        </div>
      ) : activeCexBal !== null && (
        <div className="flex items-center gap-2 -mt-1 px-0.5">
          <span className="font-mono text-[10px] text-ink-3">
            Disponível na CEX:{" "}
            <span className="text-cyan tabular-nums">{activeCexBal.free.toFixed(6)} {currency.toUpperCase()}</span>
            {activeCexBal.used > 0 && (
              <span className="text-ink-4 ml-1">({activeCexBal.used.toFixed(4)} em uso)</span>
            )}
          </span>
          {balanceLoading
            ? <Loader2 className="w-3 h-3 text-ink-4 animate-spin ml-auto" />
            : <button type="button" onClick={fetchCexBalances} className="ml-auto text-ink-4 hover:text-ink-2">
                <RefreshCw className="w-3 h-3" />
              </button>}
        </div>
      )}

      <label className="block">
        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1 flex items-center justify-between">
          <span>Valor</span>
          {activeCexBal && activeCexBal.free > 0 && stage === "form" && (
            <button
              type="button"
              onClick={() => setAmount(String(activeCexBal.free))}
              className="font-mono text-[9px] text-cyan tracking-widest uppercase hover:text-cyan/80"
            >
              MAX
            </button>
          )}
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, "").slice(0, 24))}
          disabled={stage !== "form"}
          placeholder="0"
          inputMode="decimal"
          className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
        />
      </label>

      <label className="block">
        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1 inline-flex items-center gap-1 flex-wrap">
          Endereço de destino
          {isAutoFilled && (
            <span className="text-cyan/70 normal-case">
              · preenchido de {kind === "solana" ? phantomLabel : kind === "evm" ? "MetaMask" : "carteira conectada"}
            </span>
          )}
        </div>
        <input
          value={destination}
          onChange={(e) => { userEditedRef.current = true; setDestination(e.target.value.trim()); }}
          disabled={stage !== "form"}
          placeholder={kind === "solana" ? "endereço Solana base58" : kind === "evm" ? "0x…" : "0x… ou base58…"}
          className={cn(
            "w-full bg-bg-2 border rounded px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none disabled:opacity-60",
            addressWarn ? "border-red/40 focus:border-red/60" : "border-white/10 focus:border-cyan/40",
          )}
        />
        {addressWarn && (
          <div className="mt-1 font-mono text-[10px] text-red/90 leading-relaxed inline-flex items-start gap-1">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {addressWarn}
          </div>
        )}
        {walletHint && !addressWarn && (
          <div className="mt-1 font-mono text-[10px] text-gold/80 leading-relaxed inline-flex items-start gap-1">
            <WalletIcon className="w-3 h-3 mt-0.5 flex-shrink-0" /> {walletHint}
          </div>
        )}
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Memo / tag (opcional)</div>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value.slice(0, 64))}
            disabled={stage !== "form"}
            placeholder="deixe em branco"
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Código 2FA (se necessário)</div>
          <input
            value={twoFa}
            onChange={(e) => setTwoFa(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
            disabled={stage !== "form"}
            placeholder="123456"
            inputMode="numeric"
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-red/20 bg-red/[0.04] px-3 py-2 font-mono text-[10px] text-red space-y-1">
          <div>{error.code}</div>
          {error.detail && <div className="text-red/70 break-words">{error.detail}</div>}
        </div>
      )}

      {stage === "form" && (
        <button
          type="button"
          onClick={() => setStage("confirm")}
          disabled={!amountValid || !destinationValid || !currency || !network}
          className="w-full btn btn-primary text-xs disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          <ArrowUpFromLine className="w-3.5 h-3.5" />
          Revisar saque
        </button>
      )}

      {stage === "confirm" && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-gold/30 bg-gold/[0.05] p-3 space-y-2"
        >
          <div className="font-display font-bold text-xs text-gold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Confirmar saque real on-chain
          </div>
          <div className="font-mono text-[11px] text-ink-2 leading-relaxed space-y-0.5 tabular-nums">
            <div>{amount} {currency} <span className="text-ink-3">via {network}</span></div>
            <div className="text-ink-3 break-all">→ {destination}</div>
            {tag && <div className="text-red">memo: {tag}</div>}
            {twoFa && <div className="text-ink-3">2FA: ******{twoFa.slice(-2)}</div>}
          </div>
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            Esta operação é irreversível. Verifique o endereço e a rede antes de confirmar.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStage("form")}
              className="flex-1 btn btn-secondary text-xs"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={submit}
              className="flex-1 btn btn-primary text-xs inline-flex items-center justify-center gap-1.5"
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" /> Sacar
            </button>
          </div>
        </motion.div>
      )}

      {stage === "sending" && (
        <div className="rounded-md border border-cyan/30 bg-cyan/[0.05] p-3 inline-flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-cyan animate-spin" />
          <span className="font-mono text-[11px] text-ink-2">Enviando saque para a corretora…</span>
        </div>
      )}

      <p className="font-mono text-[10px] text-ink-4 leading-relaxed inline-flex items-start gap-1">
        <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0" />
        Saques limitados a ~US$50k. Transferências maiores devem ser feitas pela interface da corretora.
      </p>
    </div>
  );
}
