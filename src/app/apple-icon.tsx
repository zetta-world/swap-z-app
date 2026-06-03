import { ImageResponse } from "next/og";

/**
 * Apple touch icon — 180x180, what iOS uses when the user "Add to Home
 * Screen"s the PWA and what some sharers (iMessage thumbnails) prefer
 * over OG when the link is to a non-content URL.
 *
 * Keeps the same "Z" gradient mark as the favicon, scaled up with a
 * soft glow so the rounded squircle iOS auto-applies frames it nicely.
 */
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#02030A",
          position: "relative",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Aurora glow */}
        <div
          style={{
            position: "absolute",
            top: -20,
            left: -20,
            width: 220,
            height: 220,
            borderRadius: "50%",
            background: "radial-gradient(closest-side, #00E8FF55, transparent 70%)",
            display: "flex",
          }}
        />
        {/* The mark */}
        <div
          style={{
            width: 132,
            height: 132,
            borderRadius: 28,
            background: "linear-gradient(135deg, #00E8FF 0%, #9F5FFF 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 88,
            fontWeight: 900,
            color: "#02030A",
            boxShadow: "0 0 60px #00E8FF66",
          }}
        >
          Z
        </div>
      </div>
    ),
    { ...size },
  );
}
