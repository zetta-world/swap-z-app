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
import type { LabStatus } from "./registry";

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
    // ⚠️ AQUI ESTAVA `SOL / USDC` NA UNISWAP-V2 DA ETHEREUM, e essa piscina não
    // existe — o SOL não é nativo lá. A rodada de 09/08 devolveu "não
    // encontrada na fonte" e a excluiu corretamente do veredito, mas o alvo
    // estava errado desde o PR. Declarar par sem conferir onde ele mora é a
    // mesma preguiça que a invariante nº 12 cobra na escolha de parâmetro.
    id: "link_eth", base: "LINK", cotacao: "ETH", rotulo: "LINK / ETH",
    llama: { project: "uniswap-v2", symbol: "LINK-WETH", chain: "Ethereum" },
    porque: "volátil mais nervoso que o ETH, e par ETH-referenciado de v2 antigo",
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
 * ⚠️ PISO DA FAIXA MORTA — e ele é só o PISO, não a faixa.
 *
 * A rodada de 10/08 (manhã) fechou com vantagem de −0,01% em um ano e saiu
 * MORTA: ruído lido como reprovação. A faixa nasceu daí.
 *
 * ⚠️ MAS A JUSTIFICATIVA ORIGINAL CAIU, e isso importa registrar. Eu declarei
 * ±1 ponto porque "o gás não está na conta e custa dessa ordem". Na rodada da
 * tarde o gás ENTROU e mediu **0,01%** — a justificativa evaporou junto.
 *
 * O que não evaporou foi a incerteza; ela só mudou de lugar. Hoje quem manda é
 * a TAXA: para a mesma piscina, as duas estimativas da própria fonte
 * (`apyBase` e `apyMean30d`) chegaram a discordar em mais de 3 pontos. Por isso
 * a faixa efetiva é `max(este piso, o desacordo MEDIDO da fonte)` — ver
 * `vereditoLiquidez`.
 *
 * Este piso continua existindo para o resíduo que não tem barra de erro no
 * dado: o modelo do gás (unidades declaradas, par v2 assumido) e a perda ser de
 * ponta a ponta.
 */
export const MARGEM_MINIMA_PCT = 1;

/**
 * ⚠️ O GÁS DA PISCINA — e a decisão de enquadramento que decide o resultado.
 *
 * A pergunta desta mesa não é "quanto custa entrar numa piscina", é "a piscina
 * bate SEGURAR os mesmos ativos". Então o que entra na conta é só o custo que a
 * piscina tem **A MAIS** que segurar:
 *
 *   · A TROCA para montar a cesta 50/50 **NÃO ENTRA**. Quem vai segurar
 *     metade ETH e metade USDC paga exatamente a mesma troca, na entrada e na
 *     saída. Cobrá-la só de um lado seria comparar montagens diferentes —
 *     invariante nº 3, os dois lados no mesmo tamanho. Ela cancela, e isto está
 *     escrito aqui porque cancelamento silencioso vira, meses depois, "por que
 *     a troca não está na conta?".
 *
 *   · O GÁS DE PISCINA **ENTRA**, porque quem só segura não paga nada disso:
 *     duas aprovações (um token cada), o depósito e o saque.
 *
 * ⚠️ AS UNIDADES SÃO CONSTANTES DECLARADAS; o PREÇO delas é MEDIDO (sai dos
 * `gasCosts` de uma cotação real, igual à Fase 4). Chutar o preço do gás seria
 * inventar exatamente o número que decide o veredito.
 */
export const GAS_UNIDADES_LP = {
  /** Autorizar o contrato a gastar o token. Padrão ERC-20, e são DOIS tokens. */
  aprovar:   46_000,
  /** `addLiquidity` num par tipo Uniswap v2. */
  depositar: 180_000,
  /** `removeLiquidity` do mesmo par. */
  sacar:     160_000,
} as const;

export const GAS_TOTAL_LP =
  GAS_UNIDADES_LP.aprovar * 2 + GAS_UNIDADES_LP.depositar + GAS_UNIDADES_LP.sacar;

/**
 * Gás da ida e volta da piscina, como % do capital.
 *
 * ⚠️ Nunca negativo, nunca "grátis por omissão". Preço de gás ausente é
 * problema de quem chama — ver `gasDe` em `JanelaPiscina`.
 */
export function custoGasPct(capitalUsd: number, usdPorGas: number): number | null {
  if (!(capitalUsd > 0) || !Number.isFinite(usdPorGas) || usdPorGas <= 0) return null;
  return Number((((GAS_TOTAL_LP * usdPorGas) / capitalUsd) * 100).toFixed(4));
}

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
  /**
   * ⚠️ A VANTAGEM CONTRA SEGURAR — número RELATIVO, e o nome diz isso agora.
   *
   * Aqui existia `liquidoPct`, e o nome mentia. A perda impermanente já é
   * medida EM RELAÇÃO a ter segurado, então taxa+perda nunca foi "o que a mesa
   * rendeu": é "quanto a mesa ganhou ou perdeu de quem só segurou". Eu comparei
   * esse número contra `segurarPct`, que é um NÍVEL — uma diferença contra um
   * nível, invariante nº 3.
   *
   * Na rodada de 09/08 isso pintou de verde duas piscinas que PERDERAM para
   * segurar, e escreveu "bateu segurar em 2/2" quando o certo era 0/2.
   */
  vantagemPct: number;
  /** O retorno ABSOLUTO da posição na piscina. Comparável com `segurarPct`. */
  lpPct:       number;
  /** Segurar 50/50 os mesmos ativos, na mesma janela. Absoluto. */
  segurarPct:  number;
  /** De onde veio o APY — declarado, nunca inferido. */
  apyDe:       "apyBase" | "apyMean30d" | "ausente";
  apyAnualPct: number | null;
  /**
   * ⚠️ O DESACORDO DA FONTE CONSIGO MESMA: |apyBase − apyMean30d|, quando as
   * duas vêm. É a barra de erro da entrada mais frágil desta medição, e ela
   * existe no dado — não precisa ser chutada. `null` = a fonte só deu uma.
   */
  desacordoTaxaPct: number | null;
  /** Gás da ida e volta da piscina, como % do capital. Zero só se MEDIDO zero. */
  gasPct:      number;
  /**
   * ⚠️ "GÁS BARATO" E "GÁS NÃO LIDO" NÃO PODEM DAR A MESMA TELA.
   *
   * Cicatriz de 06/08, na Fase 4: `gasDaCotacao` devolvia null quando o campo
   * vinha vazio e o custo virava ZERO em silêncio — o que se lia como "o gás
   * deixou de ser barreira", que era exatamente a hipótese sob teste.
   */
  gasDe:       "medido" | "ausente";
  /**
   * ⚠️ QUAL PISCINA A FONTE CASOU — agregado sem parcela não é auditável. Na
   * rodada de 09/08 a taxa do WETH/USDC saiu +0,25%/ano, número implausível
   * para essa piscina, e não havia como saber DE QUAL piscina ele veio sem
   * abrir a fonte. Agora vai na tela.
   */
  casada:      { symbol: string; tvlUsd: number | null } | null;
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
  casada?:    { symbol: string; tvlUsd: number | null } | null;
  /** % do capital. `null` = não deu para medir — NÃO é zero. */
  gasPct?:    number | null;
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

  /**
   * ⚠️ A MÉDIA DE 30 DIAS VEM PRIMEIRO — e eu tinha invertido isso.
   *
   * A Fase 4 já havia decidido a ordem (`escolherApy` em `rendimento.ts`:
   * media30d > base). Eu escrevi o contrário aqui sem justificar, e a segunda
   * rodada mostrou o preço: a taxa do ETH/USDC saiu **+0,25%/ano** num dia e
   * **+2,97%/ano** no dia seguinte. Doze vezes, em 24 horas.
   *
   * `apyBase` é uma FOTO do volume de ontem; aplicá-la a uma janela de um ano
   * faz o resultado da mesa depender de que dia alguém apertou o botão. A média
   * de 30 dias não resolve isso, mas reduz a oscilação de doze vezes para
   * alguma coisa que se pode ler.
   *
   * Duas definições do mesmo conceito em dois arquivos foi o que produziu a
   * divergência — a régua tem que ser uma só.
   */
  const apyAnualPct =
    Number.isFinite(input.apyMean30d as number) ? Number(input.apyMean30d)
    : Number.isFinite(input.apyBase as number) ? Number(input.apyBase)
    : null;
  const apyDe: JanelaPiscina["apyDe"] =
    Number.isFinite(input.apyMean30d as number) ? "apyMean30d"
    : Number.isFinite(input.apyBase as number) ? "apyBase"
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

  /**
   * ⚠️ MULTIPLICATIVO, NÃO SOMADO. A taxa incide sobre a posição que a perda já
   * encolheu, então `taxa + perda` é aproximação — e era ela que estava aqui.
   * Com o produto, `lpPct` e `segurarPct` ficam exatamente na mesma moeda.
   *
   * ⚠️ E O GÁS SAI NA ENTRADA, sobre o capital inicial: o que entra na piscina
   * é `1 − gás`. O gás da SAÍDA é cobrado junto, ali na frente — simplificação
   * declarada, que superestima o custo num mercado que caiu (paga-se a saída em
   * dólares de hoje) e subestima num que subiu.
   */
  const desacordoTaxaPct =
    Number.isFinite(input.apyBase as number) && Number.isFinite(input.apyMean30d as number)
      ? Number(Math.abs(Number(input.apyBase) - Number(input.apyMean30d)).toFixed(4))
      : null;

  const gasPct = Number.isFinite(input.gasPct as number) ? Number(input.gasPct) : 0;
  const gasDe: JanelaPiscina["gasDe"] = Number.isFinite(input.gasPct as number) ? "medido" : "ausente";
  const fatorVantagem = (1 - gasPct / 100) * (1 + ilPct / 100) * (1 + taxaPct / 100);
  const vantagemPct = (fatorVantagem - 1) * 100;
  const lpPct = ((1 + segurarPct / 100) * fatorVantagem - 1) * 100;

  return {
    alvo, dias, razao, ilPct, taxaPct,
    vantagemPct, lpPct, segurarPct, apyDe, apyAnualPct,
    desacordoTaxaPct, gasPct, gasDe,
    casada: input.casada ?? null,
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
  ilMedianoPct:       number | null;
  taxaMedianaPct:     number | null;
  vantagemMedianaPct: number | null;
  lpMedianoPct:       number | null;
  gasMedianoPct:      number | null;
  /**
   * ⚠️ O DESACORDO DA PRÓPRIA FONTE sobre a mesma taxa — `apyBase` contra
   * `apyMean30d`. É a incerteza da entrada que mais pesa, e ela é MEDIDA, não
   * declarada. Ver `vereditoLiquidez`.
   */
  incertezaTaxaPct:   number | null;
  /** Quantas janelas entraram SEM preço de gás medido. */
  semGas:             number;
  /**
   * ⚠️ QUAL PISCINA É A MEDIANA PELA RÉGUA (vantagem) — e por que isto existe.
   *
   * Cada número do cabeçalho é a mediana da SUA coluna, e com n ímpar cada uma
   * vem de uma piscina DIFERENTE. Na rodada de 10/08: taxa 2,57% (do ETH/USDC),
   * perda −0,49% (do BTC/ETH), vantagem +0,56% (do LINK/ETH). A tela convida a
   * conferir `taxa − perda ≈ vantagem` e dá 2,08 contra 0,56 — não porque a
   * conta esteja errada, mas porque são três observações distintas.
   *
   * `null` quando a amostra é par: aí a mediana não É uma linha, e apontar uma
   * seria inventar. Ver invariante nº 4.
   */
  piscinaMediana:     string | null;
  segurarMedianoPct:  number | null;
  /** Em quantas a piscina bateu segurar — ou seja, vantagem > 0. */
  ganhouDeSegurar:    number;
  semApy:             number;
}

export function resumirLiquidez(janelas: JanelaPiscina[]): ResumoLiquidez {
  // ⚠️ O CONTROLE FICA FORA DAS MEDIANAS. Ele existe para provar a conta, não
  // para melhorar o número: um par estável tem perda ≈0 e entraria puxando a
  // mediana para cima como se fosse resultado da estratégia.
  const uteis = janelas.filter((j) => !j.alvo.controle);
  const medidas = uteis.filter((j) => j.apyDe !== "ausente");
  const med = (xs: number[]) => (xs.length ? median(xs) : null);
  /**
   * ⚠️ TODAS AS MEDIANAS SOBRE A MESMA AMOSTRA (`medidas`).
   *
   * A perda impermanente antes vinha de `uteis` — que inclui piscina sem taxa —
   * enquanto taxa e vantagem vinham de `medidas`. Os quatro números do
   * cabeçalho descreviam conjuntos diferentes e a tela não dizia isso
   * (invariante nº 4: amostra é o que SOBREVIVE aos filtros).
   */
  return {
    janelas,
    medidas,
    ilMedianoPct:       med(medidas.map((j) => j.ilPct)),
    taxaMedianaPct:     med(medidas.map((j) => j.taxaPct)),
    vantagemMedianaPct: med(medidas.map((j) => j.vantagemPct)),
    lpMedianoPct:       med(medidas.map((j) => j.lpPct)),
    gasMedianoPct:      med(medidas.map((j) => j.gasPct)),
    /**
     * ⚠️ O MÁXIMO, não a mediana. Escolher a mediana aqui seria pegar a
     * estatística que favorece o veredito — a mediana é menor e alargaria menos
     * a faixa morta. Se as duas estimativas da fonte para UMA piscina discordam
     * em 3 pontos, não dá para afirmar uma vantagem de meio ponto em nenhuma.
     */
    incertezaTaxaPct:   medidas.reduce<number | null>((pior, j) =>
      j.desacordoTaxaPct == null ? pior
      : pior == null ? j.desacordoTaxaPct
      : Math.max(pior, j.desacordoTaxaPct), null),
    semGas:             medidas.filter((j) => j.gasDe === "ausente").length,
    piscinaMediana: medidas.length % 2 === 1
      ? [...medidas].sort((a, b) => a.vantagemPct - b.vantagemPct)[(medidas.length - 1) / 2].alvo.id
      : null,
    segurarMedianoPct:  med(medidas.map((j) => j.segurarPct)),
    ganhouDeSegurar:    medidas.filter((j) => j.vantagemPct > 0).length,
    semApy:             uteis.length - medidas.length,
  };
}

export type VereditoLiquidez = LabStatus;

export interface Veredito {
  status: VereditoLiquidez;
  texto:  string;
}

/**
 * ⚠️ UM TESTE SÓ, PORQUE ERAM DOIS E O SEGUNDO ESTAVA QUEBRADO.
 *
 * A pergunta desta família é uma: **a mesa bate SEGURAR os mesmos ativos?**
 * E `vantagemPct` já É essa resposta, porque a perda impermanente é medida em
 * relação a segurar. Não existe segundo teste a fazer.
 *
 * O que havia aqui era `vantagem <= segurar → morta`, comparando uma diferença
 * com um nível (invariante nº 3). Além de não significar nada, ele reprovava ao
 * contrário em mercado de ALTA: uma piscina que ganhou de segurar por 2 pontos
 * seria marcada MORTA só porque segurar rendeu 50%.
 */
export function vereditoLiquidez(
  r: ResumoLiquidez, minPiscinas = MIN_PISCINAS, piso = MARGEM_MINIMA_PCT,
): Veredito {
  if (r.medidas.length < minPiscinas) {
    return {
      status: "inconclusiva",
      texto: `só ${r.medidas.length} piscina(s) com taxa medida, abaixo do piso de `
        + `${minPiscinas}. Amostra pequena não vira veredito — inconclusivo não é reprovado.`
        + (r.semApy > 0 ? ` ${r.semApy} ficaram de fora por a fonte não trazer o APY.` : ""),
    };
  }
  const vantagem = r.vantagemMedianaPct ?? 0;

  /**
   * ⚠️ SEM O PREÇO DO GÁS NÃO HÁ VEREDITO NESTA MESA.
   *
   * O gás é da ordem da margem que decide (±1 ponto em $2.000), então medir sem
   * ele e concluir seria decidir com a variável decisiva ausente. "Gás barato"
   * e "gás não lido" davam a mesma tela na Fase 4, e custou uma rodada inteira.
   */
  if (r.semGas > 0) {
    return {
      status: "inconclusiva",
      texto: `${r.semGas} de ${r.medidas.length} piscina(s) entraram SEM preço de gás medido. `
        + `O gás é da ordem da margem que decide esta mesa, então concluir sem ele seria `
        + `decidir com a variável decisiva ausente. Sem o gás, a vantagem seria `
        + `${vantagem.toFixed(2)}% — e ela só piora com ele.`,
    };
  }

  /**
   * ⚠️ A FAIXA MORTA VEM ANTES DOS DOIS LADOS. Sem ela, −0,01% em um ano vira
   * "MORTA" e +0,01% vira "VERDE" — vereditos opostos separados por dois
   * centésimos de ponto.
   *
   * ⚠️ E ELA É MEDIDA, NÃO DECLARADA. O texto antigo dizia "o GÁS não está na
   * conta". Depois da 8.1.1 ele ESTÁ, e a frase virou mentira na tela enquanto
   * uma coluna GÁS aparecia ao lado. Texto que descreve uma versão anterior da
   * medição é pior que texto nenhum: é lido como leitura do que está ali.
   *
   * A incerteza não sumiu com o gás — mudou de lugar. Hoje quem manda é a taxa:
   * as duas estimativas da PRÓPRIA fonte para a mesma piscina chegaram a
   * discordar em mais de 3 pontos.
   */
  const margem = Math.max(piso, r.incertezaTaxaPct ?? 0);
  if (Math.abs(vantagem) < margem) {
    const porque = (r.incertezaTaxaPct ?? 0) > piso
      ? `as DUAS estimativas de taxa da própria fonte discordam em até `
        + `${(r.incertezaTaxaPct ?? 0).toFixed(2)} pontos para a mesma piscina`
      : `o modelo de gás usa unidades declaradas e a perda é de ponta a ponta`;
    return {
      status: "empate",
      texto: `EMPATE: a mesa fica ${vantagem.toFixed(2)}% de segurar os mesmos ativos — `
        + `dentro da faixa de ±${margem.toFixed(2)}% que esta medição não consegue `
        + `distinguir, porque ${porque}. Não é aprovação nem reprovação: é ruído. `
        + `O gás JÁ está na conta (${(r.gasMedianoPct ?? 0).toFixed(2)}%).`,
    };
  }

  if (vantagem <= 0) {
    return {
      status: "morta",
      texto: `a taxa não cobre a perda impermanente: a mesa fica ${vantagem.toFixed(2)}% `
        + `ABAIXO de simplesmente segurar os mesmos ativos `
        + `(taxa ${(r.taxaMedianaPct ?? 0).toFixed(2)}%, perda ${(r.ilMedianoPct ?? 0).toFixed(2)}%). `
        + `Em números absolutos: ${(r.lpMedianoPct ?? 0).toFixed(2)}% na piscina contra `
        + `${(r.segurarMedianoPct ?? 0).toFixed(2)}% segurando.`,
    };
  }
  return {
    status: "verde",
    texto: `a taxa cobre a perda e sobra: a mesa fica +${vantagem.toFixed(2)}% ACIMA de segurar `
      + `os mesmos ativos, em ${r.ganhouDeSegurar}/${r.medidas.length} piscinas. `
      + `Em absolutos: ${(r.lpMedianoPct ?? 0).toFixed(2)}% contra `
      + `${(r.segurarMedianoPct ?? 0).toFixed(2)}%.`,
  };
}
