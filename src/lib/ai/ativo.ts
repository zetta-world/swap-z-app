/**
 * QUEM ANALISA HOJE — o seletor de provedor da plataforma.
 *
 * ⚠️⚠️ POR QUE ESTE ARQUIVO EXISTE (22/08).
 *
 * Em 21/08 a plataforma migrou da Anthropic para Kimi, e eu tratei como
 * mudança DEFINITIVA: apaguei o `anthropicChat`, tirei o SDK do `package.json`,
 * removi o ramo da Anthropic do `retro`. Só depois o dono explicou o motivo real
 * — *"estou sem crédito na Anthropic para fazer os testes, depois eu volto"*.
 *
 * Era uma PAUSA, e eu construí uma mudança de sentido único. Voltar teria
 * exigido reinstalar o SDK, reescrever o helper e mexer em três rotas — trabalho
 * de código para desfazer uma decisão de orçamento.
 *
 * ⚠️ ENTÃO A REGRA AQUI É UMA SÓ: trocar de provedor é UMA VARIÁVEL DE
 * AMBIENTE, nunca um deploy de código. Ver `docs/TROCAR-DE-PROVEDOR.md`.
 *
 *     AI_PROVIDER=kimi        ← hoje, sem crédito na Anthropic
 *     AI_PROVIDER=anthropic   ← quando o saldo voltar
 *
 * ⚠️ E O PADRÃO É `kimi`, de propósito. Um padrão `anthropic` faria a plataforma
 * quebrar em qualquer ambiente novo onde ninguém tenha definido a variável — e
 * quebrar por FALTA de configuração é o pior modo de falha, porque parece bug.
 * O padrão é o que está funcionando agora.
 */

import { allProviders, type ProviderConfig } from "@/lib/ai/registry";

export type ProvedorAtivo = "kimi" | "anthropic";

/** O provedor escolhido, lido do ambiente. */
export function provedorAtivo(): ProvedorAtivo {
  return process.env.AI_PROVIDER === "anthropic" ? "anthropic" : "kimi";
}

export const ANTHROPIC_MODELO_PADRAO = "claude-sonnet-4-6";

export interface Ativo {
  provedor: ProvedorAtivo;
  /** O modelo a usar. `ZION_MODEL`/`NARRATIVES_MODEL` ainda sobrepõem por rota. */
  modelo: string;
  /** `null` quando a chave do provedor escolhido não está no ambiente. */
  apiKey: string | null;
  /** Só para o caminho compatível-OpenAI. */
  baseUrl: string;
  timeoutMs: number;
  temperature?: number;
  extraBody?: Record<string, unknown>;
  /** O nome da variável que falta, para a mensagem de erro apontar certo. */
  nomeDaChave: string;
}

/**
 * O provedor ativo, já resolvido.
 *
 * ⚠️ NÃO FAZ FALLBACK ENTRE PROVEDORES. Se o `AI_PROVIDER` diz `anthropic` e a
 * chave não está lá, isto devolve `apiKey: null` e a rota recusa dizendo QUAL
 * variável falta. Cair para o outro provedor em silêncio faria a plataforma
 * gastar na conta errada sem ninguém pedir — e "por que a fatura da Kimi subiu?"
 * é uma pergunta que ninguém saberia responder três semanas depois.
 */
export function aiAtivo(): Ativo {
  if (provedorAtivo() === "anthropic") {
    return {
      provedor: "anthropic",
      modelo: process.env.ANTHROPIC_MODEL ?? ANTHROPIC_MODELO_PADRAO,
      apiKey: process.env.ANTHROPIC_API_KEY ?? null,
      baseUrl: "https://api.anthropic.com",
      timeoutMs: Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 40_000),
      nomeDaChave: "ANTHROPIC_API_KEY",
    };
  }
  const k: ProviderConfig | undefined = allProviders().kimi;
  return {
    provedor: "kimi",
    modelo: k?.model ?? "kimi-k2.6",
    apiKey: k?.apiKey ?? null,
    baseUrl: k?.baseUrl ?? "https://api.moonshot.ai/v1",
    timeoutMs: k?.timeoutMs ?? 35_000,
    temperature: k?.temperature,
    /**
     * ⚠️ O `extraBody` VIAJA JUNTO, e esquecê-lo já custou um dia. O
     * `kimi-k2.6` amarra a temperatura ao modo de raciocínio: thinking-ON exige
     * 1, thinking-OFF exige 0,6, e mandar o par errado devolve 400 em TODA
     * chamada. Foi assim que o ZION ficou fora do ar em 21/08 — a temperatura
     * foi passada e o campo que desliga o thinking, não.
     */
    extraBody: k?.extraBody,
    nomeDaChave: "KIMI_API_KEY",
  };
}

/** A mensagem de chave faltando, apontando para a variável certa. */
export function faltaChave(a: Ativo): string {
  return `${a.nomeDaChave} não está configurada no servidor (AI_PROVIDER=${a.provedor}). `
    + "Defina-a em Vercel → Settings → Environment Variables e refaça o deploy.";
}
