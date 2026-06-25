"use client";

import { useCallback, useRef, useState } from "react";

type ConfirmState = {
  open:    boolean;
  message: string;
  danger:  boolean;
};

const INITIAL: ConfirmState = { open: false, message: "", danger: false };

/**
 * Terminal-themed confirmation dialog for destructive admin actions.
 * Promise-based like the main-app useConfirm, but styled to match the
 * isolated admin terminal theme (no main-app glass/Radix chrome).
 */
export function useAdminConfirm() {
  const [state, setState] = useState<ConfirmState>(INITIAL);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((message: string, danger = true): Promise<boolean> => {
    resolveRef.current?.(false);
    return new Promise<boolean>((res) => {
      resolveRef.current = res;
      setState({ open: true, message, danger });
    });
  }, []);

  const close = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setState(INITIAL);
  }, []);

  const modal = state.open ? (
    <div
      className="adm-cmdbar-backdrop"
      onClick={(e) => e.target === e.currentTarget && close(false)}
      role="alertdialog"
      aria-modal
    >
      <div
        className="adm-cmdbar"
        style={{
          maxWidth: 420,
          borderColor: state.danger ? "var(--adm-red)" : "var(--adm-gold)",
          boxShadow: state.danger
            ? "var(--adm-glow-red), 0 24px 64px rgba(0,0,0,0.7)"
            : "var(--adm-glow-gold), 0 24px 64px rgba(0,0,0,0.7)",
        }}
      >
        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 18,
              color: state.danger ? "var(--adm-red)" : "var(--adm-gold)",
            }}>
              {state.danger ? "⚠" : "?"}
            </span>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: state.danger ? "var(--adm-red)" : "var(--adm-gold)",
            }}>
              {state.danger ? "Confirm destructive action" : "Confirm"}
            </span>
          </div>
          <p style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: "var(--adm-ink)",
            margin: 0,
          }}>
            {state.message}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <button className="adm-toggle" onClick={() => close(false)}>
              CANCEL
            </button>
            <button
              className={`adm-toggle ${state.danger ? "danger" : "active"}`}
              onClick={() => close(true)}
              autoFocus
            >
              CONFIRM
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, modal };
}
