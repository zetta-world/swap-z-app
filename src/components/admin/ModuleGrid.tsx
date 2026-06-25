"use client";

import { useAdminLayout } from "@/lib/store/admin-layout";
import { MODULE_BY_ID, type ModuleId } from "@/lib/admin/modules";

type PanelMap = Partial<Record<ModuleId, React.ReactNode>>;

export default function ModuleGrid({ panels }: { panels: PanelMap }) {
  const { enabled, order, toggleModule } = useAdminLayout();

  const visible = order.filter((id) => enabled.has(id) && panels[id]);
  const hidden  = order.filter((id) => !enabled.has(id));

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Enabled panels — 2-col grid on wide screens */}
      {visible.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))",
            gap: 12,
          }}
        >
          {visible.map((id) => (
            <div key={id}>{panels[id]}</div>
          ))}
        </div>
      )}

      {/* Hidden modules — compact re-enable strip */}
      {hidden.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="adm-category">Disabled panels</div>
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
