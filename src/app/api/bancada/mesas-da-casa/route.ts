/**
 * AS MESAS DA CASA, MEDIDAS — a vitrine do torneio na bancada do cliente.
 *
 * ⚠️⚠️ OS NÚMEROS SÃO LIDOS DO BANCO A CADA VEZ, nunca escritos à mão. Um
 * percentual digitado num catálogo envelhece em silêncio: a mesa piora, o card
 * continua vendendo o número bom, e ninguém descobre porque nada quebra.
 *
 * ⚠️ E A ROTA É PÚBLICA (sem sessão), de propósito: o que ela devolve é o que a
 * casa mede sobre as PRÓPRIAS mesas — não há dado de cliente nenhum aqui. É a
 * mesma informação que a `/pricing` mostra, e prendê-la atrás de login faria
 * quem ainda não entrou não ter como avaliar o produto.
 */

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { mesasElegiveis, montarCartao, mereceCartao, type MedicaoDaMesa } from "@/lib/bancada/mesas-da-casa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ CACHE EM `admin_kv`, 30 MINUTOS. A agregação varre milhares de linhas de
 * `zion_suggestions`, e esta rota é de PÁGINA DE CLIENTE: sem cache, cada
 * visita paga a varredura, e o custo cresce com o número de visitantes — não
 * com o número de mesas.
 *
 * Trinta minutos porque o dado muda no ritmo do cron (30 min): cachear menos
 * não traria número novo, só conta.
 */
const CHAVE = "bancada:mesas-da-casa";
const VALIDADE_MS = 30 * 60_000;

interface Cacheado { emMs: number; cartoes: unknown[] }

export async function GET() {
  const db = getSupabaseAdmin();
  if (!db) {
    // ⚠️ Sem banco a vitrine some, e isso é melhor que mostrar mesa sem número:
    // um card com "—" no lugar do resultado convida a leitura errada.
    return NextResponse.json({ ok: false, error: "sem_banco", cartoes: [] }, { status: 503 });
  }

  const agora = Date.now();
  // ⚠️ `admin_kv.value` é TEXTO — a casa serializa. Ler com `JSON.parse` dentro
  // de try/catch: um valor corrompido não pode derrubar a vitrine, ele só
  // invalida o cache e a rota remede.
  const { data: guardado } = await db.from("admin_kv").select("value").eq("key", CHAVE).maybeSingle();
  let c: Cacheado | null = null;
  try {
    const cru = (guardado as { value?: string } | null)?.value;
    c = cru ? (JSON.parse(cru) as Cacheado) : null;
  } catch { c = null; }
  if (c && typeof c.emMs === "number" && agora - c.emMs < VALIDADE_MS && Array.isArray(c.cartoes)) {
    return NextResponse.json({ ok: true, cartoes: c.cartoes, doCache: true });
  }

  const elegiveis = mesasElegiveis();
  const sources = elegiveis.map((d) => d.source);

  /**
   * ⚠️ SÓ OS TRÊS DESFECHOS RESOLVIDOS, e `expired` fica FORA de `decididos`.
   * Contá-la como derrota infla o custo, como vitória infla a borda — cicatriz
   * do flywheel. Ela é somada à parte porque o cliente precisa vê-la.
   *
   * ⚠️⚠️ inclui-arquivadas: o número é de VIDA INTEIRA, com as rodadas
   * arquivadas dentro — e isso é a escolha CONSERVADORA, não um descuido.
   * Uma rodada vai para o arquivo quando a mesa muda ou tomba; ficar só com a
   * rodada viva selecionaria por recência e só poderia MELHORAR o nosso
   * número. Incluir o passado ruim é o que impede a vitrine de escolher a
   * própria sorte. O `radar` é o caso extremo: 194 decididas arquivadas contra
   * 91 vivas — sem o histórico, a mesa apareceria com um terço da amostra.
   *
   * ⚠️ leitura-limitada: paginada em blocos de 1.000 com teto de 100.000 pelo
   * `selectAllRows` da casa. `zion_suggestions` cresce a cada tick do cron, e
   * um `.limit()` fixo truncaria em silêncio no dia em que a tabela passasse
   * dele — a média sairia de uma fatia arbitrária, e nada avisaria.
   */
  const linhas = await selectAllRows<{
    source: string; status: string; outcome_pct: number | string | null;
    symbol: string | null; created_at: string;
  }>((de, ate) => db
    // inclui-arquivadas: vida inteira de propósito — a rodada arquivada é o
    // passado RUIM da mesa, e tirá-la só melhoraria o nosso número. Ver a nota
    // acima.
    // leitura-limitada: paginada por `selectAllRows` (1.000 por bloco).
    .from("zion_suggestions")
    .select("source, status, outcome_pct, symbol, created_at")
    .in("source", sources)
    .in("status", ["hit_target", "hit_stop", "expired"])
    .order("created_at", { ascending: true })
    .range(de, ate));

  if (linhas.length === 0) {
    return NextResponse.json({ ok: false, error: "leitura", cartoes: [] }, { status: 503 });
  }

  const porFonte = new Map<string, MedicaoDaMesa>();
  const simbolosPorFonte = new Map<string, Set<string>>();
  const diasPorFonte = new Map<string, Set<string>>();
  const somaPorFonte = new Map<string, number>();

  for (const l of linhas) {
    const m = porFonte.get(l.source) ?? {
      source: l.source, decididos: 0, alvo: 0, stop: 0, expiradas: 0,
      brutoPorOpPct: 0, simbolos: 0, dias: 0, primeiroDia: "", ultimoDia: "",
    };
    const dia = l.created_at.slice(0, 10);
    if (!m.primeiroDia || dia < m.primeiroDia) m.primeiroDia = dia;
    if (!m.ultimoDia || dia > m.ultimoDia) m.ultimoDia = dia;

    if (l.status === "expired") m.expiradas++;
    else {
      m.decididos++;
      if (l.status === "hit_target") m.alvo++; else m.stop++;
      // ⚠️ `Number(null)` é 0 e passa em isFinite — a média só soma o que existe.
      const v = l.outcome_pct == null ? null : Number(l.outcome_pct);
      if (v != null && Number.isFinite(v)) somaPorFonte.set(l.source, (somaPorFonte.get(l.source) ?? 0) + v);
    }

    if (l.symbol) {
      const s = simbolosPorFonte.get(l.source) ?? new Set<string>();
      s.add(l.symbol); simbolosPorFonte.set(l.source, s);
    }
    const d = diasPorFonte.get(l.source) ?? new Set<string>();
    d.add(dia); diasPorFonte.set(l.source, d);

    porFonte.set(l.source, m);
  }

  // ⚠️ A regra de quem merece card vive em `mereceCartao`, no módulo puro —
  // com a nota inteira e com teste.
  const cartoes = elegiveis.flatMap((desk) => {
    const m = porFonte.get(desk.source);
    if (!mereceCartao(m)) return [];
    m!.simbolos = simbolosPorFonte.get(desk.source)?.size ?? 0;
    m!.dias = diasPorFonte.get(desk.source)?.size ?? 0;
    m!.brutoPorOpPct = m!.decididos > 0 ? (somaPorFonte.get(desk.source) ?? 0) / m!.decididos : 0;
    return [montarCartao(desk, m!)];
  });

  // ⚠️ Best-effort: falha ao gravar o cache não pode derrubar a vitrine.
  await db.from("admin_kv").upsert({ key: CHAVE, value: JSON.stringify({ emMs: agora, cartoes }), updated_at: new Date(agora).toISOString() }, { onConflict: "key" });

  return NextResponse.json({ ok: true, cartoes, doCache: false });
}
