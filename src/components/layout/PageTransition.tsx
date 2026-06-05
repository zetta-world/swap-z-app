"use client";

import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { type ReactNode } from "react";

/**
 * Route-level page transition wrapper. Wraps `children` with a
 * `<motion.div>` keyed by the current pathname so framer's
 * `AnimatePresence` can fade out the leaving page and slide in the
 * new one (8px translateY + 200ms ease-out).
 *
 * The animation is intentionally subtle — anything more dramatic feels
 * like a redirect on a slow device and obscures the fact that Next.js
 * App Router transitions are already near-instant.
 *
 * `mode="wait"` ensures the outgoing page finishes its exit before
 * the new one mounts, so the two never overlap and stack.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ minHeight: "100%" }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
