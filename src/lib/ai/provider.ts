/**
 * Model provider seam — the "acoplável" layer.
 *
 * One normalized interface over every LLM backend, so ZION can swap or add
 * models without the callers caring which vendor answered. Today it wraps two
 * backends:
 *   • anthropicChat     — native Anthropic SDK (prompt caching supported)
 *   • openaiCompatChat  — any OpenAI-compatible endpoint (Kimi/Moonshot,
 *                          DeepSeek, OpenRouter, Together, Groq, Fireworks…)
 *
 * Both return the SAME shape (text + normalized token usage), so cost tracking
 * (ai-cost.ts) and the flywheel A/B treat every model uniformly. The hybrid
 * branch plugs in by adding provider configs / a role→model registry on TOP of
 * this seam — the callers below don't change. Behaviour today is identical to
 * the pre-seam direct SDK calls.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface NormalizedUsage {
  inTokens:         number;  // uncached input
  outTokens:        number;
  cachedTokens:     number;  // cache read
  cacheWriteTokens: number;  // cache creation
}

export interface ChatResult {
  text:  string;
  model: string;
  usage: NormalizedUsage;
}

export interface ChatRequest {
  model:       string;   // provider-native model id
  system:      string;
  user:        string;
  maxTokens:   number;
  timeoutMs?:  number;   // default 40s
  cacheSystem?: boolean; // Anthropic prompt caching on the system block
  /** Vendor-specific extra body fields for OpenAI-compat calls — e.g. xAI's
   *  `search_parameters` to enable Grok's native live X/news search. */
  extraBody?:  Record<string, unknown>;
  /** Anthropic structured outputs (R1.1): when set, the response is FORCED to
   *  validate against this JSON schema via `output_config.format` — a
   *  malformed card becomes impossible by construction. Anthropic-only; the
   *  OpenAI-compat path uses prompt + tolerant parsing instead (provider
   *  support for schema enforcement varies too much to hard-require it). */
  jsonSchema?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT = 40_000;

/** Anthropic (native SDK). maxRetries:0 — callers own their own fallback (N1). */
export async function anthropicChat(req: ChatRequest, apiKey: string): Promise<ChatResult> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: req.timeoutMs ?? DEFAULT_TIMEOUT });
  const params = {
    model:      req.model,
    max_tokens: req.maxTokens,
    system: req.cacheSystem
      ? [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }]
      : req.system,
    messages: [{ role: "user" as const, content: req.user }],
  };
  if (req.jsonSchema) {
    // Structured outputs — GA on the API; typed loosely here so an older SDK's
    // param type doesn't block the (pass-through) field.
    (params as Record<string, unknown>).output_config = { format: { type: "json_schema", schema: req.jsonSchema } };
  }
  const msg = await client.messages.create(params);
  const u = msg.usage;
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  return {
    text, model: req.model,
    usage: {
      inTokens:         u.input_tokens,
      outTokens:        u.output_tokens,
      cachedTokens:     u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/** Any OpenAI-compatible /chat/completions endpoint. No SDK — plain fetch. */
export async function openaiCompatChat(
  req: ChatRequest,
  cfg: { apiKey: string; baseUrl: string },
): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:       req.model,
        max_tokens:  req.maxTokens,
        temperature: 0.6,
        messages: [
          { role: "system", content: req.system },
          { role: "user",   content: req.user },
        ],
        ...(req.extraBody ?? {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?:   { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text:  data.choices?.[0]?.message?.content ?? "",
      model: req.model,
      usage: {
        inTokens:         data.usage?.prompt_tokens ?? 0,
        outTokens:        data.usage?.completion_tokens ?? 0,
        cachedTokens:     0,
        cacheWriteTokens: 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Env-configured OpenAI-compatible provider for the current A/B model (Kimi
 *  by default; the hybrid branch generalizes this into a role→provider
 *  registry). Returns null when no key is set. */
export function openaiCompatConfigFromEnv(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: process.env.KIMI_BASE_URL ?? "https://api.moonshot.ai/v1",
    model:   process.env.KIMI_MODEL   ?? "kimi-k2.6",
  };
}
