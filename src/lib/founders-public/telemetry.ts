export const FOUNDERS_PUBLIC_EVENTS = [
  "founders_page_view", "tier_view", "tier_compare", "faq_open", "faq_search",
  "community_click", "platform_click", "price_view", "sale_mechanics_view",
] as const;

export type FoundersPublicEvent = (typeof FOUNDERS_PUBLIC_EVENTS)[number];
const EVENT_SET = new Set<string>(FOUNDERS_PUBLIC_EVENTS);
const SAFE_ID = /^[a-z0-9_-]{1,80}$/;
const TIER = new Set(["free", "pro", "trader", "pilot"]);

export interface FoundersPublicEventPayload {
  event: FoundersPublicEvent;
  path: "/founders-pass";
  meta?: {
    locale?: "en" | "pt" | "es" | "zh";
    tier?: "free" | "pro" | "trader" | "pilot";
    faq?: string;
    category?: string;
    queryLength?: number;
    resultCount?: number;
  };
}

/** Closed, PII-free public analytics envelope. Search text is never accepted. */
export function validateFoundersPublicEvent(value: unknown): FoundersPublicEventPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!EVENT_SET.has(String(input.event)) || input.path !== "/founders-pass") return null;
  const rawMeta = input.meta;
  if (rawMeta === undefined) return { event: input.event as FoundersPublicEvent, path: "/founders-pass" };
  if (!rawMeta || typeof rawMeta !== "object") return null;
  const source = rawMeta as Record<string, unknown>;
  const allowed = new Set(["locale", "tier", "faq", "category", "queryLength", "resultCount"]);
  if (Object.keys(source).some((key) => !allowed.has(key))) return null;
  if (source.locale !== undefined && !["en", "pt", "es", "zh"].includes(String(source.locale))) return null;
  if (source.tier !== undefined && !TIER.has(String(source.tier))) return null;
  for (const key of ["faq", "category"] as const) if (source[key] !== undefined && !(typeof source[key] === "string" && SAFE_ID.test(source[key]))) return null;
  for (const key of ["queryLength", "resultCount"] as const) if (source[key] !== undefined && !(Number.isInteger(source[key]) && (source[key] as number) >= 0 && (source[key] as number) <= 10_000)) return null;
  return { event: input.event as FoundersPublicEvent, path: "/founders-pass", meta: source as FoundersPublicEventPayload["meta"] };
}

export function trackFoundersPublicEvent(event: FoundersPublicEvent, meta?: FoundersPublicEventPayload["meta"]): void {
  if (typeof window === "undefined") return;
  const payload = validateFoundersPublicEvent({ event, path: "/founders-pass", meta });
  if (!payload) return;
  try {
    fetch("/api/beacon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(() => undefined);
  } catch {
    // Analytics never interrupts the public experience.
  }
}
