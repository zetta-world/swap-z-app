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
      // Reconcile newly-registered modules into a persisted layout: any module
      // absent from the saved `order` is brand-new, so append it (and enable it
      // if it's default-on). Modules the user explicitly disabled stay disabled.
      merge: (persisted, current) => {
        const p = persisted as { enabled?: Iterable<ModuleId>; order?: ModuleId[]; cmdOpen?: boolean } | undefined;
        if (!p) return current;
        const persistedOrder = Array.isArray(p.order) ? p.order : [];
        const enabled = new Set<ModuleId>(p.enabled ? [...p.enabled] : []);
        const order = [...persistedOrder];
        for (const m of MODULE_REGISTRY) {
          if (!persistedOrder.includes(m.id)) {
            order.push(m.id);
            if (m.defaultEnabled) enabled.add(m.id);
          }
        }
        return { ...current, ...p, enabled, order, cmdOpen: false };
      },
    },
  ),
);
