import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — the "Z" mark from the topbar logo, rendered to a
 * crisp 32x32 PNG by Vercel's Edge. No favicon.ico to maintain, no
 * blurry rescale on retina taskbars.
 */
export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          fontWeight: 900,
          color: "#02030A",
          background: "linear-gradient(135deg, #00E8FF 0%, #9F5FFF 100%)",
          borderRadius: 8,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Z
      </div>
    ),
    { ...size },
  );
}
