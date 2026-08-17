import { realismGate, type Realism } from "@/lib/zion/arb-realism";

/**
 * AS DESCARTADAS — o teto de credibilidade do arbitrador está cego?
 * (`docs/PLANO-DESCARTADAS.md`)
 *
 * ⚠️ O ACHADO QUE ABRIU ISTO (17/08). As quatro mesas de arbitragem estão com
 * a janela de disparo VAZIA por aritmética: o piso de custo (0,55% / 0,60%)
 * está acima do teto de credibilidade (0,30%). Nenhum spread no universo
 * satisfaz as duas condições, então elas nunca vão operar.
 *
 * A medição da derrapagem, no mesmo dia, tirou o PISO da lista de suspeitos:
 * impacto de 0,000% a $50 com taxa medida de 0,2%/perna. O piso descreve um
 * custo real. Sobrou o TETO.
 *
 * ⚠️ E O CÓDIGO JÁ TINHA PEDIDO ISTO. `arbiter.ts:483`, no comentário do campo
 * `acimaDoPiso`: *"este spread pagaria o custo se fosse real, e foi descartado
 * por incredulidade, não por inviabilidade. **Merece livro lido**, não venue
 * removida."* — e o livro nunca é lido, porque `arbiter.ts:494` tira as
 * anômalas ANTES do portão de profundidade. O comentário descreve uma ação que
 * o fluxo não executa. Este módulo é essa ação.
 *
 * ⚠️ ZERO MATEMÁTICA NOVA, DE PROPÓSITO. A classificação chama o MESMO
 * `realismGate` que decide abrir posição. A pergunta é literalmente "o que o
 * portão do arbitrador diria se ele visse estas rotas" — e só o caminho
 * idêntico responde isso. Uma segunda implementação da mesma conta responderia
 * outra pergunta com a mesma aparência, que é a família de defeito que este
 * repositório mais pagou.
 */

/** O que o `arb_data_anomaly` grava, no formato em que ele grava. */
export interface EventoAnomalia {
  symbol: string;
  buy: string;
  sell: string;
  spreadPct: number;
  /** `true` = pagaria o custo se fosse real. É o único caso que interessa. */
  acimaDoPiso: boolean;
  venues: number;
  createdAt: string;
}

export interface RotaDescartada {
  symbol: string;
  buy: string;
  sell: string;
  /** Quantas vezes a rota foi ANUNCIADA na janela — ver ⚠️ do dedup abaixo. */
  anuncios: number;
  /** O maior spread de topo visto para a rota. O caso mais forte dela. */
  spreadTopoPct: number;
  /** A MENOR contagem de venues vista — a testemunha mais fraca. */
  venuesMin: number;
  ultimoEm: string;
}

export const chaveDaRota = (r: { symbol: string; buy: string; sell: string }): string =>
  `${r.symbol}:${r.buy}>${r.sell}`;

/**
 * Os eventos viram ROTAS distintas.
 *
 * ⚠️ SÓ AS `acimaDoPiso`. Uma anomalia abaixo do piso não pagaria nem se fosse
 * real — julgá-la responderia "o teto barra coisa inútil?", que não é a
 * pergunta e diluiria a contagem que decide. O `arbiter.ts` já separa os dois
 * estados justamente porque eles pedem ações opostas.
 *
 * ⚠️ `anuncios` NÃO É A FREQUÊNCIA REAL. O dedup de `arbiter.ts:473` anuncia
 * uma vez por hora por rota. Uma rota com 24 anúncios em 24h pode ter ocorrido
 * em todos os ticks ou só em 24 — o campo mede visibilidade, não incidência, e
 * lê-lo como incidência seria inventar precisão que o dado não tem.
 *
 * ⚠️ `venuesMin` é a MENOR testemunha, não a média: com o mínimo de cotações a
 * mediana que produziu o spread mal tem independência, e a suspeita vale menos.
 * Guardar o melhor caso aqui seria a mesma escolha otimista que o laboratório
 * inteiro existe para evitar.
 */
export function rotasDeEventos(eventos: readonly EventoAnomalia[]): RotaDescartada[] {
  const porRota = new Map<string, RotaDescartada>();

  for (const e of eventos) {
    if (!e.acimaDoPiso) continue;
    if (!e.symbol || !e.buy || !e.sell) continue;
    if (!Number.isFinite(e.spreadPct)) continue;

    const k = chaveDaRota(e);
    const atual = porRota.get(k);
    if (!atual) {
      porRota.set(k, {
        symbol: e.symbol, buy: e.buy, sell: e.sell,
        anuncios: 1,
        spreadTopoPct: e.spreadPct,
        venuesMin: Number.isFinite(e.venues) ? e.venues : 0,
        ultimoEm: e.createdAt,
      });
      continue;
    }
    atual.anuncios += 1;
    atual.spreadTopoPct = Math.max(atual.spreadTopoPct, e.spreadPct);
    if (Number.isFinite(e.venues)) atual.venuesMin = Math.min(atual.venuesMin, e.venues);
    if (e.createdAt > atual.ultimoEm) atual.ultimoEm = e.createdAt;
  }

  return [...porRota.values()].sort((a, b) => b.spreadTopoPct - a.spreadTopoPct);
}

export type Classe = "real" | "raso" | "cadaver";

export interface Veredito {
  classe: Classe;
  motivo: string;
}

/**
 * A classificação — e ela é uma DELEGAÇÃO, não uma regra nova.
 *
 * `realismGate` é o portão que decide dinheiro. Chamá-lo aqui garante que
 * "REAL" nesta tela significa exatamente "o arbitrador abriria", e não uma
 * segunda definição de aprovado que diverge em silêncio da primeira.
 *
 * ⚠️ LIVRO NÃO LIDO É CADÁVER, NÃO É "NÃO SEI". A ausência de livro é
 * precisamente o caso para o qual o teto foi criado — listagem migrada, par
 * morto, venue que responde vazio. Aqui, e SÓ aqui, ausência de evidência é
 * evidência: a hipótese sendo testada é "isto é dado podre", e livro que não
 * responde é a confirmação dela, não a falta dela.
 */
export function classificarRota(r: Realism | null, minNetPct: number): Veredito {
  if (r === null) {
    return {
      classe: "cadaver",
      motivo: "livro não respondeu ou veio vazio — é o caso para o qual o teto existe",
    };
  }
  const gate = realismGate(r, minNetPct);
  // ⚠️ O motivo vem do portão, palavra por palavra. Reescrever a frase aqui
  // criaria duas explicações para a mesma decisão, e elas divergiriam.
  return { classe: gate.book ? "real" : "raso", motivo: gate.reason };
}

export interface Agregado {
  real: number;
  raso: number;
  cadaver: number;
  total: number;
}

export function agregar(classes: readonly Classe[]): Agregado {
  return {
    real:    classes.filter((c) => c === "real").length,
    raso:    classes.filter((c) => c === "raso").length,
    cadaver: classes.filter((c) => c === "cadaver").length,
    total:   classes.length,
  };
}

/**
 * O VEREDITO SOBRE O TETO — a frase que alguém vai citar.
 *
 * ⚠️ "REAL = 0" É RESULTADO, NÃO FRACASSO. Se nenhuma rota descartada
 * sobrevive à profundidade, as quatro mesas estão corretamente paradas e a
 * resposta honesta é "esta estratégia não paga neste custo". Escrever essa
 * frase como se fosse decepção empurraria a próxima pessoa a mexer no teto
 * para ver acontecer alguma coisa — que é exatamente o que não pode acontecer.
 *
 * ⚠️ E "REAL > 0" NÃO AUTORIZA NADA. É base para conversa com número, com
 * símbolo e com livro lido. A troca do `MAX_GROSS_PCT` continua sendo uma
 * decisão de dinheiro, tomada por gente, fora desta rota.
 */
export function vereditoDoTeto(a: Agregado, ceilPct: number, floorPct: number): string {
  if (a.total === 0) {
    return "nenhuma rota acima do piso foi descartada na janela — não há o que julgar. "
      + "Sem descarte, o teto não está barrando nada que pagaria.";
  }
  if (a.real === 0) {
    return `nenhuma das ${a.total} rotas descartadas sobrevive a andar o livro a $50: `
      + `${a.raso} morre na profundidade e ${a.cadaver} não tem livro. `
      + `O teto de ${ceilPct.toFixed(2)}% está barrando o que o livro barraria de qualquer forma — `
      + "as mesas estão corretamente paradas, e a resposta é que esta estratégia não paga neste custo.";
  }
  return `${a.real} de ${a.total} rotas descartadas SOBREVIVEM a andar o livro a $50 `
    + `(${a.raso} morrem na profundidade, ${a.cadaver} sem livro). `
    + `O teto de ${ceilPct.toFixed(2)}% está barrando spread que pagaria o piso de ${floorPct.toFixed(2)}% `
    + "com profundidade conferida — há número para discutir o teto.";
}
