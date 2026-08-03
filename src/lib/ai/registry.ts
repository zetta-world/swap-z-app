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
  timeoutMs?: number;          // per-provider call timeout; slow reasoning
                               // models (kimi-k2.6) need more than the 40s default.
  extraBody?: Record<string, unknown>; // vendor-specific request-body fields —
                               // e.g. Kimi's { thinking: { type: "disabled" } }
                               // to skip its slow chain-of-thought.
  signup:  string;             // where to get the API key
}

/** Every direct-from-source provider. */
export function allProviders(): Record<string, ProviderConfig> {
  return {
    deepseek: {
      id: "deepseek", label: "DeepSeek", origin: "china",
      apiKey:  process.env.DEEPSEEK_API_KEY,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      // "deepseek-chat" was RETIRED (25/07: every call 400'd "The supported API
      // model names are deepseek-v4-pro or deepseek-v4-flash" → the breaker
      // re-tripped hourly all day). We take the -pro flagship because this
      // provider holds the "brain" seat (technical/quant reasoning) and both
      // heavy paths (backtest scan, oracle) budget 40s. If latency bites — the
      // hybrid brain seat only allows 18s — swap with ONE env var, no deploy:
      // DEEPSEEK_MODEL=deepseek-v4-flash.
      model:   process.env.DEEPSEEK_MODEL   ?? "deepseek-v4-pro",
      signup:  "https://platform.deepseek.com",
    },
    kimi: {
      id: "kimi", label: "Kimi (Moonshot)", origin: "china",
      apiKey:  process.env.KIMI_API_KEY,
      baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
      model:   process.env.KIMI_MODEL   ?? "kimi-k2.6",
      // kimi-k2.6 pins the allowed temperature to the reasoning MODE: thinking-ON
      // demands 1, thinking-OFF (instant, below) demands 0.6 — sending the wrong
      // one 400s. We run instant, so 0.6.
      temperature: Number(process.env.KIMI_TEMPERATURE ?? 0.6),
      // kimi-k2.6 ships with "thinking" ON by default — it emits a long internal
      // reasoning trace that blew past even a 50s timeout. We don't need the
      // trace (we only want the cards), so disable it → instant mode (~3-8s).
      // NB: do NOT also send reasoning_effort — Moonshot 400s if both are sent.
      extraBody: { thinking: { type: "disabled" } },
      // Instant mode is usually fast (<10s), but Moonshot latency varies and the
      // occasional slow tick was aborting at 25s. 35s catches those (rarely
      // engaged, so little tick-drag) while still leaving room in the 60s budget.
      timeoutMs: Number(process.env.KIMI_TIMEOUT_MS ?? 35_000),
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
 *   • brain     — technical / quant reasoning (Mistral → Kimi)
 *   • macro     — big-context macro digest (Kimi → Mistral)
 *   • sentiment — leitura de sentimento (Mistral → Kimi)
 *   • ceo       — final synthesis (DeepSeek → Kimi → Mistral)
 *
 * 27/07: Anthropic left this desk entirely. The flywheel measured every
 * brain within ~1pt of every other, so an Opus CEO bought nothing and cost
 * $17.50 across the three days it ran — 70% of July's whole Anthropic bill.
 * DeepSeek takes the CEO seat, and `brain` moves off DeepSeek to Mistral so
 * the drafter and the synthesizer stay DIFFERENT models (a CEO reviewing its
 * own draft is a rubber stamp, not a second opinion). Mistral is also the
 * free tier, so the draft seat now costs nothing.
 */
export type HybridRole = "brain" | "macro" | "sentiment" | "ceo";
const ROLE_PREFERENCE: Record<HybridRole, string[]> = {
  brain:     ["mistral", "deepseek", "kimi", "grok"],
  macro:     ["kimi", "mistral"],
  // 29/07 — Grok SAI do assento de sentimento. A xAI aposentou o Live Search
  // (ver a nota em backtest.ts), então o X deixou de alimentar o modelo: o
  // assento rodava "Grok pelado", ou seja, um analista de sentimento SEM
  // acesso à rede social que era a razão inteira de ele estar aqui. Pagar o
  // prêmio do xAI por sentimento sem fonte é tiro no pé. Mistral assume; Grok
  // segue no torneio de scanner, onde compete pelo mesmo insumo que os outros.
  sentiment: ["mistral", "kimi"],
  ceo:       ["deepseek", "kimi", "mistral"],
};

export function roleProvider(role: HybridRole): ProviderConfig | null {
  return roleProviderChain(role)[0] ?? null;
}

/**
 * TODOS os provedores do papel, na ordem de preferência — a cadeia de reserva.
 *
 * POR QUE ISTO EXISTE (03/08): o `roleProvider` devolvia UM provedor, e quem
 * chamava não tinha para onde ir se a chamada falhasse. O ledger registrou
 * "Mistral indisponível" e o MÍMIR perdeu o tick inteiro — sem decidir, sem
 * gravar, sem par para o VÖLUNDR daquele ciclo.
 *
 * Isso não é só um trade perdido: é AMOSTRA perdida de um lado só do duelo. O
 * controle continua acumulando enquanto a mesa de IA fica para trás, e a
 * comparação vai ficando torta sem ninguém notar — porque os dois números
 * continuam existindo, só que medindo janelas diferentes.
 *
 * Agora o chamador recebe a fila inteira e tenta o próximo quando um falha. O
 * disjuntor (`isTripped`) segue valendo por provedor, então um que esteja em
 * cooldown é pulado sem queimar chamada.
 */
export function roleProviderChain(role: HybridRole): ProviderConfig[] {
  const all = allProviders();
  const forced = process.env[`HYBRID_${role.toUpperCase()}`];
  const ids = forced ? [forced, ...ROLE_PREFERENCE[role].filter((x) => x !== forced)] : ROLE_PREFERENCE[role];
  return ids.map((id) => all[id]).filter((p): p is ProviderConfig => !!p?.apiKey);
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
