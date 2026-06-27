"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useRef, type ReactNode } from "react";

/**
 * Route-level page transition wrapper. A `<motion.div>` keyed by the current
 * pathname: when the route changes React remounts it, so the new page fades
 * in (8px translateY + 200ms ease-out).
 *
 * IMPORTANT — do NOT wrap this in `AnimatePresence mode="wait"`. With the App
 * Router, `mode="wait"` holds the OUTGOING page during its exit animation
 * while Next has already swapped `children` to the new page; the new page
 * can fail to mount and the route renders BLANK until a hard refresh (whose
 * SSR pass paints it). That was the "blank screen until I reload" bug across
 * every area. A plain keyed motion.div always mounts the new page — there is
 * no "wait" state that can strand it — so the entrance animation stays but
 * the blank-page failure mode is gone. We drop the exit animation (the old
 * page just unmounts), which is imperceptible behind a 200ms fade-in.
 *
 * A first-render guard keeps the very first paint (full load / hard refresh)
 * animation-free, matching the old `initial={false}` behaviour.
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const firstRender = useRef(true);
  const isFirst = firstRender.current;
  firstRender.current = false;

  return (
    <motion.div
      key={pathname}
      initial={isFirst ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      style={{ minHeight: "100%" }}
    >
      {children}
    </motion.div>
  );
}
