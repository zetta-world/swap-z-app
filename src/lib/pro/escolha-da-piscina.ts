/**
 * QUAL PISCINA O TERMINAL DEVE MOSTRAR — a medição que ninguém fez.
 *
 * ⚠️⚠️ O DEFEITO QUE ORIGINOU ISTO (31/08). O dono abriu o `/pro` em BNB no
 * gráfico de 1 minuto e disse: *"o gráfico nem se mexe"*. Ele estava certo, e a
 * causa não era o gráfico — era o endereço.
 *
 * `PRO_PAIRS` aponta `bnb-usdt` para a PancakeSwap **V3 0,05%**. A tela que ele
 * comparou, na DEXTools, era a **V2**. Ninguém escolheu isso: os endereços foram
 * escritos à mão quando o terminal nasceu e nunca foram medidos contra
 * alternativa nenhuma. Uma constante escrita uma vez decide o que o usuário vê
 * todo dia.
 *
 * ⚠️ E A PERGUNTA NÃO É "QUAL PISCINA TEM MAIS TVL". São DUAS perguntas, e elas
 * podem discordar:
 *
 *   A) **O gráfico se mexe?** → cobertura de velas de 1 minuto. A GeckoTerminal
 *      só devolve o minuto em que houve trade; minuto sem trade não vem. Então
 *      "quantos dos últimos 180 minutos têm vela" É a medida literal do que o
 *      dono viu na tela — não um proxy dela.
 *
 *   B) **A execução é a melhor?** → TVL. Uma piscina rasa dá pior preço em
 *      qualquer tamanho que valha a pena operar.
 *
 * Uma piscina V3 concentrada pode ter menos TVL e mais trades; uma V2 gorda pode
 * ter mais TVL e um gráfico picotado. **Quando as duas réguas apontam para
 * piscinas diferentes, isto devolve `conflito` e não escolhe.** Compor as duas
 * num "score" único esconderia exatamente a informação que o humano precisa
 * para decidir — é o mesmo erro do painel de liquidez que pintava de verde uma
 * piscina que perdeu 53%, porque segurar perdeu 54%.
 *
 * ⚠️ E PROFUNDIDADE DE V3 NÃO ESTÁ AQUI, DE PROPÓSITO. Saber qual piscina
 * executa melhor $10k exigiria a liquidez por tick, que a GeckoTerminal não
 * publica. TVL é o que dá para medir honestamente, e está rotulado como TVL —
 * não como "profundidade". Ver `notMeasured` no resultado da rota.
 */

/** A janela declarada ANTES da rodada. Ver a invariante nº 12 do laboratório. */
export const JANELA_MIN = 180;

/**
 * Abaixo disto, o gráfico de 1 minuto tem mais buraco que vela.
 *
 * ⚠️ 50% não é gosto: é o ponto em que a maioria dos minutos da tela é
 * interpolação entre dois trades distantes, e a vela deixa de descrever o
 * minuto que ela ocupa.
 */
export const COBERTURA_MINIMA_PCT = 50;

/**
 * Diferença de cobertura que autoriza trocar de piscina.
 *
 * ⚠️ EXISTE PARA NÃO TROCAR POR RUÍDO. Duas piscinas medidas em janelas de 180
 * minutos vão diferir por alguns pontos só pelo acaso de quem operou naquele
 * intervalo. Trocar o endereço de produção por 3 pontos seria decidir no ruído.
 */
export const DIFERENCA_QUE_DECIDE_PCT = 10;

/** Sem trade há mais tempo que isto, o preço no topo da tela é história. */
export const ATRASO_QUE_CONDENA_MIN = 15;

export interface VelaLida {
  /** Unix em SEGUNDOS — é o que a GeckoTerminal devolve. */
  time: number;
  high: number;
  low: number;
  close: number;
}

export interface MedidaDaVela {
  velasLidas: number | null;
  /** Velas com `high === low`: houve trade, mas a um preço só. */
  velasParadas: number | null;
  minutosComVela: number | null;
  coberturaPct: number | null;
  amplitudeMediaPct: number | null;
  /** Minutos desde a vela mais recente. `null` quando não veio vela nenhuma. */
  atrasoMin: number | null;
}

const VAZIO: MedidaDaVela = {
  velasLidas: null, velasParadas: null, minutosComVela: null,
  coberturaPct: null, amplitudeMediaPct: null, atrasoMin: null,
};

/**
 * As velas de 1 minuto viram cobertura, buraco e chacoalho.
 *
 * ⚠️ A LISTA VAZIA AQUI SIGNIFICA COBERTURA ZERO, e isso só é verdade porque
 * quem chama garante que a fonte RESPONDEU. `getOHLCV` engole a falha e devolve
 * `[]`, então a rota usa `getOHLCVOuFalha` — sem isso, "GeckoTerminal recusou"
 * ficaria idêntico a "esta piscina está morta", que é o par de estados mais
 * caro desta casa.
 */
export function medirVelas(
  velas: ReadonlyArray<VelaLida>,
  agoraMs: number,
  janelaMin: number = JANELA_MIN,
): MedidaDaVela {
  if (!Number.isFinite(agoraMs) || agoraMs <= 0) return VAZIO;
  const janela = Number.isFinite(janelaMin) && janelaMin > 0 ? Math.floor(janelaMin) : JANELA_MIN;

  const validas = velas.filter(
    (c) => Number.isFinite(c.time) && c.time > 0 && Number.isFinite(c.close) && c.close > 0
      && Number.isFinite(c.high) && Number.isFinite(c.low) && c.high >= c.low,
  );

  const maisNova = validas.reduce((m, c) => (c.time > m ? c.time : m), 0);
  const atrasoMin = maisNova > 0 ? Math.max(0, (agoraMs - maisNova * 1000) / 60_000) : null;

  /**
   * ⚠️⚠️ A JANELA CONTA MINUTOS INTEIROS, E O TESTE PEGOU ISTO. Comparar
   * milissegundos com `>= agora − 180min` e `<= agora` inclui as DUAS bordas:
   * 181 minutos distintos numa janela chamada de 180, e uma cobertura que
   * passava de 100% antes do `Math.min`. Uma janela de N minutos tem N
   * começos de minuto, não N+1.
   *
   * ⚠️ E A TOLERÂNCIA DE RELÓGIO VIRA COLAPSO, NÃO ALARGAMENTO. Uma vela
   * carimbada até um minuto no futuro é a vela do minuto corrente sob
   * desencontro de relógio — então ela é DOBRADA para o minuto corrente em vez
   * de esticar a janela, que era por onde o 181º minuto entrava.
   */
  const minutoAgora = Math.floor(agoraMs / 60_000);
  const primeiro = minutoAgora - janela + 1;
  const dentro = validas.filter((c) => {
    const m = Math.floor(c.time / 60);
    return m >= primeiro && m <= minutoAgora + 1;
  });
  /** Deduplica por minuto: a fonte já devolve uma vela por minuto, mas contar
   *  minutos DISTINTOS é o que a cobertura afirma — não o tamanho do array. */
  const minutos = new Set(dentro.map((c) => Math.min(Math.floor(c.time / 60), minutoAgora)));
  const minutosComVela = minutos.size;

  const paradas = dentro.filter((c) => c.high === c.low).length;
  const somaAmp = dentro.reduce((s, c) => s + ((c.high - c.low) / c.close) * 100, 0);

  return {
    velasLidas: dentro.length,
    velasParadas: paradas,
    minutosComVela,
    coberturaPct: Math.min(100, (minutosComVela / janela) * 100),
    amplitudeMediaPct: dentro.length > 0 ? somaAmp / dentro.length : null,
    atrasoMin,
  };
}

export interface LeituraDaPiscina extends MedidaDaVela {
  piscina: string;
  rotulo: string;
  /** É o endereço que `PRO_PAIRS` usa hoje. */
  atual: boolean;
  /** `null` quando leu. Texto quando a fonte recusou — nunca vira zero. */
  porqueNaoLeu: string | null;
  /**
   * ⚠️ POR QUE O TVL FALTA — e sem este campo a frase saía uma calúnia.
   *
   * A vela e a meta são duas requisições. A vela pode ter lido e a meta ter
   * batido em 429; a linha fica `lida` com `tvlUsd: null`, e `julgarPar`
   * escrevia *"nenhuma das 2 piscinas lidas devolveu TVL"* — descrevendo duas
   * piscinas de bilhões de dólares como se elas não publicassem tamanho.
   *
   * `null` aqui significa "a meta foi lida" (o TVL nulo é da fonte mesmo);
   * texto significa "não perguntamos ou fomos barrados".
   */
  porqueNaoLeuMeta?: string | null;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  trocas24h: number | null;
  precoUsd: number | null;
}

export type VereditoPiscina =
  | "atual_e_a_melhor"
  | "trocar"
  | "conflito"
  | "inconclusiva"
  /**
   * ⚠️ A FONTE NOS BARROU — e este estado existe porque em 31/08 ele saiu como
   * `inconclusiva` com o texto "0 de 1 piscinas foram lidas", que se lê como
   * "este par só tem uma piscina". Ver a nota dentro de `julgarPar`.
   */
  | "fonte_recusou";

export interface JulgamentoDoPar {
  melhorParaOGrafico: string | null;
  maiorLiquidez: string | null;
  atual: string | null;
  veredito: VereditoPiscina;
  porque: string;
  lidas: number;
  candidatas: number;
}

const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);
const usd = (n: number | null) =>
  n == null ? "—" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString("pt-BR")}`;

/**
 * As duas réguas, e o silêncio quando elas discordam.
 *
 * ⚠️ NÃO DEVOLVE VENCEDOR ÚNICO. `melhorParaOGrafico` e `maiorLiquidez` são
 * campos separados justamente porque podem apontar para piscinas diferentes, e
 * nesse caso o veredito é `conflito` — a decisão é de produto, não de função.
 */
export function julgarPar(leituras: ReadonlyArray<LeituraDaPiscina>): JulgamentoDoPar {
  const candidatas = leituras.length;
  const lidas = leituras.filter((l) => l.porqueNaoLeu === null && l.coberturaPct != null);
  const atualLeitura = lidas.find((l) => l.atual) ?? null;
  const atual = atualLeitura?.piscina ?? null;

  const base = { melhorParaOGrafico: null, maiorLiquidez: null, atual, lidas: lidas.length, candidatas };

  if (lidas.length < 2) {
    /**
     * ⚠️⚠️ "NÃO HÁ ALTERNATIVA" E "A FONTE RECUSOU" SÃO COISAS DIFERENTES, e em
     * 31/08 esta função as colapsou — no primeiro dia de vida dela.
     *
     * O dono clicou em MEDIR TODOS. A GeckoTerminal devolveu 429 em 56 das 62
     * leituras, e o veredito gravado no banco foi:
     *
     *     "0 de 1 piscinas foram lidas — comparação precisa de duas."
     *
     * Que se lê como *"este par só tem uma piscina"*. O estado real era *"não
     * medimos nada, a fonte nos barrou"* — e são conclusões opostas: a primeira
     * encerra o assunto, a segunda pede outra rodada.
     *
     * É literalmente o defeito que este arquivo inteiro foi escrito para evitar,
     * cometido por quem escreveu o aviso. Por isso a distinção agora é lida do
     * `porqueNaoLeu` de cada linha, e não inferida da contagem.
     */
    const naoLidas = leituras.filter((l) => l.porqueNaoLeu !== null);
    const recusadas = naoLidas.filter((l) => /geckoterminal|429|limite|rede/i.test(l.porqueNaoLeu ?? ""));

    /**
     * ⚠️ E SÓ QUANDO NADA FOI LIDO. Este portão nasceu agressivo demais e o
     * próprio teste pegou: com a piscina atual LIDA e uma alternativa em 429,
     * ele gritava "a fonte recusou" sobre uma rodada que mediu metade. Ter uma
     * leitura e não ter comparação é `inconclusiva` com nota — não rodada
     * perdida. Trocar um exagero por outro não seria conserto.
     */
    if (lidas.length === 0 && naoLidas.length > 0 && recusadas.length === naoLidas.length) {
      return {
        ...base,
        veredito: "fonte_recusou",
        porque: `a fonte recusou ${recusadas.length} de ${candidatas} leituras `
          + `(${recusadas[0].porqueNaoLeu}) — NADA foi medido sobre este par. `
          + `Isto não é "só existe uma piscina": é uma rodada perdida, e ela pede outra `
          + `com menos pares de uma vez.`,
      };
    }

    return {
      ...base,
      veredito: "inconclusiva",
      porque: `${lidas.length} de ${candidatas} piscinas foram lidas — comparação precisa de duas. `
        + `Piscina só é pior que outra quando a outra existe na medição.`
        + (recusadas.length > 0
          ? ` ⚠️ ${recusadas.length} das não-lidas foram recusa da fonte, não ausência de piscina.`
          : ""),
    };
  }
  if (!atualLeitura) {
    return {
      ...base,
      veredito: "inconclusiva",
      porque: `a piscina que o terminal usa hoje não foi lida nesta rodada — sem ela não há contra o que comparar. `
        + `${lidas.length} alternativas leram.`,
    };
  }

  /** Cobertura desc; empate desempata por TVL, não por acaso da ordem. */
  const porGrafico = [...lidas].sort((a, b) =>
    (b.coberturaPct ?? 0) - (a.coberturaPct ?? 0) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  const melhorG = porGrafico[0];

  const comTvl = lidas.filter((l) => l.tvlUsd != null);
  const melhorL = comTvl.length > 0
    ? [...comTvl].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))[0]
    : null;

  /**
   * ⚠️ SEM TVL EM NENHUMA CANDIDATA, UMA DAS DUAS RÉGUAS NÃO EXISTIU — e um
   * veredito com uma régua só se disfarçaria de veredito com duas. "Não medido
   * não é aprovado" vale aqui como vale no flywheel: a saída é `inconclusiva`,
   * não "a cobertura decide sozinha".
   */
  if (melhorL == null) {
    /**
     * ⚠️ E O TEXTO MUDA CONFORME O MOTIVO. "A piscina não publicou TVL" e "não
     * conseguimos perguntar" levam a ações opostas: a primeira é um fato sobre
     * a piscina, a segunda é uma rodada a repetir.
     */
    const metaBarrada = lidas.filter((l) => l.porqueNaoLeuMeta != null);
    const causa = metaBarrada.length > 0
      ? `a fonte barrou a leitura de tamanho em ${metaBarrada.length} de ${lidas.length} piscinas `
        + `(${metaBarrada[0].porqueNaoLeuMeta}) — o TVL não está ausente, ele não foi perguntado`
      : `nenhuma das ${lidas.length} piscinas lidas devolveu TVL`;
    return {
      ...base,
      melhorParaOGrafico: melhorG.piscina,
      veredito: "inconclusiva",
      porque: `${causa} — a régua da execução não foi medida nesta rodada. Pela cobertura, `
        + `${melhorG.rotulo} lidera com ${pct(melhorG.coberturaPct)}, mas uma régua só não `
        + `decide troca de endereço.`,
    };
  }

  const cobAtual = atualLeitura.coberturaPct ?? 0;
  const ganho = (melhorG.coberturaPct ?? 0) - cobAtual;

  /** Dito em toda saída: é a queixa do dono, medida. */
  const queixa = cobAtual < COBERTURA_MINIMA_PCT
    ? ` ⚠️ E a atual cobre só ${pct(cobAtual)} dos últimos ${JANELA_MIN} minutos — abaixo de `
      + `${COBERTURA_MINIMA_PCT}% o gráfico de 1m tem mais buraco que vela, que é exatamente o "não se mexe".`
    : "";
  const atrasada = (atualLeitura.atrasoMin ?? 0) > ATRASO_QUE_CONDENA_MIN
    ? ` ⚠️ Último trade da atual há ${Math.round(atualLeitura.atrasoMin ?? 0)} min — o preço no topo da tela é história.`
    : "";

  const nomeG = melhorG.rotulo;
  const nomeL = melhorL.rotulo;
  const saida = {
    ...base,
    melhorParaOGrafico: melhorG.piscina,
    maiorLiquidez: melhorL.piscina,
  };

  const mesmaCoisa = melhorL.piscina === melhorG.piscina;

  if (ganho < DIFERENCA_QUE_DECIDE_PCT && melhorL.piscina === atual) {
    return {
      ...saida,
      veredito: "atual_e_a_melhor",
      porque: `a atual (${atualLeitura.rotulo}) cobre ${pct(cobAtual)} e a melhor alternativa cobre `
        + `${pct(melhorG.coberturaPct)} — ${ganho.toFixed(0)} pontos, dentro do ruído de ${DIFERENCA_QUE_DECIDE_PCT}. `
        + `E ela é a de maior TVL (${usd(atualLeitura.tvlUsd)}). As duas réguas concordam: fica.${queixa}${atrasada}`,
    };
  }

  if (ganho >= DIFERENCA_QUE_DECIDE_PCT && mesmaCoisa && melhorG.piscina !== atual) {
    return {
      ...saida,
      veredito: "trocar",
      porque: `${nomeG} cobre ${pct(melhorG.coberturaPct)} contra ${pct(cobAtual)} da atual `
        + `(+${ganho.toFixed(0)} pontos) E tem o maior TVL (${usd(melhorG.tvlUsd)} contra `
        + `${usd(atualLeitura.tvlUsd)}). As duas réguas apontam para a mesma piscina.${queixa}${atrasada}`,
    };
  }

  return {
    ...saida,
    veredito: "conflito",
    porque: `as duas réguas discordam e esta função NÃO escolhe. Gráfico: ${nomeG} `
      + `(${pct(melhorG.coberturaPct)} contra ${pct(cobAtual)} da atual). Liquidez: ${nomeL} `
      + `(${usd(melhorL.tvlUsd)} contra ${usd(atualLeitura.tvlUsd)}). `
      + `Trocar melhora uma e piora a outra — é decisão de produto.${queixa}${atrasada}`,
  };
}
