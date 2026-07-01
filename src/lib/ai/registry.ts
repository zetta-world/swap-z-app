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
      model:   process.env.KIMI_MODEL   ?? "kimi-k2-0711-preview",
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
  };
}

/** Providers that have a key configured (i.e. usable right now). */
export function configuredProviders(): ProviderConfig[] {
  return Object.values(allProviders()).filter((p) => !!p.apiKey);
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
  western:  ["mistral", "llama"],   // Western-origin only
  china_ok: ["deepseek", "kimi"],   // cheaper China-origin allowed
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
    { model: p.model, system: req.system, user: req.user, maxTokens: req.maxTokens, timeoutMs: req.timeoutMs },
    { apiKey: p.apiKey, baseUrl: p.baseUrl },
  );
  return { ...r, providerId: p.id, origin: p.origin };
}
