import {
  anualizar, colher, lerSerieDeFunding, portao, type PeriodoDeFunding,
} from "@/lib/celeiro/funding-colheita";

interface ConfiguracaoDaObservacao {
  simbolos: readonly string[];
  genomaVersao: number | null;
  controleAnualPct: number | null;
  margem: number;
  janelaDias: number;
  limiteDeSerie: number;
}

export interface ExameDeFundingObservado {
  simbolo: string;
  /** Elegibilidade da oportunidade não é uma posição aberta. */
  candidatoElegivel: boolean | null;
  julgado: boolean;
  porqueCandidato: string;
  entra: false;
  porque: string;
  anualPct?: number;
  periodos?: number;
  fatiaNegativa?: number;
  equilibrioEmDias?: number | null;
}

export interface ObservacaoDaColheita {
  estado: "pendente_reconciliacao";
  entradasHabilitadas: false;
  creditosHabilitados: false;
  creditou: 0;
  escreveu: false;
  porque: string;
  genomaVersao: number | null;
  controleAnualPct: number | null;
  margem: number;
  exames: ExameDeFundingObservado[];
}

const PENDENCIA_CONTABIL = "entradas e créditos suspensos até reconciliar posições por símbolo "
  + "e implantar recibos de funding atômicos por período";

/**
 * Mantém a leitura de oportunidades enquanto a contabilização está contida.
 * Sem banco, escritor, capital ou cursor de extrato: uma taxa atual não pode
 * virar crédito retroativo nem um portão aprovado virar posição implícita.
 * O replay puro também não é integrado aqui; ele depende de recibos atômicos.
 */
export async function observarColheitaDeFunding(
  config: Readonly<ConfiguracaoDaObservacao>,
  lerSerie: (simbolo: string, limite: number) => Promise<readonly PeriodoDeFunding[] | null> = lerSerieDeFunding,
): Promise<ObservacaoDaColheita> {
  const controleAnualPct = typeof config.controleAnualPct === "number" && Number.isFinite(config.controleAnualPct)
    ? config.controleAnualPct : null;
  const exames: ExameDeFundingObservado[] = [];

  for (const simbolo of config.simbolos) {
    const serie = await lerSerie(simbolo, config.limiteDeSerie);
    let semJulgamento: string | null = null;
    if (serie === null || serie.length === 0) {
      semJulgamento = "série não lida — não medido não é aprovado";
    } else if (controleAnualPct === null) {
      semJulgamento = "sem a taxa do controle não há barra para comparar";
    } else if (!Number.isFinite(config.margem) || !Number.isFinite(config.janelaDias) || config.janelaDias <= 0) {
      semJulgamento = "parâmetros de comparação inválidos — oportunidade não julgada";
    }
    if (semJulgamento !== null) {
      exames.push({
        simbolo, entra: false, julgado: false, candidatoElegivel: null,
        porque: semJulgamento, porqueCandidato: semJulgamento,
      });
      continue;
    }

    const c = colher(serie!);
    const p = portao(c, controleAnualPct! + config.margem, config.janelaDias);
    exames.push({
      simbolo, entra: false, julgado: true, candidatoElegivel: p.entra,
      porque: p.entra ? PENDENCIA_CONTABIL : p.porque,
      porqueCandidato: p.porque,
      anualPct: anualizar(c, config.janelaDias),
      periodos: c.periodos, fatiaNegativa: c.fatiaNegativa,
      equilibrioEmDias: c.equilibrioEmDias,
    });
  }

  return {
    estado: "pendente_reconciliacao", entradasHabilitadas: false, creditosHabilitados: false,
    creditou: 0, escreveu: false, porque: PENDENCIA_CONTABIL,
    genomaVersao: config.genomaVersao, controleAnualPct, margem: config.margem, exames,
  };
}
