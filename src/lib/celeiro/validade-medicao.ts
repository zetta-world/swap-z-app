/** Containment of known incomplete models. Historical ledgers remain intact. */
const LIMITACOES: Readonly<Record<string, string>> = Object.freeze({
  colheita_funding: "Funding sem posição reconciliada e recibo atômico por período.",
  convergencia_base: "Convergência sem contabilidade das duas pernas e do spread.",
  pool_novo: "Pool Novo sem custo completo de execução, slippage e gás.",
});

export function limitacaoDaMedicao(agente: string): string | null {
  return LIMITACOES[agente] ?? null;
}

export function medicaoComparavel(agente: string): boolean {
  return limitacaoDaMedicao(agente) === null;
}

export function estadoDaMedicao(agente: string) {
  const motivo = limitacaoDaMedicao(agente);
  return { comparavel: motivo === null, estado: motivo ? "modelo_incompleto" : "simulacao",
    motivo, versao: "paper-observed-v2" };
}
