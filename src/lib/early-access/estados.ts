/**
 * MÁQUINA DE ESTADOS DO EARLY ACCESS — espelho da migration 0068.
 *
 * ⚠️ A VERDADE MORA NO BANCO. `early_access_transicao_permitida` e
 * `early_access_transicao_exige_motivo` (0068) são quem decide de fato; esta
 * cópia existe para o painel não oferecer botão que o banco vai recusar. Um
 * teste (`estados.test.ts`) lê a migration e compara as duas — mudar uma sem
 * a outra quebra o teste.
 *
 * VERIFIED e CONVERTED NÃO SÃO ESTADOS (correção C): são marcos de tempo
 * (`email_verified_at`, `converted_at`), ortogonais à decisão de triagem.
 *
 * Sem import de servidor: o painel admin (cliente) importa daqui.
 */
export const ESTADOS = ["pending", "approved", "rejected", "blocked"] as const;
export type Estado = (typeof ESTADOS)[number];

export const TRANSICOES: Readonly<Record<Estado, readonly Estado[]>> = {
  pending:  ["approved", "rejected", "blocked"],
  approved: ["rejected", "blocked"],
  rejected: ["pending", "blocked"],
  blocked:  ["pending"],
};

export function estadoValido(v: unknown): v is Estado {
  return typeof v === "string" && (ESTADOS as readonly string[]).includes(v);
}

export function transicaoPermitida(de: Estado, para: Estado): boolean {
  return TRANSICOES[de].includes(para);
}

/** Rejeitar, bloquear, reconsiderar e desbloquear exigem motivo. */
export function exigeMotivo(de: Estado, para: Estado): boolean {
  return para === "rejected" || para === "blocked" || de === "rejected" || de === "blocked";
}

/**
 * As transições que o painel pode oferecer para uma linha.
 * `approved → rejected` some quando a inscrição já converteu (o banco recusa
 * com `early_access_ja_convertido`).
 */
export function transicoesDisponiveis(de: Estado, convertido: boolean): Estado[] {
  return TRANSICOES[de].filter((p) => !(convertido && de === "approved" && p === "rejected"));
}
