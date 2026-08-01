/**
 * MARGEM — a única tela que responde se a empresa vive.
 *
 * O buraco que isto tapa: existia receita (escondida num terço do card de
 * finanças), existia custo de IA (escondido no mesmo card) e NÃO existia custo
 * de infraestrutura em lugar nenhum. Ou seja, o painel mostrava as duas metades
 * da conta e nunca a conta.
 *
 * Com receita de ASSINATURA, o negócio inteiro é `receita − (IA + infra)`. Sem
 * essa subtração na tela, dá pra comemorar um número de receita que já foi
 * comido pelo custo — e é justamente o tipo de autoengano que o resto deste
 * painel foi construído para impedir.
 *
 * CUSTO DE INFRA É ENTRADA MANUAL (admin_kv). Integrar as APIs de faturamento
 * da Vercel e do Supabase seria mais bonito e muito mais frágil: cada uma tem
 * autenticação própria, formato próprio e muda quando quer. Um número digitado
 * uma vez por mês é chato e é confiável — e a data da última atualização fica
 * visível, para que um valor velho se denuncie sozinho em vez de mentir calado.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

/** Onde cada custo fixo mensal fica guardado no KV de operação. */
export const INFRA_KEYS = ["infra_vercel_usd", "infra_supabase_usd", "infra_outros_usd"] as const;
export type InfraKey = (typeof INFRA_KEYS)[number];

export const INFRA_LABEL: Record<InfraKey, string> = {
  infra_vercel_usd: "Vercel",
  infra_supabase_usd: "Supabase",
  infra_outros_usd: "Outros (domínio, e-mail, RPC…)",
};

export interface InfraCost {
  key: InfraKey;
  label: string;
  usdPerMonth: number;
  /** Quando o valor foi digitado. Um custo de infra parado há meses provavelmente
   *  está errado — e precisa se denunciar em vez de passar por atual. */
  updatedAt: string | null;
  staleDays: number | null;
}

export interface MarginReport {
  /** Receita mensal recorrente estimada (assinaturas). */
  mrrUsd: number | null;
  /** Custo de IA projetado para o mês, a partir do gasto observado. */
  aiMonthlyUsd: number;
  infra: InfraCost[];
  infraMonthlyUsd: number;
  totalCostUsd: number;
  /** receita − custos. Negativo = queima. */
  marginUsd: number | null;
  marginPct: number | null;
  verdict: string;
  /** Algum custo de infra nunca foi preenchido? Então a margem é OTIMISTA. */
  incomplete: boolean;
}

const STALE_AFTER_DAYS = 45;

export async function readInfraCosts(): Promise<InfraCost[]> {
  const db = getSupabaseAdmin();
  const out: InfraCost[] = INFRA_KEYS.map((key) => ({
    key, label: INFRA_LABEL[key], usdPerMonth: 0, updatedAt: null, staleDays: null,
  }));
  if (!db) return out;
  try {
    const { data } = await db.from("admin_kv").select("key, value, updated_at").in("key", INFRA_KEYS as unknown as string[]);
    for (const row of data ?? []) {
      const i = out.findIndex((o) => o.key === row.key);
      if (i < 0) continue;
      const n = Number(row.value);
      out[i].usdPerMonth = Number.isFinite(n) && n >= 0 ? n : 0;
      out[i].updatedAt = row.updated_at ?? null;
      out[i].staleDays = row.updated_at
        ? Math.floor((Date.now() - Date.parse(row.updated_at)) / 86_400_000)
        : null;
    }
  } catch { /* KV indisponível: devolve zeros, e `incomplete` sinaliza */ }
  return out;
}

/**
 * Monta o relatório. `mrrUsd` null significa que ainda não há assinatura
 * recorrente medida — e nesse caso a margem NÃO é calculada como se fosse zero:
 * fingir receita zero e custo real produziria um número que parece medido e é
 * inventado.
 */
export function buildMargin(
  mrrUsd: number | null,
  aiMonthlyUsd: number,
  infra: InfraCost[],
): MarginReport {
  const infraMonthlyUsd = infra.reduce((s, i) => s + i.usdPerMonth, 0);
  const totalCostUsd = aiMonthlyUsd + infraMonthlyUsd;
  // "Incompleto" = algum custo nunca foi digitado. A margem então é um TETO
  // otimista, não um resultado — e a tela precisa dizer isso.
  const incomplete = infra.some((i) => i.updatedAt === null);

  const marginUsd = mrrUsd === null ? null : mrrUsd - totalCostUsd;
  const marginPct = mrrUsd === null || mrrUsd <= 0 ? null : (marginUsd! / mrrUsd) * 100;

  const verdict =
    mrrUsd === null
      ? `🟡 sem receita recorrente medida ainda — queima atual de $${totalCostUsd.toFixed(2)}/mês`
      : marginUsd! > 0
        ? `🟢 margem de $${marginUsd!.toFixed(2)}/mês${incomplete ? " (OTIMISTA — falta custo de infra)" : ""}`
        : `🔴 queimando $${Math.abs(marginUsd!).toFixed(2)}/mês — receita não cobre o custo`;

  return { mrrUsd, aiMonthlyUsd, infra, infraMonthlyUsd, totalCostUsd, marginUsd, marginPct, verdict, incomplete };
}

/** Quantos meses o caixa aguenta na queima atual. Null quando não há queima
 *  (margem positiva) ou quando o caixa não foi informado. */
export function runwayMonths(cashUsd: number | null, marginUsd: number | null): number | null {
  if (cashUsd === null || marginUsd === null || marginUsd >= 0) return null;
  return Math.round((cashUsd / Math.abs(marginUsd)) * 10) / 10;
}
