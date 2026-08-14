/**
 * O REGISTRO DAS ESTRATÉGIAS DO LABORATÓRIO — as 26 do Mapa do Lucro.
 *
 * ⚠️ DE ONDE VEIO (05/08).
 *
 * O Mapa do Lucro classificou 34 fontes de retorno em três estados: VERDE
 * (medimos, é positiva), MORTA (medimos, é negativa) e CINZA (não medimos —
 * que não é aprovação nem reprovação). O dono decidiu medir todas as cinzas e
 * remedir as verdes, cada uma com o capital que ela realmente pede.
 *
 * Este arquivo é a fonte única desses números. `lab_strategies` no banco é
 * espelho dele, não o contrário: registro em código pode ser revisado em PR,
 * linha em tabela não.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A REGRA DO CAPITAL, que é o motivo desta empreitada existir.
 *
 * As 23 mesas antigas recebiam $1.000 (ou $300) independentemente da
 * estratégia. Isso não é neutro — é medir errado por construção. Uma mesa
 * sub-capitalizada não rende menos: rende NEGATIVO por custo fixo. Funding com
 * $1.000 perde porque as quatro pernas custam 0,45% e o funding acumula 0,2%
 * no período, e aí o resultado é lido como "a estratégia não presta".
 *
 * Provavelmente já matamos ideias boas assim.
 *
 * Por isso `capitalWhy` é obrigatório e o teste de guarda exige 25 caracteres:
 * número de capital sem justificativa vira constante que ninguém confere, que
 * é exatamente como a coluna `priority` nasceu e sobreviveu meses.
 */

/** A família diz QUEM paga você — a única classificação que importa. */
export type LabFamily =
  | "carrego"     // alguém paga para você esperar
  | "direcional"  // você aposta em preço
  | "estrutura"   // você é a infraestrutura do mercado
  | "liquidez"    // você vira o livro
  | "primario"    // mercado primário e evento
  | "negocio";    // você cobra pela infraestrutura — não é trade

/**
 * ⚠️ SEIS ESTADOS, PORQUE ERAM TRÊS E `cinza` FAZIA QUATRO TRABALHOS (Fase 10).
 *
 * A auditoria de 11/08 cruzou este registro com o veredito da última rodada de
 * cada estratégia em `lab_results`. **Onze das 28 linhas contavam histórias
 * diferentes**, e em oito delas a tela contava a mais favorável: `grid_bot`
 * tinha perdido 54% do capital e aparecia como "não medida"; `dex_cex_arb`
 * tinha veredito MORTA gravado e aparecia como "não medida"; o EMPATE do
 * `amm_lp` — a medição mais cara da Fase 8 — aparecia como se não existisse.
 *
 * A causa não era desleixo de atualização. Era que `cinza` significava quatro
 * coisas ao mesmo tempo, e as quatro pedem coisas DIFERENTES de quem lê:
 *
 *   · "nunca medida"                 → pede: vá medir
 *   · "medida, e deu empate"         → pede: não perca tempo, já foi
 *   · "rodou e não deu para concluir"→ pede: remeça com mais amostra
 *   · "não dá para medir com o que alcançamos" → pede: pare de olhar
 *
 * Colapsadas num cinza só, todas pediam a mesma coisa: nada.
 *
 * ⚠️ O TESTE DE UM ESTADO NOVO é conseguir escrever o que ele MANDA fazer. Se
 * dois estados mandam a mesma coisa, é um estado com dois nomes — e a tabela
 * abaixo existe para essa coluna ser preenchível, não por simetria.
 *
 * | estado           | o que significa                                   | o que manda fazer |
 * |------------------|---------------------------------------------------|-------------------|
 * | `verde`          | medida, positiva                                  | pode promover |
 * | `morta`          | medida, negativa                                  | não voltar sem hipótese nova |
 * | `empate`         | medida BEM, e a vantagem cabe dentro da incerteza | não adianta remedir com o mesmo método |
 * | `inconclusiva`   | rodou, e falta amostra ou dado para concluir      | remedir — o texto diz o que falta |
 * | `cinza`          | **não medida**                                    | medir |
 * | `nao_mensuravel` | não dá com fonte que a gente alcança              | parar de olhar |
 *
 * `cinza` continua sendo cinza na tela, e não âmbar: ausência de informação
 * não é um aviso. Quem virou aviso foi `inconclusiva`, que É um pedido.
 */
export type LabStatus =
  | "verde"
  | "cinza"
  | "morta"
  | "empate"
  | "inconclusiva"
  | "nao_mensuravel";

/** Os estados que afirmam ter havido medição — os que exigem parcela no livro. */
export const STATUS_COM_VEREDITO: readonly LabStatus[] = [
  "verde", "morta", "empate", "inconclusiva",
] as const;

export interface LabStrategy {
  slug: string;
  name: string;
  /** Subtítulo funcional. Nome sozinho não comunica — decisão de 05/08. */
  subtitle: string;
  family: LabFamily;
  capitalRequiredUsd: number;
  capitalWhy: string;
  status: LabStatus;
  /** A hipótese ANTES do dado — registrada para poder estar errada em público. */
  hypothesis?: string;
  /** Por que foi morta. Reprovar sem motivo escrito é esquecer. */
  killedWhy?: string;
  /**
   * ⚠️ OBRIGATÓRIO quando `status === "nao_mensuravel"` — exigido aqui, no
   * `assertRegistroCoerente` e por CHECK no banco (migração 0023).
   *
   * Sem isso, `nao_mensuravel` vira o novo cinza: um lugar onde coisa difícil
   * se esconde sem ninguém precisar escrever por quê. "Não dá" não é motivo;
   * "a fonte não publica liquidação por endereço" é.
   */
  notMeasurableWhy?: string;
  /**
   * Onde a medição vive, quando ela não vive no `lab_runs`.
   *
   * ⚠️ Isto existe para NÃO fabricar parcela. As mesas de tendência e o
   * comprar-e-segurar foram medidos na Fase 1, pelo painel 🧭. Inventar uma
   * linha de rodada com números copiados à mão seria o oposto do que estas
   * tabelas existem para fazer — então elas declaram onde o número mora, e o
   * detector de discordância para de reclamar delas por esse motivo, e só por
   * ele: se o livro daqui vier a discordar, ele volta a reclamar.
   */
  measuredElsewhere?: string;
}

export const LAB_STRATEGIES: LabStrategy[] = [
  // ══ VERDES — medidas, positivas. Vão ser REMEDIDAS com capital e janela certos.
  {
    slug: "trend_ma50_long_short",
    name: "Tendência com venda",
    subtitle: "média 50 comprada E vendida · $5.000 · janela de 174 dias",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "10 símbolos com posição simultânea de ~$500; abaixo disso duas posições já são "
      + "a carteira inteira e o resultado mede concentração, não a estratégia",
    status: "verde",
    hypothesis: "poder vender vale +45,9 pontos no crash e custa 7 a 11 pontos fora dele — "
      + "é seguro, não vantagem. Medido em três janelas de 04/08.",
    measuredElsewhere: "Fase 1 — painel 🧭 Estratégias, três janelas de 04/08. Antecede o "
      + "`lab_runs`, então não há rodada aqui para conferir.",
  },
  {
    slug: "trend_ma50_long_only",
    name: "Tendência sem venda",
    subtitle: "média 50 só comprada · $5.000 · janela de 174 dias",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "mesmo capital da versão com venda — a capacidade de vender é a variável "
      + "isolada, e mudar o capital junto mediria duas coisas ao mesmo tempo",
    status: "verde",
    hypothesis: "+18,5% na janela de alta com 45% de exposição; morre nas de queda e lateral",
    measuredElsewhere: "Fase 1 — painel 🧭 Estratégias, três janelas de 04/08. Antecede o "
      + "`lab_runs`, então não há rodada aqui para conferir.",
  },
  {
    slug: "regime_filter",
    name: "Filtro de regime",
    subtitle: "opera só quando há direção · $5.000 · janela de 174 dias",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "mesmo capital das mesas de tendência — o filtro é a variável isolada, "
      + "e ele é medido contra a MESMA estratégia sem filtro",
    status: "morta",
    hypothesis: "direção paga, lateralidade mata. Mercado a −63% deu +27,7%; a +0,1% deu "
      + "+18,5%; a −15% SEM direção matou todas. ⚠️ Já levantei uma hipótese de regime antes "
      + "(o clima) e a minha própria medição derrubou — isto é candidato, não promessa.",
    killedWhy: "MEDIDO em 06/08 pela quebra `byRegime`, DENTRO da janela, e a hipótese caiu "
      + "invertida: RANGING (lateral) rende −0,446% com n=176, e TRENDING_UP rende −0,777% "
      + "com n=135. A lateralidade é o MELHOR terreno desta biblioteca, não o pior — por 0,33 "
      + "ponto, com amostra boa nos dois. Faz sentido depois de dito: cinco dos nove playbooks "
      + "são reversão à média (range_reversion, pivot_reversion, support_accumulation, "
      + "capitulation_reversal, absorption), e reversão precisa de faixa, não de tendência. "
      + "Um filtro 'só opere com direção' bloquearia o terreno onde ela perde menos. "
      + "⚠️ E não salvaria nada: filtrar para RANGING+TRANSITIONING melhora de −0,610% para "
      + "−0,440% por trade e custa 41% dos trades — continua negativo. "
      + "⚠️ O QUE ISTO NÃO REFUTA: os +27,7% do crash foram da MÉDIA MÓVEL 50, que é "
      + "seguidora de tendência e obviamente precisa de tendência. São estratégias opostas; "
      + "o regime certo para uma é o errado para a outra. Ver `trend_ma50_long_short`.",
    measuredElsewhere: "Fase 1 — quebra `byRegime` do painel 🧭, 06/08. Antecede o "
      + "`lab_runs`, então não há rodada aqui para conferir.",
  },
  {
    slug: "tendencia_baixa_freq",
    name: "Tendência de baixa frequência",
    subtitle: "EMA 50/200 · stop 2×ATR · risco fixo · walk-forward · $5.000",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "mesmo capital das outras direcionais, senão a comparação contra elas mede "
      + "o tamanho da posição em vez da estratégia. Com teto de 25% por posição, $5.000 "
      + "comportam quatro posições simultâneas sem que uma vire a carteira inteira",
    status: "cinza",
    hypothesis: "⚠️ A PERGUNTA NÃO É 'tendência funciona?' — isso já foi medido "
      + "(`trend_ma50_long_only`, verde, três janelas de 04/08: mercado −63% deu +27,7%, "
      + "mercado +0,1% deu +18,5%). A pergunta é se SEGURAR POR SEMANAS amortiza o pedágio "
      + "que matou a alta frequência: a grade pagou 54,27% de custo para render 3,39% bruto, "
      + "e a biblioteca de playbooks perde −0,610%/trade com a borda menor que o custo. "
      + "Se a resposta for não, o achado é sobre o NÍVEL de custo com que operamos — "
      + "corretora e execução — e não sobre sinal. "
      + "⚠️ Primeira estratégia deste laboratório medida FORA DA AMOSTRA "
      + "(`walk-forward.ts`): o risco por trade é escolhido no treino e o número que vale "
      + "sai só do teste.",
  },
  {
    slug: "buy_and_hold",
    name: "Comprar e segurar",
    subtitle: "o denominador de tudo · $5.000 · janela de 174 dias",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "mesmo capital das outras direcionais, senão a comparação contra elas "
      + "mede o tamanho da posição em vez da estratégia",
    status: "verde",
    hypothesis: "toda mesa é julgada contra isto na MESMA janela — sem o denominador, "
      + "'+18%' não diz se foi a estratégia ou o mercado",
    measuredElsewhere: "Fase 1 — painel 🧭 Estratégias, três janelas de 04/08. É o "
      + "denominador das outras, medido junto com elas.",
  },

  // ══ CARREGO — alguém paga para você esperar.
  {
    slug: "stablecoin_lending",
    name: "Empréstimo de stablecoin",
    subtitle: "Aave e similares · $1.000 · rendimento contínuo",
    family: "carrego",
    capitalRequiredUsd: 1000,
    capitalWhy: "sem mínimo de protocolo; $1.000 é o suficiente para o gás de entrada e "
      + "saída aparecer como fração real do rendimento, que é o que ninguém publica",
    status: "verde",
    hypothesis: "3,5% a 9% ao ano segundo fontes públicas de 2026 — o que precisa ser "
      + "medido é quanto o gás come disso por faixa de capital. "
      + "⚠️ MEDIDO EM 06/08 e a hipótese caiu pelo lado do CUSTO, não do rendimento: o "
      + "gás não come nada. 5 produtos distintos, mediana bruta 3,56%/ano, líquido do 1º "
      + "ano +3,40% com $1.000 — e o custo de ida e volta na Base é 0,0012%, ou seja "
      + "$0,006 para as três transações. A faixa de $500 rende praticamente o mesmo que "
      + "a de $50.000. É a MAIOR renda líquida medida no laboratório, e ganha do funding "
      + "(+1,18%) com três pernas a menos e sem perna vendida.",
  },
  {
    slug: "tokenized_treasury",
    name: "Tesouro tokenizado",
    subtitle: "renda de título público on-chain · $1.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 1000,
    capitalWhy: "mínimos de emissor giram nessa faixa; abaixo disso o custo de entrada "
      + "domina um rendimento que é de dígito único",
    status: "verde",
    hypothesis: "3,3% a 8% ao ano — é o piso seguro do produto, não a estrela. "
      + "⚠️ MEDIDO EM 06/08 e confirmado no piso da faixa: 5 produtos distintos (BUIDL, "
      + "USDY, OUSG, TBILL, USDO), mediana bruta 3,47%/ano, líquido do 1º ano +3,10% com "
      + "$1.000 depois de uma ida e volta de 0,42%. Ficou como previsto — piso seguro, "
      + "não estrela — e mesmo assim ganha do funding, que carrega perna vendida.",
  },
  {
    slug: "liquid_staking",
    name: "Staking líquido",
    subtitle: "stETH e similares · $1.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 1000,
    capitalWhy: "sem mínimo; o custo real é o gás de entrada e saída, e $1.000 é onde "
      + "ele deixa de ser proibitivo sem ainda ser desprezível",
    status: "verde",
    hypothesis: "2,3% a 2,6% depois das taxas do provedor — abaixo do empréstimo de "
      + "stablecoin no regime atual, o que é contraintuitivo e vale confirmar. "
      + "⚠️ MEDIDO EM 06/08 e CONFIRMADO, inclusive na parte contraintuitiva: 4 produtos "
      + "(Lido 2,20%, Rocket Pool 2,20%, cbETH 2,39%, sfrxETH 2,73%), mediana bruta "
      + "2,30%/ano e líquido do 1º ano +1,88% — abaixo do empréstimo de stablecoin "
      + "(+3,40%), como a hipótese previa. Validar a rede paga menos que emprestar para "
      + "quem quer alavancar.",
  },
  {
    slug: "restaking",
    name: "Restaking",
    subtitle: "aluga a segurança do staking · $2.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 2000,
    capitalWhy: "camada extra de risco de corte pede amostra maior para o resultado "
      + "distinguir rendimento de sorte",
    status: "inconclusiva",
    hypothesis: "5% a 15% ao ano com risco de corte empilhado — o rendimento extra "
      + "pode ser só o prêmio do risco novo",
    killedWhy: "RODOU em 09/08 e a amostra não chegou ao piso: 2 produtos distintos "
      + "(3 implantações) contra o mínimo de 3. O MESMO emissor em várias cadeias tem UMA "
      + "taxa, não várias — contar implantação como amostra seria contar o mesmo número "
      + "três vezes. É a taxa de um emissor num dia, não uma estratégia. "
      + "O que destrava: um terceiro emissor de restaking com taxa publicada.",
  },
  {
    slug: "funding_basis",
    name: "Funding / cash-and-carry",
    subtitle: "spot comprado + perp vendido · $2.000 · 360 dias",
    family: "carrego",
    capitalRequiredUsd: 2000,
    capitalWhy: "o ciclo tem quatro pernas a 0,45%; abaixo de $2.000 o custo fixo come "
      + "o funding antes de ele acumular, e o resultado mede a taxa, não a estratégia",
    status: "verde",
    hypothesis: "⚠️ A MAIOR INCERTEZA DO MAPA. Nossa medição de 04/08 deu mediana de "
      + "+1,4% ao ano em 53 símbolos; a literatura vende 5% a 20%. Uma das duas está "
      + "errada e o desfecho muda o produto. Fonte limitada a 30-60 dias — remedir com 360. "
      + "⚠️ MEDIDO EM 06/08 E A DISCREPÂNCIA FICOU DE PÉ, agora com amostra que aguenta: "
      + "50 símbolos com 94 dias medianos (era 11 símbolos com 30-60), líquido mediano de "
      + "+1,16%/ano depois das 4 pernas — praticamente o mesmo +1,4% que a rodada ruim já "
      + "dizia. Os 5-20% NÃO reproduzem. 23 dos 50 rendem positivo no ano com funding "
      + "negativo em menos de 35% dos períodos, e a mediana DESSA cesta é +3,0%/ano, com "
      + "teto em TAO +6,7%, NEAR +5,8% e CRV +5,7%. ρ=0,067: os 50 valem 11,7 apostas "
      + "independentes, e a cauda ruim é funda — BONK −17,8%/ano, TRX −12,6%. "
      + "⚠️ O SINAL MAIS FORTE ESTÁ NA JANELA, não na mediana: os 10 símbolos com 187 dias "
      + "rendem +0,70%/ano, os 40 com 94 dias rendem +1,35%, e os 3 com só 30 dias rendem "
      + "+7,90%. Janela mais longa, número menor, monotônico — que é exatamente o que a "
      + "hipótese 'os 5-20% publicados são recorte de regime' prevê. Verde porque a renda "
      + "existe e é selecionável; o teto é ~3%/ano na cesta, então ela compete com o Tesouro "
      + "tokenizado (`tokenized_treasury`), não com a promessa de 20%.",
  },
  {
    slug: "carteira_verde",
    name: "Carteira das verdes",
    subtitle: "as rendas aprovadas juntas · $5.000 · 365 dias",
    family: "carrego",
    capitalRequiredUsd: 5000,
    capitalWhy: "o capital é DIVIDIDO entre os fluxos, e cada fatia paga a própria "
      + "entrada; abaixo de $5.000 a divisão em quatro deixa cada perna pequena "
      + "demais e a medição vira um teste de custo fixo, não de diversificação",
    status: "inconclusiva",
    hypothesis: "⚠️ HIPÓTESE MINHA, e é onde eu já errei duas vezes — o clima e o "
      + "filtro de regime, as duas levantadas por mim e derrubadas pela minha própria "
      + "medição, a segunda INVERTIDA. A tese: ρ=0,07 no funding mostrou que 50 nomes "
      + "valem 12 apostas, então adicionar moeda não é a alavanca; combinar rendas com "
      + "MOTORES diferentes (posicionamento, crédito, juro soberano, emissão) seria. "
      + "⚠️ E a aritmética já diz que a carteira vai render MENOS que a melhor parte: "
      + "a média de 3,40% e 1,18% é 2,29%. O que ela pode ganhar é tombo — e trocar "
      + "retorno por sono é decisão do dono, não resultado de fórmula.",
    killedWhy: "MEDIDA em 08/08 e a hipótese caiu no MELHOR cenário possível: correlação "
      + "média de −0,004 (0%), quatro fluxos valendo 4,0 apostas independentes — "
      + "diversificação perfeita, o máximo teórico. E a carteira perdeu assim mesmo: "
      + "2,66%/ano contra 3,13% do Tesouro tokenizado sozinho, em 95 dias de interseção. "
      + "⚠️ A PREMISSA ESTAVA CERTA, A CONCLUSÃO NÃO. A matriz confirmou que os motores são "
      + "independentes (funding × crédito = −0,03; funding × juro soberano = −0,00). O erro "
      + "foi concluir que independência bastaria: diversificação só paga quando NENHUMA "
      + "parte domina, e o Tesouro domina — rende mais que todos e nunca tem dia negativo. "
      + "Misturar funding (16% de dias negativos) só acrescenta oscilação. "
      + "⚠️ O QUE ISTO NÃO REFUTA, e é a parte que importa: o tombo dos três fluxos de "
      + "piscina é ZERO POR CONSTRUÇÃO — retorno de piscina é apy/365, e APY positivo nunca "
      + "gera dia negativo. O risco que justificaria diversificar (emissor, despegue, fila "
      + "de resgate) está inteiro FORA da série. Então isto reprova combinar PELO RETORNO, "
      + "e não diz nada sobre risco. "
      + "⚠️ O ÚNICO SINAL DE ESTRUTURA na matriz inteira foi funding × staking líquido = "
      + "−0,24, os dois ETH-adjacentes. Aponta para um PAR, não para uma cesta de quatro — "
      + "é o que sobrou de vivo desta hipótese. "
      + "⚠️ ESTADO CORRIGIDO EM 11/08, de MORTA para INCONCLUSIVA. Não é recuo da leitura "
      + "acima — é ela levada a sério: o parágrafo diz \"reprova combinar PELO RETORNO, e "
      + "não diz nada sobre risco\", e MORTA afirmava as duas metades. O módulo sempre se "
      + "recusou a carimbar morta aqui, com teste-cicatriz próprio; o registro é que "
      + "afirmava mais do que foi pesado.",
  },
  {
    slug: "quarterly_basis",
    name: "Basis de futuro trimestral",
    subtitle: "prêmio de prazo travado · $5.000 · 360 dias",
    family: "carrego",
    capitalRequiredUsd: 5000,
    capitalWhy: "contrato trimestral tem lote mínimo maior que o perpétuo, e o capital "
      + "fica preso até o vencimento — $2.000 daria uma posição só",
    status: "cinza",
    hypothesis: "dígito único alto em Q2 2026 segundo fontes públicas, comprimido em "
      + "relação aos picos de 2024",
  },
  {
    slug: "covered_call",
    name: "Venda de opção coberta",
    subtitle: "vende o prêmio sobre o que já se tem · $5.000 · 360 dias",
    family: "carrego",
    capitalRequiredUsd: 5000,
    capitalWhy: "o lote mínimo de opção de BTC exige nocional; com $1.000 não se monta "
      + "uma posição coberta sem concentrar tudo numa moeda",
    status: "inconclusiva",
    hypothesis: "volatilidade implícita do BTC roda 50-80% ao ano contra 15-20% do S&P — "
      + "é o prêmio mais gordo e estruturalmente persistente deste mercado, e nunca medimos",
    killedWhy: "RODOU em 09/08 e não deu para concluir — o que é diferente de reprovar. "
      + "Com teto de +5%, a coberta rendeu 1,48% contra 0,86% de segurar em 870 janelas de "
      + "30 dias: vantagem de 0,62 ponto, ABAIXO da margem de 1 ponto exigida para prêmio "
      + "MODELADO. O sorriso subestima o prêmio e a cauda subestima o risco, para lados "
      + "opostos — aprovar aqui seria afirmar precisão que a simulação não tem. "
      + "O que destrava: prêmio OBSERVADO de mercado, não modelado.",
  },
  {
    slug: "susde_wrapped_basis",
    name: "Basis empacotado (sUSDe)",
    subtitle: "o mesmo carrego, feito por terceiro · $1.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 1000,
    capitalWhy: "sem mínimo; existe para ser o CONTROLE do funding feito à mão — se o "
      + "empacotado render mais, a nossa execução é que está cara",
    status: "cinza",
    hypothesis: "10% a 15% em 2026 segundo fontes públicas, acima do funding cru porque "
      + "soma o rendimento do staking na perna comprada",
  },

  {
    slug: "playbook_short",
    name: "Short na biblioteca de playbooks",
    subtitle: "inverter os 9 playbooks estruturais · $5.000 · janela de 174 dias",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "mesmo capital das mesas direcionais — inverter o lado é a variável isolada, "
      + "e mudar o capital junto mediria duas coisas ao mesmo tempo",
    status: "morta",
    hypothesis: "se a biblioteca long perde num mercado que caiu, talvez o problema seja o "
      + "LADO e não a estratégia — inverter cada trade viraria lucro",
    killedWhy: "MEDIDO em 06/08 pelo teste espelho, e a hipótese caiu: os NOVE playbooks são "
      + "negativos nos dois sentidos. Melhor espelho −0,427% (absorption, n=16, abaixo do "
      + "limiar); pior −1,058%. ⚠️ Ressalva honesta: da soma média de −1,543% (long+espelho), "
      + "−1,143 vêm da convenção de straddle (vela que toca os dois lados registra STOP nas "
      + "duas direções), não do mercado. Mesmo creditando isso de volta, nenhum playbook "
      + "chega a positivo convincente. Correlação long×espelho −0,18: quase nenhuma — a "
      + "biblioteca não tem viés de lado, ela tem custo maior que a borda.",
    measuredElsewhere: "Fase 1 — teste espelho do painel 🧭, 06/08. Antecede o `lab_runs`, "
      + "então não há rodada aqui para conferir.",
  },

  // ══ DIRECIONAL — as que faltam.
  {
    slug: "momentum_rotation",
    name: "Rotação por momento",
    subtitle: "troca o perdedor pelo vencedor relativo · $2.000 · 174 dias",
    family: "direcional",
    capitalRequiredUsd: 2000,
    capitalWhy: "precisa de 5+ posições simultâneas para a rotação existir; com menos "
      + "vira uma aposta só trocando de nome",
    status: "morta",
    hypothesis: "nunca medida. É a família que os traders de copy operam e a única "
      + "direcional do mapa que não testamos.",
    killedWhy: "MEDIDA em 10/08, 9 rebalanceamentos: a rotação PERDEU 3,01% por período. "
      + "Ela bateu segurar todos por 2,45 pontos, e isso não a salva — os dois caminhos "
      + "perderam, e ficar em CAIXA bateu os dois. "
      + "⚠️ ESTE VEREDITO ESTEVE GRAVADO COMO `cinza` ATÉ 11/08, porque o vocabulário não "
      + "tinha palavra para \"bateu o índice e ainda assim perdeu dinheiro\". Uma mesa que "
      + "torrou 3% aparecia na tela igual a uma que ninguém nunca olhou.",
  },
  {
    slug: "grid_bot",
    name: "Grade (grid)",
    subtitle: "compra e vende dentro de uma faixa · $1.000 · 174 dias",
    family: "direcional",
    capitalRequiredUsd: 1000,
    capitalWhy: "muitas ordens pequenas é o caso de uso REAL desta estratégia — medir "
      + "com capital grande responderia uma pergunta que ninguém faz",
    status: "morta",
    hypothesis: "15% a 60% ao ano em consolidação segundo fontes públicas, mas um "
      + "rompimento apaga semanas; em teste comparativo só 3 de 8 bots deram lucro em 6 meses",
    killedWhy: "MEDIDA em 10/08 e a fonte pública errou por uma ordem de grandeza: a grade "
      + "perdeu 54,19% DO CAPITAL. Os degraus renderam 2,00% e o estoque preso comeu o resto — "
      + "10 de 10 símbolos romperam a faixa, que é exatamente como esta estratégia morre. "
      + "Perdeu menos que os 64,61% de segurar, e ficar em CAIXA bateu as duas. "
      + "⚠️ E ISTO FICOU MARCADO `cinza` — \"não medida\" — DE 10 A 11/08. Metade do capital "
      + "evaporou numa medição e a tela não pedia nada de ninguém.",
  },

  // ══ ESTRUTURA — você é a infraestrutura.
  {
    slug: "dex_cex_arb",
    name: "Arbitragem DEX ↔ CEX",
    subtitle: "o atraso do bloco contra o preço vivo · $5.000 · contínuo",
    family: "estrutura",
    capitalRequiredUsd: 5000,
    capitalWhy: "o gás é custo FIXO por operação; abaixo de $5.000 ele domina qualquer "
      + "borda, e mediríamos o gás em vez da oportunidade",
    status: "morta",
    hypothesis: "o único terreno com vantagem estrutural — o tempo de bloco cria janela "
      + "lenta por construção. ⚠️ MEV compete pesado e a resposta pode ser a mesma das outras.",
    killedWhy: "MEDIDA em 09/08: 7 pares, mediana da borda LÍQUIDA em −0,337%, com 0 de 7 "
      + "positivos depois de taxa, impacto e gás, e o mesmo nocional dos dois lados. "
      + "A janela de bloco existe — e não sobra dinheiro dentro dela. "
      + "⚠️ O livro gravou `morta` no dia 09 e o registro continuou dizendo `cinza` por dois "
      + "dias: a única linha em que a tela ignorava um veredito já escrito.",
  },
  {
    slug: "liquidations",
    name: "Liquidações",
    subtitle: "compra a garantia com desconto · $10.000 · evento",
    family: "estrutura",
    capitalRequiredUsd: 10000,
    capitalWhy: "capital tem que estar PRONTO quando o evento vem, e o evento não avisa; "
      + "capital pequeno perde as liquidações grandes, que são as que pagam",
    status: "nao_mensuravel",
    hypothesis: "5% a 10% por evento, concentrado em poucos momentos de estresse",
    notMeasurableWhy: "é jogo de LATÊNCIA, e daqui não alcançamos nem feed de evento de "
      + "liquidação nem posição na fila. Sem os dois, qualquer número seria teatro: mediria "
      + "o desconto teórico da garantia, que ninguém captura sem chegar primeiro. "
      + "O que destrava: feed de eventos por endereço + medição de posição na fila.",
  },
  {
    slug: "bridge_arb",
    name: "Arbitragem de ponte",
    subtitle: "adianta liquidez e cobra pela fila · $20.000 · contínuo",
    family: "estrutura",
    capitalRequiredUsd: 20000,
    capitalWhy: "o capital fica PRESO durante a travessia; com pouco, uma operação "
      + "consome o caixa inteiro e a mesa fica ociosa esperando",
    status: "cinza",
  },

  // ══ LIQUIDEZ — você vira o livro.
  {
    slug: "amm_lp",
    name: "LP em AMM clássico",
    subtitle: "taxa de quem troca, menos a perda impermanente · $2.000 · 174 dias",
    family: "liquidez",
    capitalRequiredUsd: 2000,
    capitalWhy: "capital pequeno num pool grande recebe taxa proporcional irrisória e o "
      + "gás de entrada domina; $2.000 é onde a taxa passa a ser mensurável",
    status: "empate",
    killedWhy: "MEDIDA em 10/08 e deu EMPATE, que não é reprovação: a mesa fica +0,55% de "
      + "segurar os mesmos ativos, dentro da faixa de ±3,68% que esta medição não consegue "
      + "distinguir. E a faixa não é chute — é a discordância das DUAS estimativas de taxa "
      + "da PRÓPRIA fonte para a MESMA piscina. O gás já está na conta (0,01%). "
      + "⚠️ NÃO ADIANTA REMEDIR com o mesmo método: a incerteza está na fonte, não na "
      + "amostra. O que destrava é taxa observada de eventos de swap, não estimada.",
  },
  {
    slug: "concentrated_lp",
    name: "Liquidez concentrada",
    subtitle: "mais taxa, muito mais risco fora da faixa · $2.000 · 174 dias",
    family: "liquidez",
    capitalRequiredUsd: 2000,
    capitalWhy: "mesmo capital do AMM clássico — a concentração é a variável isolada",
    status: "cinza",
    hypothesis: "54,7% dos LPs em pares voláteis PERDERAM dinheiro segundo estudo "
      + "público. Medimos para poder DESACONSELHAR com dado nosso, não com citação.",
  },
  {
    slug: "perp_dex_vault",
    name: "Cofre de perp DEX",
    subtitle: "você é a contraparte dos traders · $2.000 · contínuo",
    family: "liquidez",
    capitalRequiredUsd: 2000,
    capitalWhy: "cofres têm mínimo de entrada e a cota se dilui; abaixo disso o "
      + "resultado é ruído de arredondamento",
    status: "cinza",
  },
  {
    slug: "options_vault",
    name: "Cofre de opções",
    subtitle: "venda de volatilidade automatizada · $1.000 · contínuo",
    family: "liquidez",
    capitalRequiredUsd: 1000,
    capitalWhy: "sem mínimo relevante; existe para ser o CONTROLE da venda de opção "
      + "feita à mão — se o cofre render mais, a nossa execução é que está cara",
    status: "cinza",
  },

  // ══ PRIMÁRIO — mercado primário e evento.
  {
    slug: "airdrop_points",
    name: "Airdrop e pontos",
    subtitle: "o protocolo comprando usuário inicial · $500 · meses",
    family: "primario",
    capitalRequiredUsd: 500,
    capitalWhy: "aqui TEMPO vale mais que capital — em 2026 os programas recompensam "
      + "narrativa de carteira, não tamanho de posição",
    status: "nao_mensuravel",
    hypothesis: "retorno binário e não anualizável. Alto valor relativo para o peixe "
      + "pequeno justamente porque não depende de capital.",
    notMeasurableWhy: "o retorno é RETROSPECTIVO e não repetível — medir os airdrops que já "
      + "aconteceram não prevê os próximos, porque o critério muda de propósito a cada "
      + "programa para não ser farmado. Um número aqui descreveria o passado e seria lido "
      + "como expectativa. Não é falta de fonte: é a pergunta que não tem resposta estável.",
  },
  {
    slug: "launchpad",
    name: "Launchpad / IEO",
    subtitle: "alocação com desconto de emissão · $1.000 · evento",
    family: "primario",
    capitalRequiredUsd: 1000,
    capitalWhy: "a alocação é por tier de saldo; abaixo do tier mínimo a participação "
      + "é simbólica e o resultado não representa a estratégia",
    status: "nao_mensuravel",
    notMeasurableWhy: "não alcancei fonte histórica de alocação por tier NEM de preço de "
      + "estreia. Faltam os dois lados da conta — quanto se consegue comprar e por quanto "
      + "se vende — e com um só deles o resultado é metade de uma divisão.",
  },
  {
    slug: "governance_bribes",
    name: "Mercado de votos",
    subtitle: "quem quer direcionar emissão paga · $10.000 · contínuo",
    family: "primario",
    capitalRequiredUsd: 10000,
    capitalWhy: "poder de voto é proporcional; com pouco, o suborno recebido não paga "
      + "o gás de votar",
    status: "nao_mensuravel",
    notMeasurableWhy: "depende de API de marketplace de suborno (Votium, Hidden Hand) que "
      + "não consegui alcançar daqui. ⚠️ Este é o único dos quatro que é NOSSO limite e não "
      + "do mundo: com acesso à API, ele volta para a fila de medição.",
  },

  // ══ NEGÓCIO — não é trade, é receita. Capital nominal.
  {
    slug: "venue_rebate",
    name: "Rebate de corretora",
    subtitle: "a venue paga pelo volume que trazemos · sem capital · contínuo",
    family: "negocio",
    capitalRequiredUsd: 1,
    capitalWhy: "não consome capital — o valor nominal existe só porque a tabela exige "
      + "um número positivo; o que se mede aqui é volume gerado, não retorno",
    status: "cinza",
    hypothesis: "20% a 40% da taxa segundo faixas públicas. É dinheiro na mesa que "
      + "não exige achar borda nenhuma.",
  },
  {
    slug: "protocol_revshare",
    name: "Rev-share de protocolo",
    subtitle: "o protocolo paga por depósito roteado · sem capital · contínuo",
    family: "negocio",
    capitalRequiredUsd: 1,
    capitalWhy: "não consome capital — o que se mede é quanta stablecoin parada os "
      + "clientes têm, não retorno sobre investimento nosso",
    status: "cinza",
  },
];

/** Índice por slug, para lookup barato. */
export const BY_SLUG = new Map(LAB_STRATEGIES.map((s) => [s.slug, s]));

/** As famílias em ordem de exibição — vira aba no painel. */
export const FAMILIES: Array<{ id: LabFamily; label: string; hint: string }> = [
  { id: "direcional", label: "Direcional", hint: "você aposta em preço" },
  { id: "carrego", label: "Carrego", hint: "alguém paga para você esperar" },
  { id: "estrutura", label: "Estrutura", hint: "você é a infraestrutura" },
  { id: "liquidez", label: "Liquidez", hint: "você vira o livro" },
  { id: "primario", label: "Primário", hint: "mercado primário e evento" },
  { id: "negocio", label: "Negócio", hint: "receita, não trade" },
];
