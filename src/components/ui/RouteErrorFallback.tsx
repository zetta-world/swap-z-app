"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home, ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Canonical fallback for `error.tsx` route boundaries. Renders a glass
 * pane that matches the rest of the app instead of Next.js's default
 * blank screen. Surfaces:
 *
 * - The error message (sanitised — never the stack).
 * - A "Try again" button wired to Next.js's `reset()`.
 * - A "Back to swap" link as the always-safe exit.
 * - The error digest (if present) so support can correlate it with
 *   server logs.
 *
 * Side effect: posts the error to the browser console once on mount so
 * a developer running locally still sees what blew up.
 */

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
  /** Optional override — defaults to "Something cracked." */
  title?: string;
}

export default function RouteErrorFallback({ error, reset, title }: Props) {
  const t = useT();
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.error("[route-error]", error);
    }
  }, [error]);

  const detail = error?.message?.slice(0, 280) || t("routeError.unknownError");

  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[420px] h-[420px] rounded-full bg-red/10 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-xl mx-auto px-4 py-12 sm:py-20">
        <div className="rounded-2xl border border-red/20 bg-bg-1/60 glass-pane p-6 sm:p-8 space-y-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-red/10 border border-red/30 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-4 h-4 text-red" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display font-extrabold text-xl sm:text-2xl text-ink">
                {title ?? t("routeError.title")}
              </h1>
              <p className="font-sans text-sm text-ink-2 leading-relaxed mt-1.5">
                {t("routeError.body")}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-white/5 bg-bg-2/60 p-3">
            <div className="font-mono text-[9px] text-ink-4 tracking-widest uppercase mb-1">{t("routeError.detail")}</div>
            <p className="font-mono text-[11px] text-ink-2 break-words leading-relaxed">{detail}</p>
            {error.digest && (
              <p className="font-mono text-[9px] text-ink-4 mt-2">
                {t("routeError.digest")} <span className="text-ink-3">{error.digest}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-cyan/40 bg-cyan/15 text-cyan font-mono text-[11px] tracking-widest uppercase hover:bg-cyan/25"
            >
              <RefreshCw className="w-3 h-3" />
              {t("routeError.tryAgain")}
            </button>
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-ink font-mono text-[11px] tracking-widest uppercase hover:bg-white/[0.06]"
            >
              <Home className="w-3 h-3" />
              {t("routeError.backToSwap")}
            </Link>
            <a
              href="https://status.zettaword.global"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03] text-ink-2 font-mono text-[11px] tracking-widest uppercase hover:bg-white/[0.06]"
            >
              {t("routeError.status")}
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
