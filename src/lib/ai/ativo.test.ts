import { describe, it, expect, afterEach } from "vitest";
import { provedorAtivo, aiAtivo, faltaChave, ANTHROPIC_MODELO_PADRAO } from "@/lib/ai/ativo";

/**
 * O SELETOR DE PROVEDOR — os testes que garantem que a volta é uma VARIÁVEL.
 *
 * ⚠️ A CICATRIZ (21–22/08). A plataforma migrou para Kimi e eu tratei como
 * mudança definitiva: apaguei o `anthropicChat`, tirei o SDK do `package.json`,
 * removi o ramo do `retro`. Só depois o dono explicou — *"estou sem crédito na
 * Anthropic para fazer os testes, depois eu volto"*.
 *
 * Era uma PAUSA e eu construí uma via de sentido único. Estes testes existem
 * para que a próxima troca custe uma variável de ambiente, não um dia.
 */

const ORIGINAL = { ...process.env };
afterEach(() => { process.env = { ...ORIGINAL }; });

describe("quem analisa hoje", () => {
  /**
   * ⚠️ O PADRÃO É KIMI, DE PROPÓSITO. Um padrão `anthropic` quebraria qualquer
   * ambiente novo onde ninguém definiu a variável — e quebrar por FALTA de
   * configuração é o pior modo de falha, porque parece bug. O padrão é o que
   * está funcionando agora.
   */
  it("sem AI_PROVIDER, o padrão é kimi", () => {
    delete process.env.AI_PROVIDER;
    expect(provedorAtivo()).toBe("kimi");
    expect(aiAtivo().provedor).toBe("kimi");
  });

  it("valor desconhecido cai para kimi em vez de quebrar", () => {
    process.env.AI_PROVIDER = "abacaxi";
    expect(provedorAtivo()).toBe("kimi");
  });

  it("AI_PROVIDER=anthropic escolhe a Anthropic", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-teste";
    const a = aiAtivo();
    expect(a.provedor).toBe("anthropic");
    expect(a.modelo).toBe(ANTHROPIC_MODELO_PADRAO);
    expect(a.nomeDaChave).toBe("ANTHROPIC_API_KEY");
  });

  /**
   * ⚠️⚠️ NÃO EXISTE FALLBACK ENTRE PROVEDORES, e é a decisão mais importante
   * do módulo. Se `AI_PROVIDER=anthropic` e a chave não está lá, o resultado é
   * `apiKey: null` — a rota recusa dizendo QUAL variável falta.
   *
   * Cair para o Kimi em silêncio faria a plataforma gastar na conta errada sem
   * ninguém pedir, e "por que a fatura da Kimi subiu?" é uma pergunta que
   * ninguém saberia responder três semanas depois.
   */
  it("provedor escolhido sem chave NÃO cai para o outro", () => {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    process.env.KIMI_API_KEY = "kimi-existe";   // o outro TEM chave

    const a = aiAtivo();
    expect(a.provedor).toBe("anthropic");
    expect(a.apiKey).toBeNull();
    expect(a.baseUrl).not.toContain("moonshot");
  });

  /**
   * ⚠️ A MENSAGEM NOMEIA A VARIÁVEL CERTA. Depois da migração a guarda ainda
   * cobrava `ANTHROPIC_API_KEY` e mandava configurar a chave errada — guarda
   * apontando para a chave errada é pior que guarda nenhuma, porque manda a
   * pessoa consertar o que não está quebrado.
   */
  it("a mensagem de chave faltando aponta para a variável do provedor ativo", () => {
    process.env.AI_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    expect(faltaChave(aiAtivo())).toContain("ANTHROPIC_API_KEY");

    process.env.AI_PROVIDER = "kimi";
    delete process.env.KIMI_API_KEY;
    const msg = faltaChave(aiAtivo());
    expect(msg).toContain("KIMI_API_KEY");
    expect(msg).not.toContain("ANTHROPIC");
  });

  /**
   * ⚠️⚠️ O `extraBody` VIAJA JUNTO COM O KIMI, e esquecê-lo custou um dia de
   * ZION fora do ar. O `kimi-k2.6` amarra a temperatura ao modo de raciocínio:
   * thinking-ON exige 1, thinking-OFF exige 0,6, e o par errado devolve 400 em
   * TODA chamada. A temperatura foi passada; o campo que desliga o thinking,
   * não.
   */
  it("no kimi, temperatura e extraBody andam juntos", () => {
    process.env.AI_PROVIDER = "kimi";
    process.env.KIMI_API_KEY = "kimi-teste";
    const a = aiAtivo();
    expect(a.temperature).toBeTypeOf("number");
    expect(a.extraBody).toMatchObject({ thinking: { type: "disabled" } });
  });

  /** Na Anthropic não há `extraBody` — o campo é específico do outro provedor. */
  it("na anthropic não viaja extraBody de outro provedor", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-teste";
    expect(aiAtivo().extraBody).toBeUndefined();
  });
});
