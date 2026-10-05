/**
 * GROWTH — a montagem dos KPIs a partir das leituras, separada da rota para ser testável.
 *
 * ⚠️⚠️ "NÃO SEI" NÃO É "ZERO" (RM-07, auditoria do round de custo). A rota fazia
 * `count ?? 0` e lia só `.linhas` de `lerTodasAsPaginas` — que devolve
 * `linhas: []` quando a leitura FALHA. Uma queda do banco virava, na tela,
 * "traded 0 · autopilot 0 · paid 0": um número legítimo, errado, e sem aviso.
 *
 * Agora cada métrica que dependeu de uma leitura que falhou (ou que o teto
 * cortou) sai `null`, e a resposta diz QUAIS e POR QUÊ:
 *   · `estado: "completo"`     — todas as leituras voltaram inteiras;
 *   · `estado: "parcial"`      — alguma voltou cortada (`truncado`) ou falhou;
 *   · `estado: "indisponivel"` — nenhuma métrica pôde ser medida.
 *
 * ⚠️ NÃO É LEDGER-GRADE: as leituras paginadas usam offset (`lerTodasAsPaginas`)
 * sem snapshot — uma linha inserida/apagada no meio da leitura pode deslocar a
 * página. Para um painel indicativo isso é aceitável e está declarado; número
 * financeiro oficial NÃO pode sair daqui (ver `paginar.ts`).
 */
import type { LeituraPaginada } from "@/lib/supabase/paginar";

export interface Contagem { count: number | null; error: { message: string } | null }

export interface EntradasDoGrowth {
  total: Contagem; dau: Contagem; wau: Contagem; mau: Contagem; new1d: Contagem; new7d: Contagem;
  operacoes: LeituraPaginada<{ wallet_address: string }>;
  autopilot: LeituraPaginada<{ wallet_address: string }>;
  tiers: LeituraPaginada<{ tier: string }>;
}

export interface Growth {
  active: { dau: number | null; wau: number | null; mau: number | null; stickiness: number | null };
  signups: { new1d: number | null; new7d: number | null };
  funnel: Array<{ step: string; count: number | null; conv: number | null }>;
  estado: "completo" | "parcial" | "indisponivel";
  /** O que não pôde ser medido, com o motivo — a tela mostra isto em vez de um zero. */
  indisponiveis: Array<{ metrica: string; porque: string }>;
  /** ⚠️ Sempre presente: estes números são indicativos, não ledger-grade. */
  natureza: "indicativo_nao_ledger";
}

const PAID = new Set(["pro", "trader", "pilot"]);

export function montarGrowth(e: EntradasDoGrowth): Growth {
  const indisponiveis: Growth["indisponiveis"] = [];
  const contagem = (nome: string, c: Contagem): number | null => {
    if (c.error) { indisponiveis.push({ metrica: nome, porque: c.error.message.slice(0, 160) }); return null; }
    if (typeof c.count !== "number" || !Number.isFinite(c.count)) {
      indisponiveis.push({ metrica: nome, porque: "contagem ausente na resposta" }); return null;
    }
    return c.count;
  };
  const distintas = <T,>(nome: string, l: LeituraPaginada<T>, f: (linhas: T[]) => number): number | null => {
    if (l.erro) { indisponiveis.push({ metrica: nome, porque: l.erro }); return null; }
    if (l.truncado) { indisponiveis.push({ metrica: nome, porque: `leitura cortada pelo teto depois de ${l.linhas.length} linhas` }); return null; }
    return f(l.linhas);
  };

  const signedUp = contagem("signed up", e.total);
  const dau = contagem("dau", e.dau);
  const wau = contagem("wau", e.wau);
  const mau = contagem("mau", e.mau);
  const new1d = contagem("new1d", e.new1d);
  const new7d = contagem("new7d", e.new7d);
  const traded = distintas("traded", e.operacoes, (ls) => new Set(ls.map((r) => r.wallet_address)).size);
  const autopilot = distintas("autopilot", e.autopilot, (ls) => new Set(ls.map((r) => r.wallet_address)).size);
  const paid = distintas("paid", e.tiers, (ls) => ls.filter((t) => PAID.has(t.tier)).length);

  // Conversão só existe com numerador E base medidos; base 0 também não tem conversão.
  const conv = (n: number | null) => (n != null && signedUp != null && signedUp > 0 ? n / signedUp : null);
  const medidas = [signedUp, dau, wau, mau, new1d, new7d, traded, autopilot, paid];
  const estado: Growth["estado"] = medidas.every((m) => m == null)
    ? "indisponivel" : indisponiveis.length > 0 ? "parcial" : "completo";

  return {
    active: { dau, wau, mau, stickiness: dau != null && mau != null && mau > 0 ? dau / mau : null },
    signups: { new1d, new7d },
    funnel: [
      { step: "signed up", count: signedUp, conv: signedUp != null ? 1 : null },
      { step: "traded", count: traded, conv: conv(traded) },
      { step: "autopilot", count: autopilot, conv: conv(autopilot) },
      { step: "paid", count: paid, conv: conv(paid) },
    ],
    estado,
    indisponiveis,
    natureza: "indicativo_nao_ledger",
  };
}
