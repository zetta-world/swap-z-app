import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { logSecurityAguardado } from "@/lib/admin/auditoria-duravel";

/**
 * ⚠️ A NEGAÇÃO ESPERA O REGISTRO — com teto, e sem nunca lançar.
 *
 * `logSecurity` é fire-and-forget, e logo depois vem `notFound()`: a resposta
 * sai, a função congela na Vercel, e o insert que provaria "alguém tentou" se
 * perdia na corrida (`event-durability.test.ts` conta a mesma história). O teto
 * curto existe para que um banco lento nunca transforme a negação num pendurão.
 */
async function negar(kind: string, meta: Record<string, unknown>, severity: "low" | "med" | "high"): Promise<never> {
  await logSecurityAguardado(kind, meta, severity);
  notFound();
}

/**
 * Server helper — call at the top of every admin Server Component / Route
 * Handler. Returns the verified wallet address or throws notFound() (404),
 * never 403, so the panel's existence is never revealed to outsiders.
 *
 * Access logic (ANY condition grants entry):
 *  1. Wallet address is in the ADMIN_WALLETS env var (comma-separated).
 *  2. The wallet has a row in `platform_admins` (grant/revoke from the panel).
 *  3. Legacy: the wallet has a tier_cache row with source = 'admin' (kept so
 *     wallets seeded before platform_admins existed are never locked out).
 *
 * ⚠️ A NOTA ANTERIOR AQUI ESTAVA DESATUALIZADA, e ela descrevia como atual
 * exatamente o defeito que o `middleware.ts` corrigiu em 11/08: *"o middleware
 * pré-triagem com (1)"*. Ele NÃO faz mais isso — checar `ADMIN_WALLETS` na
 * borda era um PORTÃO, não uma triagem, e trancou o dono fora do próprio painel
 * com a carteira que ele mesmo tinha cadastrado. Hoje a borda confere só que
 * existe SESSÃO válida; quem decide permissão é esta função, e só ela.
 *
 * Um comentário que descreve o bug antigo como comportamento atual é pior que
 * comentário nenhum: o próximo a ler daqui vai procurar o defeito no lugar
 * errado — foi o que aconteceu hoje.
 */
export async function requireAdmin(): Promise<{ wallet: string }> {
  const session = await getSession();
  /**
   * ⚠️⚠️ ESTE 404 ERA MUDO, E FOI ELE QUE CUSTOU A INVESTIGAÇÃO DE 13/09.
   *
   * O dono disse "não consigo entrar no painel". `admin_access_denied` tinha
   * ZERO ocorrências no banco desde sempre — o que provava que nenhuma sessão
   * estava sendo recusada por FALTA DE PERMISSÃO, mas não dizia o que estava
   * acontecendo. Descobrir que ele parava por falta de SESSÃO levou meia dúzia
   * de consultas, porque os dois primeiros `notFound()` desta função e o 404 do
   * middleware não deixavam rastro nenhum.
   *
   * O próprio middleware já escrevia a lição: *"tentativa que ninguém registra
   * não vira alerta"*. Ela valia para a autorização, e a AUTENTICAÇÃO ficou
   * muda — que é o caso mais comum, porque a sessão expira sozinha em 30 dias.
   *
   * ⚠️ Severidade BAIXA de propósito: sessão expirada é rotina, não intrusão.
   * Mandar isto para o Telegram como `high` treinaria todo mundo a ignorar o
   * alerta que importa — que é o `admin_access_denied` logo abaixo.
   */
  if (!session) {
    return negar("admin_sem_sessao", { porque: "cookie ausente, expirado ou de outro domínio" }, "low");
  }

  const wallet = session.sub;

  if (isEnvAdmin(wallet)) return { wallet };

  const db = getSupabaseAdmin();
  /**
   * ⚠️ E ESTE ERA O PIOR DOS TRÊS: sem banco, um admin LEGÍTIMO leva 404 e nada
   * registra. Fica indistinguível de "você não tem permissão" — para quem tem.
   */
  if (!db) {
    return negar("admin_sem_banco", { wallet: `${wallet.slice(0, 10)}…` }, "high");
  }

  // Dedicated admin grants (the panel writes here).
  const { data: pa, error: erroPainel } = await db
    .from("platform_admins")
    .select("wallet_address")
    .eq("wallet_address", wallet)
    .maybeSingle();
  if (pa) return { wallet };

  // Legacy fallback: tier_cache.source = 'admin' (pre-platform_admins grants).
  const { data, error: erroLegado } = await db
    .from("tier_cache")
    .select("source")
    .eq("wallet_address", wallet)
    .eq("source", "admin")
    .maybeSingle();

  if (!data) {
    /**
     * ⚠️ A DECISÃO NÃO MUDA (nega), O REGISTRO SIM. Uma leitura que falhou não
     * é "esta carteira não é admin": marcá-la como `admin_access_denied` manda
     * procurar um intruso quando o defeito é o banco — e é o admin LEGÍTIMO
     * que está levando 404.
     */
    if (erroPainel || erroLegado) {
      return negar("admin_sem_banco", {
        wallet: `${wallet.slice(0, 10)}…`, porque: "leitura de permissão falhou",
        falhou: [erroPainel ? "platform_admins" : "", erroLegado ? "tier_cache" : ""].filter(Boolean),
      }, "high");
    }
    // A signed-in wallet probing an admin surface — high-signal intrusion attempt.
    return negar("admin_access_denied", { wallet: `${wallet.slice(0, 10)}…` }, "high");
  }
  return { wallet };
}

/** Returns true if the wallet is in the ADMIN_WALLETS env var. */
export function isEnvAdmin(wallet: string): boolean {
  const raw = process.env.ADMIN_WALLETS ?? "";
  if (!raw.trim()) return false;
  const set = new Set(raw.split(",").map((w) => w.trim().toLowerCase()));
  return set.has(wallet.toLowerCase());
}

/** The env-configured admin wallets (lower-cased). These are baked into the
 *  deployment — the panel shows them read-only (can't be revoked from the UI). */
export function envAdminWallets(): string[] {
  const raw = process.env.ADMIN_WALLETS ?? "";
  return raw.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
}

/**
 * Writes one row to admin_audit_log. Fire-and-forget — never throws,
 * so a logging failure never aborts the action being audited.
 *
 * ⚠️ SÓ PARA TELEMETRIA. Comando sensível (grant/revoke, kill-switch, liberação,
 * reset de capital, export) passa por `comandoAuditado` em
 * `auditoria-duravel.ts`, que confere a gravação e recusa sem trilha.
 */
export async function logAdminAction(
  actor: string,
  action: string,
  target?: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    if (!db) return;
    await db.from("admin_audit_log").insert({ actor_wallet: actor, action, target: target ?? null, payload: payload ?? null });
  } catch {
    // intentionally swallowed — logging must not block the happy path
  }
}
