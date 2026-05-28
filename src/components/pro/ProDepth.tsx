"use client";

import { useEffect, useMemo, useState } from "react";
import { Waves } from "lucide-react";
import type { Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import { cn } from "@/lib/cn";

/**
 * Pro depth / impact matrix. For 5 trade size buckets ($1k, $10k, $50k,
 * $250k, $1M), shows the expected price impact in BOTH directions of
 * the active pair. The data comes from a live 0x quote per size, so the
 * impact reflects what the aggregator would actually route — slightly
 * better than a naive constant-product approximation.
 *
 * This is the closest thing to a CEX depth ladder a DEX trader gets:
 * "how much can I move before the price moves against me X bps?".
 */

const BUCKETS = [1_000, 10_000, 50_000, 250_000, 1_000_000];

interface ImpactRow {
  size:      number;       // input USD
  buyBps:    number | null;
  sellBps:   number | null;
}

interface Props {
  fromToken: Token | undefined;
  toToken:   Token | undefined;
  chain:     ChainId;
  midPrice:  number;       // current spot from the chart (USD price of FROM token)
}

export default function ProDepth({ fromToken, toToken, chain, midPrice }: Props) {
  const [rows,    setRows]    = useState<ImpactRow[]>(BUCKETS.map((s) => ({ size: s, buyBps: null, sellBps: null })));
  const [loading, setLoading] = useState(true);

  const enabled = !!(fromToken && toToken && midPrice > 0);

  useEffect(() => {
    if (!enabled || !fromToken || !toToken) return;
    let cancelled = false;
    const ctrl = new AbortController();

    async function loadRow(idx: number, sizeUsd: number) {
      // Convert USD size into sellToken base units for BOTH legs.
      const ft = fromToken!;
      const tt = toToken!;
      const sellAmountFrom = Math.floor((sizeUsd / midPrice) * Math.pow(10, ft.decimals)).toString();
      const sellAmountTo   = Math.floor((sizeUsd) * Math.pow(10, tt.decimals)).toString();
      // Hardcoded ETH for "selling" side direction is a simplification; the
      // server only needs sellToken/buyToken/sellAmount/chain to route.
      const baseParams = {
        mode:        "quote",
        source:      "0x",
        fromChain:   chain,
        toChain:     chain,
        sellAmount:  "",   // overwritten per direction
        slippageBps: "30",
        taker:       "0x0000000000000000000000000000000000000000",
      };

      try {
        // BUY direction: spend `sizeUsd` of quote asset to BUY from-asset
        const buyParams = new URLSearchParams({
          ...baseParams,
          sellToken:  tt.address === "native" ? "native" : tt.address,
          buyToken:   ft.address === "native" ? "native" : ft.address,
          sellAmount: sellAmountTo,
        });
        const buyRes = await fetch(`/api/quote?${buyParams.toString()}`, { signal: ctrl.signal });
        let buyBps: number | null = null;
        if (buyRes.ok) {
          const body = await buyRes.json();
          const raw  = body?.result;
          if (raw?.buyAmount) {
            const got = Number(raw.buyAmount) / Math.pow(10, ft.decimals);
            const fair = sizeUsd / midPrice;
            buyBps = fair > 0 ? Math.max(0, (fair - got) / fair * 10_000) : null;
          }
        }

        // SELL direction: sell `sizeUsd` worth of from-asset
        const sellParams = new URLSearchParams({
          ...baseParams,
          sellToken:  ft.address === "native" ? "native" : ft.address,
          buyToken:   tt.address === "native" ? "native" : tt.address,
          sellAmount: sellAmountFrom,
        });
        const sellRes = await fetch(`/api/quote?${sellParams.toString()}`, { signal: ctrl.signal });
        let sellBps: number | null = null;
        if (sellRes.ok) {
          const body = await sellRes.json();
          const raw  = body?.result;
          if (raw?.buyAmount) {
            const got = Number(raw.buyAmount) / Math.pow(10, tt.decimals);
            const fair = sizeUsd;
            sellBps = fair > 0 ? Math.max(0, (fair - got) / fair * 10_000) : null;
          }
        }

        if (!cancelled) {
          setRows((prev) => {
            const next = prev.slice();
            next[idx] = { size: sizeUsd, buyBps, sellBps };
            return next;
          });
        }
      } catch {
        /* per-row failures stay as null — UI shows "—" honestly */
      }
    }

    setLoading(true);
    Promise.all(BUCKETS.map((s, i) => loadRow(i, s)))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; ctrl.abort(); };
  }, [enabled, fromToken, toToken, chain, midPrice]);

  const maxBps = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      if (r.buyBps  && r.buyBps  > m) m = r.buyBps;
      if (r.sellBps && r.sellBps > m) m = r.sellBps;
    }
    return Math.max(m, 50); // floor at 50 bps so a calm pool's bars are visible
  }, [rows]);

  return (
    <div className="rounded-lg border border-white/5 bg-black/40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="font-mono text-[10px] text-ink-3 tracking-widest uppercase inline-flex items-center gap-1.5">
          <Waves className="w-3 h-3 text-violet" />
          Depth · expected slippage
        </span>
        <span className="font-mono text-[9px] text-ink-4 tracking-widest uppercase">
          {loading ? "computing…" : "via 0x quote"}
        </span>
      </div>

      <div className="grid grid-cols-12 px-3 py-1 border-b border-white/5 font-mono text-[9px] text-ink-3 tracking-widest uppercase">
        <span className="col-span-3">Size</span>
        <span className="col-span-4 text-right">Buy impact</span>
        <span className="col-span-1" />
        <span className="col-span-4 text-right">Sell impact</span>
      </div>

      <div>
        {rows.map((r) => (
          <Row key={r.size} row={r} maxBps={maxBps} />
        ))}
      </div>

      {!enabled && (
        <div className="px-3 py-3 font-mono text-[10px] text-ink-3 text-center border-t border-white/5">
          Pair metadata not loaded — depth idle.
        </div>
      )}
    </div>
  );
}

function Row({ row, maxBps }: { row: ImpactRow; maxBps: number }) {
  const buyTone  = bpsTone(row.buyBps);
  const sellTone = bpsTone(row.sellBps);
  return (
    <div className="grid grid-cols-12 px-3 py-1.5 items-center font-mono text-[10px] tabular-nums border-b border-white/[0.02] last:border-0">
      <span className="col-span-3 text-ink-2">
        ${row.size >= 1_000_000 ? `${row.size / 1_000_000}M` : `${row.size / 1_000}k`}
      </span>

      {/* BUY side — bar grows LEFT from the center divider, label on the LEFT */}
      <div className="col-span-4 flex items-center justify-end gap-2">
        <span className={cn("w-12 text-right", buyTone.cls)}>
          {row.buyBps !== null ? `${formatBps(row.buyBps)}` : "—"}
        </span>
        <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden flex justify-end">
          <div
            className={cn("h-full rounded-full", buyTone.bar)}
            style={{ width: row.buyBps !== null ? `${Math.min(100, (row.buyBps / maxBps) * 100)}%` : "0%" }}
          />
        </div>
      </div>

      <span className="col-span-1 text-center text-ink-4">·</span>

      {/* SELL side — bar grows RIGHT */}
      <div className="col-span-4 flex items-center gap-2">
        <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full", sellTone.bar)}
            style={{ width: row.sellBps !== null ? `${Math.min(100, (row.sellBps / maxBps) * 100)}%` : "0%" }}
          />
        </div>
        <span className={cn("w-12 text-left", sellTone.cls)}>
          {row.sellBps !== null ? `${formatBps(row.sellBps)}` : "—"}
        </span>
      </div>
    </div>
  );
}

function bpsTone(bps: number | null): { cls: string; bar: string } {
  if (bps === null)   return { cls: "text-ink-3", bar: "bg-white/10"   };
  if (bps <= 10)      return { cls: "text-green", bar: "bg-green/60"   };
  if (bps <= 50)      return { cls: "text-cyan",  bar: "bg-cyan/60"    };
  if (bps <= 200)     return { cls: "text-gold",  bar: "bg-gold/60"    };
  return                       { cls: "text-red",  bar: "bg-red/60"     };
}

function formatBps(bps: number): string {
  if (bps < 1)       return `${bps.toFixed(2)} bp`;
  if (bps < 100)     return `${bps.toFixed(1)} bp`;
  return                 `${(bps / 100).toFixed(2)}%`;
}
