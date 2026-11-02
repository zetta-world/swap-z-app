import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * GOVERNANÇA DO ADMIN (SOLO FOUNDER MODE, migration 0088) — leitura da linha única
 * `admin_private.admin_governance` e as 3 RPCs que são o ÚNICO caminho de escrita
 * (o service_role só tem SELECT nessas tabelas).
 *
 * Separado de `repo.ts` de propósito: os testes antigos têm repositórios falsos de
 * `RepoCorp` inteiros, e a governança tem o seu próprio contrato (e o seu falso).
 *
 * ⚠️ Mesmo contrato de `repo.ts`: `{ ok, … }`; "não consegui ler" NUNCA vira "não há
 * fundador" — quem decide trata `ok:false` como negação do que for perigoso.
 */
export type R<T> = { ok: true; valor: T } | { ok: false; erro: string };

export type ModoGovernanca = "solo_founder" | "multi_admin";

export interface Governanca {
  modo: ModoGovernanca;
  fundador: string | null;
}

export type ResultadoReset =
  | { codigo: "ok"; fatorAntigo: string | null; authUserId: string | null; identidade: string }
  | { codigo: string };

export interface RepoGovernanca {
  ler(): Promise<R<Governanca>>;
  bootstrap(a: { identityId: string; sessionId: string; tokenSha256: Buffer; emailFundador: string; requestId: string }): Promise<R<string>>;
  resetMfa(a: { tokenSha256: Buffer; emailFundador: string; ativacaoHash: Buffer; ativacaoExpira: string; carteiraRedigida: string; requestId: string }): Promise<R<ResultadoReset>>;
  paraMulti(a: { sessionId: string; requestId: string }): Promise<R<string>>;
}

const hexBytea = (b: Buffer) => `\\x${b.toString("hex")}`;

type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Esquema = {
  from: (t: string) => { select: (c: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> } } };
  rpc: Rpc;
};

function esquema(): Esquema | null {
  const db = getSupabaseAdmin();
  if (!db) return null;
  return (db as unknown as { schema: (s: string) => Esquema }).schema("admin_private");
}

async function chamar<T>(f: (e: Esquema) => PromiseLike<{ data: unknown; error: { message: string } | null }>, mapear: (d: unknown) => T): Promise<R<T>> {
  const e = esquema();
  if (!e) return { ok: false, erro: "sem_banco" };
  try {
    const { data, error } = await f(e);
    if (error) return { ok: false, erro: String(error.message).slice(0, 160) };
    return { ok: true, valor: mapear(data) };
  } catch (x) {
    return { ok: false, erro: (x instanceof Error ? x.message : "excecao").slice(0, 160) };
  }
}

const texto = (d: unknown) => (typeof d === "string" ? d : "resposta_invalida");

export const repoGovernancaReal: RepoGovernanca = {
  async ler() {
    const r = await chamar((e) => e.from("admin_governance").select("mode, founder_identity_id").eq("id", true).maybeSingle(),
      (d) => d as { mode?: unknown; founder_identity_id?: unknown } | null);
    if (!r.ok) return r;
    const linha = r.valor;
    // Linha ausente ou modo desconhecido = ilegível (a 0088 cria a linha): nunca "multi por omissão".
    if (!linha || (linha.mode !== "solo_founder" && linha.mode !== "multi_admin")) return { ok: false, erro: "governanca_ausente" };
    return { ok: true, valor: { modo: linha.mode, fundador: typeof linha.founder_identity_id === "string" ? linha.founder_identity_id : null } };
  },
  bootstrap: (a) => chamar((e) => e.rpc("founder_bootstrap", {
    p_identity_id: a.identityId, p_session_id: a.sessionId, p_token_sha256: hexBytea(a.tokenSha256),
    p_founder_email: a.emailFundador, p_request_id: a.requestId,
  }), texto),
  resetMfa: (a) => chamar((e) => e.rpc("founder_mfa_reset", {
    p_token_sha256: hexBytea(a.tokenSha256), p_founder_email: a.emailFundador, p_activation_hash: hexBytea(a.ativacaoHash),
    p_activation_expires: a.ativacaoExpira, p_actor_wallet_redacted: a.carteiraRedigida, p_request_id: a.requestId,
  }), (d) => {
    const j = (d ?? {}) as Record<string, unknown>;
    const codigo = typeof j.codigo === "string" ? j.codigo : "resposta_invalida";
    if (codigo !== "ok") return { codigo };
    return {
      codigo: "ok" as const,
      fatorAntigo: typeof j.fator_antigo === "string" ? j.fator_antigo : null,
      authUserId: typeof j.auth_user_id === "string" ? j.auth_user_id : null,
      identidade: String(j.identidade ?? ""),
    };
  }),
  paraMulti: (a) => chamar((e) => e.rpc("governance_to_multi", { p_session_id: a.sessionId, p_request_id: a.requestId }), texto),
};

let atual: RepoGovernanca = repoGovernancaReal;
export function repoGovernanca(): RepoGovernanca { return atual; }
/** Só para testes. */
export function definirRepoGovernanca(r: RepoGovernanca | null): void { atual = r ?? repoGovernancaReal; }
