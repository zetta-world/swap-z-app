/**
 * ⚠️⚠️ CE-07 — a conta de tokens dos endpoints OpenAI-compatíveis.
 *
 * `estimateCost` precifica `inTokens` como entrada NÃO cacheada. Lá
 * `prompt_tokens` é o TOTAL (já contém os cacheados). Gravar o total como
 * `inTokens` cobrava os cacheados a preço cheio — e, no streaming, de novo a
 * preço de cache. Estes testes fixam a separação e a fórmula de custo.
 */
import { describe, it, expect } from "vitest";
import { entradaOpenAICompat } from "@/lib/ai/provider";
import { estimateCost } from "@/lib/admin/ai-cost";

describe("entradaOpenAICompat: entrada não cacheada = total − cacheados", () => {
  it("padrão OpenAI: prompt_tokens_details.cached_tokens", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 8000, prompt_tokens_details: { cached_tokens: 6000 } }))
      .toEqual({ inTokens: 2000, cachedTokens: 6000 });
  });

  it("Moonshot/Kimi: cached_tokens no nível de cima", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 8000, cached_tokens: 6000 }))
      .toEqual({ inTokens: 2000, cachedTokens: 6000 });
  });

  it("sem informação de cache = tudo é entrada cheia (comportamento conservador de sempre)", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 5000 })).toEqual({ inTokens: 5000, cachedTokens: 0 });
    expect(entradaOpenAICompat(undefined)).toEqual({ inTokens: 0, cachedTokens: 0 });
  });

  it("resposta inconsistente (cacheados > total) nunca gera entrada negativa", () => {
    expect(entradaOpenAICompat({ prompt_tokens: 100, cached_tokens: 500 })).toEqual({ inTokens: 0, cachedTokens: 100 });
  });

  it("o custo de uma chamada Kimi com 6k de 8k cacheados é ~3,3× menor que a conta antiga", () => {
    const certo = estimateCost({ model: "kimi-k2.6", ...entradaOpenAICompat({ prompt_tokens: 8000, cached_tokens: 6000 }) });
    // Conta antiga do streaming: inTokens = total E cachedTokens = 6000 (contagem dupla).
    const antiga = estimateCost({ model: "kimi-k2.6", inTokens: 8000, cachedTokens: 6000 });
    expect(certo).toBeCloseTo((2000 * 0.6 + 6000 * 0.06) / 1e6, 12);
    expect(antiga / certo).toBeCloseTo(3.31, 1);
  });
});
