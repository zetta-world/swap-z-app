"use client";

import type { ReactNode } from "react";
import type { ModuleId } from "@/lib/admin/modules";
import { useAdminLayout } from "@/lib/store/admin-layout";

type Props = {
  id:          ModuleId;
  title:       string;
  subtitle:    string;
  icon:        string;
  source?:     string;
  secondsAgo?: number;
  refreshing?: boolean;
  onRefresh?:  () => void;
  children:    ReactNode;
};

export default function TerminalPanel({
  id, title, subtitle, icon, source, secondsAgo, refreshing, onRefresh, children,
}: Props) {
  const { toggleModule } = useAdminLayout();

  const freshLabel = secondsAgo !== undefined
    ? secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`
    : undefined;

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

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {source && (
            <span className="adm-source-badge">
              {source}
            </span>
          )}
          {freshLabel && (
            <span style={{
              fontSize: 8,
              color: refreshing ? "var(--adm-green)" : "var(--adm-ink-4)",
              letterSpacing: "0.1em",
              transition: "color 300ms",
            }}>
              {refreshing ? "↻" : freshLabel}
            </span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh panel"
              style={{
                background: "transparent",
                border: "none",
                padding: "2px 4px",
                cursor: refreshing ? "default" : "pointer",
                color: refreshing ? "var(--adm-ink-4)" : "var(--adm-ink-3)",
                fontSize: 11,
                lineHeight: 1,
                transition: "color 120ms",
              }}
            >
              ↻
            </button>
          )}
        </div>
      </div>
      <div className="adm-panel-body">
        {children}
      </div>
    </div>
  );
}
