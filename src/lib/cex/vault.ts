"use client";

import { create } from "zustand";
import type { CexCredentials, CexId } from "./types";

/**
 * In-memory CEX vault — holds decrypted credentials AFTER the user
 * has unlocked them in CexPortfolioRollup or CexConsole, so the ZION
 * autopilot and any future cross-page surface can fire orders without
 * forcing the user to re-enter the passphrase.
 *
 * Threat model:
 *   - Memory-only. Never persisted. A page reload re-locks.
 *   - Auto-lock at 30 min of inactivity, mirroring the per-component
 *     timers that already existed. Components and the autopilot bump
 *     the activity timestamp on use.
 *   - Lock is idempotent + safe to call from anywhere.
 *
 * Existing unlock flows are unchanged. Components that opt in by
 * calling setUnlocked / lock also expose their decrypted creds to the
 * vault; older paths that don't simply don't enable autopilot.
 */

const AUTO_LOCK_MS = 8 * 60 * 60_000; // 8 hours — only re-locks on long inactivity

interface VaultState {
  creds:       Partial<Record<CexId, CexCredentials>> | null;
  unlockedAt:  number | null;
  lastTouched: number;

  setUnlocked: (creds: Partial<Record<CexId, CexCredentials>>) => void;
  touch:       () => void;
  lock:        () => void;
  /**
   * ⚠⚠ ESQUECER UMA CORRETORA SÓ — achado A15 da auditoria externa.
   *
   * "Desconectar" no painel removia a chave do keystore cifrado do navegador e
   * NÃO tocava aqui. Estas credenciais estão DECIFRADAS em memória e o autopilot
   * lê `getActive()`: o robô seguia negociando naquela corretora até o recarregar
   * da página ou as 8 horas de auto-lock.
   *
   * ⚠️ É POR CORRETORA, não `lock()`: desconectar a Binance não pode trancar a
   * Bybit e obrigar o dono a redigitar a senha por causa de outra conta.
   */
  esquecer:    (id: CexId) => void;
  /** Returns the creds IF unlocked AND not expired; locks + returns null otherwise. */
  getActive:   () => Partial<Record<CexId, CexCredentials>> | null;
}

export const useCexVault = create<VaultState>((set, get) => ({
  creds:       null,
  unlockedAt:  null,
  lastTouched: 0,

  setUnlocked: (creds) => set({
    creds,
    unlockedAt:  Date.now(),
    lastTouched: Date.now(),
  }),

  touch: () => set({ lastTouched: Date.now() }),

  lock: () => set({ creds: null, unlockedAt: null, lastTouched: 0 }),

  esquecer: (id) => set((st) => {
    if (!st.creds) return st;
    const resto = { ...st.creds };
    delete resto[id];
    // Sem nenhuma corretora sobrando, o cofre fica vazio de verdade — e não
    // um objeto vazio que `getActive()` devolveria como "destrancado".
    return Object.keys(resto).length === 0
      ? { creds: null, unlockedAt: null, lastTouched: 0 }
      : { creds: resto };
  }),

  getActive: () => {
    const { creds, lastTouched } = get();
    if (!creds) return null;
    if (Date.now() - lastTouched > AUTO_LOCK_MS) {
      set({ creds: null, unlockedAt: null, lastTouched: 0 });
      return null;
    }
    return creds;
  },
}));
