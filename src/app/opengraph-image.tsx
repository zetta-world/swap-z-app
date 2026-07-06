import { ImageResponse } from "next/og";

/**
 * Launch-poster OG card — the Yggdrasil Z emblem BIG, with the wordmark and
 * tagline beside it. This is what WhatsApp / Telegram / Twitter show when the
 * link is shared, so it reads as a brand poster, not a UI screenshot (the
 * previous dashboard-mock design lives in git history if we want it back).
 *
 * 1200×630, Edge-rendered. Satori supports only flexbox + inline styles.
 * No external font load — system stack, cold-start <100ms.
 */
export const runtime = "edge";

export const alt = "Z-SWAP — The Liquidity Nexus · multi-chain DEX with ZION AI";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CYAN   = "#00E8FF";
const VIOLET = "#9F5FFF";
const GOLD   = "#F2C879";
const INK    = "#E6E9F5";
const INK_2  = "#A5ADC4";
const INK_3  = "#6C7590";
const BG     = "#02030A";

const CHIPS = ["10+ CHAINS", "ZION AI", "NON-CUSTODIAL", "SOLANA · EVM"];

export default async function OG() {
  // The real Yggdrasil Z emblem (512px, transparent) — Satori accepts the raw
  // ArrayBuffer as an <img> src.
  const logo = await fetch(new URL("./og-logo.png", import.meta.url)).then((r) => r.arrayBuffer());

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          background: BG,
          color: INK,
          fontFamily: "system-ui, -apple-system, sans-serif",
          position: "relative",
        }}
      >
        {/* cosmic glows */}
        <div style={{ position: "absolute", left: -140, top: -160, width: 620, height: 620, borderRadius: 9999, background: "radial-gradient(circle, rgba(0,232,255,0.16) 0%, rgba(0,232,255,0) 65%)", display: "flex" }} />
        <div style={{ position: "absolute", left: 120, bottom: -220, width: 640, height: 640, borderRadius: 9999, background: "radial-gradient(circle, rgba(159,95,255,0.18) 0%, rgba(159,95,255,0) 65%)", display: "flex" }} />
        <div style={{ position: "absolute", right: -180, top: -120, width: 560, height: 560, borderRadius: 9999, background: "radial-gradient(circle, rgba(242,200,121,0.10) 0%, rgba(242,200,121,0) 65%)", display: "flex" }} />

        {/* faint star field */}
        {[[90, 80], [220, 480], [420, 120], [700, 60], [980, 140], [1100, 420], [860, 540], [560, 560]].map(([x, y], i) => (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: 4, height: 4, borderRadius: 9999, background: i % 3 === 0 ? CYAN : i % 3 === 1 ? VIOLET : GOLD, opacity: 0.55, display: "flex" }} />
        ))}

        {/* THE EMBLEM — big, glowing, left */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 520, height: "100%", position: "relative" }}>
          <div style={{ position: "absolute", width: 470, height: 470, borderRadius: 9999, background: "radial-gradient(circle, rgba(159,95,255,0.28) 0%, rgba(0,232,255,0.10) 45%, rgba(0,0,0,0) 70%)", display: "flex" }} />
          {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
          <img src={logo as unknown as string} width={430} height={430} style={{ objectFit: "contain" }} />
        </div>

        {/* Wordmark + tagline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, paddingRight: 70, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 20, letterSpacing: 6, color: INK_3, textTransform: "uppercase" }}>
            <div style={{ width: 9, height: 9, borderRadius: 9999, background: "#22D27E", display: "flex" }} />
            ZETTA ECOSYSTEM · LIVE
          </div>

          <div style={{ fontSize: 92, fontWeight: 900, letterSpacing: -2, color: INK, display: "flex", lineHeight: 1 }}>
            Z-SWAP
          </div>

          <div
            style={{
              fontSize: 44,
              fontWeight: 800,
              letterSpacing: -1,
              backgroundImage: `linear-gradient(120deg, ${CYAN} 0%, ${VIOLET} 55%, ${GOLD} 100%)`,
              backgroundClip: "text",
              color: "transparent",
              display: "flex",
              lineHeight: 1.1,
            }}
          >
            The Liquidity Nexus
          </div>

          <div style={{ fontSize: 23, color: INK_2, display: "flex", lineHeight: 1.45, maxWidth: 560 }}>
            Swap multi-chain com IA de trading, segurança pré-trade e autopilot — sem custódia, sem atrito.
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            {CHIPS.map((c, i) => (
              <div key={c} style={{
                display: "flex", padding: "8px 16px", borderRadius: 9999, fontSize: 16, letterSpacing: 1.5,
                color: i === 1 ? GOLD : INK_2,
                border: `1px solid ${i === 1 ? "rgba(242,200,121,0.45)" : "rgba(108,117,144,0.35)"}`,
                background: i === 1 ? "rgba(242,200,121,0.08)" : "rgba(17,22,42,0.6)",
              }}>
                {c}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
