/**
 * APLICAÇÃO DE PLANO NO SERVIDOR — a matriz que ninguém consultava.
 *
 * O QUE ESTAVA ERRADO (auditoria 01/08):
 *
 * `FEATURE_TIER` se descreve como "the single source of truth for which gate a
 * surface sits behind. UI and API both read from here". A UI lia. A API não.
 *
 * De quatro entradas declaradas, UMA era verificada no servidor
 * (`zionAdvisory`, no `/api/zion`). `cexAutopilot: "pro"` e
 * `arbScanner: "trader"` não eram consultados por nenhuma rota — nem por
 * `/api/cex/order`, nem por `/api/autopilot/session`. O controle existia apenas
 * no `TierGate`, um componente de CLIENTE que ESCONDE a interface.
 *
 * Esconder botão não é controle de acesso. Um `curl` na rota entregava igual, e
 * a rota nem precisava ser descoberta: o código dela vai no bundle.
 *
 * E `TIER_DAILY_ANALYSES` — free 5, pro 10, trader 25, pilot 30 — trazia no
 * comentário "Source of truth for the ENFORCEMENT LAYER". A camada de aplicação
 * não existia. Nada contava nada. O assinante do plano mais barato consumia sem
 * limite o recurso mais caro da plataforma, que é exatamente a conta que a
 * assinatura deveria pagar.
 *
 * POR QUE ISSO É PERDA DE DINHEIRO DOS DOIS LADOS:
 *
 * Do lado da plataforma é vazamento direto de receita — o modelo é assinatura,
 * com taxa de no máximo 0,5%, então o plano É o produto. Do lado do usuário é
 * pior de um jeito menos óbvio: uma conta que ninguém segura acaba fechada às
 * pressas quando estoura, e quem paga o corte é quem estava usando de boa-fé.
 *
 * A REGRA AQUI: a mesma matriz que desenha a interface decide a resposta HTTP.
 * Uma superfície nova é gated no servidor por declarar a chave, não por alguém
 * lembrar de escrever o `if`.
 */

import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { gatesEnabled } from "@/lib/tier/flags";
import { rateLimitDurable } from "@/lib/rate-limit";
import {
  tierSatisfies, FEATURE_TIER, TIER_DAILY_ANALYSES, type Tier,
} from "@/lib/tier/types";

/** Quantas análises por dia este plano paga. Decisão pura, testável sozinha. */
export function dailyQuota(tier: Tier): number {
  return TIER_DAILY_ANALYSES[tier];
}

/**
 * A cota é POR CARTEIRA e POR DIA — nunca por IP.
 *
 * Por IP seria fácil de furar (trocar de rede zera) e injusto ao mesmo tempo
 * (escritório atrás de um NAT dividiria uma cota só). A carteira é a identidade
 * que assinou o plano, então é ela que carrega o limite.
 */
export function quotaBucket(wallet: string): string {
  return `zion:quota:${wallet.toLowerCase()}`;
}

export type TierDenial =
  | { kind: "unauthenticated" }
  | { kind: "tier_required"; required: Tier; have: Tier }
  | { kind: "quota_exhausted"; tier: Tier; limit: number; retryAfter: number };

/** `null` = pode seguir. Qualquer outra coisa = motivo da recusa. */
export type TierVerdict = TierDenial | null;

/**
 * Verifica o plano exigido por uma feature de `FEATURE_TIER`.
 *
 * Com os gates dormentes (`TIER_GATES_ENABLED=false`) libera tudo — é o mesmo
 * interruptor que a UI já respeita, para que interface e API nunca discordem
 * sobre o que está aberto.
 */
export async function checkFeatureTier(feature: keyof typeof FEATURE_TIER | string): Promise<TierVerdict> {
  if (!gatesEnabled()) return null;
  const required = FEATURE_TIER[feature];
  // Feature sem entrada na matriz não é gated. Declarar é o que trava.
  if (!required) return null;

  const session = await getSession();
  if (!session) return { kind: "unauthenticated" };

  const { tier } = await getTierForWallet(session.sub, session.chain);
  if (!tierSatisfies(tier, required)) {
    return { kind: "tier_required", required, have: tier };
  }
  return null;
}

/**
 * Consome uma análise da cota diária da carteira.
 *
 * Falha ABERTO se o banco estiver fora — mesma regra dos tetos de gasto: uma
 * proteção que derruba o produto quando ela própria falha não é proteção, e
 * cobrar de quem pagou por causa de um Postgres indisponível é o pior dos dois
 * mundos.
 */
export async function consumeAnalysisQuota(wallet: string, tier: Tier): Promise<TierVerdict> {
  if (!gatesEnabled()) return null;
  const limit = dailyQuota(tier);
  const r = await rateLimitDurable(quotaBucket(wallet), { windowMs: 86_400_000, max: limit });
  if (r.ok) return null;
  return { kind: "quota_exhausted", tier, limit, retryAfter: r.retryAfter };
}

/** Traduz a recusa para uma resposta HTTP — mesma forma em toda rota. */
export function denialResponse(d: TierDenial): Response {
  if (d.kind === "unauthenticated") {
    return json({ ok: false, error: "unauthenticated", signInUrl: "/" }, 401);
  }
  if (d.kind === "tier_required") {
    return json({
      ok: false, error: "tier_required", requiredTier: d.required, currentTier: d.have,
      upgradeUrl: "/pricing",
    }, 402);
  }
  return json({
    ok: false, error: "quota_exhausted", tier: d.tier, dailyLimit: d.limit,
    message: `Você usou as ${d.limit} análises do dia no plano ${d.tier}. A cota reabre em algumas horas.`,
    upgradeUrl: "/pricing",
  }, 429, { "Retry-After": String(d.retryAfter) });
}

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}
