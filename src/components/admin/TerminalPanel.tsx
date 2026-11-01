"use client";

import { useEffect, useState, type ReactNode } from "react";
import { idadeEmSegundos, rotuloDeFrescor } from "@/lib/admin/frescor";
import type { ModuleId } from "@/lib/admin/modules";
import { useAdminLayout } from "@/lib/store/admin-layout";

type Props = {
  id:          ModuleId;
  title:       string;
  subtitle:    string;
  icon:        string;
  source?:     string;
  secondsAgo?: number;
  /**
   * R3: quando o dado foi LIDO no servidor (o `fetchedAt` da resposta). Tem precedência sobre
   * `secondsAgo`: o rótulo diz a idade do DADO, não da última tentativa. `null` = sem dado.
   */
  fetchedAt?:  string | null;
  refreshing?: boolean;
  onRefresh?:  () => void;
  children:    ReactNode;
};

export default function TerminalPanel({
  id, title, subtitle, icon, source, secondsAgo, fetchedAt, refreshing, onRefresh, children,
}: Props) {
  const { toggleModule } = useAdminLayout();
  const [agora, setAgora] = useState(() => Date.now());
  const usaFetchedAt = fetchedAt !== undefined;
  useEffect(() => {
    if (!usaFetchedAt) return;
    const t = setInterval(() => { if (!document.hidden) setAgora(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, [usaFetchedAt]);

  const freshLabel = usaFetchedAt
    ? rotuloDeFrescor(idadeEmSegundos(fetchedAt, agora)) ?? "sem dado"
    : secondsAgo !== undefined
      ? rotuloDeFrescor(secondsAgo) ?? undefined
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
        {/* h2 (R3): leitor de tela navega pelos painéis por cabeçalho; o visual é o mesmo. */}
        <h2 className="adm-panel-title" style={{ margin: 0 }}>{title}</h2>
        <span className="adm-panel-subtitle">{subtitle}</span>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {source && (
            <span className="adm-source-badge">
              {source}
            </span>
          )}
          {freshLabel && (
            <span title={usaFetchedAt && fetchedAt ? `dado lido em ${fetchedAt}` : undefined} style={{
              fontSize: 11,
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
                fontSize: 14,
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
