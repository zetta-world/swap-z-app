/**
 * ⚠️⚠️ CE-07 + RM-08 — a conta de tokens dos endpoints OpenAI-compatíveis.
 *
 * `estimateCost` precifica `inTokens` como entrada NÃO cacheada, `cachedTokens`
 * como LEITURA e `cacheWriteTokens` como ESCRITA de cache. Lá `prompt_tokens` é o
 * TOTAL. CE-07 tirou a contagem dupla da leitura; RM-08 (auditoria) separa a
 * ESCRITA, que o caminho OpenAI-compatível gravava como 0.
 *
 * As fixtures seguem o formato DOCUMENTADO pelos provedores (05/10/2026), não um
 * formato inventado:
 *   · Kimi: `usage.prompt_tokens_details.{cached_tokens, cache_write_tokens}` (+ o
 *     `cached_tokens` legado no topo). Leitura, escrita e o resto são mutuamente
 *     exclusivos e somam `prompt_tokens`. No streaming, o detalhe vem no ÚLTIMO
 *     chunk (com `stream_options.include_usage`).
 *   · DeepSeek: `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens` = `prompt_tokens`.
 * Nenhuma chamada real foi feita: o formato vem da documentação, e a conferência
 * contra uma resposta real exige credencial (NOT EXERCISED — ver o relatório).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { entradaOpenAICompat, openaiCompatChat, openaiCompatStream } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/admin/ai-cost";

/** Kimi, formato documentado: 8.000 de prompt = 5.000 lidos do cache + 2.000 escritos + 1.000 sem cache. */
const USO_KIMI = {
  prompt_tokens: 8000, completion_tokens: 300, total_tokens: 8300, cached_tokens: 5000,
  prompt_tokens_details: { cached_tokens: 5000, cache_write_tokens: 2000 },
};
/** DeepSeek, formato documentado. */
const USO_DEEPSEEK = {
  prompt_tokens: 8000, prompt_cache_hit_tokens: 6000, prompt_cache_miss_tokens: 2000, completion_tokens: 300,
  prompt_tokens_details: { cached_tokens: 6000 },
};

describe("entradaOpenAICompat: total = não cacheado + lido + escrito", () => {
  it("⚠️ RM-08 · Kimi com escrita de cache: a escrita sai de `inTokens` e vai para `cacheWriteTokens`", () => {
    expect(entradaOpenAICompat(USO_KIMI)).toEqual({ inTokens: 1000, cachedTokens: 5000, cacheWriteTokens: 2000 });
  });

  it("padrão OpenAI: prompt_tokens_details.cached_tokens (sem escrita)", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 8000, prompt_tokens_details: { cached_tokens: 6000 } }))
      .toEqual({ inTokens: 2000, cachedTokens: 6000, cacheWriteTokens: 0 });
  });

  it("Kimi legado: só `cached_tokens` no nível de cima", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 8000, cached_tokens: 6000 }))
      .toEqual({ inTokens: 2000, cachedTokens: 6000, cacheWriteTokens: 0 });
  });

  it("⚠️ RM-08 · DeepSeek: `prompt_cache_hit_tokens` era ignorado (todo prompt a preço cheio)", () => {
    expect(entradaOpenAICompat(USO_DEEPSEEK)).toEqual({ inTokens: 2000, cachedTokens: 6000, cacheWriteTokens: 0 });
    // sem `prompt_tokens`, o total sai de hit + miss
    expect(entradaOpenAICompat({ prompt_cache_hit_tokens: 300, prompt_cache_miss_tokens: 700 }))
      .toEqual({ inTokens: 700, cachedTokens: 300, cacheWriteTokens: 0 });
  });

  it("sem informação de cache = tudo é entrada cheia (conservador)", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 5000 })).toEqual({ inTokens: 5000, cachedTokens: 0, cacheWriteTokens: 0 });
    expect(entradaOpenAICompat(undefined)).toEqual({ inTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 });
  });

  it("resposta inconsistente nunca gera entrada negativa nem soma acima do total", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 100, cached_tokens: 500 })).toEqual({ inTokens: 0, cachedTokens: 100, cacheWriteTokens: 0 });
    expect(entradaOpenAICompat({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 70, cache_write_tokens: 90 } }))
      .toEqual({ inTokens: 0, cachedTokens: 70, cacheWriteTokens: 30 });
  });
});

describe("o custo resultante, com o preço de lista do kimi-k2.6 (0,95 / leitura 0,16 / escrita = entrada / saída 4,00)", () => {
  it("a chamada do exemplo custa exatamente o que a lista diz", () => {
    const u = { model: "kimi-k2.6", ...entradaOpenAICompat(USO_KIMI), outTokens: 300 };
    expect(estimateCost(u)).toBeCloseTo((1000 * 0.95 + 5000 * 0.16 + 2000 * 0.95 + 300 * 4.0) / 1e6, 12);
  });

  it("a contagem dupla do CE-07 continua morta: 8k de prompt com 6k lidos custa ~2,9× menos que a conta antiga", () => {
    const certo = estimateCost({ model: "kimi-k2.6", ...entradaOpenAICompat({ prompt_tokens: 8000, cached_tokens: 6000 }) });
    const antiga = estimateCost({ model: "kimi-k2.6", inTokens: 8000, cachedTokens: 6000 });
    expect(certo).toBeCloseTo((2000 * 0.95 + 6000 * 0.16) / 1e6, 12);
    expect(antiga / certo).toBeCloseTo((8000 * 0.95 + 6000 * 0.16) / (2000 * 0.95 + 6000 * 0.16), 6);
  });
});

describe("os DOIS caminhos gravam a escrita de cache (antes: `cacheWriteTokens: 0` fixo)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("não-streaming (`openaiCompatChat`)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "ok" } }], usage: USO_KIMI,
    }), { status: 200 })));
    const r = await openaiCompatChat({ model: "kimi-k2.6", system: "s", user: "u", maxTokens: 10 }, { apiKey: "k", baseUrl: "http://x" });
    expect(r.usage).toEqual({ inTokens: 1000, outTokens: 300, cachedTokens: 5000, cacheWriteTokens: 2000 });
  });

  it("streaming (`openaiCompatStream`): o detalhe vem no ÚLTIMO chunk", async () => {
    const sse = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "olá" } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: USO_KIMI })}`,
      "data: [DONE]", "",
    ].join("\n");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    let texto = "";
    const r = await openaiCompatStream(
      { model: "kimi-k2.6", system: "s", user: "u", maxTokens: 10 }, { apiKey: "k", baseUrl: "http://x" }, (d) => { texto += d; },
    );
    expect(texto).toBe("olá");
    expect(r.usage).toEqual({ inTokens: 1000, outTokens: 300, cachedTokens: 5000, cacheWriteTokens: 2000 });
  });
});
