import { cn } from "@/lib/cn";

/**
 * Canonical skeleton placeholder — `.shimmer` keyframe from globals.css
 * + rounded border so loading states feel like the same surface as the
 * real content, not a different page.
 *
 * Use SkeletonRow for table/list rows and SkeletonCard for full panels.
 */
export default function Skeleton({
  className, w, h, rounded = "md",
}: {
  className?: string;
  /** Tailwind width class (e.g. "w-24", "w-full"). Default w-full. */
  w?: string;
  /** Tailwind height class (e.g. "h-3"). Default h-3. */
  h?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}) {
  const r = rounded === "full" ? "rounded-full"
          : rounded === "lg"   ? "rounded-lg"
          : rounded === "sm"   ? "rounded-sm"
                               : "rounded-md";
  return (
    <div
      className={cn("shimmer border border-white/5", r, w ?? "w-full", h ?? "h-3", className)}
      aria-hidden="true"
    />
  );
}

/**
 * Single row of a list/table skeleton. Render `count` copies inside a
 * parent that handles spacing.
 */
export function SkeletonList({
  count = 3, rowClassName, gap = 8,
}: {
  count?: number;
  rowClassName?: string;
  /** Gap in px between rows. */
  gap?: number;
}) {
  return (
    <div className="flex flex-col" style={{ gap }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={cn("flex items-center gap-3 px-3 py-2.5", rowClassName)}>
          <Skeleton w="w-8" h="h-8" rounded="full" />
          <Skeleton w="w-40" h="h-3" />
          <Skeleton w="w-16" h="h-3" className="ml-auto" />
        </div>
      ))}
    </div>
  );
}

/**
 * Card-shaped skeleton — uses the same `glass-pane` + rounded-2xl frame
 * as real cards in the app so the loading state slides into the final
 * layout without reflow.
 */
export function SkeletonCard({
  className, lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div className={cn("rounded-2xl border border-white/5 glass-pane p-5 space-y-3", className)}>
      <Skeleton w="w-32" h="h-4" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? "w-2/3" : "w-full"} h="h-3" />
      ))}
    </div>
  );
}
