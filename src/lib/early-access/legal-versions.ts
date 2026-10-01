/**
 * VERSÕES DOS TEXTOS LEGAIS que a inscrição de early access aceita.
 *
 * ⚠️⚠️ "UNAPPROVED" NÃO É PLACEHOLDER ACEITÁVEL — é uma trava.
 *
 * Não existe texto jurídico aprovado de Termos de Uso nem de Política de
 * Privacidade (docs/WHITELIST-FUNDRAISING-DISCOVERY.md §9, correção H). Coletar
 * email com um aceite de "versão 1" que não aponta para texto nenhum seria
 * fabricar um consentimento. Então, enquanto estes valores forem "UNAPPROVED":
 *
 *   · o gate (`./gate.ts`) fica FECHADO e a rota pública não aceita nada;
 *   · a validação (`./validate.ts`) recusa a versão mesmo se o gate falhar;
 *   · o banco recusa por CHECK (`ea_versoes_aprovadas`, migration 0068).
 *
 * Trocar o valor exige o texto aprovado PUBLICADO numa página — e é decisão
 * do dono com o jurídico, não de quem escreve código.
 *
 * Sem import de servidor: a página e o formulário (cliente) leem daqui.
 */
export const VERSAO_NAO_APROVADA = "UNAPPROVED" as const;

export const TERMS_VERSION: string = VERSAO_NAO_APROVADA;
export const PRIVACY_VERSION: string = VERSAO_NAO_APROVADA;

/**
 * Formato de uma versão aprovada — o MESMO regex do CHECK `ea_versoes_aprovadas`
 * (0068). Sem espaço, começa com letra ou dígito, até 40 caracteres.
 */
export const FORMATO_VERSAO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/**
 * É o sentinela? Em QUALQUER caixa e com espaço lateral (F-03 da auditoria
 * adversarial): "unapproved", " UNAPPROVED", "UNAPPROVED " também são a trava.
 * Espelha `upper(btrim(v)) = 'UNAPPROVED'` do banco.
 */
export function ehSentinela(v: string): boolean {
  return v.trim().toUpperCase() === VERSAO_NAO_APROVADA;
}

/** Uma versão só vale se tiver o formato explícito e não for a trava. */
export function versaoAprovada(v: string | null | undefined): boolean {
  return typeof v === "string" && FORMATO_VERSAO.test(v) && !ehSentinela(v);
}
