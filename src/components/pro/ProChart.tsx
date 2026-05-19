"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type DeepPartial,
  type ChartOptions,
  type Time,
  type CandlestickData,
  type BarData,
  type LineData,
  type HistogramData,
} from "lightweight-charts";
import type { Candle, Timeframe, PriceToken, PoolMeta } from "@/lib/api/geckoterminal";

export type ChartKind = "candle" | "bar" | "line";

interface Props {
  chain:        string;
  pool:         string;
  tf:           Timeframe;
  kind:         ChartKind;
  ma:           boolean;     // 20-period simple moving average overlay
  ema:          boolean;     // 50-period exponential moving average overlay
  /**
   * Symbol the user expects to see on the chart. The component fetches the
   * pool's metadata and automatically picks token=base or token=quote based
   * on which side of the pool that symbol is. Without this, naively-base
   * requests would chart USDT@$1 instead of BNB@$700 on inverted pools.
   */
  targetSymbol: string;
  onLastPrice?: (last: number, change24h: number, high: number, low: number, vol24hUsd: number) => void;
  onMeta?:      (meta: PoolMeta | null, side: PriceToken) => void;
}

/**
 * TradingView Lightweight Charts wrapper.
 *
 * - Pulls OHLCV from /api/ohlcv (which proxies GeckoTerminal)
 * - Renders candle / bar / line by the `kind` prop (hot-swappable)
 * - Volume histogram pinned to the bottom 25% of the pane
 * - MA / EMA overlays toggle via props
 * - Auto-resizes via ResizeObserver
 */
export default function ProChart({ chain, pool, tf, kind, ma, ema, targetSymbol, onLastPrice, onMeta }: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const priceSeriesRef  = useRef<ISeriesApi<"Candlestick" | "Bar" | "Line"> | null>(null);
  const volSeriesRef    = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef    = useRef<ISeriesApi<"Line"> | null>(null);

  const [error, setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]);

  // ── Initial chart setup (runs once) ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const options: DeepPartial<ChartOptions> = {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor:  "#7E89C2",
        fontFamily: "var(--font-mono), monospace",
        fontSize:   11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: "#00E8FF", style: LineStyle.Dotted, width: 1, labelBackgroundColor: "#0C1130" },
        horzLine: { color: "#00E8FF", style: LineStyle.Dotted, width: 1, labelBackgroundColor: "#0C1130" },
      },
      autoSize: true,
      handleScroll: true,
      handleScale:  true,
    };

    const chart = createChart(containerRef.current, options);
    chartRef.current = chart;

    // Volume histogram pinned to the bottom
    const volSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "#00E8FF44",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
    volSeriesRef.current = volSeries;

    // Resize-observer fallback (autoSize handles most cases)
    const ro = new ResizeObserver(() => chart.applyOptions({}));
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volSeriesRef.current   = null;
      maSeriesRef.current    = null;
      emaSeriesRef.current   = null;
    };
  }, []);

  // ── Recreate price series when chart kind changes ───────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Drop old series
    if (priceSeriesRef.current) {
      chart.removeSeries(priceSeriesRef.current);
      priceSeriesRef.current = null;
    }

    if (kind === "candle") {
      priceSeriesRef.current = chart.addCandlestickSeries({
        upColor:        "#00E087",
        downColor:      "#FF3B5C",
        borderUpColor:  "#00E087",
        borderDownColor:"#FF3B5C",
        wickUpColor:    "#00E087",
        wickDownColor:  "#FF3B5C",
      });
    } else if (kind === "bar") {
      priceSeriesRef.current = chart.addBarSeries({
        upColor:    "#00E087",
        downColor:  "#FF3B5C",
        thinBars:   false,
        openVisible: true,
      });
    } else {
      priceSeriesRef.current = chart.addLineSeries({
        color:     "#00E8FF",
        lineWidth: 2,
        priceLineVisible: true,
      });
    }

    // Push current data into the new series
    if (candles.length > 0) {
      pushCandles(priceSeriesRef.current!, kind, candles);
    }
  }, [kind, candles]);

  // ── MA overlay toggle ───────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ma) {
      if (!maSeriesRef.current) {
        maSeriesRef.current = chart.addLineSeries({
          color: "#F5A623",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      maSeriesRef.current!.setData(sma(candles, 20));
    } else if (maSeriesRef.current) {
      chart.removeSeries(maSeriesRef.current);
      maSeriesRef.current = null;
    }
  }, [ma, candles]);

  // ── EMA overlay toggle ──────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ema) {
      if (!emaSeriesRef.current) {
        emaSeriesRef.current = chart.addLineSeries({
          color: "#9F5FFF",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      emaSeriesRef.current!.setData(emaCalc(candles, 50));
    } else if (emaSeriesRef.current) {
      chart.removeSeries(emaSeriesRef.current);
      emaSeriesRef.current = null;
    }
  }, [ema, candles]);

  // ── Fetch pool metadata + OHLCV on chain / pool / tf change ─────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();

    async function fetchData() {
      try {
        // 1. Fetch pool metadata to learn which side has our target symbol
        const metaUrl = `/api/pool-meta?chain=${chain}&pool=${pool}`;
        const metaRes = await fetch(metaUrl, { signal: ctrl.signal });
        let side: PriceToken = "base";
        let meta: PoolMeta | null = null;
        if (metaRes.ok) {
          const j = await metaRes.json() as { meta?: PoolMeta | null };
          meta = j.meta ?? null;
          if (meta) {
            const wantUpper = targetSymbol.toLowerCase();
            const baseSym   = meta.baseTokenSymbol.toLowerCase();
            const quoteSym  = meta.quoteTokenSymbol.toLowerCase();
            // Match exactly OR allow W-prefix wrap (WETH ≈ ETH, WBNB ≈ BNB, etc.)
            const matchBase  = baseSym  === wantUpper || baseSym  === "w" + wantUpper || "w" + baseSym  === wantUpper;
            const matchQuote = quoteSym === wantUpper || quoteSym === "w" + wantUpper || "w" + quoteSym === wantUpper;
            if (matchBase) side = "base";
            else if (matchQuote) side = "quote";
            // Fall back to base if neither matches (likely a custom symbol)
          }
        }
        if (cancelled) return;
        onMeta?.(meta, side);

        // 2. Fetch OHLCV with the correct token side
        const url = `/api/ohlcv?chain=${chain}&pool=${pool}&tf=${tf}&token=${side}`;
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { candles?: Candle[] };
        if (cancelled) return;
        const rows = data.candles ?? [];
        setCandles(rows);

        // Push to all live series
        if (priceSeriesRef.current) {
          pushCandles(priceSeriesRef.current, kind, rows);
        }
        if (volSeriesRef.current) {
          const vols: HistogramData<Time>[] = rows.map((c) => ({
            time: c.time as Time,
            value: c.volume,
            color: c.close >= c.open ? "#00E08744" : "#FF3B5C44",
          }));
          volSeriesRef.current.setData(vols);
        }
        chartRef.current?.timeScale().fitContent();

        // Push summary to parent
        if (onLastPrice && rows.length > 0) {
          const first24 = findFirst24hAgo(rows);
          const last    = rows[rows.length - 1].close;
          const ref     = first24 ? first24.close : rows[0].close;
          const change  = ref > 0 ? ((last - ref) / ref) * 100 : 0;
          const recent  = rows.slice(-Math.min(rows.length, ticksFor24h(tf)));
          const high    = Math.max(...recent.map((r) => r.high));
          const low     = Math.min(...recent.map((r) => r.low));
          const vol24   = recent.reduce((acc, r) => acc + r.volume, 0);
          onLastPrice(last, change, high, low, vol24);
        }
      } catch (e) {
        if (cancelled) return;
        const name = e instanceof Error ? e.name : "";
        if (name !== "AbortError") {
          setError(e instanceof Error ? e.message : "Failed to load chart data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [chain, pool, tf, kind, targetSymbol, onLastPrice, onMeta]);

  return (
    <div className="relative w-full h-full min-h-[320px]">
      <div ref={containerRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase animate-pulse">
            Loading candles…
          </div>
        </div>
      )}
      {error && !loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 font-mono text-[10px] text-gold/80">
            {error}
          </div>
        </div>
      )}
      {!loading && !error && candles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="font-mono text-[10px] text-ink-3 tracking-widest uppercase">
            No candles · pool may be too new
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function pushCandles(
  series: ISeriesApi<"Candlestick" | "Bar" | "Line">,
  kind: ChartKind,
  rows: Candle[],
) {
  if (kind === "candle") {
    const data: CandlestickData<Time>[] = rows.map((c) => ({
      time:  c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    (series as ISeriesApi<"Candlestick">).setData(data);
  } else if (kind === "bar") {
    const data: BarData<Time>[] = rows.map((c) => ({
      time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
    }));
    (series as ISeriesApi<"Bar">).setData(data);
  } else {
    const data: LineData<Time>[] = rows.map((c) => ({
      time: c.time as Time, value: c.close,
    }));
    (series as ISeriesApi<"Line">).setData(data);
  }
}

function sma(rows: Candle[], period: number): LineData<Time>[] {
  if (rows.length < period) return [];
  const out: LineData<Time>[] = [];
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    sum += rows[i].close;
    if (i >= period) sum -= rows[i - period].close;
    if (i >= period - 1) {
      out.push({ time: rows[i].time as Time, value: sum / period });
    }
  }
  return out;
}

function emaCalc(rows: Candle[], period: number): LineData<Time>[] {
  if (rows.length < period) return [];
  const k = 2 / (period + 1);
  const out: LineData<Time>[] = [];
  // Seed with SMA of first `period` closes
  let prev = rows.slice(0, period).reduce((acc, r) => acc + r.close, 0) / period;
  out.push({ time: rows[period - 1].time as Time, value: prev });
  for (let i = period; i < rows.length; i++) {
    prev = rows[i].close * k + prev * (1 - k);
    out.push({ time: rows[i].time as Time, value: prev });
  }
  return out;
}

function ticksFor24h(tf: Timeframe): number {
  switch (tf) {
    case "1m":  return 1440;
    case "5m":  return 288;
    case "15m": return 96;
    case "1h":  return 24;
    case "4h":  return 6;
    case "1d":  return 1;
  }
}

function findFirst24hAgo(rows: Candle[]): Candle | null {
  if (!rows.length) return null;
  const last = rows[rows.length - 1].time;
  const target = last - 24 * 3600;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].time <= target) return rows[i];
  }
  return null;
}
