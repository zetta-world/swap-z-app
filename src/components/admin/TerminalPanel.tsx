"use client";

import type { ReactNode } from "react";
import type { ModuleId } from "@/lib/admin/modules";
import { useAdminLayout } from "@/lib/store/admin-layout";

type Props = {
  id:       ModuleId;
  title:    string;
  subtitle: string;
  icon:     string;
  source?:  string;
  fresh?:   string;
  children: ReactNode;
};

export default function TerminalPanel({
  id, title, subtitle, icon, source, fresh, children,
}: Props) {
  const { toggleModule } = useAdminLayout();

  return (
    <div className="adm-panel">
      <div className="adm-panel-header">
        {/* macOS-style traffic lights */}
        <div className="adm-panel-dots" aria-hidden>
          <button
            className="adm-panel-dot adm-panel-dot-close"
            title="Disable panel"
            onClick={() => toggleModule(id)}
            aria-label={`Disable ${title} panel`}
          />
          <span className="adm-panel-dot adm-panel-dot-min" />
          <span className="adm-panel-dot adm-panel-dot-max" />
        </div>

        <span className="adm-panel-icon" aria-hidden>{icon}</span>
        <span className="adm-panel-title">{title}</span>
        <span className="adm-panel-subtitle">{subtitle}</span>

        {source && (
          <span className="adm-source-badge" title={`Source: ${source}`}>
            {fresh ? `${source} · ${fresh}` : source}
          </span>
        )}
      </div>
      <div className="adm-panel-body">
        {children}
      </div>
    </div>
  );
}
