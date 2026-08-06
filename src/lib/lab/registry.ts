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
 * VERDE = medida por nós, positiva. MORTA = medida, negativa.
 * CINZA = **não medida**. Não é aprovação nem reprovação, e a tela mostra
 * cinza e não âmbar de propósito: ausência de informação não é um aviso.
 */
export type LabStatus = "verde" | "cinza" | "morta";

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
  },
  {
    slug: "regime_filter",
    name: "Filtro de regime",
    subtitle: "opera só quando há direção · $5.000 · janela de 174 dias",
    family: "direcional",
    capitalRequiredUsd: 5000,
    capitalWhy: "mesmo capital das mesas de tendência — o filtro é a variável isolada, "
      + "e ele é medido contra a MESMA estratégia sem filtro",
    status: "cinza",
    hypothesis: "direção paga, lateralidade mata. Mercado a −63% deu +27,7%; a +0,1% deu "
      + "+18,5%; a −15% SEM direção matou todas. ⚠️ Já levantei uma hipótese de regime antes "
      + "(o clima) e a minha própria medição derrubou — isto é candidato, não promessa.",
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
    status: "cinza",
    hypothesis: "3,5% a 9% ao ano segundo fontes públicas de 2026 — o que precisa ser "
      + "medido é quanto o gás come disso por faixa de capital",
  },
  {
    slug: "tokenized_treasury",
    name: "Tesouro tokenizado",
    subtitle: "renda de título público on-chain · $1.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 1000,
    capitalWhy: "mínimos de emissor giram nessa faixa; abaixo disso o custo de entrada "
      + "domina um rendimento que é de dígito único",
    status: "cinza",
    hypothesis: "3,3% a 8% ao ano — é o piso seguro do produto, não a estrela",
  },
  {
    slug: "liquid_staking",
    name: "Staking líquido",
    subtitle: "stETH e similares · $1.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 1000,
    capitalWhy: "sem mínimo; o custo real é o gás de entrada e saída, e $1.000 é onde "
      + "ele deixa de ser proibitivo sem ainda ser desprezível",
    status: "cinza",
    hypothesis: "2,3% a 2,6% depois das taxas do provedor — abaixo do empréstimo de "
      + "stablecoin no regime atual, o que é contraintuitivo e vale confirmar",
  },
  {
    slug: "restaking",
    name: "Restaking",
    subtitle: "aluga a segurança do staking · $2.000 · contínuo",
    family: "carrego",
    capitalRequiredUsd: 2000,
    capitalWhy: "camada extra de risco de corte pede amostra maior para o resultado "
      + "distinguir rendimento de sorte",
    status: "cinza",
    hypothesis: "5% a 15% ao ano com risco de corte empilhado — o rendimento extra "
      + "pode ser só o prêmio do risco novo",
  },
  {
    slug: "funding_basis",
    name: "Funding / cash-and-carry",
    subtitle: "spot comprado + perp vendido · $2.000 · 360 dias",
    family: "carrego",
    capitalRequiredUsd: 2000,
    capitalWhy: "o ciclo tem quatro pernas a 0,45%; abaixo de $2.000 o custo fixo come "
      + "o funding antes de ele acumular, e o resultado mede a taxa, não a estratégia",
    status: "cinza",
    hypothesis: "⚠️ A MAIOR INCERTEZA DO MAPA. Nossa medição de 04/08 deu mediana de "
      + "+1,4% ao ano em 53 símbolos; a literatura vende 5% a 20%. Uma das duas está "
      + "errada e o desfecho muda o produto. Fonte limitada a 30-60 dias — remedir com 360.",
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
    status: "cinza",
    hypothesis: "volatilidade implícita do BTC roda 50-80% ao ano contra 15-20% do S&P — "
      + "é o prêmio mais gordo e estruturalmente persistente deste mercado, e nunca medimos",
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
    status: "cinza",
    hypothesis: "nunca medida. É a família que os traders de copy operam e a única "
      + "direcional do mapa que não testamos.",
  },
  {
    slug: "grid_bot",
    name: "Grade (grid)",
    subtitle: "compra e vende dentro de uma faixa · $1.000 · 174 dias",
    family: "direcional",
    capitalRequiredUsd: 1000,
    capitalWhy: "muitas ordens pequenas é o caso de uso REAL desta estratégia — medir "
      + "com capital grande responderia uma pergunta que ninguém faz",
    status: "cinza",
    hypothesis: "15% a 60% ao ano em consolidação segundo fontes públicas, mas um "
      + "rompimento apaga semanas; em teste comparativo só 3 de 8 bots deram lucro em 6 meses",
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
    status: "cinza",
    hypothesis: "o único terreno com vantagem estrutural — o tempo de bloco cria janela "
      + "lenta por construção. ⚠️ MEV compete pesado e a resposta pode ser a mesma das outras.",
  },
  {
    slug: "liquidations",
    name: "Liquidações",
    subtitle: "compra a garantia com desconto · $10.000 · evento",
    family: "estrutura",
    capitalRequiredUsd: 10000,
    capitalWhy: "capital tem que estar PRONTO quando o evento vem, e o evento não avisa; "
      + "capital pequeno perde as liquidações grandes, que são as que pagam",
    status: "cinza",
    hypothesis: "5% a 10% por evento, concentrado em poucos momentos de estresse",
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
    status: "cinza",
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
    status: "cinza",
    hypothesis: "retorno binário e não anualizável. Alto valor relativo para o peixe "
      + "pequeno justamente porque não depende de capital.",
  },
  {
    slug: "launchpad",
    name: "Launchpad / IEO",
    subtitle: "alocação com desconto de emissão · $1.000 · evento",
    family: "primario",
    capitalRequiredUsd: 1000,
    capitalWhy: "a alocação é por tier de saldo; abaixo do tier mínimo a participação "
      + "é simbólica e o resultado não representa a estratégia",
    status: "cinza",
  },
  {
    slug: "governance_bribes",
    name: "Mercado de votos",
    subtitle: "quem quer direcionar emissão paga · $10.000 · contínuo",
    family: "primario",
    capitalRequiredUsd: 10000,
    capitalWhy: "poder de voto é proporcional; com pouco, o suborno recebido não paga "
      + "o gás de votar",
    status: "cinza",
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
