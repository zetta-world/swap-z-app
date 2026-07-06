import { ImageResponse } from "next/og";

/**
 * Dashboard-style OG card — visually replicates the real app surface
 * so when the link is shared on WhatsApp / Telegram / Twitter the
 * preview looks like a screenshot of Z-SWAP, not an abstract teaser.
 *
 * 1200×630, Edge-rendered. Satori (the underlying renderer) supports
 * only flexbox + inline styles, so the layout is built from explicit
 * flex containers — no CSS grid, no transforms, no backdrop-filter.
 *
 * Composition:
 *   [ Sidebar ][      Main canvas                      ]
 *
 *   Sidebar (compact):
 *     - "Z" mark + Z-SWAP wordmark
 *     - Nav icon strip (Swap / Buy / Bridge / Orders / CEX / Pro / ZION)
 *
 *   Main canvas:
 *     - Eyebrow "ZETTA Ecosystem · Live"
 *     - "The Liquidity Nexus" headline (cyan→violet gradient)
 *     - One-line value prop
 *     - Stat strip — TVL / Swaps 24h / Chains / Routes
 *     - Two mock cards (top pair + chain breakdown) to fill the bottom
 *
 * No external font load — system stack with weights, so the image
 * cold-starts in <100ms.
 */
export const runtime = "edge";

export const alt = "Z-SWAP — The Liquidity Nexus · multi-chain DEX with ZION AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CYAN   = "#00E8FF";
const VIOLET = "#9F5FFF";
const GOLD   = "#F2C879";
const GREEN  = "#22D27E";
const RED    = "#FF5C7A";
const INK    = "#E6E9F5";
const INK_2  = "#A5ADC4";
const INK_3  = "#6C7590";
const INK_4  = "#3F4862";
const BG     = "#02030A";
const BG_1   = "#0A0E1B";
const BG_2   = "#11162A";

export default async function OG() {
  // The real Yggdrasil Z emblem, embedded so the link preview carries the
  // actual brand instead of a lookalike text tile. Satori accepts the raw
  // ArrayBuffer as an <img> src.
  const logo = await fetch(new URL("./og-logo.png", import.meta.url)).then((r) => r.arrayBuffer());
  return new ImageResponse(
    (
      <div
        style={{
          width:  "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          background: BG,
          color: INK,
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* Aurora wash (single gradient — satori-safe) */}
        <div
          style={{
            position: "absolute",
            top: -200,
            right: -120,
            width: 620,
            height: 620,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${CYAN}28, transparent 70%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -220,
            left: 100,
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${VIOLET}28, transparent 70%)`,
            display: "flex",
          }}
        />

        {/* ── Sidebar ─────────────────────────────────────── */}
        <Sidebar logo={logo} />

        {/* ── Main canvas ─────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            padding: "44px 56px 40px",
            gap: 20,
            zIndex: 1,
          }}
        >
          {/* Top eyebrow row */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Pill color={GREEN} label="ZETTA Ecosystem · Live" dot />
            <Pill color={GOLD} label="ZION AI advisory" />
            <Pill color={CYAN} label="Non-custodial" />
          </div>

          {/* Headline */}
          <div
            style={{
              fontSize: 96,
              fontWeight: 900,
              letterSpacing: -2.5,
              lineHeight: 1.0,
              backgroundImage: `linear-gradient(95deg, ${CYAN} 0%, ${INK} 50%, ${VIOLET} 100%)`,
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
              marginTop: 4,
            }}
          >
            The Liquidity Nexus
          </div>

          {/* Tagline */}
          <div
            style={{
              fontSize: 22,
              color: INK_2,
              lineHeight: 1.35,
              maxWidth: 820,
              display: "flex",
            }}
          >
            Multi-chain DEX aggregator with ZION AI advisory, autopilot
            trading, and CEX-bridged arbitrage.
          </div>

          {/* Stat strip */}
          <div
            style={{
              display: "flex",
              gap: 14,
              marginTop: 6,
            }}
          >
            <StatCard label="TVL Routed"  value="$2.5B" sub="across 11 chains" tone={CYAN}   />
            <StatCard label="Swaps · 24h" value="8,420" sub="aggregator + CEX" tone={INK}    />
            <StatCard label="Chains"      value="11"    sub="EVM + Solana"     tone={VIOLET} />
            <StatCard label="ZION cards"  value="132"   sub="distinct actions" tone={GOLD}   />
          </div>

          {/* Two-card row at the bottom — mimics the dashboard mini-cards */}
          <div style={{ display: "flex", gap: 14, marginTop: "auto", flex: 1 }}>
            <PairCard />
            <ChainCard />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function Sidebar({ logo }: { logo: ArrayBuffer }) {
  // Pure CSS pictograms — satori can't load emoji fonts so the previous
  // ⇄/💳/🌉 etc. rendered as empty tofu boxes. These are drawn from div
  // primitives so they're always present at the same visual weight as
  // the real lucide icons in the app.
  const items: { kind: PictoKind; label: string; tone?: string }[] = [
    { kind: "swap",    label: "Swap" },
    { kind: "card",    label: "Buy",    tone: GOLD },
    { kind: "bridge",  label: "Bridge" },
    { kind: "chart",   label: "Orders" },
    { kind: "wallet",  label: "CEX" },
    { kind: "bars",    label: "Pro" },
    { kind: "sparks",  label: "ZION",   tone: GOLD },
  ];
  return (
    <div
      style={{
        width: 196,
        background: BG_1,
        borderRight: `1px solid ${INK_4}33`,
        display: "flex",
        flexDirection: "column",
        padding: "28px 18px",
        gap: 22,
        zIndex: 2,
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={logo as unknown as string} width={40} height={40} style={{ objectFit: "contain" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: INK, letterSpacing: 0.5 }}>
            Z-SWAP
          </div>
          <div style={{ fontSize: 8, color: INK_3, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace" }}>
            Liquidity Nexus
          </div>
        </div>
      </div>

      {/* Nav rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background: it.label === "Swap" ? "#FFFFFF0A" : "transparent",
              fontSize: 13,
              color: it.label === "Swap" ? INK : INK_2,
            }}
          >
            <span style={{ width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Picto kind={it.kind} color={it.tone ?? INK_3} />
            </span>
            <span style={{ flex: 1, display: "flex" }}>{it.label}</span>
            {it.tone === GOLD && (
              <span style={{
                fontSize: 8,
                color: GOLD,
                border: `1px solid ${GOLD}55`,
                padding: "1px 4px",
                borderRadius: 999,
                fontFamily: "monospace",
                letterSpacing: 1.5,
                display: "flex",
              }}>
                {it.label === "Buy" ? "SOON" : "AI"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Pill({ color, label, dot }: { color: string; label: string; dot?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        border: `1px solid ${color}55`,
        background: `${color}10`,
        fontSize: 12,
        color,
        letterSpacing: 2.5,
        textTransform: "uppercase",
        fontFamily: "monospace",
      }}
    >
      {dot && (
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, display: "flex" }} />
      )}
      {label}
    </div>
  );
}

function StatCard({
  label, value, sub, tone,
}: {
  label: string; value: string; sub: string; tone: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: `${BG_2}cc`,
        border: `1px solid ${INK_4}66`,
        borderRadius: 14,
        padding: "16px 18px",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: INK_3,
          letterSpacing: 2.5,
          textTransform: "uppercase",
          fontFamily: "monospace",
          display: "flex",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 900, color: tone, letterSpacing: -0.5, display: "flex" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: INK_3, display: "flex" }}>
        {sub}
      </div>
    </div>
  );
}

function PairCard() {
  return (
    <div
      style={{
        flex: 1.2,
        display: "flex",
        flexDirection: "column",
        background: `${BG_2}cc`,
        border: `1px solid ${INK_4}66`,
        borderRadius: 14,
        padding: 18,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, color: INK_3, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "monospace", display: "flex" }}>
          Top Pair · Routed
        </div>
        <div style={{ fontSize: 10, color: GREEN, fontFamily: "monospace", display: "flex" }}>
          +2.41%
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <CoinDot label="ETH" color={CYAN} />
        <span style={{ fontSize: 20, color: INK_3, display: "flex" }}>/</span>
        <CoinDot label="USDC" color={GREEN} />
        <span style={{ flex: 1, display: "flex" }} />
        <div style={{ fontSize: 22, fontWeight: 800, color: INK, fontVariantNumeric: "tabular-nums", display: "flex" }}>
          $3,421.50
        </div>
      </div>
      {/* Fake spark/bar row */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 38, marginTop: 4 }}>
        {[18, 26, 14, 32, 22, 30, 24, 36, 30, 33, 28, 38, 34, 30, 32, 36, 33, 38, 35, 36].map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: h,
              background: i > 12 ? CYAN : `${CYAN}66`,
              borderRadius: 2,
              display: "flex",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ChainCard() {
  const rows: { name: string; pct: string; color: string; width: number }[] = [
    { name: "Ethereum", pct: "38%", color: CYAN,   width: 100 },
    { name: "Base",     pct: "21%", color: VIOLET, width: 55  },
    { name: "Arbitrum", pct: "17%", color: GREEN,  width: 44  },
    { name: "BSC",      pct: "12%", color: GOLD,   width: 31  },
    { name: "Solana",   pct: "8%",  color: RED,    width: 21  },
  ];
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: `${BG_2}cc`,
        border: `1px solid ${INK_4}66`,
        borderRadius: 14,
        padding: 18,
        gap: 10,
      }}
    >
      <div style={{ fontSize: 10, color: INK_3, letterSpacing: 2.5, textTransform: "uppercase", fontFamily: "monospace", display: "flex" }}>
        Chain Mix · 24h
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
        {rows.map((r) => (
          <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: r.color, display: "flex" }} />
            <div style={{ fontSize: 13, color: INK, flex: 1, display: "flex" }}>{r.name}</div>
            <div style={{ width: 110, height: 4, background: `${INK_4}55`, borderRadius: 2, display: "flex" }}>
              <div style={{ width: r.width, height: 4, background: r.color, borderRadius: 2, display: "flex" }} />
            </div>
            <div style={{ fontSize: 11, color: INK_2, fontFamily: "monospace", width: 36, textAlign: "right", display: "flex", justifyContent: "flex-end" }}>
              {r.pct}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pictograms (CSS-only — satori can't load icon fonts or emojis) ────

type PictoKind = "swap" | "card" | "bridge" | "chart" | "wallet" | "bars" | "sparks";

function Picto({ kind, color }: { kind: PictoKind; color: string }) {
  switch (kind) {
    case "swap":   return <SwapPicto   color={color} />;
    case "card":   return <CardPicto   color={color} />;
    case "bridge": return <BridgePicto color={color} />;
    case "chart":  return <ChartPicto  color={color} />;
    case "wallet": return <WalletPicto color={color} />;
    case "bars":   return <BarsPicto   color={color} />;
    case "sparks": return <SparksPicto color={color} />;
  }
}

function SwapPicto({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center" }}>
      <div style={{ width: 12, height: 2, background: color, borderRadius: 1, display: "flex" }} />
      <div style={{ width: 12, height: 2, background: color, borderRadius: 1, display: "flex" }} />
    </div>
  );
}
function CardPicto({ color }: { color: string }) {
  return (
    <div style={{ width: 14, height: 10, border: `1.5px solid ${color}`, borderRadius: 2, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ width: 14, height: 2, background: color, display: "flex" }} />
    </div>
  );
}
function BridgePicto({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 1 }}>
      <div style={{ width: 4, height: 4, borderRadius: "50%", border: `1.5px solid ${color}`, display: "flex" }} />
      <div style={{ width: 6, height: 1.5, background: color, display: "flex" }} />
      <div style={{ width: 4, height: 4, borderRadius: "50%", border: `1.5px solid ${color}`, display: "flex" }} />
    </div>
  );
}
function ChartPicto({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
      <div style={{ width: 2, height: 6,  background: color, display: "flex" }} />
      <div style={{ width: 2, height: 10, background: color, display: "flex" }} />
      <div style={{ width: 2, height: 4,  background: color, display: "flex" }} />
      <div style={{ width: 2, height: 12, background: color, display: "flex" }} />
    </div>
  );
}
function WalletPicto({ color }: { color: string }) {
  return (
    <div style={{ width: 14, height: 10, border: `1.5px solid ${color}`, borderRadius: 2, display: "flex", justifyContent: "flex-end", alignItems: "center", paddingRight: 2 }}>
      <div style={{ width: 3, height: 3, borderRadius: "50%", background: color, display: "flex" }} />
    </div>
  );
}
function BarsPicto({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5 }}>
      <div style={{ width: 2.5, height: 5,  background: color, display: "flex" }} />
      <div style={{ width: 2.5, height: 9,  background: color, display: "flex" }} />
      <div style={{ width: 2.5, height: 7,  background: color, display: "flex" }} />
      <div style={{ width: 2.5, height: 12, background: color, display: "flex" }} />
    </div>
  );
}
function SparksPicto({ color }: { color: string }) {
  // Simple 4-point starlet shape using rotated diamond plus a dot
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", width: 14, height: 14 }}>
      <div style={{ width: 10, height: 2, background: color, borderRadius: 1, position: "absolute", display: "flex" }} />
      <div style={{ width: 2, height: 10, background: color, borderRadius: 1, position: "absolute", display: "flex" }} />
    </div>
  );
}

function CoinDot({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: `${color}22`,
        border: `1px solid ${color}66`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        color,
        fontWeight: 800,
        fontFamily: "monospace",
      }}>
        {label.slice(0, 2)}
      </div>
      <div style={{ fontSize: 14, color: INK, fontWeight: 700, display: "flex" }}>
        {label}
      </div>
    </div>
  );
}
