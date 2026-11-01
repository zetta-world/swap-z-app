import { notFound } from "next/navigation";
import { requireAdmin, type FonteLegada } from "@/lib/admin/require";
import { logSecurityAguardado } from "@/lib/admin/auditoria-duravel";
import { ACOES, type AcaoId } from "@/lib/admin/acoes";
import { PERMISSOES_BREAKGLASS, PERMISSOES_SO_CORPORATIVAS, algumPapelTem, type Permissao } from "@/lib/admin/rbac";
import { COOKIE_ADMIN } from "@/lib/admin/sessao-corporativa";

/**
 * PONTO ÚNICO DE DECISÃO DO ADMIN (R2, Admin CC 2.0) — `autorizarAdmin(ação)`.
 *
 * Todo handler de `src/app/admin/api/**` chama isto com o id da SUA linha em
 * `ACOES` (teste de completude por método). Hoje a decisão continua sendo a
 * de `requireAdmin()`; o que muda é que existe UM lugar onde ela é tomada, com
 * a ação nomeada — e é aqui que o RBAC corporativo (R1/R2) entra sem tocar os
 * 79 handlers de novo.
 *
 * MODOS (`ADMIN_AUTH_MODE`, env do servidor — design §5):
 *   · ausente / `legacy` → EXATAMENTE a decisão de hoje (3 fontes legadas). A
 *     única diferença é a observação R5: qual fonte autorizou qual ação
 *     (`admin_legacy_admit`), sem mudar a decisão e sem pendurar a resposta;
 *   · `dual` → sessão CORPORATIVA válida (R1: Google/Microsoft + TOTP aal2) decide
 *     POR PAPEL, com step-up nas ações `step_up`; sem ela, só as fontes de
 *     `ADMIN_LEGACY_SOURCES` (padrão `env,panel,tier`) — principal legado NÃO
 *     recebe identidade/papéis (exceto `env`, o bootstrap);
 *   · `corp` → só sessão corporativa (ou break-glass na janela do dono). Sem a
 *     configuração R1 válida, FECHA o Admin (404 + alerta alto). Por isso o runbook
 *     só manda ligar `corp` depois de duas contas reais com MFA testadas em `dual`;
 *   · qualquer outro valor → Admin fechado (404) + alerta alto: erro de operador
 *     visível, sem abrir nada.
 *
 * Negação = `notFound()` (404, nunca 403), registrada e AGUARDADA com teto,
 * como em `requireAdmin`. Para o principal corporativo, recusa por papel ou por
 * step-up também é 404 — e grava `denied` em `admin_audit` (o handler não pode
 * devolver Response daqui; divergência do desenho §4.7, que previa 403/401:
 * quem renova o step-up vai a `/admin-acesso/step-up`).
 */

import { lerModoAuth, fontesLegadasPermitidas, type ModoAuth } from "@/lib/admin/authz-modo";
export { lerModoAuth, fontesLegadasPermitidas, type ModoAuth, type LeituraModo } from "@/lib/admin/authz-modo";

/** Quem foi admitido: uma das fontes legadas, a sessão corporativa (R1) ou o break-glass. */
export type FonteAdmissao = FonteLegada | "corp" | "breakglass";

export interface Autorizado {
  /**
   * Compatível com `requireAdmin()`: os handlers que usam o ator seguem iguais. Corporativo =
   * `corp:<identity_id>`; break-glass = `breakglass:<carteira>` (design §4.7).
   */
  wallet: string;
  fonte: FonteAdmissao;
  acao: AcaoId;
  modo: ModoAuth;
}

/** Decisão de PÁGINA (layout, mural): mesmo caminho, rótulo `pagina:<nome>`. */
export interface PaginaAutorizada {
  wallet: string;
  fonte: FonteAdmissao;
  pagina: string;
  modo: ModoAuth;
}

async function negar(kind: string, meta: Record<string, unknown>, severity: "low" | "med" | "high"): Promise<never> {
  await logSecurityAguardado(kind, meta, severity);
  notFound();
}

// ── R5: observação da fonte legada (não decide nada) ─────────────────────────

const JANELA_OBSERVACAO_MS = 10 * 60_000;
const TETO_OBSERVACAO_MS = 400;
const vistos = new Map<string, number>();

/**
 * Registra `admin_legacy_admit {fonte, acao}` — a evidência para decidir, em
 * R5, quais fontes legadas podem ser desligadas sem trancar ninguém.
 *
 * ⚠️ NUNCA muda a decisão, nunca lança, e tem teto curto: é telemetria, não
 * requisito de segurança. Deduplicado por instância (fonte+ator+ação a cada
 * 10 min) para não virar uma escrita por clique.
 */
export async function observarAdmissaoLegada(
  a: { wallet: string; fonte: FonteLegada; modo: ModoAuth; acao: string }, agora = Date.now(),
): Promise<void> {
  try {
    const chave = `${a.fonte}|${a.wallet}|${a.acao}`;
    const ultimo = vistos.get(chave);
    if (ultimo != null && agora - ultimo < JANELA_OBSERVACAO_MS) return;
    vistos.set(chave, agora);
    if (vistos.size > 5_000) vistos.clear();
    const { recordEvent } = await import("@/lib/admin/track");
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      recordEvent("admin_legacy_admit", {
        meta: { fonte: a.fonte, acao: a.acao, modo: a.modo, ator: `${a.wallet.slice(0, 10)}…` },
      }),
      new Promise<void>((res) => { timer = setTimeout(res, TETO_OBSERVACAO_MS); }),
    ]).finally(() => clearTimeout(timer));
  } catch {
    // observação é best-effort POR DESENHO (design §5): a decisão já foi tomada.
  }
}

/** Só para testes: esquece a deduplicação. */
export function _esquecerObservacoes(): void { vistos.clear(); }

// ── a decisão ────────────────────────────────────────────────────────────────

export async function autorizarAdmin(acao: AcaoId): Promise<Autorizado> {
  const def = ACOES[acao];
  if (!def) {
    // Id fora do registro não compila; isto cobre `as never`/JS.
    return negar("admin_acao_desconhecida", { acao: String(acao).slice(0, 80) }, "high");
  }
  const r = await decidir(acao, def.permissoes, def.mfa === "step_up");
  return { wallet: r.wallet, fonte: r.fonte, acao, modo: r.modo };
}

/**
 * Páginas (layout do Admin, mural) — o MESMO ponto de decisão (revisão adversarial):
 * antes chamavam `requireAdmin()` direto, então em `dual` restrito, `corp` ou modo
 * inválido um principal recusado nas APIs ainda recebia o shell, a chave anon do
 * realtime e o mural. Permissão: `admin.view`.
 */
export async function autorizarPaginaAdmin(pagina: "shell" | "mural"): Promise<PaginaAutorizada> {
  const r = await decidir(`pagina:${pagina}`, ["admin.view"], false);
  return { wallet: r.wallet, fonte: r.fonte, pagina, modo: r.modo };
}

/** Cookie da sessão corporativa, se houver. Fora de requisição (testes, build) = nenhum. */
async function cookieCorporativo(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    return (await cookies()).get(COOKIE_ADMIN)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * R1: sessão corporativa (ou break-glass) → decisão POR PAPEL. `null` = não há sessão corporativa
 * utilizável (o chamador decide o que fazer: `dual` cai no legado, `corp` nega).
 */
async function decidirCorporativo(
  acao: string, permissoes: readonly Permissao[], exigeStepUp: boolean, modo: ModoAuth,
): Promise<{ wallet: string; fonte: FonteAdmissao; modo: ModoAuth } | null> {
  const token = await cookieCorporativo();
  if (!token) return null;
  const { lerConfigCorp } = await import("@/lib/admin/corp/config");
  const cfg = lerConfigCorp();
  if (!cfg.ok) {
    return negar("admin_corp_config_invalida", { acao, motivo: cfg.motivo, porque: "cookie corporativo presente sem configuração R1 válida" }, "high");
  }
  const { lerPrincipal } = await import("@/lib/admin/corp/fluxo");
  const lido = await lerPrincipal(token);
  if (!lido.ok) {
    if (modo === "corp") return negar("admin_corp_sessao_invalida", { acao, codigo: lido.codigo }, lido.codigo === "banco" ? "high" : "med");
    return null;   // dual: cookie velho/inválido não impede a carteira legada
  }
  const p = lido.principal;
  const permitido = p.kind === "breakglass"
    ? permissoes.some((x) => PERMISSOES_BREAKGLASS.has(x))
    : algumPapelTem(p.papeis, permissoes);
  const quem = p.kind === "breakglass" ? `breakglass:${p.wallet}` : `corp:${p.identityId}`;
  const negarCorp = async (kind: string, motivo: string): Promise<never> => {
    try {
      const { repoCorp } = await import("@/lib/admin/corp/repo");
      await Promise.race([
        repoCorp().auditar({
          request_id: globalThis.crypto.randomUUID(), actor_kind: p.kind === "breakglass" ? "breakglass" : "corp",
          actor_identity_id: p.kind === "corp" ? p.identityId : null, actor_session_id: p.sessionId,
          actor_roles: p.kind === "corp" ? [...p.papeis] : [], action: acao, authz_decision: "deny", outcome: "denied", failure_code: motivo,
        }),
        new Promise((r) => setTimeout(r, 1_500)),
      ]);
    } catch { /* a negação vale com ou sem a linha; o evento abaixo é aguardado */ }
    return negar(kind, { acao, ator: quem.slice(0, 18), motivo }, "med");
  };
  // ADM-003: papel sem a permissão → nega (404) com a trilha `denied` — nada do handler roda.
  if (!permitido) return negarCorp("admin_rbac_negado", "papel_sem_permissao");
  if (exigeStepUp && !p.stepUpOk) return negarCorp("admin_step_up_exigido", "step_up_expirado");
  return { wallet: quem, fonte: p.kind, modo };
}

async function decidir(
  acao: string, permissoes: readonly Permissao[], exigeStepUp: boolean,
): Promise<{ wallet: string; fonte: FonteAdmissao; modo: ModoAuth }> {
  const modo = lerModoAuth();
  if (!modo.ok) {
    return negar("admin_modo_invalido", { bruto: modo.bruto, porque: "ADMIN_AUTH_MODE inválido — Admin fechado" }, "high");
  }

  // R1: em `dual`/`corp` a sessão corporativa, quando existe, decide (RBAC real + step-up).
  // Em `legacy` (padrão) o cookie corporativo NEM É LIDO: a decisão é byte a byte a de antes.
  if (modo.modo !== "legacy") {
    const corp = await decidirCorporativo(acao, permissoes, exigeStepUp, modo.modo);
    if (corp) return corp;
  }

  if (modo.modo === "corp") {
    return negar("admin_corp_sem_sessao", {
      acao, porque: "ADMIN_AUTH_MODE=corp: só sessão corporativa (ou break-glass) entra",
    }, "high");
  }

  // legacy e dual: a decisão de QUEM é admin continua em `requireAdmin()`. Em `dual`,
  // ela recebe as fontes permitidas e admite pela primeira PERMITIDA que casar.
  const r = modo.modo === "dual"
    ? await requireAdmin({ fontesPermitidas: fontesLegadasPermitidas() })
    : await requireAdmin();
  const autorizado = { wallet: r.wallet, fonte: r.fonte, acao, modo: modo.modo };

  if (modo.modo === "dual") {
    if (!fontesLegadasPermitidas().has(r.fonte)) {
      return negar("admin_fonte_legada_recusada", { fonte: r.fonte, acao, wallet: `${r.wallet.slice(0, 10)}…` }, "high");
    }
    const soCorporativa = permissoes.length > 0
      && permissoes.every((p) => PERMISSOES_SO_CORPORATIVAS.has(p));
    if (soCorporativa && r.fonte !== "env") {
      return negar("admin_permissao_so_corporativa", { fonte: r.fonte, acao }, "med");
    }
  }

  await observarAdmissaoLegada(autorizado);
  return autorizado;
}
