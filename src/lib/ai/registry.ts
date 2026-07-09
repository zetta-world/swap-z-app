import { openaiCompatChat, type ChatResult } from "@/lib/ai/provider";

/**
 * Model registry + GEO ROUTING — the hybrid brain.
 *
 * Routes each request to a model by the caller's jurisdiction, DIRECT from each
 * vendor (no OpenRouter):
 *   • China-origin OK (e.g. Brazil, LatAm)  → DeepSeek / Kimi (cheaper)
 *   • US + allies (data-sovereignty)        → Mistral / Llama (Western-origin)
 *
 * All four are OpenAI-compatible, so they share openaiChat with a different
 * base URL. Model ids + base URLs are env-overridable (vendors rev often).
 * Everything is dormant until the matching API key is set.
 */

export type ModelOrigin = "china" | "western";

export interface ProviderConfig {
  id:      string;
  label:   string;
  origin:  ModelOrigin;
  apiKey:  string | undefined; // from env — undefined = not configured
  baseUrl: string;
  model:   string;
  temperature?: number;        // sampling temp override; some models pin it
                               // (kimi-k2.6 only accepts 1). undefined = 0.6.
  signup:  string;             // where to get the API key
}

/** Every direct-from-source provider. */
export function allProviders(): Record<string, ProviderConfig> {
  return {
    deepseek: {
      id: "deepseek", label: "DeepSeek", origin: "china",
      apiKey:  process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      model:   process.env.DEEPSEEK_MODEL   ?? "deepseek-chat",
      signup:  "https://platform.deepseek.com",
    },
    kimi: {
      id: "kimi", label: "Kimi (Moonshot)", origin: "china",
      apiKey:  process.env.KIMI_API_KEY,
      baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
      model:   process.env.KIMI_MODEL   ?? "kimi-k2.6",
      // kimi-k2.6 rejects any temperature != 1 with a 400 (invalid_request).
      temperature: Number(process.env.KIMI_TEMPERATURE ?? 1),
      signup:  "https://platform.moonshot.ai",
    },
    mistral: {
      id: "mistral", label: "Mistral", origin: "western",
      apiKey:  process.env.MISTRAL_API_KEY,
      baseUrl: process.env.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
      model:   process.env.MISTRAL_MODEL   ?? "mistral-large-latest",
      signup:  "https://console.mistral.ai",
    },
    llama: {
      id: "llama", label: "Llama (Meta)", origin: "western",
      apiKey:  process.env.LLAMA_API_KEY,
      baseUrl: process.env.LLAMA_BASE_URL ?? "https://api.llama.com/compat/v1",
      model:   process.env.LLAMA_MODEL   ?? "Llama-4-Maverick-17B-128E-Instruct-FP8",
      signup:  "https://llama.developer.meta.com",
    },
    // xAI (US, Western-origin) — works in BOTH regions. Its real edge is the
    // native real-time X / whale / news firehose (SENTIMENT radar), a separate
    // feature to build (plan D2). Here it's a reasoning option + A/B participant.
    grok: {
      id: "grok", label: "Grok (xAI)", origin: "western",
      apiKey:  process.env.XAI_API_KEY,
      baseUrl: process.env.XAI_BASE_URL ?? "https://api.x.ai/v1",
      model:   process.env.XAI_MODEL   ?? "grok-4.3",
      signup:  "https://console.x.ai",
    },
  };
}

/** Providers that have a key configured (i.e. usable right now). */
export function configuredProviders(): ProviderConfig[] {
  return Object.values(allProviders()).filter((p) => !!p.apiKey);
}

/**
 * Ferrari roles — each specialist in its strongest area. Preference order per
 * role; each overridable via HYBRID_<ROLE> (e.g. HYBRID_BRAIN=mistral). Returns
 * the first CONFIGURED provider for the role, or null.
 *   • brain     — technical / quant reasoning (DeepSeek → Mistral)
 *   • macro     — big-context macro digest (Kimi → DeepSeek)
 *   • sentiment — X / social sentiment, native to Grok (Grok → Mistral)
 * The CEO (synthesis) is Claude Opus, resolved separately in backtest.ts.
 */
export type HybridRole = "brain" | "macro" | "sentiment";
const ROLE_PREFERENCE: Record<HybridRole, string[]> = {
  brain:     ["deepseek", "mistral"],
  macro:     ["kimi", "deepseek"],
  sentiment: ["grok", "mistral"],
};

export function roleProvider(role: HybridRole): ProviderConfig | null {
  const all = allProviders();
  const forced = process.env[`HYBRID_${role.toUpperCase()}`];
  if (forced && all[forced]?.apiKey) return all[forced];
  for (const id of ROLE_PREFERENCE[role]) if (all[id]?.apiKey) return all[id];
  return null;
}

/** The technical brain (kept for the radar's cheap wake). */
export function hybridBrain(): ProviderConfig | null {
  return roleProvider("brain") ?? (configuredProviders()[0] ?? null);
}

export type Region = "western" | "china_ok";

/**
 * US + allies — jurisdictions that should AVOID China-origin models. Unknown or
 * missing country resolves to WESTERN (fail-safe: never send data to a
 * China-origin model unless we're confident the jurisdiction permits it).
 */
export const WESTERN_ALIGNED = new Set<string>([
  "US", "CA", "GB", "AU", "NZ",               // Five Eyes
  "JP", "KR", "TW",                           // East-Asian allies
  // EU / EEA / EFTA
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES",
  "SE", "IS", "LI", "NO", "CH", "UA",
]);

/** Region policy for a country code. Unknown → western (fail-safe). */
export function regionForCountry(country?: string | null): Region {
  if (!country) return "western";
  return WESTERN_ALIGNED.has(country.toUpperCase()) ? "western" : "china_ok";
}

/** Ordered provider preference per region (primary first, fallback second). */
const REGION_STACK: Record<Region, string[]> = {
  western:  ["mistral", "llama", "grok"],   // Western-origin (grok = xAI/US)
  china_ok: ["deepseek", "kimi"],           // cheaper China-origin allowed
};

/** First CONFIGURED provider allowed in the country's region, or null. */
export function providerForCountry(country?: string | null): ProviderConfig | null {
  const region = regionForCountry(country);
  const all = allProviders();
  for (const id of REGION_STACK[region]) {
    if (all[id]?.apiKey) return all[id];
  }
  return null;
}

/** Vercel stamps the visitor's country on every request. */
export function countryFromHeaders(h: Headers): string | null {
  return h.get("x-vercel-ip-country");
}

/**
 * Call the geo-appropriate model. Returns null when no provider is configured
 * for the region — the caller then falls back to its default (Claude), so
 * behaviour is safe even with zero keys set.
 */
export async function callGeoModel(req: {
  country?:   string | null;
  system:     string;
  user:       string;
  maxTokens:  number;
  timeoutMs?: number;
}): Promise<(ChatResult & { providerId: string; origin: ModelOrigin }) | null> {
  const p = providerForCountry(req.country);
  if (!p?.apiKey) return null;
  const r = await openaiCompatChat(
    { model: p.model, system: req.system, user: req.user, maxTokens: req.maxTokens, timeoutMs: req.timeoutMs, temperature: p.temperature },
    { apiKey: p.apiKey, baseUrl: p.baseUrl },
  );
  return { ...r, providerId: p.id, origin: p.origin };
}
