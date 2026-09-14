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

import { NextRequest, NextResponse } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { mesasElegiveis, montarCartao, mereceCartao, diaDaDecisao, type MedicaoDaMesa } from "@/lib/bancada/mesas-da-casa";

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
// ⚠️ O SUFIXO `v2` É PARTE DA CORREÇÃO, não enfeite: o cache guarda CARTÕES
// PRONTOS por 30 min, com o carimbo de validade já dentro. Sem trocar a chave,
// a vitrine continuaria servindo a data errada por meia hora depois do deploy —
// e o cache é global, não por visitante. Trocar a chave é o único jeito de a
// correção valer no primeiro acesso.
const CHAVE = "bancada:mesas-da-casa:v2";
const VALIDADE_MS = 30 * 60_000;

interface Cacheado { emMs: number; cartoes: unknown[] }

/**
 * ⚠️⚠️ QUANTO A VARREDURA PODE SER REFEITA — a trava contra a debandada (14/09).
 *
 * ACHADO DA AUDITORIA (lente `ratelimit`). Esta rota é PÚBLICA — sem sessão, de
 * propósito — e o `middleware.ts` só cobre `/admin/:path*`, então NADA acima
 * dela limita coisa alguma. O cache de 30 min é lido no começo e só escrito no
 * FIM, depois da varredura inteira: K requisições que cheguem com o cache
 * vencido TODAS erram e TODAS varrem. O cache não serializa nada.
 *
 * E a varredura não é uma consulta: `selectAllRows` pagina em blocos de 1.000
 * sobre `.in("source", …).in("status", …).order("created_at")`, e NENHUM índice
 * de `zion_suggestions` cobre esse filtro — os que existem são parciais em
 * `status='open'`, por `symbol`, e por `created_at where archived_at is null`.
 * Cada página é varredura + ordenação do conjunto filtrado inteiro, e o OFFSET
 * cresce a cada página.
 *
 * ⚠️ O Postgres é UM só para a plataforma. Derrubar o pool aqui derruba login,
 * swap, admin e os agentes dos clientes pagantes junto.
 *
 * ⚠️⚠️ E O ÍNDICE **NÃO** É A CORREÇÃO — medido em 14/09, não chute.
 *
 * A leitura óbvia do parágrafo acima é "falta um índice em (source, status,
 * created_at)". Eu criei esse índice, medi com `explain (analyze, buffers)`
 * sobre as 5.875 linhas reais, e DESFIZ:
 *
 *     seq scan     4,25 ms ·   169 buffers
 *     index scan   3,95 ms · 1.422 buffers   ← oito vezes mais páginas lidas
 *
 * Com 2.494 das 5.875 linhas casando o filtro (42%), o índice obriga a buscar
 * quase metade da tabela no heap, uma linha por vez, em vez de varrê-la em
 * sequência. O planejador só o escolheu por margem estreita de custo (243 vs
 * 286) — e pagaria escrita a cada insert do cron por um ganho que não existe.
 *
 * ⚠️ QUANDO ELE PASSARIA A PAGAR: quando a fração que casa o filtro cair bem
 * abaixo de 42%, ou quando a tabela crescer a ponto de a varredura sequencial
 * custar mais que o heap fetch. Refaça a medição antes de criar — não crie
 * porque o texto acima diz "varredura sequencial".
 *
 * O que corrige DE VERDADE é o que está abaixo: o freio de rajada e a trava.
 * Eles limitam quantas varreduras existem, que é o número que importa; o índice
 * mexeria no custo de cada uma, que hoje já é de 4 milissegundos.
 */
const TRAVA = "lock:bancada:mesas-da-casa";
const TRAVA_MS = 60_000;

/**
 * ⚠️ FALHA ABERTA, como o resto da casa: não conseguir ler ou gravar a trava
 * não pode derrubar a vitrine. O pior caso sem trava é o que já existia hoje.
 */
async function pegouATrava(db: ReturnType<typeof getSupabaseAdmin>): Promise<boolean> {
  if (!db) return true;
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", TRAVA).maybeSingle();
    const valor = (data as { value?: string } | null)?.value;
    if (valor) {
      const quando = Date.parse(valor);
      if (Number.isFinite(quando) && Date.now() - quando < TRAVA_MS) return false;
    }
    await db.from("admin_kv").upsert(
      { key: TRAVA, value: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    return true;
  } catch { return true; }
}

export async function GET(req: NextRequest) {
  /**
   * ⚠️⚠️ FREIO DE RAJADA NUMA ROTA SEM SESSÃO (14/09).
   *
   * A chave é o IP porque aqui NÃO HÁ carteira — é o único identificador que
   * existe numa rota anônima, e é exatamente o caso que `getClientId` documenta
   * como o certo. (Nas rotas com sessão a chave é a carteira; usar IP lá seria
   * o erro que o DCA já pagou.)
   *
   * ⚠️ Generoso de propósito: a vitrine é a porta de entrada de quem ainda não
   * assinou, e um teto apertado transformaria um defeito de disponibilidade
   * numa barreira de venda. 30 por minuto é muito acima de qualquer navegação
   * humana e muito abaixo de uma rajada.
   */
  const limite = await rateLimitDurable(`vitrine:${getClientId(req.headers)}`, { windowMs: 60_000, max: 30 });
  if (!limite.ok) {
    return NextResponse.json(
      { ok: false, error: "muitas_requisicoes", cartoes: [] },
      { status: 429, headers: { "Retry-After": String(limite.retryAfter) } },
    );
  }

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
  const temCache = !!c && typeof c.emMs === "number" && Array.isArray(c.cartoes);
  if (temCache && agora - c!.emMs < VALIDADE_MS) {
    return NextResponse.json({ ok: true, cartoes: c!.cartoes, doCache: true });
  }

  /**
   * ⚠️⚠️ SÓ UMA VARREDURA POR VEZ — e quem não pega a trava serve o CACHE VELHO.
   *
   * Servir dado de 31 minutos é melhor que somar mais uma varredura completa à
   * que já está correndo. Sem cache nenhum para servir, 503: a vitrine some, que
   * é a mesma escolha que a rota já faz sem banco — um card com "—" no lugar do
   * resultado convida a leitura errada.
   *
   * ⚠️ `doCache: "vencido"` e não `true`: quem consome precisa poder distinguir
   * "fresco" de "o melhor que eu tinha". Devolver os dois como a mesma coisa
   * seria a família de defeito que esta auditoria inteira persegue.
   */
  if (!(await pegouATrava(db))) {
    if (temCache) {
      return NextResponse.json({ ok: true, cartoes: c!.cartoes, doCache: "vencido" });
    }
    return NextResponse.json({ ok: false, error: "medindo", cartoes: [] }, { status: 503 });
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
    symbol: string | null; created_at: string; resolved_at: string | null;
  }>((de, ate) => db
    // inclui-arquivadas: vida inteira de propósito — a rodada arquivada é o
    // passado RUIM da mesa, e tirá-la só melhoraria o nosso número. Ver a nota
    // acima.
    // leitura-limitada: paginada por `selectAllRows` (1.000 por bloco).
    .from("zion_suggestions")
    // ⚠️ `resolved_at` VEM JUNTO porque o carimbo de validade fala de DECISÃO,
    // e `created_at` é a EMISSÃO — até 72h de diferença, medidas no banco. A
    // regra de qual data conta mora em `diaDaDecisao`, com nota e teste.
    .select("source, status, outcome_pct, symbol, created_at, resolved_at")
    .in("source", sources)
    .in("status", ["hit_target", "hit_stop", "expired"])
    .order("created_at", { ascending: true })
    .range(de, ate));

  if (linhas.length === 0) {
    /**
     * ⚠️ SEM LINHA NENHUMA a rota devolve 503 e NÃO grava cache — então neste
     * estado toda requisição refaz a varredura. É deliberado (cachear "vazio"
     * esconderia uma leitura quebrada por 30 minutos), e é justamente por isso
     * que o freio de rajada e a trava acima existem: eles são o que impede esse
     * caminho de virar varredura sem fim.
     */
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
    const dia = diaDaDecisao(l);
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
