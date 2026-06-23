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

export interface StrategyLevel {
  price:  number;
  label:  string;
  color:  string;
  style?: "solid" | "dashed" | "dotted";
}

export interface ChartSignals {
  price:     number;
  ema9?:     number;
  ema21?:    number;
  ema50?:    number;
  ema100?:   number;
  ema200?:   number;
  vwap?:     number;
  rsi?:      number;
  macdBull?: boolean;
  atr?:      number;
}

interface Props {
  chain:        string;
  pool:         string;
  tf:           Timeframe;
  kind:         ChartKind;
  ma:           boolean;     // 20-period simple moving average overlay
  ema:          boolean;     // 50-period exponential moving average overlay
  bb:           boolean;     // Bollinger Bands 20,2
  vwap:         boolean;     // Volume-weighted average price
  ema9:         boolean;
  ema21:        boolean;
  ema100:       boolean;
  ema200:       boolean;
  rsiOn:        boolean;     // RSI 14 in lower portion of chart
  macd:         boolean;
  stochRsi:     boolean;
  onSignals?:   (s: ChartSignals) => void;
  strategyLevels?: StrategyLevel[];
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
 * - MA / EMA / BB / VWAP / EMA9/21/100/200 / RSI / MACD / StochRSI overlays toggle via props
 * - Strategy levels drawn as price lines
 * - Auto-resizes via ResizeObserver
 */
export default function ProChart({
  chain, pool, tf, kind, ma, ema,
  bb, vwap, ema9, ema21, ema100, ema200, rsiOn,
  macd, stochRsi, onSignals,
  strategyLevels,
  targetSymbol, onLastPrice, onMeta,
}: Props) {
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const priceSeriesRef  = useRef<ISeriesApi<"Candlestick" | "Bar" | "Line"> | null>(null);
  const volSeriesRef    = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef    = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpperRef      = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMiddleRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLowerRef      = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef         = useRef<ISeriesApi<"Line"> | null>(null);
  const ema9Ref         = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref        = useRef<ISeriesApi<"Line"> | null>(null);
  const ema100Ref       = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref       = useRef<ISeriesApi<"Line"> | null>(null);
  const rsiRef          = useRef<ISeriesApi<"Line"> | null>(null);
  const macdLineRef     = useRef<ISeriesApi<"Line"> | null>(null);
  const macdSignalRef   = useRef<ISeriesApi<"Line"> | null>(null);
  const macdHistRef     = useRef<ISeriesApi<"Histogram"> | null>(null);
  const stochKRef       = useRef<ISeriesApi<"Line"> | null>(null);
  const stochDRef       = useRef<ISeriesApi<"Line"> | null>(null);

  const [error, setError]     = useState<string | null>(null);
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
      chartRef.current    = null;
      priceSeriesRef.current = null;
      volSeriesRef.current   = null;
      maSeriesRef.current    = null;
      emaSeriesRef.current   = null;
      bbUpperRef.current     = null;
      bbMiddleRef.current    = null;
      bbLowerRef.current     = null;
      vwapRef.current        = null;
      ema9Ref.current        = null;
      ema21Ref.current       = null;
      ema100Ref.current      = null;
      ema200Ref.current      = null;
      rsiRef.current         = null;
      macdLineRef.current    = null;
      macdSignalRef.current  = null;
      macdHistRef.current    = null;
      stochKRef.current      = null;
      stochDRef.current      = null;
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
        upColor:         "#00E087",
        downColor:       "#FF3B5C",
        borderUpColor:   "#00E087",
        borderDownColor: "#FF3B5C",
        wickUpColor:     "#00E087",
        wickDownColor:   "#FF3B5C",
      });
    } else if (kind === "bar") {
      priceSeriesRef.current = chart.addBarSeries({
        upColor:     "#00E087",
        downColor:   "#FF3B5C",
        thinBars:    false,
        openVisible: true,
      });
    } else {
      priceSeriesRef.current = chart.addLineSeries({
        color:            "#00E8FF",
        lineWidth:        2,
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
          color:            "#F5A623",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      maSeriesRef.current.setData(sma(candles, 20));
    } else if (maSeriesRef.current) {
      chart.removeSeries(maSeriesRef.current);
      maSeriesRef.current = null;
    }
  }, [ma, candles]);

  // ── EMA 50 overlay toggle ──────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ema) {
      if (!emaSeriesRef.current) {
        emaSeriesRef.current = chart.addLineSeries({
          color:            "#9F5FFF",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      emaSeriesRef.current.setData(emaCalcN(candles, 50));
    } else if (emaSeriesRef.current) {
      chart.removeSeries(emaSeriesRef.current);
      emaSeriesRef.current = null;
    }
  }, [ema, candles]);

  // ── Bollinger Bands toggle ──────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (bb) {
      const { upper, middle, lower } = bbCalc(candles);
      if (!bbUpperRef.current) {
        bbUpperRef.current = chart.addLineSeries({
          color:            "#FF6B35",
          lineWidth:        1,
          lineStyle:        LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      if (!bbMiddleRef.current) {
        bbMiddleRef.current = chart.addLineSeries({
          color:            "#888888",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      if (!bbLowerRef.current) {
        bbLowerRef.current = chart.addLineSeries({
          color:            "#FF6B35",
          lineWidth:        1,
          lineStyle:        LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      bbUpperRef.current.setData(upper);
      bbMiddleRef.current.setData(middle);
      bbLowerRef.current.setData(lower);
    } else {
      if (bbUpperRef.current)  { chart.removeSeries(bbUpperRef.current);  bbUpperRef.current  = null; }
      if (bbMiddleRef.current) { chart.removeSeries(bbMiddleRef.current); bbMiddleRef.current = null; }
      if (bbLowerRef.current)  { chart.removeSeries(bbLowerRef.current);  bbLowerRef.current  = null; }
    }
  }, [bb, candles]);

  // ── VWAP toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (vwap) {
      if (!vwapRef.current) {
        vwapRef.current = chart.addLineSeries({
          color:            "#FFD700",
          lineWidth:        1,
          lineStyle:        LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      vwapRef.current.setData(vwapCalc(candles));
    } else if (vwapRef.current) {
      chart.removeSeries(vwapRef.current);
      vwapRef.current = null;
    }
  }, [vwap, candles]);

  // ── EMA 9 toggle ────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ema9) {
      if (!ema9Ref.current) {
        ema9Ref.current = chart.addLineSeries({
          color:            "#00E8FF",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema9Ref.current.setData(emaCalcN(candles, 9));
    } else if (ema9Ref.current) {
      chart.removeSeries(ema9Ref.current);
      ema9Ref.current = null;
    }
  }, [ema9, candles]);

  // ── EMA 21 toggle ───────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ema21) {
      if (!ema21Ref.current) {
        ema21Ref.current = chart.addLineSeries({
          color:            "#F5A623",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema21Ref.current.setData(emaCalcN(candles, 21));
    } else if (ema21Ref.current) {
      chart.removeSeries(ema21Ref.current);
      ema21Ref.current = null;
    }
  }, [ema21, candles]);

  // ── EMA 100 toggle ──────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ema100) {
      if (!ema100Ref.current) {
        ema100Ref.current = chart.addLineSeries({
          color:            "#9F5FFF",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema100Ref.current.setData(emaCalcN(candles, 100));
    } else if (ema100Ref.current) {
      chart.removeSeries(ema100Ref.current);
      ema100Ref.current = null;
    }
  }, [ema100, candles]);

  // ── EMA 200 toggle ──────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (ema200) {
      if (!ema200Ref.current) {
        ema200Ref.current = chart.addLineSeries({
          color:            "#FF3B5C",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema200Ref.current.setData(emaCalcN(candles, 200));
    } else if (ema200Ref.current) {
      chart.removeSeries(ema200Ref.current);
      ema200Ref.current = null;
    }
  }, [ema200, candles]);

  // ── RSI toggle ──────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (rsiOn) {
      // Shrink main price scale to make room for RSI
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.45 } });

      if (!rsiRef.current) {
        rsiRef.current = chart.addLineSeries({
          color:            "#9F5FFF",
          lineWidth:        1,
          priceLineVisible: false,
          lastValueVisible: true,
          priceScaleId:     "rsi",
        });
        chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.80, bottom: 0.02 } });
        // Reference lines at 30 and 70
        rsiRef.current.createPriceLine({ price: 70, color: "#FF3B5C44", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "OB" });
        rsiRef.current.createPriceLine({ price: 30, color: "#00E08744", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "OS" });
      }
      rsiRef.current.setData(rsiCalc(candles));
    } else {
      if (rsiRef.current) {
        chart.removeSeries(rsiRef.current);
        rsiRef.current = null;
      }
      // Restore main price scale margins
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
    }
  }, [rsiOn, candles]);

  // ── MACD toggle ─────────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (macd) {
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.45 } });
      if (!macdLineRef.current) {
        macdLineRef.current = chart.addLineSeries({
          color: "#00E8FF", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceScaleId: "macd",
        });
        macdSignalRef.current = chart.addLineSeries({
          color: "#F5A623", lineWidth: 1, lineStyle: LineStyle.Dashed,
          priceLineVisible: false, lastValueVisible: false, priceScaleId: "macd",
        });
        macdHistRef.current = chart.addHistogramSeries({
          priceScaleId: "macd", priceLineVisible: false, lastValueVisible: false,
        });
        chart.priceScale("macd").applyOptions({ scaleMargins: { top: 0.80, bottom: 0.02 } });
        macdLineRef.current.createPriceLine({ price: 0, color: "rgba(255,255,255,0.10)", lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false, title: "" });
      }
      const { macdLine, signalLine, histogram } = macdCalc(candles);
      macdLineRef.current.setData(macdLine);
      macdSignalRef.current?.setData(signalLine);
      macdHistRef.current?.setData(histogram as HistogramData<Time>[]);
    } else {
      if (macdLineRef.current)   { chart.removeSeries(macdLineRef.current);   macdLineRef.current   = null; }
      if (macdSignalRef.current) { chart.removeSeries(macdSignalRef.current); macdSignalRef.current = null; }
      if (macdHistRef.current)   { chart.removeSeries(macdHistRef.current);   macdHistRef.current   = null; }
      if (!rsiOn && !stochRsi)
        chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
    }
  }, [macd, candles, rsiOn, stochRsi]);

  // ── Stoch RSI toggle ────────────────────────────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (stochRsi) {
      chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.45 } });
      if (!stochKRef.current) {
        stochKRef.current = chart.addLineSeries({
          color: "#9F5FFF", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceScaleId: "stoch",
        });
        stochDRef.current = chart.addLineSeries({
          color: "#F5A623", lineWidth: 1, lineStyle: LineStyle.Dashed,
          priceLineVisible: false, lastValueVisible: false, priceScaleId: "stoch",
        });
        chart.priceScale("stoch").applyOptions({ scaleMargins: { top: 0.80, bottom: 0.02 } });
        stochKRef.current.createPriceLine({ price: 80, color: "#FF3B5C44", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "OB" });
        stochKRef.current.createPriceLine({ price: 20, color: "#00E08744", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "OS" });
      }
      const { k, d } = stochRsiCalc(candles);
      stochKRef.current.setData(k);
      stochDRef.current?.setData(d);
    } else {
      if (stochKRef.current) { chart.removeSeries(stochKRef.current); stochKRef.current = null; }
      if (stochDRef.current) { chart.removeSeries(stochDRef.current); stochDRef.current = null; }
      if (!rsiOn && !macd)
        chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: 0.28 } });
    }
  }, [stochRsi, candles, rsiOn, macd]);

  // ── Strategy levels — use a stable ref to track created lines ───────
  const strategyLineHandlesRef = useRef<ReturnType<NonNullable<typeof priceSeriesRef.current>["createPriceLine"]>[]>([]);

  useEffect(() => {
    const series = priceSeriesRef.current;
    if (!series) return;

    // Remove old lines
    for (const line of strategyLineHandlesRef.current) {
      try { series.removePriceLine(line); } catch { /* already gone */ }
    }
    strategyLineHandlesRef.current = [];

    if (!strategyLevels || strategyLevels.length === 0) return;

    const styleMap: Record<string, number> = {
      solid:  LineStyle.Solid,
      dashed: LineStyle.Dashed,
      dotted: LineStyle.Dotted,
    };

    for (const lvl of strategyLevels) {
      const handle = series.createPriceLine({
        price:              lvl.price,
        color:              lvl.color,
        lineWidth:          1,
        lineStyle:          styleMap[lvl.style ?? "solid"] ?? LineStyle.Solid,
        axisLabelVisible:   true,
        title:              lvl.label,
      });
      strategyLineHandlesRef.current.push(handle);
    }
  }, [strategyLevels]);

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
            time:  c.time as Time,
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

        if (onSignals && rows.length > 0) {
          const lastClose = rows[rows.length - 1].close;
          const s: ChartSignals = { price: lastClose };
          if (ema9)    { const d = emaCalcN(rows, 9);   if (d.length) s.ema9   = d[d.length-1].value; }
          if (ema21)   { const d = emaCalcN(rows, 21);  if (d.length) s.ema21  = d[d.length-1].value; }
          if (ema)     { const d = emaCalcN(rows, 50);  if (d.length) s.ema50  = d[d.length-1].value; }
          if (ema100)  { const d = emaCalcN(rows, 100); if (d.length) s.ema100 = d[d.length-1].value; }
          if (ema200)  { const d = emaCalcN(rows, 200); if (d.length) s.ema200 = d[d.length-1].value; }
          if (vwap)    { const d = vwapCalc(rows);      if (d.length) s.vwap   = d[d.length-1].value; }
          if (rsiOn)   { const d = rsiCalc(rows);       if (d.length) s.rsi    = d[d.length-1].value; }
          if (macd)    {
            const { macdLine, signalLine } = macdCalc(rows);
            if (macdLine.length && signalLine.length)
              s.macdBull = macdLine[macdLine.length-1].value > signalLine[signalLine.length-1].value;
          }
          const atrData = atrCalc(rows);
          if (atrData.length) s.atr = atrData[atrData.length-1];
          onSignals(s);
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
  }, [chain, pool, tf, kind, targetSymbol, onLastPrice, onMeta, onSignals, ema9, ema21, ema, ema100, ema200, vwap, rsiOn, macd]);

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
      time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close,
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

function emaCalcN(rows: Candle[], period: number): LineData<Time>[] {
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

function bbCalc(rows: Candle[], period = 20, mult = 2): {
  upper: LineData<Time>[];
  middle: LineData<Time>[];
  lower: LineData<Time>[];
} {
  if (rows.length < period) return { upper: [], middle: [], lower: [] };
  const upper: LineData<Time>[] = [];
  const middle: LineData<Time>[] = [];
  const lower: LineData<Time>[] = [];

  for (let i = period - 1; i < rows.length; i++) {
    const slice = rows.slice(i - period + 1, i + 1);
    const avg = slice.reduce((acc, r) => acc + r.close, 0) / period;
    const variance = slice.reduce((acc, r) => acc + Math.pow(r.close - avg, 2), 0) / period;
    const stddev = Math.sqrt(variance);
    const t = rows[i].time as Time;
    upper.push({ time: t, value: avg + mult * stddev });
    middle.push({ time: t, value: avg });
    lower.push({ time: t, value: avg - mult * stddev });
  }
  return { upper, middle, lower };
}

function vwapCalc(rows: Candle[]): LineData<Time>[] {
  if (rows.length === 0) return [];
  const out: LineData<Time>[] = [];
  let cumVolume = 0;
  let cumVolPrice = 0;
  for (const c of rows) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumVolume   += c.volume;
    cumVolPrice += typicalPrice * c.volume;
    if (cumVolume > 0) {
      out.push({ time: c.time as Time, value: cumVolPrice / cumVolume });
    }
  }
  return out;
}

function rsiCalc(rows: Candle[], period = 14): LineData<Time>[] {
  if (rows.length <= period) return [];
  const out: LineData<Time>[] = [];

  // Compute changes
  const changes: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    changes.push(rows[i].close - rows[i - 1].close);
  }

  // Seed with simple average of first `period` gains/losses
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  const calcRsi = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out.push({ time: rows[period].time as Time, value: calcRsi(avgGain, avgLoss) });

  // Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({ time: rows[i + 1].time as Time, value: calcRsi(avgGain, avgLoss) });
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
  const last   = rows[rows.length - 1].time;
  const target = last - 24 * 3600;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].time <= target) return rows[i];
  }
  return null;
}

function macdCalc(rows: Candle[]): {
  macdLine: LineData<Time>[];
  signalLine: LineData<Time>[];
  histogram: { time: Time; value: number; color: string }[];
} {
  const fast = emaCalcN(rows, 12);
  const slow = emaCalcN(rows, 26);
  if (!fast.length || !slow.length) return { macdLine: [], signalLine: [], histogram: [] };
  const slowMap = new Map<Time, number>(slow.map(d => [d.time, d.value]));
  const macdLine: LineData<Time>[] = fast
    .filter(d => slowMap.has(d.time))
    .map(d => ({ time: d.time, value: d.value - slowMap.get(d.time)! }));
  if (macdLine.length < 9) return { macdLine, signalLine: [], histogram: [] };
  const kk = 2 / 10;
  let prev = macdLine.slice(0, 9).reduce((a, b) => a + b.value, 0) / 9;
  const signalLine: LineData<Time>[] = [{ time: macdLine[8].time, value: prev }];
  for (let i = 9; i < macdLine.length; i++) {
    prev = macdLine[i].value * kk + prev * (1 - kk);
    signalLine.push({ time: macdLine[i].time, value: prev });
  }
  const sigMap = new Map<Time, number>(signalLine.map(d => [d.time, d.value]));
  const histogram = macdLine
    .filter(d => sigMap.has(d.time))
    .map(d => {
      const val = d.value - sigMap.get(d.time)!;
      return { time: d.time, value: val, color: val >= 0 ? "#00E08766" : "#FF3B5C66" };
    });
  return { macdLine, signalLine, histogram };
}

function stochRsiCalc(
  rows: Candle[],
  rsiPeriod   = 14,
  stochPeriod = 14,
  kSmooth     = 3,
  dSmooth     = 3,
): { k: LineData<Time>[]; d: LineData<Time>[] } {
  const rsiData = rsiCalc(rows, rsiPeriod);
  if (rsiData.length < stochPeriod) return { k: [], d: [] };
  const rawK: LineData<Time>[] = [];
  for (let i = stochPeriod - 1; i < rsiData.length; i++) {
    const window = rsiData.slice(i - stochPeriod + 1, i + 1).map(d => d.value);
    const lo = Math.min(...window);
    const hi = Math.max(...window);
    rawK.push({ time: rsiData[i].time, value: hi === lo ? 50 : ((rsiData[i].value - lo) / (hi - lo)) * 100 });
  }
  const kSmoothed = smoothLineArr(rawK, kSmooth);
  return { k: kSmoothed, d: smoothLineArr(kSmoothed, dSmooth) };
}

function smoothLineArr(data: LineData<Time>[], period: number): LineData<Time>[] {
  if (data.length < period) return data;
  const out: LineData<Time>[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const avg = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.value, 0) / period;
    out.push({ time: data[i].time, value: avg });
  }
  return out;
}

function atrCalc(rows: Candle[], period = 14): number[] {
  if (rows.length < period + 1) return [];
  const trues: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    trues.push(Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - rows[i - 1].close),
      Math.abs(rows[i].low  - rows[i - 1].close),
    ));
  }
  let atr = trues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out = [atr];
  for (let i = period; i < trues.length; i++) {
    atr = (atr * (period - 1) + trues[i]) / period;
    out.push(atr);
  }
  return out;
}
