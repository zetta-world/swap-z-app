/**
 * SER A CONTRAPARTE — C14, a família liquidez do Mapa do Lucro.
 *
 * ⚠️ O QUE ESTA FASE MEDE, E POR QUE NÃO É "LER O APY DA POOL".
 *
 * Toda interface de AMM publica um número de "APR das taxas". Esse número é
 * verdadeiro e é metade da conta. A outra metade é a **perda impermanente**: ao
 * pôr dois ativos numa piscina de produto constante, você vende automaticamente
 * o que sobe e compra o que cai. Quando os preços divergem, a sua cesta vale
 * menos do que valeria se você tivesse só SEGURADO os dois.
 *
 * A pergunta desta mesa é a única que importa: **a taxa cobre o que a piscina
 * te tira?** É a invariante nº 9 na forma mais literal do laboratório — a mesa
 * é julgada contra comprar-e-segurar os MESMOS ativos na MESMA janela, porque
 * aqui "não fazer nada" não é uma abstração: é exatamente a alternativa.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A PERDA IMPERMANENTE É CALCULADA, NÃO ESTIMADA.
 *
 * Ela não precisa de aproximação nem de campo de terceiro: para uma piscina
 * 50/50 de produto constante, a razão entre o valor da posição e o valor de
 * ter segurado sai fechada da variação RELATIVA dos dois preços. Ver
 * `perdaImpermanente`.
 *
 * Isso importa porque a fonte tem um campo `il7d` que eu **não consigo
 * verificar daqui** (a política de rede deste ambiente recusa `llama.fi`), e
 * ele não está documentado no README do `yield-server`. Construir a medição em
 * cima dele seria assumir contrato que ninguém assinou — o erro exato de 04/08,
 * quando eu argumentei que um host devia funcionar porque outro funcionava.
 * O preço dos dois tokens eu tenho, e dele sai a conta inteira.
 */

import { median } from "@/lib/zion/stats";

/**
 * ⚠️ AS PISCINAS SÃO DECLARADAS AQUI, ANTES DA RODADA (invariante nº 12).
 *
 * Escolher o par depois de ver o resultado é ajuste, não medição — foi assim
 * que a sonda de orderbook acabou com 4.085 medições de altcoin rasa e ZERO de
 * BTC. A lista passa por PR.
 *
 * ⚠️ E A ÚLTIMA LINHA É GRUPO DE CONTROLE, não um par a mais.
 *
 * Dois dólares sintéticos não divergem, então a perda impermanente do par
 * estável TEM que sair ≈ 0. Se ela sair grande, quem está errado é a minha
 * conta — não o mercado. Sem esse par, um erro de sinal ou de fórmula sairia
 * como descoberta.
 */
export interface AlvoPiscina {
  id:       string;
  /** Símbolos na fonte de preço (Binance USDT). Null = ativo já é o dólar. */
  base:     string | null;
  cotacao:  string | null;
  rotulo:   string;
  /** Como a piscina é identificada na fonte de rendimento. */
  llama:    { project: string; symbol: string; chain: string };
  /** Por que este par está na lista. Vai para a tela. */
  porque:   string;
  controle?: boolean;
}

export const ALVOS: AlvoPiscina[] = [
  {
    id: "eth_usdc", base: "ETH", cotacao: null, rotulo: "ETH / USDC",
    llama: { project: "uniswap-v2", symbol: "WETH-USDC", chain: "Ethereum" },
    porque: "volátil contra dólar — o caso clássico de perda impermanente",
  },
  {
    id: "btc_eth", base: "BTC", cotacao: "ETH", rotulo: "BTC / ETH",
    llama: { project: "uniswap-v2", symbol: "WBTC-WETH", chain: "Ethereum" },
    porque: "dois voláteis CORRELACIONADOS — a perda deve ser bem menor",
  },
  {
    id: "sol_usdc", base: "SOL", cotacao: null, rotulo: "SOL / USDC",
    llama: { project: "uniswap-v2", symbol: "SOL-USDC", chain: "Ethereum" },
    porque: "volátil mais nervoso que o ETH — testa o outro extremo",
  },
  {
    id: "usdc_usdt", base: null, cotacao: null, rotulo: "USDC / USDT",
    llama: { project: "curve-dex", symbol: "USDC-USDT", chain: "Ethereum" },
    porque: "GRUPO DE CONTROLE: dois dólares não divergem, a perda tem que dar ≈0",
    controle: true,
  },
];

/** Piso de amostra: uma piscina medida não é uma família medida. */
export const MIN_PISCINAS = 3;

/**
 * PERDA IMPERMANENTE de uma piscina 50/50 de produto constante.
 *
 * `razao` é a variação RELATIVA dos dois preços no período:
 *   razao = (preçoBase_fim / preçoBase_ini) ÷ (preçoCotação_fim / preçoCotação_ini)
 *
 * Devolve `valorNaPiscina / valorSeTivesseSegurado − 1`, ou seja, um número
 * **negativo ou zero**, nunca positivo.
 *
 * ⚠️ O SINAL É A TRAVA. Estar na piscina não pode render MAIS que segurar por
 * efeito de preço — o ganho da piscina vem da taxa, que entra depois e por
 * fora. Uma perda impermanente positiva é a versão desta família do defeito que
 * a Fase 4 pegou como "custo não pode ser negativo" e a Fase 6 como "ida e
 * volta não pode ganhar" (invariantes nº 1 e nº 2). Aqui ela teria a cara de
 * "ser contraparte paga sozinho", que é falso por construção.
 */
export function perdaImpermanente(razao: number): number {
  if (!Number.isFinite(razao) || razao <= 0) return 0;
  const v = (2 * Math.sqrt(razao)) / (1 + razao) - 1;
  // Clamp defensivo: o máximo matemático é 0, em razao = 1. Ponto flutuante
  // pode devolver +1e-16 ali, e um positivo minúsculo que vaza para o veredito
  // é pior que o zero exato.
  return v > 0 ? 0 : v;
}

export interface JanelaPiscina {
  alvo:        AlvoPiscina;
  dias:        number;
  /** Variação relativa dos preços no período. 1 = não divergiram. */
  razao:       number;
  /** Perda impermanente do período, ≤ 0. */
  ilPct:       number;
  /** Taxa recebida no período, derivada do APY da fonte. */
  taxaPct:     number;
  /** taxa + perda. O que a mesa entregou de fato. */
  liquidoPct:  number;
  /** Segurar 50/50 os mesmos ativos, na mesma janela. */
  segurarPct:  number;
  /** De onde veio o APY — declarado, nunca inferido. */
  apyDe:       "apyBase" | "apyMean30d" | "ausente";
  apyAnualPct: number | null;
}

/**
 * Monta a janela de uma piscina.
 *
 * ⚠️ APY AUSENTE NÃO É TAXA ZERO. Piscina sem `apyBase` sai com `apyDe:
 * "ausente"` e a rota a exclui do veredito — tratá-la como 0% faria a fonte
 * calada virar "a taxa não cobre", que é uma conclusão, não um dado
 * (invariante nº 6).
 *
 * ⚠️ E `apyReward` NUNCA entra. Recompensa é paga em token de incentivo que
 * pode cair 80% antes de você vender. Mesma regra da Fase 4.
 */
export function janelaPiscina(input: {
  alvo:      AlvoPiscina;
  precoBaseIni:    number | null;
  precoBaseFim:    number | null;
  precoCotacaoIni: number | null;
  precoCotacaoFim: number | null;
  apyBase:    number | null | undefined;
  apyMean30d: number | null | undefined;
  dias:       number;
}): JanelaPiscina | null {
  const { alvo, dias } = input;
  if (!(dias > 0)) return null;

  // Ativo sem símbolo é o dólar: preço constante 1, variação 1.
  const varBase = variacao(input.precoBaseIni, input.precoBaseFim, alvo.base);
  const varCot  = variacao(input.precoCotacaoIni, input.precoCotacaoFim, alvo.cotacao);
  if (varBase === null || varCot === null) return null;

  const razao = varBase / varCot;
  if (!Number.isFinite(razao) || razao <= 0) return null;

  const ilPct = perdaImpermanente(razao) * 100;

  const apyAnualPct =
    Number.isFinite(input.apyBase as number) ? Number(input.apyBase)
    : Number.isFinite(input.apyMean30d as number) ? Number(input.apyMean30d)
    : null;
  const apyDe: JanelaPiscina["apyDe"] =
    Number.isFinite(input.apyBase as number) ? "apyBase"
    : Number.isFinite(input.apyMean30d as number) ? "apyMean30d"
    : "ausente";

  /**
   * ⚠️ O APY VIRA TAXA DO PERÍODO POR REGRA DE TRÊS SIMPLES, e a tela diz isso.
   *
   * Compor seria fingir precisão que a fonte não dá: `apyBase` é uma foto de
   * HOJE, não a série da janela. Proporcional subestima em janela longa, e
   * subestimar a receita é o lado conservador — o lado que não vende a mesa.
   */
  const taxaPct = apyAnualPct === null ? 0 : (apyAnualPct * dias) / 365;

  /** Segurar 50/50: metade em cada ativo, cada metade rendendo a sua variação. */
  const segurarPct = ((varBase + varCot) / 2 - 1) * 100;

  return {
    alvo, dias, razao, ilPct, taxaPct,
    liquidoPct: taxaPct + ilPct,
    segurarPct, apyDe, apyAnualPct,
  };
}

function variacao(ini: number | null, fim: number | null, simbolo: string | null): number | null {
  if (simbolo === null) return 1;               // dólar: não varia contra si mesmo
  if (!(ini && fim) || ini <= 0 || fim <= 0) return null;
  return fim / ini;
}

export interface ResumoLiquidez {
  janelas:        JanelaPiscina[];
  /** Só as que têm APY — as sem taxa não entram em conta nenhuma. */
  medidas:        JanelaPiscina[];
  ilMedianoPct:      number | null;
  taxaMedianaPct:    number | null;
  liquidoMedianoPct: number | null;
  segurarMedianoPct: number | null;
  /** Em quantas a piscina bateu segurar. */
  ganhouDeSegurar:   number;
  semApy:            number;
}

export function resumirLiquidez(janelas: JanelaPiscina[]): ResumoLiquidez {
  // ⚠️ O CONTROLE FICA FORA DAS MEDIANAS. Ele existe para provar a conta, não
  // para melhorar o número: um par estável tem perda ≈0 e entraria puxando a
  // mediana para cima como se fosse resultado da estratégia.
  const uteis = janelas.filter((j) => !j.alvo.controle);
  const medidas = uteis.filter((j) => j.apyDe !== "ausente");
  const med = (xs: number[]) => (xs.length ? median(xs) : null);
  return {
    janelas,
    medidas,
    ilMedianoPct:      med(uteis.map((j) => j.ilPct)),
    taxaMedianaPct:    med(medidas.map((j) => j.taxaPct)),
    liquidoMedianoPct: med(medidas.map((j) => j.liquidoPct)),
    segurarMedianoPct: med(medidas.map((j) => j.segurarPct)),
    ganhouDeSegurar:   medidas.filter((j) => j.liquidoPct > j.segurarPct).length,
    semApy:            uteis.length - medidas.length,
  };
}

export type VereditoLiquidez = "verde" | "cinza" | "morta";

export interface Veredito {
  status: VereditoLiquidez;
  texto:  string;
}

/**
 * ⚠️ DOIS TESTES, E O SEGUNDO É O QUE MATA.
 *
 * Líquido positivo só diz que a mesa não perdeu dinheiro. A pergunta é se ela
 * bate SEGURAR os mesmos ativos — se não bater, a taxa foi paga com o próprio
 * patrimônio do provedor, e a mesa destrói valor por mais bonito que seja o APR
 * na tela (invariante nº 9).
 */
export function vereditoLiquidez(r: ResumoLiquidez, minPiscinas = MIN_PISCINAS): Veredito {
  if (r.medidas.length < minPiscinas) {
    return {
      status: "cinza",
      texto: `só ${r.medidas.length} piscina(s) com taxa medida, abaixo do piso de `
        + `${minPiscinas}. Amostra pequena não vira veredito — inconclusivo não é reprovado.`
        + (r.semApy > 0 ? ` ${r.semApy} ficaram de fora por a fonte não trazer o APY.` : ""),
    };
  }
  const liquido = r.liquidoMedianoPct ?? 0;
  const segurar = r.segurarMedianoPct ?? 0;

  if (liquido <= 0) {
    return {
      status: "morta",
      texto: `a taxa não cobre a perda impermanente: mediana ${liquido.toFixed(2)}% na janela `
        + `(taxa ${(r.taxaMedianaPct ?? 0).toFixed(2)}%, perda ${(r.ilMedianoPct ?? 0).toFixed(2)}%).`,
    };
  }
  if (liquido <= segurar) {
    return {
      status: "morta",
      texto: `a mesa fica positiva (${liquido.toFixed(2)}%) mas PERDE de segurar os mesmos `
        + `ativos (${segurar.toFixed(2)}%). A taxa foi paga com o próprio patrimônio do provedor.`,
    };
  }
  return {
    status: "verde",
    texto: `a taxa cobre a perda E bate segurar: ${liquido.toFixed(2)}% contra `
      + `${segurar.toFixed(2)}% na mesma janela, em ${r.ganhouDeSegurar}/${r.medidas.length} piscinas.`,
  };
}
