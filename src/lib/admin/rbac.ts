/**
 * RBAC DO ADMIN — papéis e permissões (R2, Admin CC 2.0).
 *
 * Fonte: `docs/ADMIN-API-AUTHORIZATION-MATRIX.md` ("Papéis × permissões") e
 * `docs/ADMIN-SSO-MFA-RBAC-DESIGN.md` §4.8. `rbac.test.ts` confere que esta
 * tabela e a da matriz são a MESMA — doc e código não divergem em silêncio.
 *
 * ⚠️ NÃO É HIERÁRQUICO. `superadmin` tem tudo; os demais têm exatamente o que
 * está listado. Invariantes (testadas): `auditor` nunca recebe escrita; nada
 * aqui deriva de carteira ou de `tier_cache` — papel é atribuído a IDENTIDADE
 * corporativa (R1). Em modo `legacy` (padrão, hoje) este catálogo NÃO decide
 * nada: quem é admin continua sendo `requireAdmin()` (ver `authz.ts`).
 *
 * Módulo PURO (sem servidor): pode ser lido por painel.
 */

export const PAPEIS = [
  "superadmin", "security_admin", "operations", "finance", "support", "analyst", "auditor", "growth",
] as const;
export type Papel = (typeof PAPEIS)[number];

/** Permissão → papéis que a têm ALÉM de `superadmin`. Vazio = só superadmin. */
export const PERMISSOES = {
  "admin.view":                 ["auditor", "growth", "support", "analyst", "operations", "finance", "security_admin"],
  "security.read":              ["security_admin", "operations", "auditor"],
  "security.killswitch.write":  ["security_admin"],
  "identity.invite":            [],
  "identity.revoke":            [],
  "finance.read":               ["finance", "auditor"],
  "finance.export":             ["finance"],
  "ops.read":                   ["operations", "security_admin", "auditor"],
  "ops.control":                ["operations", "security_admin"],
  "paper.manage":               ["analyst"],
  "ai.read":                    ["operations", "finance", "analyst", "security_admin", "auditor"],
  "audit.read":                 ["security_admin", "auditor"],
  "users.support.read":         ["support", "security_admin"],
  "analytics.read":             ["growth", "analyst", "auditor"],
  "identity.read":              ["security_admin", "auditor"],
  "ai.control":                 ["operations", "security_admin"],
  "security.scan.run":          ["security_admin"],
  "security.probe.run":         ["security_admin", "operations"],
  "finance.config.write":       ["finance"],
  "tiers.manage":               [],
  "trading.automation.release": [],
  "lab.read":                   ["analyst", "operations", "auditor"],
  "lab.run":                    ["analyst"],
  "users.access.manage":        ["support"],
  "users.export":               [],
  "agents.read":                ["operations", "security_admin", "auditor"],
  "agents.instruct":            [],
  // reservadas (nenhuma rota atual): gestão de papéis e orçamento de IA
  "roles.grant":                [],
  "roles.revoke":               [],
  "ai.budget.write":            [],
} as const satisfies Record<string, readonly Papel[]>;
export type Permissao = keyof typeof PERMISSOES;

/** Permissões de LEITURA (as únicas que `auditor` pode ter). */
export const PERMISSOES_LEITURA: ReadonlySet<Permissao> = new Set<Permissao>([
  "admin.view", "security.read", "finance.read", "ops.read", "ai.read", "audit.read",
  "users.support.read", "analytics.read", "identity.read", "lab.read", "agents.read",
]);

/** Permissões que NÃO vão para principal legado em `dual` (design §5): identidade e papéis. */
export const PERMISSOES_SO_CORPORATIVAS: ReadonlySet<Permissao> = new Set<Permissao>([
  "identity.invite", "identity.revoke", "roles.grant", "roles.revoke",
]);

export function papelTem(papel: Papel, p: Permissao): boolean {
  return papel === "superadmin" || (PERMISSOES[p] as readonly Papel[]).includes(papel);
}

/** Algum dos papéis tem ALGUMA das permissões (lista = alternativas, "a | b" da matriz). */
export function algumPapelTem(papeis: readonly Papel[], alternativas: readonly Permissao[]): boolean {
  return papeis.some((r) => alternativas.some((p) => papelTem(r, p)));
}
