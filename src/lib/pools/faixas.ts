import type { Tier } from "@/lib/tier/types";

/**
 * AS FAIXAS DE FRESCOR DO /pools — quem paga vê o mercado mais recente.
 * (auditoria de /pools, 31/08)
 *
 * ⚠️⚠️ CRÉDITO NÃO É GASTO POR USUÁRIO. É GASTO POR ATUALIZAÇÃO.
 *
 * Este é o fato que decide o desenho inteiro, e ele é contra-intuitivo: cem
 * visitantes olhando a mesma tabela custam **uma** chamada à GeckoTerminal,
 * porque o cache de dados do Next junta todos. O que consome cota é o
 * RELÓGIO — de quanto em quanto tempo o dado é renovado.
 *
 * Logo, "cada tier pode fazer N chamadas por dia" seria a régua errada: ela
 * mede o que não custa. A régua certa é o TTL, e é por isso que este módulo
 * mapeia tier → segundos, e não tier → cota.
 *
 * ⚠️ E O CUSTO ESCALA COM ENGAJAMENTO, NÃO COM PÚBLICO. O Next só revalida
 * quando alguém pede: rota que ninguém abre não gasta nada. Dobrar o número de
 * visitantes não dobra a conta; dobrar o TEMPO que eles passam navegando, sim.
 *
 * ⚠️ A ARITMÉTICA QUE JUSTIFICA OS NÚMEROS (plano gratuito da CoinGecko:
 * 10.000 créditos/mês = 333/dia). Custo de manter UMA rota sempre fresca:
 *
 *      30 s ->  2.880/dia      5 min ->   288/dia
 *       1 min -> 1.440/dia    15 min ->    96/dia
 *       3 min ->   480/dia     1 h   ->    24/dia
 *
 * O /pools tem ~9 rotas quentes (8 redes + trending). A 30 s para todo mundo
 * seriam 777.600/mês — plano Lite, US$ 499. Com as faixas abaixo, o gasto cai
 * para a ordem de 80.000–250.000/mês conforme o quanto os Einherjar navegam:
 * Basic (US$ 35) num uso moderado, Analyst (US$ 129) com folga.
 */

export type FaixaId = "aberta" | "hird" | "pantheon";

export interface Faixa {
  id: FaixaId;
  /** Segundos até o dado ser renovado na fonte. É ISTO que custa crédito. */
  ttlSegundos: number;
}

/**
 * ⚠️ TRÊS FAIXAS, NÃO QUATRO. `pro` e `trader` compartilham a mesma faixa de
 * propósito: separá-las multiplicaria o custo por uma diferença que ninguém
 * percebe (3 min contra 4 min não é um argumento de venda), e cada faixa nova
 * é uma entrada de cache a mais sendo aquecida em paralelo.
 *
 * A diferença que o dono PAGA para ter é entre "o mercado de um quarto de hora
 * atrás" e "o mercado de agora", e essa é a única que a tela consegue mostrar.
 */
const FAIXAS: Record<FaixaId, Faixa> = {
  // Visitante e free. 15 min é o ponto em que 9 rotas cabem com folga no plano
  // gratuito da fonte (25.920/mês) caso um dia se queira rodar só esta faixa.
  aberta:   { id: "aberta",   ttlSegundos: 900 },
  // A Hird — Drengr e Berserkr, assinatura mensal.
  hird:     { id: "hird",     ttlSegundos: 180 },
  // Einherjar (Hird) e o passe do Odin (Pantheon) chegam ao MESMO tier `pilot`
  // por portas diferentes — NFT ou assinatura. A faixa é do tier, não da porta.
  pantheon: { id: "pantheon", ttlSegundos: 30 },
};

/**
 * A faixa de um tier.
 *
 * ⚠️ FALHA PARA A FAIXA MAIS BARATA, SEMPRE. Um tier desconhecido — cliente
 * antigo, valor novo que ninguém mapeou aqui, string corrompida — cai em
 * `aberta`. O erro possível é um pagante ver dado de 15 minutos e reclamar,
 * que é visível e conserta-se; o erro inverso é a plataforma inteira operar na
 * faixa de 30 s sem ninguém pedir, e esse aparece na fatura no fim do mês.
 */
export function faixaDoTier(tier: Tier | string | null | undefined): Faixa {
  if (tier === "pilot") return FAIXAS.pantheon;
  if (tier === "pro" || tier === "trader") return FAIXAS.hird;
  return FAIXAS.aberta;
}

/**
 * O que uma faixa custa por dia, em créditos, se ficar quente o tempo todo.
 *
 * ⚠️ É TETO, NÃO PREVISÃO. Só conta rota que alguém está pedindo: o Next
 * revalida sob demanda, então uma rede que ninguém abre custa zero. Serve para
 * responder "e se todo mundo estiver olhando ao mesmo tempo?", que é a
 * pergunta que decide o plano a contratar.
 */
export function creditosPorDia(faixa: Faixa, rotasQuentes: number): number {
  if (!Number.isFinite(rotasQuentes) || rotasQuentes <= 0) return 0;
  if (!Number.isFinite(faixa.ttlSegundos) || faixa.ttlSegundos <= 0) return 0;
  return Math.round((86_400 / faixa.ttlSegundos) * rotasQuentes);
}

/**
 * O cabeçalho de cache da RESPOSTA.
 *
 * ⚠️⚠️ `private`, E ISSO NÃO É EXCESSO DE ZELO — É A CORREÇÃO DE UM VAZAMENTO.
 *
 * A rota respondia `public, s-maxage=30`, que autoriza a CDN a guardar UMA
 * resposta e servi-la a todos. Com resposta que varia por tier, isso entrega o
 * dado de 30 s do Einherjar para o visitante (a plataforma dá de graça o que
 * cobra) ou o dado de 15 min do visitante para o Einherjar (o pagante recebe o
 * que não comprou). As duas direções são erradas.
 *
 * ⚠️ E `Vary: Cookie` NÃO RESOLVE — piora. O cookie de sessão é único por
 * pessoa, então a CDN passaria a guardar uma entrada por usuário: cache miss
 * em todo mundo, e MAIS chamadas à fonte do que sem cache nenhum. Seria pagar
 * mais para proteger o dado.
 *
 * A economia de crédito não vem daqui. Vem do TTL no `fetch` de upstream, que
 * é o cache de DADOS do Next — servidor, compartilhado, e keyado pelas opções
 * do fetch. Este cabeçalho só governa navegador, e por isso pode ser privado
 * sem custo nenhum.
 */
export function cacheControlDa(faixa: Faixa): string {
  return `private, max-age=${faixa.ttlSegundos}`;
}
