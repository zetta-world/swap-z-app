/**
 * O QUE A VITRINE PODE DIZER SOBRE O MODELO — derivado de quem de fato atende.
 *
 * ⚠️⚠️ POR QUE ISTO EXISTE (05/09). Duas coisas erradas, e a segunda é a grave.
 *
 * **1. A vitrine anunciava um modelo que não estava atendendo.** Em quatro
 * idiomas, `/pricing` e `/plans` vendiam "Claude Sonnet 4.6" e "Claude Opus
 * 4.8" enquanto `AI_PROVIDER=kimi` — uma pausa de orçamento que o dono conhecia,
 * mas que a página não sabia. O nome do modelo estava escrito à mão em ~44
 * lugares; trocar os 44 teria movido a mentira, não fechado a porta.
 *
 * **2. ⚠️⚠️ A DIFERENCIAÇÃO POR PLANO NUNCA EXISTIU NO CÓDIGO.** E esta é a que
 * cobra dinheiro de gente: o passe Pilot (30 SOL) é vendido com "Claude Opus
 * 4.8" contra o "Sonnet 4.6" dos planos abaixo, e não há uma linha que roteie
 * plano para modelo. A prova é `app/api/zion/route.ts`:
 *
 *     const { tier } = await getTierForWallet(...)   // linha 158
 *     ...
 *     const model = process.env.ZION_MODEL ?? ativo.modelo;   // linha 442
 *
 * O tier entra na COTA e no PORTÃO. O modelo é um só para a plataforma inteira,
 * em qualquer provedor. Isso não é efeito da pausa da Anthropic — é assim desde
 * sempre, e continuaria assim no dia em que ela voltasse.
 *
 * ⚠️ É o espelho exato do achado do `op-tier.ts`: lá se vendia como exclusivo
 * de um plano algo entregue a todos; aqui se vende ao plano mais caro um modelo
 * melhor e se entrega o mesmo de todo mundo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A REGRA QUE ESTE MÓDULO IMPÕE: **a vitrine lê de `aiAtivo()`, a mesma função
 * que a rota usa para chamar o modelo.** Trocar `AI_PROVIDER` passa a mudar a
 * página sozinho — a página não tem como divergir do produto, porque não tem
 * fonte própria.
 *
 * ⚠️ E ELA NÃO INVENTA NOME COMERCIAL. Id conhecido vira o nome publicado; id
 * desconhecido aparece cru. Um nome bonito chutado é o mesmo defeito de novo,
 * só que mais difícil de achar.
 */

import { aiAtivo } from "@/lib/ai/ativo";

/**
 * Os nomes publicados dos ids que esta casa usa. ⚠️ Só entra aqui id que o
 * `registry.ts` ou o `ativo.ts` de fato nomeiam — esta tabela não é catálogo de
 * marketing, é tradução do que está configurado.
 */
const NOME_PUBLICADO: Record<string, string> = {
  "kimi-k2.6":              "Kimi K2.6",
  "claude-sonnet-4-6":      "Claude Sonnet 4.6",
  "claude-opus-4-8":        "Claude Opus 4.8",
  "claude-3-5-sonnet-latest": "Claude 3.5 Sonnet",
};

export interface ModeloDaVitrine {
  /** O id cru, como configurado. É ele que audita. */
  id: string;
  /** O nome a publicar. Cai no id quando não há nome conhecido. */
  nome: string;
  /**
   * ⚠️ SEMPRE `true` HOJE, e o campo existe para o dia em que deixar de ser.
   *
   * Não há roteamento de modelo por plano em lugar nenhum do código. Enquanto
   * isto for `true`, **nenhuma tela pode anunciar modelos diferentes por
   * plano** — seria vender uma diferença que não existe.
   */
  mesmoParaTodosOsPlanos: boolean;
}

export function modeloDaVitrine(): ModeloDaVitrine {
  const a = aiAtivo();
  /**
   * ⚠️ `ZION_MODEL` TEM PRECEDÊNCIA AQUI porque tem precedência LÁ — é a
   * primeira coisa que `app/api/zion/route.ts` lê. Se a vitrine ignorasse esta
   * variável, ela voltaria a mentir no dia em que alguém a definisse, e por um
   * caminho que ninguém lembraria de conferir.
   */
  const id = process.env.ZION_MODEL || a.modelo;
  return {
    id,
    nome: NOME_PUBLICADO[id] ?? id,
    mesmoParaTodosOsPlanos: true,
  };
}
