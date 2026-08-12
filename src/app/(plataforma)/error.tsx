"use client";

import RouteErrorFallback from "@/components/ui/RouteErrorFallback";

/**
 * Top-level error boundary. Next.js's App Router invokes this whenever
 * any nested page or layout throws and there's no closer `error.tsx`.
 * The topbar + sidebar remain mounted (this only replaces the page
 * body), so the user still has nav.
 */
export default function GlobalRouteError({
  error, reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorFallback error={error} reset={reset} />;
}
