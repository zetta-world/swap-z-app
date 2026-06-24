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
  /** When true the paid-tier visual theme (god ambient, accent colour, data-tier)
   *  is suppressed even for authenticated paid members. Lets power users revert
   *  to the neutral dark UI without downgrading their plan. */
  disableTierTheme: boolean;

  setMode: (m: AppMode) => void;
  setLang: (l: AppLang) => void;
  toggleZion: () => void;
  setZion: (open: boolean) => void;
  setCommand: (open: boolean) => void;
  toggleCommand: () => void;
  toggleSidebar: () => void;
  setDisableTierTheme: (v: boolean) => void;
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

      setMode:             (mode)  => set({ mode }),
      setLang:             (lang)  => set({ lang }),
      toggleZion:          ()      => set({ zionOpen: !get().zionOpen }),
      setZion:             (open)  => set({ zionOpen: open }),
      setCommand:          (open)  => set({ commandOpen: open }),
      toggleCommand:       ()      => set({ commandOpen: !get().commandOpen }),
      toggleSidebar:       ()      => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setDisableTierTheme: (v)     => set({ disableTierTheme: v }),
    }),
    {
      name: "zswap-ui",
      partialize: (s) => ({
        mode: s.mode, lang: s.lang,
        sidebarCollapsed: s.sidebarCollapsed,
        disableTierTheme: s.disableTierTheme,
      }),
    },
  ),
);
