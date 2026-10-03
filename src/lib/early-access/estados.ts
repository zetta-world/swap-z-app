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
 * D-4 (0069): aprovar EXIGE email verificado. A verdade é o banco (CHECK
 * `ea_aprovado_exige_email` + erro `early_access_email_nao_verificado` na
 * RPC); isto só evita o painel oferecer o botão que o banco recusa.
 */
export function exigeEmailVerificado(para: Estado): boolean {
  return para === "approved";
}

/**
 * As transições que o painel pode oferecer para uma linha.
 * `approved → rejected` some quando a inscrição já converteu (o banco recusa
 * com `early_access_ja_convertido`). `→ approved` some sem email verificado
 * — e o padrão é NÃO verificado (na dúvida, não oferece).
 */
export function transicoesDisponiveis(de: Estado, convertido: boolean, emailVerificado = false): Estado[] {
  return TRANSICOES[de].filter((p) =>
    !(convertido && de === "approved" && p === "rejected")
    && !(exigeEmailVerificado(p) && !emailVerificado));
}

/**
 * EA2-IA07: MOTIVO DE TRANSIÇÃO = CÓDIGO CONTROLADO, nunca texto livre.
 *
 * O `admin_audit_log` é PERSISTENTE e não é apagado pela purga de privacidade.
 * Texto livre ali ("João da Silva - x@example.com") sobreviveria à purga do
 * titular — e um comentário pedindo "não escreva PII" não é controle técnico.
 * Então o log persistente só recebe um destes códigos. A nota humana opcional
 * vai SÓ para registros da própria inscrição (`early_access_events.reason`,
 * `status_reason`), que a purga apaga junto com ela.
 */
export const MOTIVOS = [
  "approved_verified", "rejected_policy", "duplicate", "abuse",
  "owner_request", "administrative_correction", "other",
] as const;
export type Motivo = (typeof MOTIVOS)[number];

export function motivoValido(v: unknown): v is Motivo {
  return typeof v === "string" && (MOTIVOS as readonly string[]).includes(v);
}

/** Teto da nota humana (cabe em `status_reason` ≤ 500 com o código na frente). */
export const NOTA_MAX = 400;
