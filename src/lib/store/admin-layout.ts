"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { MODULE_REGISTRY, type ModuleId } from "@/lib/admin/modules";

type AdminLayoutState = {
  enabled:  Set<ModuleId>;
  order:    ModuleId[];
  cmdOpen:  boolean;
  // actions
  toggleModule:  (id: ModuleId) => void;
  reorderModule: (id: ModuleId, newIndex: number) => void;
  setCmdOpen:    (open: boolean) => void;
  resetLayout:   () => void;
};

function defaultEnabled(): Set<ModuleId> {
  return new Set(
    MODULE_REGISTRY.filter((m) => m.defaultEnabled).map((m) => m.id),
  );
}

function defaultOrder(): ModuleId[] {
  return [...MODULE_REGISTRY]
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((m) => m.id);
}

export const useAdminLayout = create<AdminLayoutState>()(
  persist(
    (set) => ({
      enabled:  defaultEnabled(),
      order:    defaultOrder(),
      cmdOpen:  false,

      toggleModule: (id) =>
        set((s) => {
          const next = new Set(s.enabled);
          next.has(id) ? next.delete(id) : next.add(id);
          return { enabled: next };
        }),

      reorderModule: (id, newIndex) =>
        set((s) => {
          const arr = s.order.filter((x) => x !== id);
          arr.splice(newIndex, 0, id);
          return { order: arr };
        }),

      setCmdOpen: (open) => set({ cmdOpen: open }),

      resetLayout: () =>
        set({ enabled: defaultEnabled(), order: defaultOrder() }),
    }),
    {
      name: "admin-layout-v1",
      // Serialize Set as array for JSON
      storage: {
        getItem: (key) => {
          try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (parsed?.state?.enabled && Array.isArray(parsed.state.enabled)) {
              parsed.state.enabled = new Set(parsed.state.enabled);
            }
            return parsed;
          } catch {
            return null;
          }
        },
        setItem: (key, val) => {
          const copy = JSON.parse(JSON.stringify(val, (_k, v) =>
            v instanceof Set ? [...v] : v,
          ));
          localStorage.setItem(key, JSON.stringify(copy));
        },
        removeItem: (key) => localStorage.removeItem(key),
      },
    },
  ),
);
