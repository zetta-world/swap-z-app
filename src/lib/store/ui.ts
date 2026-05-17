import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AppMode = "standard" | "pro" | "privacy";
export type AppLang = "en" | "pt" | "es" | "zh";

interface UIState {
  mode: AppMode;
  lang: AppLang;
  zionOpen: boolean;
  commandOpen: boolean;
  sidebarCollapsed: boolean;

  setMode: (m: AppMode) => void;
  setLang: (l: AppLang) => void;
  toggleZion: () => void;
  setZion: (open: boolean) => void;
  setCommand: (open: boolean) => void;
  toggleCommand: () => void;
  toggleSidebar: () => void;
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      mode: "standard",
      lang: "en",
      zionOpen: false,
      commandOpen: false,
      sidebarCollapsed: false,

      setMode:         (mode)  => set({ mode }),
      setLang:         (lang)  => set({ lang }),
      toggleZion:      ()      => set({ zionOpen: !get().zionOpen }),
      setZion:         (open)  => set({ zionOpen: open }),
      setCommand:      (open)  => set({ commandOpen: open }),
      toggleCommand:   ()      => set({ commandOpen: !get().commandOpen }),
      toggleSidebar:   ()      => set({ sidebarCollapsed: !get().sidebarCollapsed }),
    }),
    {
      name: "zswap-ui",
      partialize: (s) => ({ mode: s.mode, lang: s.lang, sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);
