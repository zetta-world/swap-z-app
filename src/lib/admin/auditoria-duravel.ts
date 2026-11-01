/**
 * AUDITORIA DURÁVEL DOS COMANDOS DE ADMIN — Desenho A, SEM migration
 * (`docs/ADMIN-OBSERVABILITY-TRUTH-CONTRACTS.md` §3.3, ADM-005).
 *
 * ⚠️ POR QUE NÃO É `logAdminAction`. Aquele engole `{ error }`, engole exceção e
 * devolve `void`: é telemetria best-effort DE PROPÓSITO, e continua servindo
 * para o que é telemetria. Só que 6 das 10 chamadas dele vinham depois de uma
 * escrita NÃO conferida — o registro forense podia afirmar o que não aconteceu,
 * ou nem existir para o que aconteceu. Comando sensível sem trilha confiável
 * falha FECHADO (plano §0, resultado 4).
 *
 * O protocolo de `comandoAuditado`:
 *
 *   1. grava a linha `intencao` (com teto de 3 s). SEM ELA, O COMANDO NÃO
 *      RODA — a resposta é 503 `auditoria_indisponivel`;
 *   2. executa (a função do chamador confere a PRÓPRIA escrita e diz se gravou);
 *   3. grava `executado` ou `falhou`, com `req` = id da intenção. Se ESTA
 *      gravação falhar, o resultado real é devolvido mesmo assim, marcado
 *      `desfecho_nao_gravado`, e vira evento de segurança alto: a intenção já
 *      prova a tentativa, e esconder o desfecho real seria a mentira oposta.
 *
 * ⚠️ LIMITE HONESTO: são transações separadas. O estado pode mudar e o desfecho
 * não ser gravado (passo 3) — é por isso que esse caso é barulhento. A versão
 * transacional (Desenho B, uma RPC que grava o estado e a trilha juntos) exige
 * migration e autorização do dono.
 *
 * ⚠️ D-AUD-1 (decisão do dono, 31/10/2026: "Protetor executa + alerta"). Comando
 * PROTETOR — o que BLOQUEIA/PAUSA/FECHA/REMOVE (ligar kill switch ou gate, fechar a
 * liberação da automação, remover piloto) — declara `protetor: true` e EXECUTA mesmo
 * quando a intenção não grava: travar o incidente vale mais que a trilha completa.
 * Nesse caso: evento de segurança `high` AGUARDADO antes de executar, e o resultado
 * volta marcado `auditoria: "intencao_nao_gravada"`. Os PERMISSIVOS (abrir, liberar,
 * autorizar, conceder) continuam recusados com 503 sem a intenção gravada.
 *
 * O que vai no `payload`: fase, correlação, idempotência e os campos que o
 * chamador passa. NUNCA segredo, e nada de PII além da carteira que o log de
 * admin já guardava (`actor_wallet`, `target`).
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordEvent, notifyTelegram, type Severity } from "@/lib/admin/track";

/** Mesmo orçamento de `GATE_KV_TIMEOUT_MS` (`early-access/gate.ts`). */
export const AUDITORIA_TIMEOUT_MS = 3_000;
/** Evento de segurança aguardado antes de responder: curto, nunca trava a negação. */
export const SEGURANCA_TIMEOUT_MS = 1_500;

export type FaseAuditoria = "intencao" | "executado" | "falhou" | "negado";

export interface RegistroAuditoria {
  ator:    string;
  acao:    string;
  alvo?:   string | null;
  fase:    FaseAuditoria;
  /** Correlação: o id da linha de intenção. Intenção e desfecho carregam o mesmo. */
  req:     string;
  /** Id explícito desta linha (a intenção usa `req`). */
  id?:     string;
  idem?:   string | null;
  antes?:  unknown;
  depois?: unknown;
  codigo?: string | null;
  /** Campos do comando (motivo, nota…). Os reservados acima prevalecem. */
  dados?:  Record<string, unknown>;
}

export type ErroAuditoria = "db_indisponivel" | "insert_falhou" | "tempo_esgotado" | "excecao";

export type ResultadoAuditoria =
  | { ok: true; id: string }
  | { ok: false; erro: ErroAuditoria; detalhe?: string };

/** Corre `p` contra um relógio. Estourar devolve `aoEstourar`; nunca lança por causa do relógio. */
export async function comTeto<T>(p: Promise<T>, ms: number, aoEstourar: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const estouro = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(aoEstourar), ms); });
  try {
    return await Promise.race([p, estouro]);
  } finally {
    clearTimeout(timer);
  }
}

export function novoId(): string {
  return globalThis.crypto.randomUUID();
}

const TETO_TEXTO = 500;
const TETO_JSON = 2_000;

/** Corta o que pode crescer sem limite. Não redige: quem chama não passa segredo. */
function limitar(v: unknown): unknown {
  if (typeof v === "string") return v.length > TETO_TEXTO ? `${v.slice(0, TETO_TEXTO)}…` : v;
  if (v && typeof v === "object") {
    let json: string;
    try { json = JSON.stringify(v); } catch { return "[não serializável]"; }
    if (json.length > TETO_JSON) return { truncado: true, previa: json.slice(0, TETO_JSON) };
  }
  return v;
}

export function montarPayload(r: RegistroAuditoria): Record<string, unknown> {
  const dados: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r.dados ?? {})) dados[k] = limitar(v);
  return {
    ...dados,
    fase: r.fase,
    req:  r.req,
    ...(r.idem ? { idem: r.idem } : {}),
    ...(r.antes !== undefined ? { antes: limitar(r.antes) } : {}),
    ...(r.depois !== undefined ? { depois: limitar(r.depois) } : {}),
    ...(r.codigo ? { codigo: r.codigo } : {}),
  };
}

/**
 * Grava UMA linha em `admin_audit_log` e diz se gravou. Confere `{ error }`,
 * teto de 3 s. NUNCA lança.
 *
 * ⚠️ Estourar o tempo NÃO prova que a linha não entrou — só que não dá para
 * contar com ela. Para quem decide executar, isso é "não gravou".
 */
export async function registrarAuditoria(
  r: RegistroAuditoria, tetoMs: number = AUDITORIA_TIMEOUT_MS,
): Promise<ResultadoAuditoria> {
  const id = r.id ?? novoId();
  const tentativa = (async (): Promise<ResultadoAuditoria> => {
    try {
      const db = getSupabaseAdmin();
      if (!db) return { ok: false, erro: "db_indisponivel" };
      const { error } = await db.from("admin_audit_log").insert({
        id, actor_wallet: r.ator, action: r.acao, target: r.alvo ?? null, payload: montarPayload(r),
      });
      if (error) return { ok: false, erro: "insert_falhou", detalhe: String(error.message ?? "").slice(0, 160) };
      return { ok: true, id };
    } catch (e) {
      return { ok: false, erro: "excecao", detalhe: String(e).slice(0, 160) };
    }
  })();
  return comTeto(tentativa, tetoMs, { ok: false, erro: "tempo_esgotado" });
}

/**
 * `logSecurity` AGUARDADO, com teto. Mesmo formato de evento e de alerta.
 *
 * ⚠️ POR QUE UM ESPELHO: `logSecurity` (track.ts) devolve `void`, então quem
 * responde logo em seguida — um `notFound()`, um 503 — não tem como esperar o
 * insert, e na Vercel a função congela depois da resposta e o evento se perde
 * (`event-durability.test.ts`). O espelho é conferido contra o original em
 * `auditoria-duravel.test.ts`: se um mudar sozinho, o teste acusa.
 */
export async function logSecurityAguardado(
  kind: string, meta: Record<string, unknown> = {}, severity: Severity = "med",
  tetoMs: number = SEGURANCA_TIMEOUT_MS,
): Promise<void> {
  try {
    const gravando = recordEvent("security", { meta: { kind, severity, ...meta } });
    if (severity === "high") {
      notifyTelegram(`🔴 <b>SECURITY</b>: ${kind}\n${JSON.stringify(meta).slice(0, 200)}`, { dedupKey: `sec:${kind}`, meta: { kind } });
    }
    await comTeto(gravando.then(() => true, () => false), tetoMs, false);
  } catch { /* nunca lança: quem chama está negando ou respondendo */ }
}

export type DesfechoComando<T> =
  | { ok: true; valor: T; depois?: unknown }
  | { ok: false; codigo: string; valor?: T; detalhe?: string };

export interface Comando<T> {
  acao:     string;
  ator:     string;
  alvo?:    string | null;
  antes?:   unknown;
  depois?:  unknown;
  /** Chave de idempotência: repetir um comando já EXECUTADO não executa de novo. */
  idem?:    string | null;
  dados?:   Record<string, unknown>;
  /** Faz a coisa E confere a própria escrita. Lançar conta como falha (estado incerto). */
  executar: () => Promise<DesfechoComando<T>>;
  /**
   * D-AUD-1: `true` SÓ na direção que bloqueia/pausa/fecha/remove. Sem trilha, executa
   * com alerta alto aguardado e `auditoria: "intencao_nao_gravada"`. Explícito de
   * propósito: o padrão (ausente) é o comportamento seguro de antes — recusar.
   */
  protetor?: boolean;
}

export type AuditoriaDoDesfecho = "completa" | "desfecho_nao_gravado" | "intencao_nao_gravada";

export type ResultadoComando<T> =
  | { estado: "recusado"; erro: "auditoria_indisponivel"; detalhe: string; req: string }
  | { estado: "repetido"; req: string; anterior: string }
  | { estado: "executado"; valor: T; auditoria: AuditoriaDoDesfecho; req: string }
  | { estado: "falhou"; codigo: string; valor?: T; detalhe?: string; auditoria: AuditoriaDoDesfecho; req: string };

export type Busca = { achou: string | null } | { falhou: string };

/**
 * Já existe um `executado` com esta chave? Falha de leitura NÃO vira "não existe".
 * Exportada para rotas que precisam responder `repetido` ANTES de uma pré-condição
 * (ex.: o compare-and-set do kill switch, que num reenvio legítimo já não casa).
 */
export async function buscarExecutado(acao: string, idem: string): Promise<Busca> {
  const tentativa = (async (): Promise<Busca> => {
    try {
      const db = getSupabaseAdmin();
      if (!db) return { falhou: "db_indisponivel" };
      // leitura-limitada: só a EXISTÊNCIA de um `executado` com esta chave importa — 1 linha basta.
      const { data, error } = await db.from("admin_audit_log")
        .select("id")
        .eq("action", acao)
        .eq("payload->>idem", idem)
        .eq("payload->>fase", "executado")
        .limit(1);
      if (error) return { falhou: "leitura_falhou" };
      const linha = (data ?? [])[0] as { id?: string } | undefined;
      return { achou: linha?.id ?? null };
    } catch {
      return { falhou: "excecao" };
    }
  })();
  return comTeto(tentativa, AUDITORIA_TIMEOUT_MS, { falhou: "tempo_esgotado" });
}

/**
 * Executa um comando sensível SÓ com a intenção registrada. Ver o cabeçalho.
 * Nunca lança: exceção do `executar` vira desfecho `falhou` / `excecao`.
 */
export async function comandoAuditado<T>(c: Comando<T>): Promise<ResultadoComando<T>> {
  const req = novoId();
  const base = { ator: c.ator, acao: c.acao, alvo: c.alvo ?? null, req, idem: c.idem ?? null, dados: c.dados };

  const protetor = c.protetor === true;
  if (c.idem) {
    const b = await buscarExecutado(c.acao, c.idem);
    if ("falhou" in b) {
      // Protetor: repetir um bloqueio é inofensivo — não saber se já rodou não o impede.
      await logSecurityAguardado(protetor ? "auditoria_indisponivel_protetor_executa" : "auditoria_indisponivel",
        { acao: c.acao, etapa: "idempotencia", erro: b.falhou }, "high");
      if (!protetor) return { estado: "recusado", erro: "auditoria_indisponivel", detalhe: `idempotência: ${b.falhou}`, req };
    } else if (b.achou) return { estado: "repetido", req, anterior: b.achou };
  }

  const intencao = await registrarAuditoria({
    ...base, id: req, fase: "intencao", antes: c.antes, depois: c.depois,
  });
  const semIntencao = !intencao.ok;
  if (!intencao.ok) {
    await logSecurityAguardado(protetor ? "auditoria_indisponivel_protetor_executa" : "auditoria_indisponivel",
      { acao: c.acao, etapa: "intencao", erro: intencao.erro, req }, "high");
    if (!protetor) return { estado: "recusado", erro: "auditoria_indisponivel", detalhe: intencao.erro, req };
  }

  let desfecho: DesfechoComando<T>;
  try {
    desfecho = await c.executar();
  } catch (e) {
    desfecho = { ok: false, codigo: "excecao", detalhe: String(e).slice(0, 200) };
  }

  const fim = await registrarAuditoria(desfecho.ok
    ? { ...base, fase: "executado", depois: desfecho.depois ?? c.depois }
    : { ...base, fase: "falhou", codigo: desfecho.codigo, dados: { ...c.dados, ...(desfecho.detalhe ? { detalhe: desfecho.detalhe } : {}) } });
  let auditoria: AuditoriaDoDesfecho = semIntencao ? "intencao_nao_gravada" : "completa";
  if (!fim.ok && !semIntencao) {
    auditoria = "desfecho_nao_gravado";
    await logSecurityAguardado("auditoria_desfecho_nao_gravado", {
      acao: c.acao, req, fase: desfecho.ok ? "executado" : "falhou", erro: fim.erro,
    }, "high");
  }

  return desfecho.ok
    ? { estado: "executado", valor: desfecho.valor, auditoria, req }
    : { estado: "falhou", codigo: desfecho.codigo, valor: desfecho.valor, detalhe: desfecho.detalhe, auditoria, req };
}

/** Texto padrão da recusa — o operador precisa saber que NADA foi alterado. */
export const PORQUE_AUDITORIA_INDISPONIVEL =
  "NADA foi alterado: a intenção não pôde ser registrada no log de auditoria, "
  + "e comando sensível sem trilha não executa. Confira o banco (admin_audit_log).";

/** Marca no corpo quando o comando rodou mas a trilha ficou incompleta. */
export function avisoDeAuditoria(a: AuditoriaDoDesfecho): Record<string, string> {
  if (a === "intencao_nao_gravada") return {
    auditoria: "intencao_nao_gravada",
    auditoriaPorque: "comando PROTETOR executado SEM a intenção na trilha (D-AUD-1): o log de auditoria "
      + "estava indisponível; um alerta alto foi disparado — registre o ocorrido quando o banco voltar",
  };
  return a === "completa" ? {} : {
    auditoria: "desfecho_nao_gravado",
    auditoriaPorque: "o comando FOI executado, mas o desfecho não entrou no log de auditoria — "
      + "a intenção está lá; confira admin_audit_log antes de repetir",
  };
}
