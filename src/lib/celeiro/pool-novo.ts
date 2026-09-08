/**
 * POOL NOVO COM PORTÃO DE SOBREVIVÊNCIA — assimetria com perda limitada.
 *
 * Aposta fixa e pequena em pool recém-criado, atrás de portões MECÂNICOS. É a
 * única categoria do Celeiro onde perder quase sempre é aceitável — desde que
 * o ganho raro pague a série, e desde que cada perda seja do tamanho combinado.
 *
 * ⚠️⚠️ POR QUE OS PORTÕES SÃO MECÂNICOS E NÃO UM MODELO OPINANDO.
 *
 * "Este token parece bom?" é previsão de direção com outra roupa, e previsão de
 * direção por LLM ficou de −6,7 a −30,4 pp ABAIXO do acaso em 3.300 decisões.
 *
 * As perguntas aqui não são de opinião — são de FATO verificável na cadeia:
 * a liquidez está travada? um punhado de carteiras detém tudo? dá para vender?
 * Cada uma tem resposta binária e auditável, e nenhuma pede palpite sobre preço.
 *
 * ⚠️ E O TETO DE MUNIÇÃO É PARTE DA ESTRATÉGIA, não uma precaução. Assimetria só
 * paga se a série tiver fôlego para chegar ao evento raro. Sem teto diário, uma
 * sequência ruim consome o capital antes de o ganho aparecer — e aí a tese
 * "perder quase sempre é aceitável" vira só perder.
 */

export interface Pool {
  /** USD de liquidez no par. */
  liquidezUsd: number;
  /** A liquidez está travada (LP queimado ou em contrato de trava)? */
  /** ⚠️ `null` = não deu para medir. O portão reprova nos dois casos, mas a
   *  recusa diz QUAL dos dois — ver `portaoDeSobrevivencia`. */
  liquidezTravada: boolean | null;
  /**
   * Fração do supply nas 10 maiores carteiras (0 a 1). `null` = não medido.
   *
   * ⚠️ NULO REPROVA, igual ao teste de venda. Concentração desconhecida é o
   * caso em que uma carteira pode ter 90% do supply e ninguém sabe — tratar
   * ausência como "provavelmente pulverizado" é a aposta mais cara possível.
   */
  concentracaoTop10: number | null;
  /** Uma venda de teste passou? `null` = não foi possível testar. */
  vendaTestePassou: boolean | null;
  /** Idade do pool em minutos. */
  idadeMinutos: number;
}

export interface Portao {
  entra: boolean;
  /** Todos os motivos de recusa, não só o primeiro. */
  recusas: string[];
}

export const LIQUIDEZ_MINIMA_USD = Number(process.env.CELEIRO_POOL_LIQ_MIN_USD ?? 15_000);
export const CONCENTRACAO_MAXIMA = Number(process.env.CELEIRO_POOL_TOP10_MAX ?? 0.5);
/** Abaixo disto o pool é jovem demais para os dados serem confiáveis. */
export const IDADE_MINIMA_MIN = Number(process.env.CELEIRO_POOL_IDADE_MIN ?? 10);

/**
 * Os portões. Todos precisam passar.
 *
 * ⚠️ DEVOLVE TODAS AS RECUSAS, NÃO A PRIMEIRA. Parar no primeiro "não" esconde
 * que o pool falhou em quatro coisas ao mesmo tempo — e a diferença entre
 * "quase passou" e "é lixo em todos os eixos" muda se vale a pena afrouxar
 * algum limiar depois. Diagnóstico truncado vira ajuste às cegas.
 *
 * ⚠️ `vendaTestePassou === null` REPROVA. Não conseguir testar a venda é o caso
 * mais perigoso: é exatamente o que um honeypot produz. Tratar "não sei" como
 * "provavelmente ok" é o hábito que este projeto chama de
 * `inconclusivo ≠ aprovado`, e aqui ele custa a aposta inteira.
 */
export function portaoDeSobrevivencia(p: Pool | null): Portao {
  if (p === null) return { entra: false, recusas: ["pool não lido — não medido não é aprovado"] };

  const recusas: string[] = [];

  if (!(p.liquidezUsd >= LIQUIDEZ_MINIMA_USD)) {
    recusas.push(`liquidez ${p.liquidezUsd.toFixed(0)} USD abaixo do mínimo ${LIQUIDEZ_MINIMA_USD}`);
  }
  /**
   * ⚠️⚠️ AS DUAS RECUSAS REPROVAM IGUAL — a diferença é de DIAGNÓSTICO (07/09).
   *
   * "Não medi" e "medi e não está travada" tinham a MESMA frase, e por isso os
   * 92,4% de reprovação nesta linha (2.591 de 2.804 pools em 18 dias) não
   * diziam se o mercado da Base é assim ou se a fonte não indexa LP aqui. As
   * duas leituras pedem ações opostas: aceitar, ou trocar de fonte.
   */
  if (p.liquidezTravada === null) {
    recusas.push("trava da liquidez NÃO MEDIDA — a fonte não devolveu os detentores de LP");
  } else if (!p.liquidezTravada) {
    recusas.push("liquidez não travada — quem criou pode retirá-la a qualquer momento");
  }
  if (p.concentracaoTop10 === null) {
    recusas.push("concentração de detentores não medida — pode ser 90% numa carteira só");
  } else if (!(p.concentracaoTop10 <= CONCENTRACAO_MAXIMA)) {
    recusas.push(
      `top 10 detém ${(p.concentracaoTop10 * 100).toFixed(0)}% do supply `
      + `(teto ${(CONCENTRACAO_MAXIMA * 100).toFixed(0)}%) — a saída deles é o preço`,
    );
  }
  if (p.vendaTestePassou === null) {
    recusas.push("venda de teste não pôde ser feita — é exatamente o que um honeypot produz");
  } else if (!p.vendaTestePassou) {
    recusas.push("venda de teste FALHOU — não dá para sair da posição");
  }
  if (!(p.idadeMinutos >= IDADE_MINIMA_MIN)) {
    recusas.push(`pool com ${p.idadeMinutos} min é jovem demais para os dados serem confiáveis`);
  }

  return { entra: recusas.length === 0, recusas };
}

export interface Municao {
  /** Quantas apostas ainda cabem hoje. */
  restam: number;
  /** O tamanho de cada aposta, em USD. */
  tamanhoUsd: number;
  porque: string;
}

/**
 * A munição do dia.
 *
 * ⚠️ TAMANHO FIXO, NUNCA PROPORCIONAL À "CONFIANÇA". Dimensionar pela convicção
 * exige uma medida de convicção — e a única que tínhamos, a confiança declarada
 * pelo modelo, foi medida como INVERTIDA: diz 47% e acerta 33,3%; diz 76% e
 * acerta 7,7%, monótono em 3.749 decisões. Apostar mais onde a convicção é
 * maior teria concentrado capital exatamente no pior.
 */
export function municaoDoDia(
  gastasHoje: number,
  tetoDiario: number,
  tamanhoUsd: number,
): Municao {
  const restam = Math.max(0, tetoDiario - Math.max(0, gastasHoje));
  return {
    restam,
    tamanhoUsd,
    porque: restam === 0
      ? `munição do dia esgotada (${tetoDiario} apostas) — a série precisa de `
        + "fôlego para chegar ao evento raro, e sem teto uma sequência ruim "
        + "consome o capital antes disso"
      : `${restam} de ${tetoDiario} apostas de ${tamanhoUsd} USD ainda cabem hoje`,
  };
}
