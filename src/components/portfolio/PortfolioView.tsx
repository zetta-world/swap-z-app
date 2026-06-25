"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingUp, TrendingDown, Eye, EyeOff, Inbox } from "lucide-react";
import { useAccount } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { CHAINS } from "@/lib/chains";
import { findToken, type Token } from "@/lib/tokens";
import { compactNumber, formatUsd } from "@/lib/format";
import { useTokenBalance, type TokenBalance } from "@/lib/hooks/useTokenBalance";
import { useTokenPrices, tokenPriceKey } from "@/lib/hooks/useTokenPrices";
import { usePortfolioHistory } from "@/lib/store/portfolioHistory";
import CexPortfolioRollup from "./CexPortfolioRollup";
import PortfolioEvolution from "./PortfolioEvolution";
import { useT } from "@/lib/i18n";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import TokenLogo from "@/components/ui/TokenLogo";
import { cn } from "@/lib/cn";

// Curated set of tokens whose balances we surface on the portfolio page.
// Hooks can't live in loops, so we resolve them statically at module scope
// and call useTokenBalance once per slot below.
const TRACKED: Array<{ chain: Token["chain"]; symbol: string }> = [
  { chain: "ethereum",  symbol: "ETH"   },
  { chain: "ethereum",  symbol: "USDC"  },
  { chain: "ethereum",  symbol: "USDT"  },
  { chain: "ethereum",  symbol: "WBTC"  },
  { chain: "ethereum",  symbol: "stETH" },
  { chain: "bsc",       symbol: "BNB"   },
  { chain: "bsc",       symbol: "USDT"  },
  { chain: "polygon",   symbol: "POL"   },
  { chain: "polygon",   symbol: "USDC"  },
  { chain: "base",      symbol: "ETH"   },
  { chain: "base",      symbol: "USDC"  },
  { chain: "arbitrum",  symbol: "ETH"   },
  { chain: "arbitrum",  symbol: "USDC"  },
  { chain: "optimism",  symbol: "ETH"   },
  { chain: "avalanche", symbol: "AVAX"  },
  { chain: "solana",    symbol: "SOL"   },
  { chain: "solana",    symbol: "USDC"  },
];

/**
 * Real, live portfolio. Reads balances from the connected EVM and Solana
 * wallets via useTokenBalance, sums them in USD via the curated token
 * priceUsd (a follow-up will replace these with a live price feed), and
 * shows the CEX rollup at the bottom for users who linked exchanges.
 *
 * Nothing on this page is mocked any more: if a wallet isn't connected,
 * the corresponding section shows an empty state instead of fabricated
 * holdings.
 */
export default function PortfolioView() {
  const t = useT();
  const [hidden, setHidden] = useState(false);

  const { isConnected: evmConnected } = useAccount();
  const sol = useWallet();
  const anyWalletConnected = evmConnected || sol.connected;

  // Resolve each tracked slot to a Token (or undefined if it's not in the
  // curated list — defensive, the static list above should always resolve).
  const trackedTokens = useMemo(
    () => TRACKED.map(({ chain, symbol }) => findToken(chain, symbol)),
    [],
  );

  // One batched call to /api/prices for every tracked token. Refreshes
  // every 60 s; useTokenBalance per slot reads the live USD value from
  // here via livePriceUsd instead of the stale token-list snapshot.
  const { prices: livePrices } = useTokenPrices(trackedTokens);
  const livePrice = (t: Token | undefined) =>
    (t ? livePrices[tokenPriceKey(t)] : null) ?? null;

  // 17 fixed slots — call useTokenBalance once per slot. The hook handles
  // the "wallet not connected" case internally (returns emptyBalance).
  const balances: TokenBalance[] = [
    useTokenBalance(trackedTokens[0],  livePrice(trackedTokens[0])),
    useTokenBalance(trackedTokens[1],  livePrice(trackedTokens[1])),
    useTokenBalance(trackedTokens[2],  livePrice(trackedTokens[2])),
    useTokenBalance(trackedTokens[3],  livePrice(trackedTokens[3])),
    useTokenBalance(trackedTokens[4],  livePrice(trackedTokens[4])),
    useTokenBalance(trackedTokens[5],  livePrice(trackedTokens[5])),
    useTokenBalance(trackedTokens[6],  livePrice(trackedTokens[6])),
    useTokenBalance(trackedTokens[7],  livePrice(trackedTokens[7])),
    useTokenBalance(trackedTokens[8],  livePrice(trackedTokens[8])),
    useTokenBalance(trackedTokens[9],  livePrice(trackedTokens[9])),
    useTokenBalance(trackedTokens[10], livePrice(trackedTokens[10])),
    useTokenBalance(trackedTokens[11], livePrice(trackedTokens[11])),
    useTokenBalance(trackedTokens[12], livePrice(trackedTokens[12])),
    useTokenBalance(trackedTokens[13], livePrice(trackedTokens[13])),
    useTokenBalance(trackedTokens[14], livePrice(trackedTokens[14])),
    useTokenBalance(trackedTokens[15], livePrice(trackedTokens[15])),
    useTokenBalance(trackedTokens[16], livePrice(trackedTokens[16])),
  ];

  // Build the rows the UI renders: only non-zero balances, paired with
  // their token metadata.
  const holdings = useMemo(() => {
    return trackedTokens
      .map((token, i) => ({ token, balance: balances[i] }))
      .filter((row): row is { token: Token; balance: TokenBalance } =>
        !!row.token && !row.balance.isZero && !row.balance.loading && !row.balance.error,
      )
      .sort((a, b) => (b.balance.usdValue ?? 0) - (a.balance.usdValue ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedTokens, ...balances]);

  // True while any slot is still resolving. Combined with the "wallet
  // connected" check, we use this to show shimmer skeletons instead of
  // an "empty" message during the initial fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const balancesLoading = useMemo(() => balances.some((b) => b.loading), [...balances]);

  // CEX total bubbled up from the rollup once the vault is unlocked.
  // Initialised from localStorage cache so the portfolio shows a sensible
  // total even before (or without) unlocking the vault.
  const [cexUsd, setCexUsd] = useState(() => {
    try { return parseFloat(localStorage.getItem("zswap_cex_last_total_usd") ?? "0") || 0; }
    catch { return 0; }
  });

  const totals = useMemo(() => {
    const portfolio = holdings.reduce((acc, h) => acc + (h.balance.usdValue ?? 0), 0);
    return { portfolio, cex: cexUsd, total: portfolio + cexUsd };
  }, [holdings, cexUsd]);

  // Record a balance snapshot once the live totals settle. The store
  // throttles writes internally, so calling on every change is safe.
  const recordSnapshot = usePortfolioHistory((s) => s.record);
  useEffect(() => {
    if (balancesLoading || totals.total <= 0) return;
    recordSnapshot(totals.total, totals.portfolio, totals.cex);
  }, [balancesLoading, totals.total, totals.portfolio, totals.cex, recordSnapshot]);

  // Distribution across chains for the bar chart.
  const byChain = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holdings) {
      const v = h.balance.usdValue ?? 0;
      if (v <= 0) continue;
      map.set(h.token.chain, (map.get(h.token.chain) ?? 0) + v);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, value: v, chain: CHAINS.find((c) => c.id === id) }))
      .sort((a, b) => b.value - a.value);
  }, [holdings]);

  // The distribution bar shows the split across chains of on-chain holdings
  // only (CEX is not a chain). Divide by the on-chain total — not totals.total
  // which also includes CEX — so the segments always sum to 100%.
  const chainTotal = byChain.reduce((acc, c) => acc + c.value, 0) || 1;

  const mask = (v: string) => (hidden ? "•••••" : v);

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-32 right-1/4 w-[420px] h-[420px] rounded-full bg-green/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 px-4 sm:px-6 lg:px-8 py-8 lg:py-10 max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-4 h-4 text-cyan" />
            <span className="font-mono text-[10px] text-cyan/80 tracking-widest uppercase">
              {t("portfolio.eyebrow")}
            </span>
          </div>

          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="font-display font-extrabold text-[clamp(1.75rem,5vw,3.6rem)] leading-[0.98] tracking-tight text-ink mb-3">
                {t("portfolio.titleA")} <span className="text-grad-aurora">{t("portfolio.titleHL")}</span>
              </h1>
              <p className="font-sans text-base text-ink-2 leading-relaxed max-w-2xl">
                {t("portfolio.titleBody")}
              </p>
            </div>
            <button
              onClick={() => setHidden((h) => !h)}
              className="btn btn-secondary py-2 text-xs"
            >
              {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {hidden ? t("portfolio.showBalances") : t("portfolio.hideBalances")}
            </button>
          </div>
        </motion.div>

        {/* If no wallet is connected, show a clean empty state — no fake
            holdings, no fabricated chart. The CEX rollup below still works
            on its own if the user linked exchanges. */}
        {!anyWalletConnected && holdings.length === 0 && (
          <div className="mb-5">
            <EmptyState
              Icon={Wallet}
              title={t("portfolio.connectWalletTitle")}
              body={t("portfolio.connectWalletBody")}
              tone="cyan"
            />
          </div>
        )}

        {/* Net worth card — only when there's real data to show */}
        {(anyWalletConnected || holdings.length > 0 || cexUsd > 0) && (
          <div className="aurora-border p-px mb-5">
            <div className="god-card rounded-[20px] glass p-5 sm:p-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{t("portfolio.netWorth")}</div>
                  <div className="priv-value font-display font-extrabold text-3xl sm:text-4xl text-ink">{mask(formatUsd(totals.total))}</div>
                </div>
                <Metric label={t("portfolio.walletBalance")} value={mask(formatUsd(totals.portfolio))} tone="cyan" />
                <Metric label={t("portfolio.cexBalance")}    value={mask(formatUsd(totals.cex))}       tone="violet" />
                <Metric label={t("portfolio.chainsTracked")} value={String(byChain.length)} tone="gold" />
              </div>

              {byChain.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">{t("portfolio.distribution")}</span>
                    <span className="font-mono text-[10px] text-cyan tracking-widest uppercase flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan pulse-dot" />
                      {t("portfolio.distributionLive")}
                    </span>
                  </div>
                  <div className="flex h-3 rounded-full overflow-hidden bg-white/[0.03]">
                    {byChain.map((c) => (
                      <div
                        key={c.id}
                        title={`${c.chain?.name}: ${formatUsd(c.value)}`}
                        className="hover:brightness-125 transition-all"
                        style={{
                          width:  `${(c.value / chainTotal) * 100}%`,
                          background: c.chain?.color ?? "#00E8FF",
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
                    {byChain.map((c) => (
                      <div key={c.id} className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.chain?.color }} />
                        <span className="font-mono text-[10px] text-ink-2">{c.chain?.short}</span>
                        <span className="font-mono text-[10px] text-ink-4">{((c.value / chainTotal) * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Balance evolution — snapshot timeline + realized P&L per op type */}
        {(anyWalletConnected || holdings.length > 0 || cexUsd > 0) && (
          <PortfolioEvolution liveTotalUsd={totals.total} hidden={hidden} />
        )}

        {/* Holdings — only real, non-zero balances from the connected wallet(s) */}
        <div className="god-card rounded-2xl border border-white/5 glass-pane overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <span className="font-display font-bold text-sm text-ink">{t("portfolio.holdings")}</span>
            <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
              {t("portfolio.assetsCount", { n: holdings.length })}
            </span>
          </div>
          {holdings.length === 0 && anyWalletConnected && balancesLoading ? (
            <div className="divide-y divide-white/[0.04]">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex items-center gap-3">
                  <Skeleton w="w-8" h="h-8" rounded="full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton w="w-20" h="h-3" />
                    <Skeleton w="w-32" h="h-2.5" />
                  </div>
                  <div className="text-right space-y-1.5">
                    <Skeleton w="w-16" h="h-3" />
                    <Skeleton w="w-12" h="h-2.5" />
                  </div>
                </div>
              ))}
            </div>
          ) : holdings.length === 0 ? (
            <div className="p-4">
              <EmptyState
                Icon={Inbox}
                title={anyWalletConnected ? t("portfolio.noBalances") : t("portfolio.connectToSeeHoldings")}
                tone="ink"
                density="compact"
              />
            </div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {holdings.map(({ token, balance }) => {
                const usd = balance.usdValue ?? 0;
                const qtyNum = Number(balance.formatted) || 0;
                return (
                  <div key={token.symbol + ":" + token.chain} className="px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02]">
                    <TokenLogo symbol={token.symbol} logo={token.logo} color={token.color} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-sm text-ink truncate">{token.symbol}</div>
                      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider truncate">{token.chain}</div>
                    </div>
                    <div className="text-right min-w-0">
                      <div className="font-mono text-sm text-ink">{mask(formatUsd(usd))}</div>
                      <div className="font-mono text-[10px] text-ink-3 truncate">
                        {hidden ? "•••••" : `${compactNumber(qtyNum)} ${token.symbol}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* CEX rollup — real read-only data from the connected exchanges */}
        <CexPortfolioRollup onTotalUsdChange={setCexUsd} hidden={hidden} />

        <p className="font-mono text-[10px] text-ink-4 text-center mt-6">
          {t("portfolio.wallets")}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "cyan" | "violet" | "gold" }) {
  const cfg = { cyan: "text-cyan", violet: "text-violet", gold: "text-gold" }[tone];
  return (
    <div>
      <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase mb-1.5">{label}</div>
      <div className={cn("font-display font-bold text-2xl", cfg)}>{value}</div>
    </div>
  );
}
