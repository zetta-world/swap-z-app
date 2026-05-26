"use client";

import { useCallback } from "react";
import { useUI } from "@/lib/store/ui";
import { messages, type MessageKey } from "./messages";

/**
 * Interpolates {placeholders} in a translated string.
 *   format("Place {side} order", { side: "BUY" }) → "Place BUY order"
 *
 * Missing variables stay as `{name}` so we notice them during QA.
 */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v === undefined ? `{${key}}` : String(v);
  });
}

/**
 * Look up a key like "swap.titleSwap" through the nested catalog. Returns
 * the key path itself if missing — never a runtime error — so a forgotten
 * translation degrades visibly instead of crashing.
 */
function lookup(catalog: Record<string, unknown>, key: string): string {
  const parts = key.split(".");
  let cur: unknown = catalog;
  for (const p of parts) {
    if (typeof cur !== "object" || cur === null || !(p in (cur as object))) return key;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === "string" ? cur : key;
}

/**
 * React hook that returns a translator function bound to the active
 * language from the UI store. Re-renders the consuming component when
 * the user switches language.
 *
 *   const t = useT();
 *   <h1>{t("swap.titleSwap")}</h1>
 *   <p>{t("zion.proposalsPlural", { n: 3 })}</p>
 *
 * IMPORTANT: the returned function reference is STABLE across renders
 * as long as `lang` doesn't change. This matters because consumers add
 * `t` to useEffect / useCallback dependency arrays — a fresh reference
 * on every render would cause infinite re-fires (and previously hung
 * the ZION drawer when the drawer re-streamed on every render).
 *
 * The MessageKey type gives full autocomplete + compile-time safety on
 * the key names; runtime fallback handles any drift.
 */
export function useT() {
  const lang = useUI((s) => s.lang);
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>): string => {
      const catalog = messages[lang] ?? messages.en;
      return format(lookup(catalog as Record<string, unknown>, key), vars);
    },
    [lang],
  );
}

/**
 * Imperative variant for code that lives outside React (toast helpers,
 * etc). Reads the language directly from the persisted zustand store.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const lang = useUI.getState().lang;
  const catalog = messages[lang] ?? messages.en;
  return format(lookup(catalog as Record<string, unknown>, key), vars);
}

/**
 * Re-export so consumers can keep the import surface tight:
 *   import { useT, type MessageKey } from "@/lib/i18n";
 */
export type { MessageKey };
