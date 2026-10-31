import { notFound } from "next/navigation";
import { requireAdmin, type FonteLegada } from "@/lib/admin/require";
import { logSecurityAguardado } from "@/lib/admin/auditoria-duravel";
import { ACOES, type AcaoId } from "@/lib/admin/acoes";
import { PERMISSOES_SO_CORPORATIVAS, type Permissao } from "@/lib/admin/rbac";

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
 *   · `dual` → só as fontes de `ADMIN_LEGACY_SOURCES` (padrão `env,panel,tier`);
 *     principal legado NÃO recebe identidade/papéis (exceto `env`, o bootstrap
 *     enquanto não há superadmin corporativo — hoje não há tabela de identidade,
 *     logo a contagem é 0). Sessão corporativa ainda NÃO é aceita (R1 desligado);
 *   · `corp` → só sessão corporativa. Enquanto R1 não estiver implantado, isto
 *     FECHA o Admin para todos (404 + alerta alto). Por isso o runbook só manda
 *     ligar `corp` depois de duas contas reais com MFA testadas em `dual`;
 *   · qualquer outro valor → Admin fechado (404) + alerta alto: erro de operador
 *     visível, sem abrir nada.
 *
 * Negação = `notFound()` (404, nunca 403), registrada e AGUARDADA com teto,
 * como em `requireAdmin`. Em `dual` a recusa de permissão também é 404 (o
 * handler não pode devolver Response daqui; anotado como divergência do
 * desenho, que previa 403 para quem já tem sessão).
 */

export type ModoAuth = "legacy" | "dual" | "corp";
const MODOS: readonly ModoAuth[] = ["legacy", "dual", "corp"];
const FONTES: readonly FonteLegada[] = ["env", "panel", "tier"];

export type LeituraModo = { ok: true; modo: ModoAuth } | { ok: false; bruto: string };

export function lerModoAuth(env: Record<string, string | undefined> = process.env): LeituraModo {
  const bruto = env.ADMIN_AUTH_MODE;
  if (bruto == null || bruto.trim() === "") return { ok: true, modo: "legacy" };
  const v = bruto.trim().toLowerCase() as ModoAuth;
  return MODOS.includes(v) ? { ok: true, modo: v } : { ok: false, bruto: bruto.slice(0, 40) };
}

/** Fontes legadas aceitas em `dual`. Valor ilegível = nenhuma (fecha, não abre). */
export function fontesLegadasPermitidas(env: Record<string, string | undefined> = process.env): Set<FonteLegada> {
  const bruto = env.ADMIN_LEGACY_SOURCES;
  if (bruto == null || bruto.trim() === "") return new Set(FONTES);
  const pedidas = bruto.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (pedidas.some((s) => !FONTES.includes(s as FonteLegada))) return new Set();
  return new Set(pedidas as FonteLegada[]);
}

export interface Autorizado {
  /** Compatível com `requireAdmin()`: os handlers que usam o ator seguem iguais. */
  wallet: string;
  fonte: FonteLegada;
  acao: AcaoId;
  modo: ModoAuth;
}

/** Decisão de PÁGINA (layout, mural): mesmo caminho, rótulo `pagina:<nome>`. */
export interface PaginaAutorizada {
  wallet: string;
  fonte: FonteLegada;
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
  const r = await decidir(acao, def.permissoes);
  return { wallet: r.wallet, fonte: r.fonte, acao, modo: r.modo };
}

/**
 * Páginas (layout do Admin, mural) — o MESMO ponto de decisão (revisão adversarial):
 * antes chamavam `requireAdmin()` direto, então em `dual` restrito, `corp` ou modo
 * inválido um principal recusado nas APIs ainda recebia o shell, a chave anon do
 * realtime e o mural. Permissão: `admin.view`.
 */
export async function autorizarPaginaAdmin(pagina: "shell" | "mural"): Promise<PaginaAutorizada> {
  const r = await decidir(`pagina:${pagina}`, ["admin.view"]);
  return { wallet: r.wallet, fonte: r.fonte, pagina, modo: r.modo };
}

async function decidir(
  acao: string, permissoes: readonly Permissao[],
): Promise<{ wallet: string; fonte: FonteLegada; modo: ModoAuth }> {
  const modo = lerModoAuth();
  if (!modo.ok) {
    return negar("admin_modo_invalido", { bruto: modo.bruto, porque: "ADMIN_AUTH_MODE inválido — Admin fechado" }, "high");
  }

  if (modo.modo === "corp") {
    // R1 (sessão corporativa + MFA) ainda não está implantado: nada é aceito.
    return negar("admin_corp_indisponivel", {
      acao, porque: "ADMIN_AUTH_MODE=corp sem sessão corporativa implantada (R1)",
    }, "high");
  }

  // legacy e dual: a decisão de QUEM é admin continua em `requireAdmin()`.
  const r = await requireAdmin();
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
