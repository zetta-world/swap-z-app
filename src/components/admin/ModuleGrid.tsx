"use client";

import { useState } from "react";
import { useAdminLayout } from "@/lib/store/admin-layout";
import { MODULE_BY_ID, MODULE_REGISTRY, type ModuleId, type ModuleCategory } from "@/lib/admin/modules";

type PanelMap = Partial<Record<ModuleId, React.ReactNode>>;

const CATEGORIES: { id: ModuleCategory | "all"; label: string }[] = [
  { id: "all",       label: "ALL" },
  { id: "command",   label: "COMMAND" },
  { id: "dashboard", label: "DASHBOARD" },
  { id: "growth",    label: "GROWTH" },
  { id: "finance",   label: "FINANCE" },
  { id: "users",     label: "USERS" },
  { id: "system",    label: "SYSTEM" },
  { id: "controls",  label: "CONTROLS" },
  { id: "logs",      label: "LOGS" },
];

export default function ModuleGrid({ panels }: { panels: PanelMap }) {
  const { enabled, order, toggleModule } = useAdminLayout();
  const [cat, setCat] = useState<ModuleCategory | "all">("all");

  const visible = order.filter((id) => {
    if (!enabled.has(id)) return false;
    if (!panels[id]) return false;
    if (cat !== "all" && MODULE_BY_ID[id]?.category !== cat) return false;
    return true;
  });

  const hidden = order.filter((id) => !enabled.has(id));

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Category filter tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CATEGORIES.map(({ id, label }) => (
          <button
            key={id}
            className={`adm-toggle ${cat === id ? "active" : ""}`}
            onClick={() => setCat(id)}
          >
            {label}
            {id !== "all" && (
              <span style={{ marginLeft: 5, color: "var(--adm-ink-3)", fontSize: 8 }}>
                ({MODULE_REGISTRY.filter((m) => m.category === id && enabled.has(m.id)).length})
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 8, color: "var(--adm-ink-4)", letterSpacing: "0.1em", alignSelf: "center" }}>
          {visible.length} panel{visible.length !== 1 ? "s" : ""} visible
        </span>
      </div>

      {/* Panel grid */}
      {visible.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
            gap: 12,
          }}
        >
          {visible.map((id) => (
            <div key={id}>{panels[id]}</div>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <div style={{
          padding: "40px 0",
          textAlign: "center",
          color: "var(--adm-ink-4)",
          fontSize: 11,
          letterSpacing: "0.15em",
        }}>
          NO PANELS IN THIS CATEGORY
        </div>
      )}

      {/* Disabled modules strip */}
      {hidden.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="adm-category">Disabled panels — click to re-enable</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {hidden.map((id) => {
              const m = MODULE_BY_ID[id];
              return (
                <button
                  key={id}
                  className="adm-toggle"
                  onClick={() => toggleModule(id)}
                  title={m.subtitle}
                >
                  {m.icon} {m.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
