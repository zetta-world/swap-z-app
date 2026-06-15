"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

interface Props {
  symbol?: string;
  logo?: string;
  color?: string;
  size?: number;
  className?: string;
}

/**
 * Shows a token's logo image with a graceful colored-circle fallback.
 * Accepts the raw token fields so callers don't have to pass the full Token object.
 */
export default function TokenLogo({ symbol, logo, color, size = 24, className }: Props) {
  const [failed, setFailed] = useState(false);

  if (logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt={symbol ?? "token"}
        width={size}
        height={size}
        onError={() => setFailed(true)}
        className={cn("rounded-full object-cover flex-shrink-0", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={cn("rounded-full flex items-center justify-center font-mono font-bold flex-shrink-0", className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.floor(size * 0.36)),
        background: color ? `${color}22` : "rgba(255,255,255,0.07)",
        color: color ?? "#ffffff",
        border: `1px solid ${color ? `${color}55` : "rgba(255,255,255,0.15)"}`,
        lineHeight: 1,
      }}
    >
      {(symbol ?? "?").slice(0, 2).toUpperCase()}
    </span>
  );
}
