/**
 * ALUGUEL DE OCIOSO — o controle do Celeiro.
 *
 * Empresta o USDT parado à taxa de margem da Gate.io e recebe juro. Não compra
 * nada, não vende nada, não olha preço. Risco de mercado: **zero**.
 *
 * ⚠️⚠️ POR QUE ESTE AGENTE VEM ANTES DE TODOS OS OUTROS.
 *
 * Ele é o PISO. Qualquer agente que renda menos que ele está destruindo valor —
 * bastaria deixar o USDT parado rendendo. Sem piso, retorno é medido contra
 * nada, e foi exatamente assim que "+7,04% com amostra pequena" virou notícia
 * boa na arena antiga.
 *
 * E o plano diz, com todas as letras, que ele PODE ganhar de todo mundo. Se
 * ganhar, é resultado legítimo: a resposta certa é guardar USDT rendendo, não
 * inventar um sexto agente para salvar a tese.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O QUE ESTE MÓDULO NÃO FINGE MEDIR — obrigação declarar:
 *
 *  · **OFERTA NÃO É EXECUÇÃO.** A taxa do livro de empréstimo é o que os
 *    tomadores estão pagando AGORA. Emprestar de verdade só rende se alguém
 *    tomar — e em USDT a demanda oscila. Este módulo mede o TETO honesto do
 *    controle, não uma promessa. Quando houver execução real, a diferença entre
 *    os dois vira `derrapagem` no extrato, e aí ela fica visível em vez de
 *    escondida.
 *
 *  · **RISCO DE CUSTÓDIA.** O USDT fica na corretora. Isso não é risco de
 *    mercado, mas não é zero, e nada aqui o mede.
 *
 * Declarar isto importa porque o controle é a régua: uma régua otimista faz
 * todo agente parecer pior do que é, e uma pessimista faz todos parecerem bons.
 */

import { oControle } from "@/lib/celeiro/agentes";

/** Milissegundos num ano de 365 dias — a base de toda conversão daqui. */
export const MS_POR_ANO = 365 * 24 * 3_600_000;

/**
 * O juro de um período, em USDT.
 *
 * ⚠️ **SIMPLES, NÃO COMPOSTO.** Compor assumiria que o juro recebido é
 * reemprestado automaticamente a cada tick, o que a corretora não faz sozinha —
 * e a diferença apareceria como retorno que ninguém recebeu. É a mesma escolha
 * que `funding.ts` fez ao somar em vez de compor, e pelo mesmo motivo.
 *
 * ⚠️ **CAPITAL NEGATIVO OU TAXA NEGATIVA RENDEM ZERO**, não um número negativo.
 * O controle não pode PERDER dinheiro — se ele perdesse, deixaria de ser piso e
 * o ranking passaria a medir contra um alvo móvel.
 */
export function juroDoPeriodo(
  capitalUsdt: number,
  taxaAnualPct: number,
  msDecorridos: number,
): number {
  if (!Number.isFinite(capitalUsdt) || capitalUsdt <= 0) return 0;
  if (!Number.isFinite(taxaAnualPct) || taxaAnualPct <= 0) return 0;
  if (!Number.isFinite(msDecorridos) || msDecorridos <= 0) return 0;
  return capitalUsdt * (taxaAnualPct / 100) * (msDecorridos / MS_POR_ANO);
}

/**
 * O teto de tempo que um único lançamento pode cobrir.
 *
 * ⚠️ ESTE TETO É UM DETECTOR DE CRON MORTO, não uma otimização. Se o cron
 * ficar 20 dias parado e voltar, sem teto ele credita 20 dias de juro de uma
 * vez — a uma taxa que ninguém observou durante 19 desses dias. O gatilho do
 * volante da arena antiga ficou morto 20 dias sem ninguém notar; assumir que
 * isso não se repete seria ignorar a própria cicatriz.
 */
export const TETO_POR_LANCAMENTO_MS = 6 * 3_600_000;

export interface Acumulo {
  /** Quanto creditar agora. */
  usdt: number;
  /** A janela efetivamente coberta, já com o teto aplicado. */
  msCobertos: number;
  /** Preenchido quando o teto cortou — é sintoma, e vai para o `meta`. */
  cortadoPorTeto: boolean;
  /** Por que este valor, em uma frase legível no extrato. */
  porque: string;
}

/**
 * Quanto creditar neste tick, dado quando foi o último crédito.
 *
 * ⚠️ IDEMPOTÊNCIA POR RELÓGIO, e é a invariante central deste agente. O crédito
 * é sempre `agora − ultimo`, nunca "um tick de juro". Se o cron rodar duas
 * vezes no mesmo minuto, a segunda cobre ~0 ms e credita ~0 — em vez de dobrar
 * o rendimento do controle e envenenar a régua de toda a arena.
 */
export function acumular(
  capitalUsdt: number,
  taxaAnualPct: number,
  ultimoCreditoMs: number | null,
  agoraMs: number,
): Acumulo {
  if (ultimoCreditoMs === null) {
    return {
      usdt: 0, msCobertos: 0, cortadoPorTeto: false,
      porque: "primeiro tick — marca o relógio e não credita juro retroativo",
    };
  }
  const bruto = agoraMs - ultimoCreditoMs;
  if (bruto <= 0) {
    return {
      usdt: 0, msCobertos: 0, cortadoPorTeto: false,
      porque: "nenhum tempo decorrido desde o último crédito",
    };
  }
  const cortadoPorTeto = bruto > TETO_POR_LANCAMENTO_MS;
  const msCobertos = Math.min(bruto, TETO_POR_LANCAMENTO_MS);
  const usdt = juroDoPeriodo(capitalUsdt, taxaAnualPct, msCobertos);
  const horas = (msCobertos / 3_600_000).toFixed(2);

  return {
    usdt, msCobertos, cortadoPorTeto,
    porque: cortadoPorTeto
      ? `${horas}h creditadas de ${(bruto / 3_600_000).toFixed(2)}h decorridas — `
        + "teto aplicado: o cron ficou parado e ninguém observou a taxa no intervalo"
      : `${horas}h a ${taxaAnualPct.toFixed(2)}%/ano sobre ${capitalUsdt.toFixed(2)} USDT`,
  };
}

/** O que a Gate.io respondeu sobre o custo de tomar USDT emprestado. */
export interface TaxaDeEmprestimo {
  taxaAnualPct: number;
  /** De onde veio — o endpoint, para o extrato poder ser auditado. */
  fonte: string;
  lidoEmMs: number;
}

/**
 * Lê a taxa de empréstimo de USDT no livro público da Gate.io.
 *
 * ⚠️ SEM CREDENCIAL, DE PROPÓSITO. O livro de empréstimo é público, então o
 * controle pode ser medido honestamente antes de qualquer chave existir. É a
 * ordem certa: a régua primeiro, o dinheiro depois.
 *
 * ⚠️ FALHA DE LEITURA DEVOLVE `null`, NUNCA UM PADRÃO. Um número inventado
 * quando a rede cai viraria juro creditado que ninguém observou — e como este
 * agente é a régua, o erro contaminaria o julgamento de todos os outros.
 * `inconclusivo ≠ aprovado`, aplicado à leitura.
 */
export async function lerTaxaDeEmprestimo(
  buscar: (url: string) => Promise<unknown> = padraoBuscar,
  agoraMs: number = Date.now(),
): Promise<TaxaDeEmprestimo | null> {
  const url = "https://api.gateio.ws/api/v4/earn/uni/rate";
  try {
    const corpo = await buscar(url);
    const taxa = taxaDaMoeda(corpo, "USDT");
    if (taxa === null) return null;
    return { taxaAnualPct: taxa, fonte: url, lidoEmMs: agoraMs };
  } catch {
    return null;
  }
}

/**
 * Teto de plausibilidade para a taxa do controle, em %/ano.
 *
 * ⚠️ SE A GATE.IO TROCAR A UNIDADE, o número viraria dez ou mil vezes maior e
 * este agente — que é a RÉGUA — passaria a creditar juro fantasma, fazendo TODO
 * agente do Celeiro parecer péssimo para sempre, sem nenhum erro em log. Acima
 * do teto a leitura é RECUSADA, e o cron cai no caminho de "taxa não lida".
 *
 * Preferir parar a acreditar num número que mudou de significado.
 */
export const TETO_PLAUSIVEL_ANUAL_PCT = 60;

/**
 * A taxa anual de empréstimo de uma moeda, em %.
 *
 * ⚠️⚠️ A PRIMEIRA VERSÃO LIA O ENDPOINT ERRADO, e o cron provou em produção.
 * `/margin/funding_book?currency=USDT` responde **HTTP 200 com `[]`** — a
 * Gate.io migrou o empréstimo de margem e deixou a rota viva e vazia. O código
 * recusou corretamente (`[]` → `null` → não creditou nada, e a Colheita nem foi
 * examinada por falta de régua), mas o controle ficou parado em zero.
 *
 * ⚠️ E A UNIDADE FOI PROVADA, NÃO SUPOSTA. `est_rate` do USDT vem `0.0200`. Se
 * fosse diária, seriam 7,3% AO DIA numa stablecoin — absurdo. Como fração
 * ANUAL dá 2,00%/ano, e no mesmo instante BTC vem `0.0010` (0,10%/ano) e ETH
 * `0.0188` (1,88%) — exatamente o formato deste mercado, onde emprestar BTC
 * rende quase nada e stablecoin rende alguns por cento.
 *
 * Confere ainda com a outra rota: `/earn/uni/currencies` publica limites
 * HORÁRIOS do USDT (`max_rate` 0.0000456 → 39,9%/ano de teto), e 2,00% cabe
 * dentro. Duas fontes independentes concordando é o que separa unidade
 * VERIFICADA de unidade adivinhada — e adivinhar unidade é como o `pnl-math`
 * rodou oito asserções verdes sobre metade da taxa real.
 */
export function taxaDaMoeda(corpo: unknown, moeda: string): number | null {
  if (!Array.isArray(corpo)) return null;
  const alvo = corpo.find(
    (x) => String((x as { currency?: unknown })?.currency ?? "").toUpperCase() === moeda.toUpperCase(),
  );
  if (!alvo) return null;

  const fracaoAnual = Number((alvo as { est_rate?: unknown }).est_rate);
  if (!Number.isFinite(fracaoAnual) || fracaoAnual <= 0) return null;

  const pct = fracaoAnual * 100;
  return pct > TETO_PLAUSIVEL_ANUAL_PCT ? null : pct;
}

async function padraoBuscar(url: string): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  if (!r.ok) throw new Error(`gate.io respondeu ${r.status}`);
  return r.json();
}

/**
 * O id deste agente, vindo do registro.
 *
 * ⚠️ NÃO É UMA STRING DIGITADA AQUI. `oControle()` lança se o registro não
 * tiver exatamente um controle — então se alguém marcar um segundo agente como
 * piso, este módulo falha no carregamento em vez de eleger um em silêncio.
 */
export const AGENTE = oControle().id;
