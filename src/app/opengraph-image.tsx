import { ImageResponse } from "next/og";

/**
 * Dynamic OpenGraph card — what WhatsApp, Telegram, Discord, Twitter,
 * LinkedIn, iMessage, Slack, and every other modern unfurl-er render
 * when someone shares a swap-z-app.vercel.app link.
 *
 * Industry standard: 1200×630, served at runtime by Vercel's Edge.
 * No static PNG to maintain — brand updates flow automatically.
 *
 * Design choices (premium-tier feel):
 *   - Deep #02030A base with offset cyan + violet aurora blooms
 *   - Big "Z-SWAP" wordmark in display weight with cyan→violet gradient
 *   - One-line value prop below
 *   - Stat strip across the bottom (11 chains · 132 fns · ZION AI · CEX+DEX)
 *   - Subtle hairline rule + monospaced eyebrow for technical credibility
 *
 * No external font load — using system stack with explicit weights so
 * the image cold-starts in <100ms on Edge without bytes-on-fetch.
 */
export const runtime = "edge";

export const alt = "Z-SWAP — The Liquidity Nexus · multi-chain DEX with ZION AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CYAN = "#00E8FF";
const VIOLET = "#9F5FFF";
const GOLD = "#F2C879";
const INK = "#E6E9F5";
const INK_2 = "#A5ADC4";
const INK_3 = "#6C7590";
const BG = "#02030A";
const BG_1 = "#0A0E1B";

export default async function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width:  "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: INK,
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
          padding: "64px",
        }}
      >
        {/* Aurora blooms */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -160,
            width: 540,
            height: 540,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${CYAN}38, transparent 70%)`,
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -180,
            width: 600,
            height: 600,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${VIOLET}44, transparent 70%)`,
          }}
        />
        {/* Subtle hairline atmosphere (full grid not possible: satori
            doesn't render repeated background patterns) */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            height: 1,
            background: `linear-gradient(90deg, transparent, ${INK_3}66, transparent)`,
            display: "flex",
          }}
        />

        {/* Top eyebrow row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          {/* Logo + brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 16,
                background: `linear-gradient(135deg, ${CYAN}, ${VIOLET})`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 40,
                fontWeight: 900,
                color: BG,
                boxShadow: `0 0 60px ${CYAN}44`,
              }}
            >
              Z
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 14, color: INK_3, letterSpacing: 4, textTransform: "uppercase", fontFamily: "monospace" }}>
                ZETTA Ecosystem
              </div>
              <div style={{ fontSize: 20, color: INK, fontWeight: 700, letterSpacing: 1 }}>
                Z-SWAP
              </div>
            </div>
          </div>

          {/* Right eyebrow */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 18px",
              borderRadius: 999,
              border: `1px solid ${GOLD}55`,
              background: `${GOLD}10`,
              fontSize: 14,
              color: GOLD,
              letterSpacing: 3,
              textTransform: "uppercase",
              fontFamily: "monospace",
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: GOLD, display: "flex" }} />
            Premium Liquidity Layer
          </div>
        </div>

        {/* Main title block */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: 88, gap: 18, zIndex: 1 }}>
          <div
            style={{
              fontSize: 132,
              fontWeight: 900,
              letterSpacing: -3,
              lineHeight: 1.0,
              backgroundImage: `linear-gradient(95deg, ${CYAN} 0%, ${INK} 50%, ${VIOLET} 100%)`,
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
            }}
          >
            The Liquidity Nexus
          </div>
          <div
            style={{
              fontSize: 30,
              color: INK_2,
              maxWidth: 980,
              lineHeight: 1.35,
              display: "flex",
            }}
          >
            Multi-chain DEX aggregator with ZION AI advisory, autopilot trading,
            and CEX-bridged arbitrage — built for sovereign liquidity.
          </div>
        </div>

        {/* Spacer */}
        <div style={{ flex: 1, display: "flex" }} />

        {/* Bottom hairline */}
        <div style={{ height: 1, background: `${INK_3}33`, marginBottom: 28, display: "flex" }} />

        {/* Stat strip */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            zIndex: 1,
          }}
        >
          <Stat label="Chains"     value="11+" color={CYAN} />
          <Stat label="Functions"  value="132" color={INK} />
          <Stat label="AI Layer"   value="ZION" color={GOLD} />
          <Stat label="Surface"    value="DEX + CEX" color={VIOLET} />
          <Stat label="Posture"    value="Non-custodial" color={INK} />
        </div>
      </div>
    ),
    { ...size },
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div
        style={{
          fontSize: 13,
          color: "#6C7590",
          letterSpacing: 3,
          textTransform: "uppercase",
          fontFamily: "monospace",
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 800,
          color,
          letterSpacing: -0.5,
          display: "flex",
        }}
      >
        {value}
      </div>
    </div>
  );
}
