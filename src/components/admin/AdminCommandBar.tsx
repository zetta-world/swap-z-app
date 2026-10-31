"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAdminLayout } from "@/lib/store/admin-layout";
import { MODULE_REGISTRY, type ModuleId } from "@/lib/admin/modules";
import { areaDoModulo } from "@/lib/admin/areas";

/** Busca sem acento e sem caixa: "auditoria" acha "AUDITORIA", "metrica" acha "métrica". */
const normal = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * ⌘K NAVEGA (R3, Admin CC 2.0). Antes Enter/clique LIGAVA/DESLIGAVA o painel no
 * layout local — sem efeito visível fora de `?all=1`, e o operador achava que a
 * busca "não funcionava". Agora: Enter/clique abre a tela do painel; Shift+Enter
 * mantém o comportamento antigo (ligar/desligar na grade).
 */
export default function AdminCommandBar() {
  const { cmdOpen, setCmdOpen, enabled, toggleModule } = useAdminLayout();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const q = normal(query.trim());
  const items = MODULE_REGISTRY.filter((m) =>
    !q || normal(`${m.title} ${m.subtitle} ${m.id} ${areaDoModulo(m.id) ?? ""}`).includes(q),
  );

  useEffect(() => {
    if (cmdOpen) {
      setQuery("");
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [cmdOpen]);

  const commit = useCallback(
    (id: ModuleId, alternar = false) => {
      const area = areaDoModulo(id);
      if (alternar || !area) toggleModule(id);
      else router.push(`/admin/area/${area}/${id}`);
      setCmdOpen(false);
    },
    [toggleModule, setCmdOpen, router],
  );

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && items[activeIdx]) {
      commit(items[activeIdx].id, e.shiftKey);
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
          placeholder="Ir para painel… (Enter abre · Shift+Enter liga/desliga na grade)"
          aria-label="Buscar painel do admin"
          role="combobox"
          aria-expanded="true"
          aria-controls="adm-cmdbar-lista"
          aria-activedescendant={items[activeIdx] ? `adm-cmd-${items[activeIdx].id}` : undefined}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
          onKeyDown={onKey}
          spellCheck={false}
          autoComplete="off"
        />
        <div className="adm-cmdbar-list" role="listbox" id="adm-cmdbar-lista" aria-label="Painéis">
          {items.map((m, i) => (
            <div
              key={m.id}
              id={`adm-cmd-${m.id}`}
              className="adm-cmdbar-item"
              data-active={i === activeIdx ? "true" : "false"}
              role="option"
              aria-selected={i === activeIdx}
              onClick={(e) => commit(m.id, e.shiftKey)}
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
            <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--adm-ink-3)" }}>
              Nenhum painel encontrado.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
