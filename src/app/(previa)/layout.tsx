import type { ReactNode } from "react";

/**
 * The canonical Founder experience owns its full-width marketing navigation.
 * The isolated local simulator uses the same route only behind its server flag.
 * Keep this group free of loading boundaries so route output is deterministic.
 */
export default function FoundersLayout({ children }: { children: ReactNode }) {
  return children;
}
