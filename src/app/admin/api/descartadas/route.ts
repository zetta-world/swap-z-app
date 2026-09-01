import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { fetchOrderbookDetalhado } from "@/lib/api/cex-orderbook";
import type { CexSpotSource } from "@/lib/api/cex-spot";
import { assessRealism, type Realism } from "@/lib/zion/arb-realism";
import { spreadWindow, COST_PCT, MIN_NET_PCT } from "@/lib/zion/arbiter";
import {
  rotasDeEventos, classificarRota, agregar, vereditoDoTeto,
  type EventoAnomalia, type RotaDescartada, type Classe,
} from "@/lib/zion/descartadas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * AS DESCARTADAS — o teto de credibilidade está cego?
 * (`docs/PLANO-DESCARTADAS.md`)
 *
 * ⚠️ LEITURA PURA. Não abre posição, não escreve em `admin_kv`, não toca em
 * `MAX_GROSS_PCT`. Mexer num portão de dinheiro por palpite é o hábito que este
 * laboratório existe para não ter — mede primeiro, decide depois, e a decisão é
 * de gente, fora desta rota. O único efeito é o evento (invariante nº 14).
 *
 * ⚠️ O TAMANHO É O DA MESA. $50 é o que o arbitrador opera (`ARB_SIZE_USD`);
 * medir profundidade num tamanho que ninguém opera responderia outra pergunta.
 */

/** O tamanho que as mesas operam — o mesmo padrão de `ARB_SIZE_USD`. */
const SIZE_USD = Number(process.env.ARB_SIZE_USD ?? 50);

/**
 * ⚠️ TETO DE CUSTO DA MEDIÇÃO, e ele é ANUNCIADO, nunca silencioso.
 *
 * Cada rota são 2 chamadas de orderbook. Sem limite, um dia com 60 rotas
 * distintas viraria 120 chamadas numa rota de botão. O que foi deixado de fora
 * volta em `rotasIgnoradas` — corte silencioso lê-se como "cobri tudo", e essa
 * é a mentira mais barata que uma medição pode contar.
 */
const MAX_ROTAS = Number(process.env.DESCARTADAS_MAX_ROTAS ?? 12);

interface LinhaVeredito extends RotaDescartada {
  classe: Classe;
  motivo: string;
  realista: Realism | null;
}

export async function GET(req: Request): Promise<NextResponse> {
  await requireAdmin();
  const t0 = Date.now();

  const horas = Math.min(168, Math.max(1, Number(new URL(req.url).searchParams.get("horas") ?? 24)));
  const janela = spreadWindow();

  const db = getSupabaseAdmin();
  if (!db) {
    return NextResponse.json({ error: "sem banco — a medição não inventa amostra" }, { status: 503 });
  }

  const desde = new Date(Date.now() - horas * 3_600_000).toISOString();

  /**
   * leitura-limitada: o recorte é intencional e o teto é ANUNCIADO.
   *
   * `arb_data_anomaly` é deduplicada uma vez por hora por rota
   * (`arbiter.ts:473`), o que dá um piso natural: com ~83 anúncios em 24h, mil
   * linhas cobrem cerca de doze dias — e a janela máxima aqui é de sete.
   *
   * ⚠️ E SE ESTOURAR MESMO ASSIM, a tela precisa saber. A ordem é `created_at`
   * DESC, então o corte descarta as MAIS ANTIGAS: o efeito seria uma rota
   * sumir do julgamento por idade, não um número errado. `historicoTruncado`
   * leva isso na resposta — recorte silencioso lê-se como "vi tudo".
   */
  const TETO_EVENTOS = 1000;
  // leitura-limitada: mil linhas cobrem ~12 dias de anomalias já dedupadas por
  // hora/rota, e a janela máxima daqui é de 7. Estouro vira `historicoTruncado`
  // na resposta, nunca silêncio. (Motivo completo no bloco acima.)
  const { data, error } = await db
    .from("platform_events")
    .select("created_at, metadata")
    .eq("event_type", "arb_data_anomaly")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(TETO_EVENTOS);

  /**
   * ⚠️ FALHA DE BANCO NÃO VIRA "ZERO DESCARTADAS" (invariante nº 33). Vazio por
   * FALHA e vazio por AUSÊNCIA são estados diferentes com a mesma aparência, e
   * confundi-los aqui produziria "o teto não barra nada" a partir de uma
   * consulta quebrada.
   */
  if (error) {
    return NextResponse.json(
      { error: `histórico não respondeu: ${error.message}` },
      { status: 503 },
    );
  }

  const eventos: EventoAnomalia[] = (data ?? []).map((r) => {
    const m = (r.metadata ?? {}) as Record<string, unknown>;
    return {
      symbol: String(m.symbol ?? ""),
      buy: String(m.buy ?? ""),
      sell: String(m.sell ?? ""),
      spreadPct: Number(m.spreadPct),
      acimaDoPiso: m.acimaDoPiso === true,
      venues: Number(m.venues ?? 0),
      createdAt: String(r.created_at),
    };
  });

  const rotas = rotasDeEventos(eventos);

  /**
   * ⚠️⚠️ A ESCOLHA DA AMOSTRA, e ela decide o resultado.
   *
   * As rotas saem ordenadas pelo MAIOR spread — bom para ler na tela, péssimo
   * para escolher o que medir. Spread gigante é quase sempre cadáver de
   * listagem, que é justamente o caso que o teto acerta. Cortar por aí encheria
   * a amostra de confirmação fácil.
   *
   * A hipótese sob teste é "o teto está barrando dinheiro real". Os candidatos
   * mais fortes dela são os spreads MENORES acima do piso — 0,56% contra piso
   * de 0,55% é plausível; 12% não é. Por isso a leitura vai do menor para o
   * maior: se nem os plausíveis sobrevivem, o teto está justificado com a
   * amostra mais favorável possível ao contrário.
   */
  const paraLer = [...rotas].sort((a, b) => a.spreadTopoPct - b.spreadTopoPct).slice(0, MAX_ROTAS);

  const lidas: LinhaVeredito[] = await Promise.all(
    paraLer.map(async (rota): Promise<LinhaVeredito> => {
      /**
       * ⚠️ O LEITOR DETALHADO, e não o `fetchOrderbook` mudo (01/09). Os dois
       * existem: aquele falha fechado para o dinheiro, este diz POR QUE não
       * leu — porque aqui a diferença entre "livro vazio" e "429" vira classe,
       * e classe vira veredito sobre o teto de custo.
       */
      const [compra, venda] = await Promise.all([
        fetchOrderbookDetalhado(rota.buy as CexSpotSource, rota.symbol),
        fetchOrderbookDetalhado(rota.sell as CexSpotSource, rota.symbol),
      ]).catch(() => [
        { ok: false, motivo: "rede" } as const,
        { ok: false, motivo: "rede" } as const,
      ]);

      /** A perna que falhou manda: uma ponta não medida deixa a rota não medida. */
      const falhou = !compra.ok ? compra : !venda.ok ? venda : null;
      const realista = falhou || !compra.ok || !venda.ok
        ? null
        : assessRealism(compra.book.asks, venda.book.bids, SIZE_USD, rota.spreadTopoPct, COST_PCT);

      return {
        ...rota, realista,
        ...classificarRota(realista, MIN_NET_PCT, falhou ? falhou.motivo : undefined),
      };
    }),
  );

  const resumo = agregar(lidas.map((l) => l.classe));
  const veredito = vereditoDoTeto(resumo, janela.ceilPct, janela.floorPct, SIZE_USD, {
    lidas: paraLer.length,
    noHistorico: rotas.length,
    regra: "as de MENOR spread acima do piso",
  });

  await recordEvent("lab_descartadas", { meta: {
    horas,
    rotas_no_historico: rotas.length,
    rotas_lidas: lidas.length,
    rotas_ignoradas: Math.max(0, rotas.length - lidas.length),
    real: resumo.real, raso: resumo.raso, cadaver: resumo.cadaver,
    /**
     * ⚠️ AS DUAS RESSALVAS PASSAM A SER GRAVADAS (01/09). `nao_medido` distingue
     * "o teto está certo" de "não olhamos"; `historico_truncado` viajava na
     * resposta e morria nela — o evento anunciava "12 de 87 rotas" como se 87
     * fosse tudo o que houve na semana.
     */
    nao_medido: resumo.naoMedido,
    historico_truncado: (data ?? []).length >= TETO_EVENTOS,
    ceil_pct: janela.ceilPct,
    floor_pct: janela.floorPct,
    size_usd: SIZE_USD,
    // Os símbolos que sobreviveram — é o que alguém vai querer conferir à mão.
    reais: lidas.filter((l) => l.classe === "real").map((l) => `${l.symbol}:${l.buy}>${l.sell}`),
    ms: Date.now() - t0,
  } });

  return NextResponse.json({
    horas,
    janela: { ceilPct: janela.ceilPct, floorPct: janela.floorPct, vazia: janela.empty },
    custo: { costPct: COST_PCT, minNetPct: MIN_NET_PCT, sizeUsd: SIZE_USD },
    rotasNoHistorico: rotas.length,
    rotasLidas: lidas.length,
    /** ⚠️ O histórico bateu no teto — as anomalias mais antigas ficaram fora. */
    historicoTruncado: (data ?? []).length >= TETO_EVENTOS,
    /** ⚠️ O que o teto de custo deixou de fora — anunciado, nunca silencioso. */
    rotasIgnoradas: Math.max(0, rotas.length - lidas.length),
    resumo,
    veredito,
    linhas: lidas.sort((a, b) => b.spreadTopoPct - a.spreadTopoPct),
    /**
     * ⚠️ AS RESSALVAS VIAJAM NA RESPOSTA, não no comentário. Lida sem elas,
     * esta medição vira "as anomalias eram falsas" — uma frase que o dado não
     * sustenta.
     */
    naoMedido: [
      "NÃO É REPLAY: lê o livro de AGORA, não o do instante da anomalia. Uma rota "
        + "que era real às 18:59 e morreu às 20:00 aparece como cadáver, e vice-versa. "
        + "O veredito é honesto sobre a ROTA, nunca sobre o evento histórico",
      "a contagem de anúncios NÃO é a frequência real: o dedup anuncia uma vez por "
        + "hora por rota, então ela mede visibilidade, não incidência",
      "não mede DURAÇÃO — se o spread viveu segundos ou horas pediria amostragem "
        + "repetida da mesma rota, que é outra medição",
      "usa o piso da mesa base (custo " + COST_PCT + "% + mínimo " + MIN_NET_PCT + "%); "
        + "as três variantes 2.0 exigem mais, então o total de REAIS aqui é um TETO "
        + "do que elas aprovariam, nunca um piso",
      "andar o livro é o piso do custo de execução: falta a derrapagem de TEMPO "
        + "entre decidir e preencher, que segue sem instrumentação",
    ],
    fetchedAt: new Date().toISOString(),
  });
}
