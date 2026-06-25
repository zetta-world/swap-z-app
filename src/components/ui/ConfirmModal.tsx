"use client";

/**
 * Lean replacement for native window.confirm().
 *
 * Usage:
 *   const confirm = useConfirm();
 *   …
 *   if (await confirm(t("some.key"))) { doDestructiveThing(); }
 *
 * The hook returns a stable function that opens the modal and resolves to
 * `true` (confirmed) or `false` (cancelled / dismissed). Only one confirm
 * dialog can be open at a time — a second call while one is open will cancel
 * the first.
 */

import { useCallback, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/cn";

interface ConfirmState {
  open:    boolean;
  message: string;
  resolve: ((v: boolean) => void) | null;
}

const INITIAL: ConfirmState = { open: false, message: "", resolve: null };

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>(INITIAL);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    // Cancel any pending confirm
    resolveRef.current?.(false);
    return new Promise<boolean>((res) => {
      resolveRef.current = res;
      setState({ open: true, message, resolve: res });
    });
  }, []);

  const settle = useCallback((v: boolean) => {
    resolveRef.current?.(v);
    resolveRef.current = null;
    setState(INITIAL);
  }, []);

  const modal = (
    <ConfirmModal
      open={state.open}
      message={state.message}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, modal };
}

function ConfirmModal({
  open, message, onConfirm, onCancel,
}: {
  open:      boolean;
  message:   string;
  onConfirm: () => void;
  onCancel:  () => void;
}) {
  const t = useT();

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <div className="fixed inset-0 z-[201] flex items-center justify-center p-4">
          <AnimatePresence>
            {open && (
              <Dialog.Content asChild>
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full max-w-sm rounded-2xl border border-white/10 bg-bg-1 glass-pane p-5 shadow-card"
                >
                  <div className="flex items-start gap-3 mb-5">
                    <div className="w-9 h-9 rounded-xl bg-gold/10 border border-gold/30 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="w-4 h-4 text-gold" />
                    </div>
                    <Dialog.Description className="font-sans text-sm text-ink-2 leading-relaxed pt-1">
                      {message}
                    </Dialog.Description>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      type="button"
                      onClick={onCancel}
                      className={cn(
                        "px-4 py-2 rounded-lg border border-white/10 bg-white/[0.03]",
                        "font-mono text-[11px] tracking-widest uppercase text-ink-2 hover:bg-white/[0.06] transition-colors",
                      )}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={onConfirm}
                      className={cn(
                        "px-4 py-2 rounded-lg border border-gold/40 bg-gold/15",
                        "font-mono text-[11px] tracking-widest uppercase text-gold hover:bg-gold/25 transition-colors",
                      )}
                    >
                      {t("common.confirm")}
                    </button>
                  </div>
                </motion.div>
              </Dialog.Content>
            )}
          </AnimatePresence>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
