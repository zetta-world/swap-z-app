import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppMode = "standard" | "pro" | "privacy";
export type AppLang = "en" | "pt" | "es" | "zh";
export type ZionMode = "conservative" | "advanced" | "institutional";

/** User-supplied custom RPC endpoints, keyed by chain id (e.g. "ethereum"). */
export type CustomRpc = Record<string, string>;

interface UIState {
  mode: AppMode;
  lang: AppLang;
  zionOpen: boolean;
  commandOpen: boolean;
  sidebarCollapsed: boolean;
  /** When true the paid-tier visual theme (god ambient, accent colour, data-tier)
   *  is suppressed even for authenticated paid members. Lets power users revert
   *  to the neutral dark UI without downgrading their plan. */
  disableTierTheme: boolean;
  /** ZION advisory posture — persisted so the choice survives reloads. */
  zionMode: ZionMode;
  /** Optional per-chain custom RPC endpoints (persisted). */
  customRpc: CustomRpc;
  /** Global wallet-connect modal flag — lets any surface (e.g. the bridge
   *  wallet chips) open the connector without owning its own modal. */
  walletModalOpen: boolean;

  setMode: (m: AppMode) => void;
  setLang: (l: AppLang) => void;
  toggleZion: () => void;
  setZion: (open: boolean) => void;
  setCommand: (open: boolean) => void;
  toggleCommand: () => void;
  toggleSidebar: () => void;
  setDisableTierTheme: (v: boolean) => void;
  setZionMode: (m: ZionMode) => void;
  setCustomRpc: (chain: string, url: string) => void;
  setWalletModal: (open: boolean) => void;
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      mode: "standard",
      lang: "en",
      zionOpen: false,
      commandOpen: false,
      sidebarCollapsed: false,
      disableTierTheme: false,
      zionMode: "advanced",
      customRpc: {},
      walletModalOpen: false,

      setMode:             (mode)  => set({ mode }),
      setLang:             (lang)  => set({ lang }),
      toggleZion:          ()      => set({ zionOpen: !get().zionOpen }),
      setZion:             (open)  => set({ zionOpen: open }),
      setCommand:          (open)  => set({ commandOpen: open }),
      toggleCommand:       ()      => set({ commandOpen: !get().commandOpen }),
      toggleSidebar:       ()      => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setDisableTierTheme: (v)     => set({ disableTierTheme: v }),
      setZionMode:         (m)     => set({ zionMode: m }),
      setCustomRpc:        (chain, url) => set({ customRpc: { ...get().customRpc, [chain]: url } }),
      setWalletModal:      (open)  => set({ walletModalOpen: open }),
    }),
    {
      name: "zswap-ui",
      partialize: (s) => ({
        mode: s.mode, lang: s.lang,
        sidebarCollapsed: s.sidebarCollapsed,
        disableTierTheme: s.disableTierTheme,
        zionMode: s.zionMode,
        customRpc: s.customRpc,
      }),
    },
  ),
);
