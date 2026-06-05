import Skeleton, { SkeletonCard } from "@/components/ui/Skeleton";

/**
 * Top-level App Router loading boundary. Renders while any nested
 * server component is suspending and there's no closer `loading.tsx`.
 *
 * Keeps the topbar + sidebar (they live in the root layout, which
 * isn't replaced) and just paints a calm shimmer skeleton in the
 * `<main>` slot — never a white flash.
 */
export default function Loading() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-25 pointer-events-none" />
      <div className="absolute top-1/4 right-1/4 w-[420px] h-[420px] rounded-full bg-cyan/8 blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-10 space-y-5">
        <div className="space-y-3">
          <Skeleton w="w-32" h="h-3" />
          <Skeleton w="w-3/4" h="h-9" rounded="lg" />
          <Skeleton w="w-1/2" h="h-3" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Skeleton className="h-20" rounded="lg" />
          <Skeleton className="h-20" rounded="lg" />
          <Skeleton className="h-20" rounded="lg" />
          <Skeleton className="h-20" rounded="lg" />
        </div>
        <SkeletonCard lines={4} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}
