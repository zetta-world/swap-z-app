import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O MURAL — o que a plataforma está fazendo, agora.
 *
 * Uma rota só, porque a tela é uma só e fica aberta o dia inteiro: quatro
 * chamadas separadas dariam quatro instantes diferentes na mesma imagem, e o
 * mapa mostraria um acesso que o contador ainda não contou.
 *
 * ⚠️ TUDO AQUI É MEDIDO. Nenhum número desta rota é estimado, projetado ou
 * completado — o mapa vem de `platform_events`, o fluxo e o dinheiro vêm de
 * `operations`. Quando não há movimento, os campos voltam vazios e a tela diz
 * isso. Uma tela de parede é o lugar mais fácil do mundo para uma projeção
 * virar fato aos olhos de quem passa, e por isso ela não recebe projeção
 * nenhuma.
 */

/** Um lugar de onde vieram acessos. */
interface Praca {
  cidade: string; pais: string;
  lat: number; lon: number;
  acessos: number;
  /** Minutos desde o último acesso — decide o brilho do ponto. */
  minAtras: number;
}

/** Uma troca que aconteceu. */
interface Troca {
  quando: string; par: string; cadeia: string;
  volumeUsd: number | null; taxaUsd: number | null; rota: string | null;
}

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "sem banco" }, { status: 503 });

  const agora = Date.now();
  const desde24h = new Date(agora - 24 * 3600_000).toISOString();
  const desde30d = new Date(agora - 30 * 86400_000).toISOString();

  try {
    /**
     * ⚠️ GEO SÓ DOS ÚLTIMOS 30 DIAS. Um mapa que acumula desde sempre nunca
     * apaga um ponto, e vira um retrato do passado com cara de tempo real —
     * o visitante lê "temos gente aqui" onde a verdade é "tivemos, uma vez".
     */
    // leitura-limitada: o mapa mostra ONDE houve acesso, não quantos ao todo.
    // 2.000 eventos recentes cobrem qualquer praça ativa em 30 dias, e uma
    // praça a mais no fim da fila não muda a silhueta nem decide nada — o
    // número de acessos por praça é rótulo, não medição de negócio.
    const { data: views } = await db
      .from("platform_events")
      .select("metadata, created_at")
      .eq("event_type", "page_view")
      .gte("created_at", desde30d)
      .order("created_at", { ascending: false })
      .limit(2000);

    const porLugar = new Map<string, Praca>();
    for (const v of views ?? []) {
      const m = (v.metadata ?? {}) as Record<string, unknown>;
      const lat = Number(m.lat), lon = Number(m.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      /** Arredonda para agrupar bairros da mesma cidade num ponto só. */
      const chave = `${lat.toFixed(1)},${lon.toFixed(1)}`;
      const min = Math.floor((agora - new Date(String(v.created_at)).getTime()) / 60000);
      const atual = porLugar.get(chave);
      if (atual) { atual.acessos += 1; atual.minAtras = Math.min(atual.minAtras, min); continue; }
      porLugar.set(chave, {
        cidade: String(m.city ?? "—"), pais: String(m.country ?? "—"),
        lat, lon, acessos: 1, minAtras: min,
      });
    }
    const pracas = [...porLugar.values()].sort((a, b) => b.acessos - a.acessos);

    /** O fluxo: operações confirmadas, mais recentes primeiro. */
    const { data: ops } = await db
      .from("operations")
      .select("created_at, pair, chain, volume_usd, platform_fee_usd, route, kind, status")
      .eq("status", "confirmed")
      .order("created_at", { ascending: false })
      .limit(40);

    const trocas: Troca[] = (ops ?? []).map((o) => ({
      quando: String(o.created_at),
      par: String(o.pair ?? "—"),
      cadeia: String(o.chain ?? "—"),
      volumeUsd: o.volume_usd == null ? null : Number(o.volume_usd),
      taxaUsd: o.platform_fee_usd == null ? null : Number(o.platform_fee_usd),
      rota: o.route == null ? null : String(o.route),
    }));

    /**
     * ⚠️ O DINHEIRO É SOMA DE PARCELA (Fase 11), nunca porcentagem do volume.
     * O painel de receita já cometeu esse erro por meses e mostrou $1,27 onde
     * havia $0,09. Num mural de parede o erro seria maior: ninguém confere um
     * número que está a três metros de distância.
     */
    /**
     * ⚠️ PAGINADO, E É O TESTE DE LEITURA SEGURA QUE EXIGIU (12/08).
     *
     * Eu tinha escrito um `select` sem teto. O PostgREST corta em ~1.000
     * linhas SEM erro, então o total do dinheiro pararia de crescer em silêncio
     * na milésima operação — e este é o número que fica projetado em 65
     * polegadas, o lugar onde ninguém confere. Exatamente a classe de defeito
     * que `LEITURA-SEGURA-DO-BANCO.md` documenta.
     */
    const todas = await selectAllRows<{
      created_at: string; volume_usd: number | null; platform_fee_usd: number | null;
    }>((de, ate) => db
      .from("operations")
      .select("created_at, volume_usd, platform_fee_usd")
      .eq("status", "confirmed")
      .order("created_at", { ascending: true }).range(de, ate));

    const linhas = todas;
    const soma = (f: (r: typeof linhas[number]) => number) => linhas.reduce((t, r) => t + f(r), 0);
    const em24h = linhas.filter((r) => String(r.created_at) >= desde24h);

    const dinheiro = {
      arrecadadoTotalUsd: Number(soma((r) => Number(r.platform_fee_usd ?? 0)).toFixed(6)),
      arrecadado24hUsd: Number(em24h.reduce((t, r) => t + Number(r.platform_fee_usd ?? 0), 0).toFixed(6)),
      volumeTotalUsd: Number(soma((r) => Number(r.volume_usd ?? 0)).toFixed(2)),
      volume24hUsd: Number(em24h.reduce((t, r) => t + Number(r.volume_usd ?? 0), 0).toFixed(2)),
      operacoes: linhas.length,
      operacoes24h: em24h.length,
    };

    /**
     * ⚠️ O PULSO DA INFRAESTRUTURA — e ele é atividade REAL, não enfeite.
     *
     * Antes do lançamento o mapa terá poucos pontos, e uma tela parada parece
     * uma tela quebrada. Mas a plataforma NÃO está parada: os crons batem a
     * cada minuto, as medições rodam, o radar varre. Isso é sistema vivo, e
     * mostrar isso é honesto — o que seria desonesto é fingir tráfego de
     * cliente que ainda não existe.
     */
    const { count: eventos5min } = await db
      .from("platform_events")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date(agora - 300_000).toISOString());

    const { count: usuarios } = await db
      .from("tier_cache").select("wallet_address", { count: "exact", head: true });

    /**
     * ⚠️ A REGIÃO ONDE ESTA FUNÇÃO EXECUTOU — e ela é dado, não enfeite.
     *
     * A referência do mural trazia "NETWORK: 1GBPS" e "SYS_LOAD: 72%", que
     * são números inventados pela geração da imagem. Trocar por métrica falsa
     * numa barra de status seria a mesma classe de mentira que este projeto
     * persegue nos painéis — só que mais barata, porque ninguém confere
     * rodapé.
     *
     * `VERCEL_REGION` é o oposto: é medido, e é exatamente a pergunta que a
     * migração da Binance abriu — em qual região isto está rodando de fato?
     * Ela vira visível na parede em vez de precisar de inspeção de artefato.
     */
    return NextResponse.json({
      pracas, trocas, dinheiro,
      pulso: { eventos5min: eventos5min ?? 0, usuarios: usuarios ?? 0 },
      infra: {
        regiao: process.env.VERCEL_REGION ?? "local",
        levouMs: Date.now() - agora,
      },
      agora: new Date(agora).toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
