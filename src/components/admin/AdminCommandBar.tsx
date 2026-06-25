"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useAdminLayout } from "@/lib/store/admin-layout";
import { MODULE_REGISTRY, type ModuleId } from "@/lib/admin/modules";

export default function AdminCommandBar() {
  const { cmdOpen, setCmdOpen, enabled, toggleModule } = useAdminLayout();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = MODULE_REGISTRY.filter((m) =>
    query
      ? m.title.toLowerCase().includes(query.toLowerCase()) ||
        m.subtitle.toLowerCase().includes(query.toLowerCase())
      : true,
  );

  useEffect(() => {
    if (cmdOpen) {
      setQuery("");
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [cmdOpen]);

  const commit = useCallback(
    (id: ModuleId) => {
      toggleModule(id);
      setCmdOpen(false);
    },
    [toggleModule, setCmdOpen],
  );

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[activeIdx]) {
      commit(items[activeIdx].id);
    } else if (e.key === "Escape") {
      setCmdOpen(false);
    }
  }

  if (!cmdOpen) return null;

  return (
    <div
      className="adm-cmdbar-backdrop"
      onClick={(e) => e.target === e.currentTarget && setCmdOpen(false)}
      role="dialog"
      aria-label="Command bar"
      aria-modal
    >
      <div className="adm-cmdbar">
        <input
          ref={inputRef}
          className="adm-cmdbar-input"
          placeholder="Toggle panel… (type to filter)"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="adm-cmdbar-list" role="listbox">
          {items.map((m, i) => (
            <div
              key={m.id}
              className="adm-cmdbar-item"
              data-active={i === activeIdx ? "true" : "false"}
              role="option"
              aria-selected={i === activeIdx}
              onClick={() => commit(m.id)}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className="adm-cmdbar-item-icon">{m.icon}</span>
              <span className="adm-cmdbar-item-label">{m.title}</span>
              <span className="adm-cmdbar-item-hint">{m.subtitle}</span>
              <span className="adm-cmdbar-item-check">
                {enabled.has(m.id) ? "●" : "○"}
              </span>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: "12px 16px", fontSize: 10, color: "var(--adm-ink-3)" }}>
              No panels match.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
