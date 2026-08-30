/**
 * O EXTRATO DO CELEIRO — de onde o USDT veio e por onde ele vazou.
 *
 * ⚠️⚠️ POR QUE ESTE MÓDULO EXISTE, EM UM NÚMERO.
 *
 * Em 19/08 mediu-se, na arena antiga, mesas com **70,2%** e **60,0%** de acerto
 * que PERDIAM dinheiro (−0,401% e −0,291% líquidos, espalhado por 8 mesas e 4 a
 * 11 dias cada). O placar antigo não conseguia explicar isso, porque guardava o
 * RESULTADO e nunca as PARTES.
 *
 * "Perdi 4 USDT" é narrativa. "Paguei 3,10 de taxa, 0,70 de derrapagem, recebi
 * 1,20 de funding e o preço levou 2,40" é diagnóstico — e é a única forma do
 * Investigador (§5 do plano) raciocinar sobre evidência em vez de gerar mais um
 * palpite.
 *
 * ⚠️ TUDO AQUI É FUNÇÃO PURA. O banco entra em `store.ts`. Isto é testável sem
 * rede, e é onde as invariantes de conta vivem.
 */

/**
 * As causas possíveis de um movimento de USDT.
 *
 * ⚠️ A LISTA É FECHADA, e não existe "outros". Um balde genérico viraria o ralo
 * onde todo vazamento não explicado se esconde — e a decomposição inteira
 * perderia o sentido no dia em que mais importasse. Causa nova exige migração,
 * ou seja: exige alguém decidir.
 */
export const CAUSAS = ["taxa", "derrapagem", "funding", "preco", "aluguel", "aporte"] as const;
export type Causa = (typeof CAUSAS)[number];

/**
 * ⚠️ `aporte` NÃO É RESULTADO. É capital entrando ou saindo. Somá-lo ao
 * desempenho faria depositar dinheiro parecer lucro — que é a versão em USDT do
 * erro que o painel antigo cometeu ao exibir patrimônio contábil no lugar do
 * caixa (diferença medida à época: $9.350).
 */
export const CAUSAS_DE_RESULTADO: readonly Causa[] = ["taxa", "derrapagem", "funding", "preco", "aluguel"];

export type Braco = "controle" | "mutacao";

export interface Fluxo {
  agente: string;
  causa: Causa;
  /** Assinado: negativo é saída de USDT. */
  usdt: number;
  ocorreuEmMs: number;
  braco?: Braco | null;
  genomaVersao?: number | null;
  /**
   * ⚠️ A OPERAÇÃO QUE GEROU O LANÇAMENTO — `abertura:<id>` / `fechamento:<id>`.
   *
   * Existia no banco desde 20/08 e não subia para cá. Sem ele o piso de amostra
   * conta LINHAS DE EXTRATO, e uma posição escreve de três a quatro: taxa de
   * entrada, taxa de saída, derrapagem e preço. Ver `operacoesDistintas`.
   */
  ref?: string | null;
}

/** Quanto cada causa somou. Chaves sempre presentes, mesmo zeradas. */
export type PorCausa = Record<Causa, number>;

function zerado(): PorCausa {
  return { taxa: 0, derrapagem: 0, funding: 0, preco: 0, aluguel: 0, aporte: 0 };
}

/** Soma os fluxos por causa. */
export function decompor(fluxos: readonly Fluxo[]): PorCausa {
  const out = zerado();
  for (const f of fluxos) {
    if (!Number.isFinite(f.usdt)) continue;
    out[f.causa] += f.usdt;
  }
  return out;
}

/**
 * O USDT que o agente REALMENTE produziu — aporte fora.
 *
 * ⚠️ Este é o placar do Celeiro (P2). Não é taxa de acerto, não é expectancy.
 * É quantos USDT existem a mais por causa deste agente.
 */
export function usdtProduzido(fluxos: readonly Fluxo[]): number {
  const d = decompor(fluxos);
  return CAUSAS_DE_RESULTADO.reduce((s, c) => s + d[c], 0);
}

/**
 * Quantas OPERAÇÕES distintas estes lançamentos representam.
 *
 * ⚠️⚠️ A UNIDADE ERRADA MULTIPLICA A AMOSTRA POR TRÊS (29/08). O piso do A/B
 * pedia 20 e contava `fluxos.length` — mas uma posição escreve 3–4 linhas
 * (taxa na entrada, taxa na saída, derrapagem, preço). Os dois vereditos que o
 * Celeiro já emitiu passaram no piso com **6 e 7 operações** por braço.
 *
 * O comentário logo acima do piso avisava contra exatamente isso: *"a arena
 * antiga premiou +7,04% com 1 decidido"*. A armadilha voltou a um nível de
 * indireção de distância — a contagem estava certa, a UNIDADE não.
 *
 * ⚠️ E LANÇAMENTO SEM `ref` DEVOLVE `null`, não um palpite. Não dá para agrupar
 * o que não tem identidade, e um número inventado aqui vira amostra falsa lá na
 * frente — que é a doença inteira que esta função existe para curar.
 */
export function operacoesDistintas(fluxos: readonly Fluxo[]): number | null {
  const ids = new Set<string>();
  for (const f of fluxos) {
    const r = (f.ref ?? "").trim();
    if (!r) return null;
    const corte = r.indexOf(":");
    ids.add(corte >= 0 ? r.slice(corte + 1) : r);
  }
  return ids.size;
}

/** O capital que entrou (ou saiu) — separado do resultado, sempre. */
export function capitalAportado(fluxos: readonly Fluxo[]): number {
  return decompor(fluxos).aporte;
}

export interface LinhaDeVazamento {
  causa: Causa;
  usdt: number;
  /** Fração do total DRENADO que esta causa representa (0 a 1). */
  fatiaDoVazamento: number;
}

export interface Extrato {
  agente: string;
  usdt: number;
  porCausa: PorCausa;
  /** As causas negativas, da que mais drenou para a que menos. */
  vazamentos: LinhaDeVazamento[];
  /** As causas positivas, da que mais rendeu para a que menos. */
  fontes: LinhaDeVazamento[];
  /**
   * A frase que o Investigador recebe como PONTO DE PARTIDA — nunca como
   * conclusão. Ela descreve a conta; a hipótese é trabalho dele.
   */
  resumo: string;
}

function ordenar(entradas: Array<[Causa, number]>, total: number): LinhaDeVazamento[] {
  return entradas
    .map(([causa, usdt]) => ({
      causa,
      usdt,
      fatiaDoVazamento: total === 0 ? 0 : Math.abs(usdt) / Math.abs(total),
    }))
    .sort((a, b) => Math.abs(b.usdt) - Math.abs(a.usdt));
}

/**
 * O extrato de um agente: quanto, e de onde.
 *
 * ⚠️ O `resumo` DESCREVE, NÃO CONCLUI. Se este texto dissesse "o agente perdeu
 * porque a taxa está alta", o Investigador leria a conclusão pronta e o
 * trabalho dele viraria concordar. A arena antiga produziu 18 lições em prosa e
 * zero evidência exatamente assim.
 */
export function extratoDe(agente: string, fluxos: readonly Fluxo[]): Extrato {
  const meus = fluxos.filter((f) => f.agente === agente);
  const porCausa = decompor(meus);
  const usdt = CAUSAS_DE_RESULTADO.reduce((s, c) => s + porCausa[c], 0);

  const negativas = CAUSAS_DE_RESULTADO
    .map((c) => [c, porCausa[c]] as [Causa, number]).filter(([, v]) => v < 0);
  const positivas = CAUSAS_DE_RESULTADO
    .map((c) => [c, porCausa[c]] as [Causa, number]).filter(([, v]) => v > 0);

  const drenado = negativas.reduce((s, [, v]) => s + v, 0);
  const rendido = positivas.reduce((s, [, v]) => s + v, 0);

  const vazamentos = ordenar(negativas, drenado);
  const fontes = ordenar(positivas, rendido);

  const parte = (l: LinhaDeVazamento) => `${l.causa} ${l.usdt.toFixed(2)}`;
  const resumo = meus.length === 0
    ? `${agente}: nenhum fluxo registrado — sem dado não há diagnóstico`
    : `${agente}: ${usdt >= 0 ? "+" : ""}${usdt.toFixed(2)} USDT em ${meus.length} `
      + `lançamentos · entrou [${fontes.map(parte).join(", ") || "nada"}] · `
      + `saiu [${vazamentos.map(parte).join(", ") || "nada"}]`;

  return { agente, usdt, porCausa, vazamentos, fontes, resumo };
}

export interface Julgamento {
  usdtControle: number;
  usdtMutacao: number;
  diferenca: number;
  /** Operações distintas por braço — `null` quando não deu para contar. */
  operacoesControle: number | null;
  operacoesMutacao: number | null;
  veredito: "pagou" | "nao_pagou" | "inconclusiva";
  /**
   * ⚠️⚠️ O QUE FAZER, SEPARADO DO QUE SE APRENDEU (29/08).
   *
   * Antes a ação era inferida da palavra: `nao_pagou` revertia, o resto não. Isso
   * amarrava duas decisões diferentes numa só e não deixava espaço para o caso
   * que apareceu na auditoria — **os dois braços destruindo valor**. Ali não há
   * o que aprender sobre o parâmetro (`inconclusiva`) e mesmo assim a mudança
   * não pode ficar de pé (`reverter`).
   *
   *   · `aguardar` — amostra ainda crescendo; a mutação NÃO fecha
   *   · `manter`   — a mutação pagou e o genoma novo fica
   *   · `reverter` — volta para a versão anterior
   */
  acao: "aguardar" | "manter" | "reverter";
  porque: string;
}

/**
 * O piso de OPERAÇÕES por braço para um veredito valer.
 *
 * ⚠️ CONTAGEM POR BRAÇO, NÃO NO TOTAL. Trinta no controle e duas na mutação
 * somam 32 e não decidem nada — o braço fraco é que manda. A arena antiga
 * premiou "+7,04% com 1 decidido" por não fazer esta distinção.
 *
 * ⚠️⚠️ E A UNIDADE É OPERAÇÃO, NÃO LANÇAMENTO (29/08). Ver `operacoesDistintas`:
 * contando linhas de extrato, os dois vereditos já emitidos passaram no piso
 * com 6 e 7 operações por braço.
 */
export const MINIMO_POR_BRACO = 20;

/**
 * Julga uma mutação comparando os dois braços do A/B.
 *
 * ⚠️ `inconclusiva` É VEREDITO DE PRIMEIRA CLASSE, e é o mais importante dos
 * três. Sem ele, amostra pequena seria empurrada para "pagou" ou "nao_pagou" e
 * viraria evidência falsa — é o `inconclusivo ≠ aprovado` da casa aplicado ao
 * aprendizado. Um Investigador premiado por ruído aprende a produzir ruído.
 */
export function julgarMutacao(
  fluxos: readonly Fluxo[],
  minimoPorBraco = MINIMO_POR_BRACO,
): Julgamento {
  const doBraco = (b: Braco) => fluxos.filter((f) => f.braco === b);
  const ctrl = doBraco("controle");
  const mut = doBraco("mutacao");

  const usdtControle = usdtProduzido(ctrl);
  const usdtMutacao = usdtProduzido(mut);
  const diferenca = usdtMutacao - usdtControle;
  const operacoesControle = operacoesDistintas(ctrl);
  const operacoesMutacao = operacoesDistintas(mut);
  const base = { usdtControle, usdtMutacao, diferenca, operacoesControle, operacoesMutacao };

  // ⚠️ Sem conseguir CONTAR, não se julga. Ver `operacoesDistintas`.
  if (operacoesControle === null || operacoesMutacao === null) {
    return {
      ...base, veredito: "inconclusiva", acao: "aguardar",
      porque: "lançamento sem `ref` no braço — não dá para contar operações, e "
        + "contar linhas de extrato foi o defeito que este piso existe para não repetir",
    };
  }

  const fraco = Math.min(operacoesControle, operacoesMutacao);
  if (fraco < minimoPorBraco) {
    return {
      ...base, veredito: "inconclusiva", acao: "aguardar",
      porque: `braço fraco com ${fraco} operações, mínimo ${minimoPorBraco} — `
        + "sem amostra o número não decide nada",
    };
  }

  /**
   * ⚠️⚠️ O TERCEIRO ESTADO, E ELE É A CICATRIZ DE 12/08 (`cor-resultado.ts`).
   *
   * O juiz antigo era `diferenca > 0 ? pagou : nao_pagou` — dois estados. Com os
   * DOIS braços negativos, sangrar menos virava "pagou": em 29/08 uma mutação
   * com **−40,43 USDT** foi carimbada como sucesso porque o controle fez
   * −68,19. É o mesmo defeito que pintou de verde, no painel do laboratório,
   * uma grade que perdeu metade do capital por perder menos que segurar.
   *
   * ⚠️ E AQUI ELE É PIOR QUE UMA COR ERRADA: cada "pagou" FIXA o parâmetro, e a
   * mutação seguinte parte dali. Foi assim que o `stopPct` do Alavancado andou
   * 1,2 → 0,8 → 1,6 em cinco dias, com diagnósticos opostos e o do meio
   * aprovado.
   *
   * Com os dois negativos não há o que aprender SOBRE O PARÂMETRO — a notícia é
   * sobre o agente, não sobre a mudança. Então: `inconclusiva` (não ensina) e
   * `reverter` (não fica de pé). Separar veredito de ação é o que permite dizer
   * as duas coisas ao mesmo tempo.
   */
  if (usdtMutacao <= 0 && usdtControle <= 0) {
    return {
      ...base, veredito: "inconclusiva", acao: "reverter",
      porque: `os DOIS braços destruíram valor (controle ${usdtControle.toFixed(2)}, `
        + `mutação ${usdtMutacao.toFixed(2)} USDT) — sangrar menos não é pagar. `
        + "A comparação não decide o parâmetro; revertendo para o genoma anterior",
    };
  }

  if (diferenca > 0 && usdtMutacao > 0) {
    return {
      ...base, veredito: "pagou", acao: "manter",
      porque: `a mutação produziu ${usdtMutacao.toFixed(2)} USDT, `
        + `${diferenca.toFixed(2)} a mais que o controle`,
    };
  }

  return {
    ...base, veredito: "nao_pagou", acao: "reverter",
    porque: usdtMutacao <= 0
      ? `a mutação destruiu ${Math.abs(usdtMutacao).toFixed(2)} USDT enquanto o `
        + `controle produziu ${usdtControle.toFixed(2)} — reverter o genoma`
      : `a mutação produziu ${Math.abs(diferenca).toFixed(2)} USDT a MENOS `
        + "que o controle — reverter o genoma",
  };
}

/**
 * O ranking de uma faixa: USDT produzido, e a distância para o controle.
 *
 * ⚠️ O CONTROLE ENTRA NA TABELA, sempre. Um agente que rende menos que o
 * Aluguel de Ocioso está DESTRUINDO valor — bastaria deixar o USDT parado
 * rendendo. Sem a linha do piso na mesma tela, uma curva bonita e inútil passa
 * por vitória.
 */
export function ranquear(
  fluxos: readonly Fluxo[],
  agentes: readonly string[],
  controle: string,
): Array<{ agente: string; usdt: number; acimaDoControle: number; ehControle: boolean }> {
  const usdtDe = (a: string) => extratoDe(a, fluxos).usdt;
  const piso = usdtDe(controle);
  return agentes
    .map((a) => ({
      agente: a,
      usdt: usdtDe(a),
      acimaDoControle: usdtDe(a) - piso,
      ehControle: a === controle,
    }))
    .sort((x, y) => y.usdt - x.usdt);
}

/**
 * A CURVA DE USDT ACUMULADO — o minigráfico de cada agente.
 *
 * ⚠️ ACUMULADO, NÃO POR LANÇAMENTO. O placar do Celeiro é quanto USDT existe a
 * mais; uma série de valores soltos mostraria a volatilidade do lançamento e
 * esconderia justamente a pergunta. A linha sobe quando o agente produz.
 *
 * ⚠️ APORTE FORA DA CURVA, pelo mesmo motivo de sempre: depositar não é render,
 * e um degrau de capital pareceria um dia excelente.
 */
export function curvaAcumulada(fluxos: readonly Fluxo[], maxPontos = 40): number[] {
  const meus = fluxos
    .filter((f) => CAUSAS_DE_RESULTADO.includes(f.causa) && Number.isFinite(f.usdt))
    .sort((a, b) => a.ocorreuEmMs - b.ocorreuEmMs);
  if (meus.length === 0) return [];

  const acc: number[] = [];
  let soma = 0;
  for (const f of meus) { soma += f.usdt; acc.push(soma); }
  if (acc.length <= maxPontos) return acc;

  const passo = (acc.length - 1) / (maxPontos - 1);
  return Array.from({ length: maxPontos }, (_, i) => acc[Math.round(i * passo)]);
}

export interface ContraOPiso {
  /** A diferença crua em USDT — sempre verdadeira, sempre exibível. */
  usdt: number;
  /** Como mostrar: `pct` quando a razão é legível, `vezes` quando estoura. */
  forma: "pct" | "vezes" | "piso" | "sem_base";
  valor: number | null;
}

/**
 * Como o agente se compara ao piso, numa forma que CABE na tela.
 *
 * ⚠️⚠️ PORCENTAGEM CONTRA UM PISO PEQUENO EXPLODE, e o número vira ruído. Com o
 * piso em 0,0725 e o agente em 1,3661, a conta honesta dá **+1.784%** — que não
 * informa nada e ainda passa a impressão de erro de cálculo.
 *
 * Acima de 10× a leitura vira MÚLTIPLO ("18,8×"), que é como se fala desse
 * tamanho de diferença. Abaixo, porcentagem. E quando o piso é ~zero não há
 * base: devolve `sem_base` em vez de dividir e produzir infinito.
 *
 * ⚠️ A diferença em USDT vai SEMPRE junto, qualquer que seja a forma. É o número
 * que não depende de escolha de apresentação — e é o que o dono usa para decidir.
 */
export const PISO_MINIMO_PARA_RAZAO = 0.01;

export function contraOPiso(usdtAgente: number, usdtPiso: number, ehPiso: boolean): ContraOPiso {
  const usdt = usdtAgente - usdtPiso;
  if (ehPiso) return { usdt: 0, forma: "piso", valor: null };
  if (Math.abs(usdtPiso) < PISO_MINIMO_PARA_RAZAO) return { usdt, forma: "sem_base", valor: null };

  const razao = usdtAgente / usdtPiso;
  if (Math.abs(razao) >= 10) return { usdt, forma: "vezes", valor: razao };
  return { usdt, forma: "pct", valor: (razao - 1) * 100 };
}

export interface RetornoSobreCapital {
  /** USDT produzido dividido pela banca, em %. */
  pct: number | null;
  /** Diferença em pontos percentuais contra o piso. `null` sem base. */
  contraOPisoPp: number | null;
  porque: string;
}

/**
 * O RETORNO SOBRE CAPITAL — a régua que o `vs. piso` em USDT não dava.
 *
 * ⚠️⚠️ POR QUE A COMPARAÇÃO ANTERIOR ERA ENVIESADA. `contraOPiso` compara USDT
 * PRODUZIDO. O Aluguel de Ocioso rende sobre uma banca de $1.000; um agente que
 * arrisca $250 por posição com alavanca 6× tem exposição efetiva de $1.500.
 * Comparar o USDT dos dois **premia quem arrisca mais**, que é o pior viés
 * possível num placar de risco — e era exatamente o que a tela mostrava.
 *
 * Aqui os dois viram % da própria banca, e aí a pergunta fica honesta: *para
 * cada dólar que você administra, quanto sobrou?*
 *
 * ⚠️ BANCA ~ZERO NÃO PRODUZ RETORNO. Dividir por quase-nada devolveria número
 * gigante; sem base, devolve `null` e o USDT cru continua sendo exibido.
 */
export const BANCA_MINIMA_PARA_RETORNO = 1;

export function retornoSobreCapital(
  usdtAgente: number,
  bancaAgente: number,
  retornoDoPisoPct: number | null,
): RetornoSobreCapital {
  if (!(bancaAgente >= BANCA_MINIMA_PARA_RETORNO)) {
    return {
      pct: null, contraOPisoPp: null,
      porque: `banca de ${bancaAgente} não dá base para retorno`,
    };
  }
  const pct = (usdtAgente / bancaAgente) * 100;
  if (retornoDoPisoPct == null) {
    return { pct, contraOPisoPp: null, porque: `${pct.toFixed(3)}% da banca` };
  }
  const contraOPisoPp = pct - retornoDoPisoPct;
  return {
    pct, contraOPisoPp,
    porque: `${pct.toFixed(3)}% da banca contra ${retornoDoPisoPct.toFixed(3)}% do piso`,
  };
}
