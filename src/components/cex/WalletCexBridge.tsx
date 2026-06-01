"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownToLine, ArrowUpFromLine, Copy, Check, AlertTriangle,
  Loader2, Shield, ExternalLink, Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { CEX_META, type CexId, type CexCredentials } from "@/lib/cex/types";
import { cn } from "@/lib/cn";

/**
 * Wallet ↔ CEX bridge — two flows side-by-side on /cex once the vault
 * is unlocked.
 *
 * DEPOSIT (wallet → CEX): fetches the user's deposit address from the
 *   exchange, displays it with the memo + network warnings, lets the
 *   user copy it and execute the send from MetaMask / Phantom manually.
 *   No funds move from this page on the deposit side — we deliberately
 *   keep the wallet sign in the user's own wallet UI so the gas + slip
 *   confirmation stays in their familiar surface.
 *
 * WITHDRAW (CEX → wallet): collects the destination (pre-filled with
 *   the connected wallet so a typo can't redirect anywhere), the
 *   amount, the network, and a 2FA code if the exchange requires it.
 *   On confirm, calls /api/cex/withdraw which runs the ccxt withdraw
 *   call. The exchange does the actual on-chain send.
 *
 * THREAT MODEL & UX rails:
 *   - Network selector is mandatory and prominent: USDT-ERC20 vs
 *     USDT-BEP20 vs USDT-TRC20 are not interchangeable and sending the
 *     wrong network = permanent loss.
 *   - Memo / tag is rendered as a separate red-bordered banner when
 *     the exchange returned one.
 *   - Withdraw side requires a two-step "really do it" confirmation +
 *     the I-CONFIRM-REAL-WITHDRAWAL magic string set client-side only
 *     after that confirmation.
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

// Common networks per currency — surfaced as a dropdown so the user
// picks "BSC" or "TRC20" up-front instead of relying on the exchange's
// default (which can be misleading). Not exhaustive — if a network
// isn't in here the user can still type one. SPL-only tokens map to
// ["SOL"] alone so the deposit panel auto-targets the Phantom address.
const COMMON_NETWORKS: Record<string, string[]> = {
  USDT: ["ERC20", "BSC", "TRC20", "POLYGON", "ARBITRUM", "OPTIMISM", "SOL"],
  USDC: ["ERC20", "BSC", "POLYGON", "ARBITRUM", "OPTIMISM", "BASE", "SOL"],
  ETH:  ["ERC20", "BSC", "ARBITRUM", "OPTIMISM", "BASE"],
  BTC:  ["BTC", "BSC", "LIGHTNING"],
  BNB:  ["BSC", "BEP2"],
  SOL:  ["SOL"],
  MATIC: ["POLYGON", "ERC20"],
  LINK: ["ERC20", "BSC"],
  // SPL-native tokens that only live on Solana. Locking the network to
  // SOL prevents the "right token, wrong network" loss class.
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

/**
 * Classify a network slug so we can match it to the right wallet
 * (Phantom vs MetaMask) and address format. Anything we don't
 * recognise falls through as "other" and the UI runs in permissive
 * mode (no auto-fill, looser validation).
 */
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

/**
 * Return null when the address format is plausible for the given
 * network, or a human-readable warning string when there's an obvious
 * mismatch (e.g. EVM 0x address pasted into a SOL withdrawal). We do
 * NOT try to validate base58 checksum / EIP-55 — that's the exchange's
 * job; we just catch the cross-format goofs that lead to permanent
 * loss.
 */
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
            <ArrowDownToLine className="w-3 h-3" /> Deposit
          </button>
          <button
            type="button"
            onClick={() => setMode("withdraw")}
            className={cn(
              "px-3 py-1.5 font-mono text-[10px] tracking-widest uppercase inline-flex items-center gap-1.5 border-l border-white/10",
              mode === "withdraw" ? "bg-gold/15 text-gold" : "text-ink-3 hover:bg-white/5",
            )}
          >
            <ArrowUpFromLine className="w-3 h-3" /> Withdraw
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
  const { address: evmAddress } = useAccount();
  const sol = useWallet();
  const solAddress = sol.publicKey?.toBase58() ?? null;
  const phantomLabel = sol.wallet?.adapter?.name ?? "Phantom";

  const [currency, setCurrency] = useState("USDT");
  const [network,  setNetwork]  = useState<string>("BSC");
  const [addr, setAddr] = useState<DepositAddress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<{ code: string; detail?: string } | null>(null);
  const [copied,  setCopied]  = useState<"addr" | "tag" | null>(null);

  const networks = useMemo(() => COMMON_NETWORKS[currency.toUpperCase()] ?? [], [currency]);
  const kind = networkKind(network);
  // SPL-only currencies should auto-pick SOL the moment the user types
  // them, so the next click already targets the correct network.
  useEffect(() => {
    if (networks.length > 0 && !networks.includes(network)) {
      setNetwork(networks[0]);
    }
  }, [networks, network]);

  // Wallet-mismatch hint: surface it as soon as we can tell, so the
  // user fixes it before paying for a worthless on-chain transfer.
  const walletHint = (() => {
    if (kind === "solana" && !solAddress) {
      return { tone: "warn" as const, msg: `Connect ${phantomLabel} to send on the Solana network.` };
    }
    if (kind === "evm" && !evmAddress) {
      return { tone: "warn" as const, msg: "Connect MetaMask (or any EVM wallet) to send on this network." };
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
        setError({ code: body.error ?? `HTTP ${res.status}`, detail: body.detail });
        return;
      }
      setAddr({ address: body.address, tag: body.tag, network: body.network ?? network });
    } catch (e) {
      setError({ code: "network_error", detail: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  const copy = async (which: "addr" | "tag", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy — long-press to select instead.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Currency</div>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
            placeholder="USDT"
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40"
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Network</div>
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
              placeholder="ERC20 / BSC / TRC20 …"
              className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40"
            />
          )}
        </label>
      </div>

      {walletHint && (
        <div className="rounded-md border border-gold/30 bg-gold/[0.05] px-3 py-2 inline-flex items-start gap-2 w-full">
          <WalletIcon className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
          <p className="font-mono text-[10px] text-ink-2 leading-relaxed">{walletHint.msg}</p>
        </div>
      )}

      <button
        type="button"
        onClick={fetchAddr}
        disabled={loading || !currency || !network}
        className="w-full btn btn-secondary text-xs disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownToLine className="w-3.5 h-3.5" />}
        {loading ? "Fetching…" : "Get deposit address"}
      </button>

      {error && (
        <div className="rounded-md border border-red/20 bg-red/[0.04] px-3 py-2 font-mono text-[10px] text-red space-y-1">
          <div>{error.code}</div>
          {error.detail && <div className="text-red/70 break-words">{error.detail}</div>}
        </div>
      )}

      {addr && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-lg border border-cyan/20 bg-cyan/[0.04] p-3 space-y-2.5"
        >
          {/* The big honest network warning. */}
          <div className="rounded-md border border-gold/30 bg-gold/[0.06] p-2 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
              Send <b className="text-gold">{currency}</b> on the <b className="text-gold">{addr.network ?? network}</b> network ONLY.
              Sending on a different network from your wallet will be lost permanently — there is no recovery.
            </p>
          </div>

          <div>
            <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Deposit address</div>
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
                {copied === "addr" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {addr.tag && (
            <div className="rounded-md border border-red/30 bg-red/[0.06] p-2 space-y-1.5">
              <div className="font-mono text-[9px] text-red tracking-widest uppercase inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Memo / tag REQUIRED
              </div>
              <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
                You MUST attach this memo to the transaction or your funds will be lost.
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
                  {copied === "tag" ? "Copied" : "Copy memo"}
                </button>
              </div>
            </div>
          )}

          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            {kind === "solana"
              ? <>Open <b className="text-ink-2">{phantomLabel}</b> and send to this address. Z-SWAP doesn&apos;t move the funds — your wallet does.</>
              : kind === "evm"
                ? <>Open <b className="text-ink-2">MetaMask</b> (or any EVM wallet) and send to this address. Z-SWAP doesn&apos;t move the funds — your wallet does.</>
                : <>Open your wallet and send to this address. Z-SWAP doesn&apos;t move the funds — your wallet does.</>}
            {" "}Wait for the exchange to credit (typically 1–12 minutes depending on network).
          </p>
        </motion.div>
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

  const networks = useMemo(() => COMMON_NETWORKS[currency.toUpperCase()] ?? [], [currency]);
  const kind = networkKind(network);

  // The "expected destination" follows the picked network so it always
  // matches: SOL → Phantom, EVM → MetaMask. Without this the panel can
  // pre-fill an EVM address into a Solana withdrawal — guaranteed loss.
  const expectedDestination = useMemo(() => {
    if (kind === "solana") return solAddress ?? "";
    if (kind === "evm")    return evmAddress ?? "";
    return "";
  }, [kind, solAddress, evmAddress]);

  // Only auto-fill the destination when the user hasn't typed their own
  // address yet, OR when the previous value matches the previous
  // network's expected destination (so switching networks doesn't strand
  // them on a wrong address).
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

  // SPL-only currencies auto-pick SOL the moment they're typed.
  useEffect(() => {
    if (networks.length > 0 && !networks.includes(network)) {
      setNetwork(networks[0]);
    }
  }, [networks, network]);

  // Sticky tone: we leave 2FA + tag as-is across network changes (small
  // and rare values) but reset stage to form so a stale "confirm" can't
  // be submitted against a freshly-changed network.
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
      return `${phantomLabel} not connected — paste your Solana address manually or connect Phantom to auto-fill.`;
    }
    if (kind === "evm" && !evmAddress) {
      return "No EVM wallet connected — paste your 0x… address manually or connect MetaMask to auto-fill.";
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
      toast.success(`Withdrawal queued: ${body.receipt.id || "(no id)"}`);
    } catch (e) {
      setError({ code: "network_error", detail: e instanceof Error ? e.message : String(e) });
      setStage("confirm");
    }
  };

  if (stage === "done" && receipt) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-md border border-green/30 bg-green/[0.05] p-3 space-y-2">
        <div className="inline-flex items-center gap-1.5 font-mono text-[10px] text-green tracking-widest uppercase">
          <Check className="w-3 h-3" /> Withdrawal accepted by exchange
        </div>
        <div className="font-mono text-[10px] text-ink-2 space-y-0.5 tabular-nums">
          <div>id: {receipt.id || "—"}</div>
          <div>status: {receipt.status}</div>
          {receipt.network && <div>network: {receipt.network}</div>}
          {receipt.address && <div className="break-all">to: {receipt.address}</div>}
          {receipt.txid && <div className="break-all">tx: {receipt.txid}</div>}
        </div>
        <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
          The exchange typically takes 1–30 minutes to broadcast, depending on its internal review queue and the network.
        </p>
        <button
          type="button"
          onClick={() => { setStage("form"); setAmount(""); setTwoFa(""); setReceipt(null); }}
          className="font-mono text-[10px] text-cyan/80 hover:text-cyan tracking-widest uppercase"
        >
          New withdrawal
        </button>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-gold/30 bg-gold/[0.05] p-2 flex items-start gap-2">
        <Shield className="w-3.5 h-3.5 text-gold flex-shrink-0 mt-0.5" />
        <p className="font-mono text-[10px] text-ink-2 leading-relaxed">
          The destination address must be <b className="text-gold">pre-whitelisted on the exchange</b>. Most exchanges
          (Binance, Coinbase, Kraken, OKX, …) require email/SMS confirmation + a 24–48h cooldown for new addresses.
          If you haven&apos;t whitelisted this wallet yet, the call below will fail with a specific error from the exchange.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Currency</div>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
            disabled={stage !== "form"}
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Network</div>
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

      <label className="block">
        <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Amount</div>
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
          Destination address
          {isAutoFilled && (
            <span className="text-cyan/70 normal-case">
              · auto-filled from {kind === "solana" ? phantomLabel : kind === "evm" ? "MetaMask" : "connected wallet"}
            </span>
          )}
        </div>
        <input
          value={destination}
          onChange={(e) => { userEditedRef.current = true; setDestination(e.target.value.trim()); }}
          disabled={stage !== "form"}
          placeholder={kind === "solana" ? "base58 Solana address" : kind === "evm" ? "0x…" : "0x… or base58…"}
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
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">Memo / tag (optional)</div>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value.slice(0, 64))}
            disabled={stage !== "form"}
            placeholder="leave blank"
            className="w-full bg-bg-2 border border-white/10 rounded px-2.5 py-1.5 font-mono text-sm text-ink outline-none focus:border-cyan/40 disabled:opacity-60"
          />
        </label>
        <label className="block">
          <div className="font-mono text-[9px] text-ink-3 tracking-widest uppercase mb-1">2FA code (if required)</div>
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
          Review withdrawal
        </button>
      )}

      {stage === "confirm" && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-md border border-gold/30 bg-gold/[0.05] p-3 space-y-2"
        >
          <div className="font-display font-bold text-xs text-gold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Confirm real on-chain withdrawal
          </div>
          <div className="font-mono text-[11px] text-ink-2 leading-relaxed space-y-0.5 tabular-nums">
            <div>{amount} {currency} <span className="text-ink-3">via {network}</span></div>
            <div className="text-ink-3 break-all">→ {destination}</div>
            {tag && <div className="text-red">memo: {tag}</div>}
            {twoFa && <div className="text-ink-3">2FA: ******{twoFa.slice(-2)}</div>}
          </div>
          <p className="font-mono text-[10px] text-ink-3 leading-relaxed">
            This is irreversible. The exchange will broadcast the transaction. Double-check the address and the network.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStage("form")}
              className="flex-1 btn btn-secondary text-xs"
            >
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              className="flex-1 btn btn-primary text-xs inline-flex items-center justify-center gap-1.5"
            >
              <ArrowUpFromLine className="w-3.5 h-3.5" /> Withdraw
            </button>
          </div>
        </motion.div>
      )}

      {stage === "sending" && (
        <div className="rounded-md border border-cyan/30 bg-cyan/[0.05] p-3 inline-flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-cyan animate-spin" />
          <span className="font-mono text-[11px] text-ink-2">Sending withdrawal to exchange…</span>
        </div>
      )}

      <p className="font-mono text-[10px] text-ink-4 leading-relaxed inline-flex items-start gap-1">
        <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0" />
        Server caps withdrawals at ~$50k USD. Larger transfers go through the exchange&apos;s own UI.
      </p>
    </div>
  );
}
