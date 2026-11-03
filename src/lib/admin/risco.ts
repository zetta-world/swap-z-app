import { ACOES, type AcaoId } from "./acoes";

/**
 * CLASSE DE RISCO POR AÇÃO DO ADMIN (SOLO FOUNDER MODE) — `docs/ADMIN-SOLO-FOUNDER-MODE.md` §5.
 *
 * Derivada de `ACOES[*].risco` (a matriz testada), não de uma lista à mão:
 *   · baixo     ← `read`                     (métricas, consultas, logs)
 *   · moderado  ← `write`                    (operacional/laboratório reversível)
 *   · alto      ← `sensitive_write` | `identity` | `financial`
 *   · segregado ← exceções EXPLÍCITAS abaixo: exigem uma segunda pessoa e não há controle
 *                 compensatório adequado com uma só — em `solo_founder` ficam BLOQUEADAS.
 *
 * Módulo PURO (sem servidor).
 */
export type ClasseRisco = "baixo" | "moderado" | "alto" | "segregado";

/**
 * Bloqueadas em `solo_founder`. Por quê, uma a uma:
 *   · `trading.automation.write` — liberar automação com DINHEIRO REAL de cliente (piloto CEX/DCA);
 *     a matriz pede dupla autorização e o modo real segue NO-GO;
 *   · `identity.admins.write` — conceder admin por CARTEIRA (`platform_admins`): criaria um 2º
 *     administrador por fora da identidade corporativa. Em `solo_founder` a fonte `panel` já não
 *     admite ninguém, então revogar por aqui também não é necessário.
 * (Conceder PAPEL corporativo é bloqueado na própria rota `identidades`, por sub-ação.)
 */
export const SEGREGADAS_SOLO: ReadonlySet<AcaoId> = new Set<AcaoId>([
  "trading.automation.write",
  "identity.admins.write",
]);

/**
 * Alto risco mas de CONTENÇÃO: o principal legado da carteira do dono (fonte `env`) pode usar em
 * `dual`+`solo_founder` mesmo sem sessão corporativa — travar um incidente não pode depender do IdP.
 */
export const CONTENCAO_SOLO: ReadonlySet<AcaoId> = new Set<AcaoId>(["security.killswitch.set"]);

export function classeDeRisco(acao: string): ClasseRisco {
  if (SEGREGADAS_SOLO.has(acao as AcaoId)) return "segregado";
  const def = (ACOES as Record<string, { risco: string } | undefined>)[acao];
  if (!def) return acao.startsWith("pagina:") ? "baixo" : "alto";   // desconhecida: trata como alta
  if (def.risco === "read") return "baixo";
  if (def.risco === "write") return "moderado";
  return "alto";
}
