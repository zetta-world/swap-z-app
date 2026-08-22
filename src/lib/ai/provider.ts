/**
 * Model provider seam — the "acoplável" layer.
 *
 * One normalized interface over every LLM backend, so ZION can swap or add
 * models without the callers caring which vendor answered. Today it wraps two
 * backends:
 *   • openaiCompatChat  — any OpenAI-compatible endpoint (Kimi/Moonshot,
 *                          DeepSeek, OpenRouter, Together, Groq, Fireworks…)
 *
 * Both return the SAME shape (text + normalized token usage), so cost tracking
 * (ai-cost.ts) and the flywheel A/B treat every model uniformly. The hybrid
 * branch plugs in by adding provider configs / a role→model registry on TOP of
 * this seam — the callers below don't change. Behaviour today is identical to
 * the pre-seam direct SDK calls.
 */


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
  temperature?: number;  // OpenAI-compat sampling temp (default 0.6). Some
                         // models pin it — e.g. kimi-k2.6 only accepts 1.
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
/**
 * ⚠️ `anthropicChat` FOI REMOVIDA EM 21/08 — a plataforma inteira migrou para
 * Kimi, e o único chamador que restava era um ramo de `retro.ts` que o próprio
 * comentário declarava morto desde 27/07 ("no source routed to it today").
 *
 * Deixar a função de pé teria custo: enquanto existisse um helper pronto lendo
 * `ANTHROPIC_API_KEY`, qualquer caminho novo poderia chamá-lo por engano e
 * falhar com 401 num provedor que ninguém configurou mais. É a mesma razão que
 * `backtest.ts` já registra para não deixar função órfã por perto.
 */

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
        temperature: req.temperature ?? 0.6,
        messages: [
          { role: "system", content: req.system },
          { role: "user",   content: req.user },
        ],
        ...(req.extraBody ?? {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // Surface WHY it failed (401 bad key vs 402 no credit vs 404 dead model):
      // the status alone can't tell the operator whether to fix the key or top
      // up credits. Body is best-effort + truncated; provider error bodies never
      // echo the Authorization header, so this carries no secret.
      const detail = await res.text().catch(() => "");
      throw new Error(`upstream ${res.status}${detail ? `: ${detail.replace(/\s+/g, " ").slice(0, 180).trim()}` : ""}`);
    }
    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      // completion_tokens_details.reasoning_tokens: xAI (and other reasoning
      // models) bill an internal trace SEPARATELY from the completion. The
      // July invoice showed 359.2K reasoning tokens ($0.90) against 140K
      // completion tokens ($0.35) — 72% of Grok's output cost was invisible
      // to our own accounting because we only read completion_tokens.
      usage?: {
        prompt_tokens?: number; completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    return {
      text:  data.choices?.[0]?.message?.content ?? "",
      model: req.model,
      usage: {
        inTokens:  data.usage?.prompt_tokens ?? 0,
        // Some providers report completion_tokens EXCLUDING the reasoning
        // trace they bill for; when the detail is present and not already
        // included, add it so FINANCE stops under-reporting the real bill.
        outTokens: (data.usage?.completion_tokens ?? 0)
          + (data.usage?.completion_tokens_details?.reasoning_tokens ?? 0),
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

/**
 * STREAMING num endpoint OpenAI-compatível — o que o ZION precisa e
 * `openaiCompatChat` não faz.
 *
 * ⚠️⚠️ POR QUE UM IRMÃO E NÃO UM PARÂMETRO. `openaiCompatChat` devolve o texto
 * inteiro numa Promise; o ZION entrega token a token para o navegador enquanto o
 * modelo escreve. São contratos diferentes — espremer os dois na mesma função
 * daria um retorno que às vezes é texto e às vezes é iterador, e todo chamador
 * teria de saber qual.
 *
 * ⚠️ E A CONTA DE TOKENS SÓ CHEGA NO FIM. O padrão OpenAI só manda `usage` se
 * pedirmos `stream_options.include_usage`, e ela vem no ÚLTIMO evento, depois
 * de todo o texto. Sem esse pedido explícito o gasto some — e um custo que não
 * aparece é o que fez as mesas oráculo pagarem API por três semanas depois de
 * aposentadas.
 */
export interface StreamResult {
  usage: NormalizedUsage;
  model: string;
}

export async function openaiCompatStream(
  req: ChatRequest,
  cfg: { apiKey: string; baseUrl: string },
  onDelta: (texto: string) => void,
  signal?: AbortSignal,
): Promise<StreamResult> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
      stream: true,
      // ⚠️ Sem isto o `usage` nunca chega e o custo fica invisível.
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: req.system },
        { role: "user",   content: req.user },
      ],
      /**
       * ⚠️⚠️ `extraBody` FALTAVA AQUI, e o ZION devolveu 400 em produção.
       *
       * O registro avisa em texto: o `kimi-k2.6` amarra a temperatura ao MODO de
       * raciocínio — thinking-ON exige 1, thinking-OFF exige 0,6, e "sending the
       * wrong one 400s". O `extraBody` do provedor é justamente
       * `{ thinking: { type: "disabled" } }`.
       *
       * Eu passei a temperatura de 0,6 (o valor do modo instantâneo) e NÃO passei
       * o campo que desliga o thinking. Resultado: temperatura de um modo com o
       * raciocínio do outro → 400 em toda chamada.
       *
       * Passei `extraBody` corretamente em `narratives` e no `autopilot` — que
       * usam `openaiCompatChat`. Esqueci na função que EU acabei de escrever, que
       * não tinha o campo. Copiar a assinatura de um irmão que funciona é mais
       * seguro que reescrevê-la de memória.
       */
      ...(req.extraBody ?? {}),
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`${cfg.baseUrl} respondeu ${res.status}`);
  }

  const usage: NormalizedUsage = { inTokens: 0, outTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
  const leitor = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });

    /**
     * ⚠️ CORTA EM LINHA COMPLETA E GUARDA O RESTO. Um chunk de rede pode partir
     * um evento SSE no meio de um JSON; tratar o pedaço como linha inteira faz
     * `JSON.parse` lançar e derruba a resposta no meio da frase.
     */
    const linhas = buffer.split("\n");
    buffer = linhas.pop() ?? "";

    for (const linha of linhas) {
      const t = linha.trim();
      if (!t.startsWith("data:")) continue;
      const corpo = t.slice(5).trim();
      if (corpo === "[DONE]") continue;
      try {
        const j = JSON.parse(corpo) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number;
                    prompt_tokens_details?: { cached_tokens?: number } };
        };
        const texto = j.choices?.[0]?.delta?.content;
        if (texto) onDelta(texto);
        if (j.usage) {
          usage.inTokens = j.usage.prompt_tokens ?? 0;
          usage.outTokens = j.usage.completion_tokens ?? 0;
          usage.cachedTokens = j.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
      } catch {
        // ⚠️ Um evento ilegível não derruba o resto: o texto já entregue vale, e
        // o próximo chunk normalmente traz a continuação.
      }
    }
  }
  return { usage, model: req.model };
}
