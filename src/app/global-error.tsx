"use client";

/**
 * Last-resort fallback when even the root layout itself throws (and
 * therefore the providers / sidebar are gone). Must render its own
 * `<html>` and `<body>` tags — Next.js explicitly requires it.
 *
 * Keep the styling minimal and self-contained: no Tailwind preflight
 * is guaranteed here, no theme variables. If the user lands on this
 * screen, the whole shell crashed.
 */
export default function GlobalError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        minHeight: "100vh",
        background: "#0a0a0f",
        color: "#eef2f7",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}>
        <div style={{
          maxWidth: 520,
          width: "100%",
          padding: "1.75rem",
          borderRadius: 16,
          border: "1px solid rgba(255,92,92,0.25)",
          background: "rgba(20,20,28,0.6)",
        }}>
          <h1 style={{ fontSize: 22, margin: "0 0 .5rem", fontWeight: 800 }}>
            Z-SWAP couldn&apos;t boot.
          </h1>
          <p style={{ fontSize: 14, color: "#a7b0c0", lineHeight: 1.5, margin: "0 0 1rem" }}>
            The application shell hit an unexpected error and can&apos;t recover
            on its own. Refresh in a moment; if the problem persists, check
            our status page.
          </p>
          <pre style={{
            fontSize: 11,
            color: "#a7b0c0",
            background: "rgba(255,255,255,0.03)",
            padding: ".75rem",
            borderRadius: 8,
            margin: "0 0 1rem",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {error?.message?.slice(0, 280) || "Unknown error"}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid rgba(0,232,255,0.4)",
                background: "rgba(0,232,255,0.12)",
                color: "#00E8FF",
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
              href="https://status.zettaword.global"
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.03)",
                color: "#eef2f7",
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                textDecoration: "none",
              }}
            >
              Status
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
