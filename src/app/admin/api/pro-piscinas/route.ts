import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/admin/require";
import { recordEvent } from "@/lib/admin/track";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { PRO_PAIRS, type ProPair } from "@/lib/pro-pairs";
import {
  getPoolMeta, getTokenPools, getOHLCVOuFalha, ehIndisponivel,
  type PoolSummary, type PoolMeta, type PriceToken,
} from "@/lib/api/geckoterminal";
import {
  medirVelas, julgarPar, JANELA_MIN,
  type LeituraDaPiscina, type JulgamentoDoPar,
} from "@/lib/pro/escolha-da-piscina";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * QUAL PISCINA O TERMINAL DEVE MOSTRAR — a medição, disparada por botão.
 *
 * ⚠️⚠️ ESTA ROTA EXISTE PORQUE A MEDIÇÃO NÃO RODA NA MÁQUINA DE QUEM ESCREVEU O
 * CÓDIGO. O contêiner da sessão de desenvolvimento não alcança a
 * api.geckoterminal.com; a Vercel alcança. A ideia foi do dono: **o teste vai
 * para o painel, com um botão, e o resultado desce para o banco** — daí quem
 * precisa analisar lê por SQL, sem depender de quem clicou ter copiado a tela.
 *
 * ⚠️ LEITURA PURA sobre o mercado. Não abre posição, não muda `PRO_PAIRS`, não
 * escreve em `admin_kv`. As duas únicas escritas são o registro da própria
 * medição — `pro_piscina_medicao` e `pro_piscina_veredito`.
 *
 * ⚠️ E ELA NÃO TROCA A PISCINA SOZINHA. O veredito `trocar` é uma recomendação
 * gravada, não uma ação: mudar o endereço que a produção mostra é edição de
 * `PRO_PAIRS`, revisada em PR. Uma rota de admin que reescreve em silêncio o
 * que o usuário vê é exatamente a classe de automação que esta casa não tem.
 */

/** Quantas velas de 1m pedir. 200 minutos cobre a janela de 180 com folga. */
const VELAS_PEDIDAS = 200;

/** Quantas alternativas considerar por par, além da atual. */
const MAX_CANDIDATAS = 6;

/**
 * ⚠️ TVL MÍNIMO PARA UMA ALTERNATIVA ENTRAR NA COMPARAÇÃO.
 *
 * A lista de piscinas de um token traz de tudo, inclusive piscinas de US$ 300
 * criadas ontem. Elas nunca serão escolhidas e cada uma custa duas requisições
 * à GeckoTerminal, cujo limite é por IP e compartilhado com o resto da Vercel.
 * O corte não muda veredito nenhum — só evita gastar cota com ruído.
 */
const TVL_MINIMO_USD = 100_000;

/**
 * ⚠️⚠️ O RITMO — e ele nasceu de a medição ter se afogado na própria sede.
 *
 * Em 31/08, primeira rodada real: o dono clicou MEDIR TODOS e **56 das 62
 * leituras voltaram 429**. As duas rodadas de 23 pares terminaram em ~5
 * segundos, o que já denunciava tudo — 23 pares não se medem em 5 segundos, a
 * fonte só estava dizendo não muito rápido.
 *
 * A conta que faltou fazer: a GeckoTerminal pública, sem chave, permite ~30
 * chamadas por minuto POR IP. Um par custa ~3 + 2k chamadas (meta da atual,
 * lista de piscinas do token, e OHLCV + meta de cada candidata). Com 3
 * alternativas são ~9 por par; 23 pares são ~200 chamadas disparadas em rajada.
 *
 * ⚠️ E O AGRAVANTE É MEU: `getOHLCVOuFalha` usa `revalidate: 0` de propósito,
 * porque medir cobertura de vela pede a vela de AGORA. A decisão continua certa
 * — o que estava errado era pedir 200 velas frescas sem respirar.
 *
 * ⚠️ OS IPs DE SAÍDA DA VERCEL SÃO COMPARTILHADOS entre projetos, então a cota
 * real é menor que 30. Miramos em 20/min, que é 3 segundos entre chamadas.
 */
const CHAMADAS_POR_MINUTO_ALVO = 20;
const ESPERA_ENTRE_CHAMADAS_MS = Math.ceil(60_000 / CHAMADAS_POR_MINUTO_ALVO);

/**
 * ⚠️ O TETO DE PARES POR CLIQUE, e ele é consequência do ritmo, não gosto.
 *
 * A 3s por chamada e ~9 chamadas por par, 6 pares levam ~160s — dentro do
 * `maxDuration` de 300 com folga para a fonte demorar. Medir os 24 num clique
 * levaria ~10 minutos e a função morreria no meio.
 *
 * ⚠️ E O QUE FICA DE FORA É DITO NA RESPOSTA. Corte silencioso lido como
 * "medimos tudo" é o defeito irmão do que originou este arquivo.
 */
const MAX_PARES_POR_RODADA = 6;

/** Sobra de tempo antes do `maxDuration` — preferimos parar dizendo a parar calado. */
const ORCAMENTO_MS = 240_000;

/**
 * O marcapasso: espaça as chamadas e sabe quando o relógio acabou.
 *
 * ⚠️ ELE CONTA CHAMADAS, NÃO PARES. Um par com 5 alternativas custa o dobro de
 * um com 2, e um limite por par deixaria a rajada acontecer dentro do par.
 */
function marcapasso(inicioMs: number) {
  let chamadas = 0;
  return {
    get chamadas() { return chamadas; },
    /** `false` quando o orçamento de tempo acabou — quem chama PARA e reporta. */
    async passo(): Promise<boolean> {
      if (Date.now() - inicioMs > ORCAMENTO_MS) return false;
      if (chamadas > 0) {
        await new Promise((r) => setTimeout(r, ESPERA_ENTRE_CHAMADAS_MS));
      }
      chamadas += 1;
      return Date.now() - inicioMs <= ORCAMENTO_MS;
    },
  };
}

interface LinhaDaPiscina extends LeituraDaPiscina {
  par: string;
  rede: string;
}

/** Rótulo legível: "PancakeSwap V3 · 0x172f…f849". */
function rotuloDe(dex: string, endereco: string, feeTier?: string): string {
  const curto = endereco.length > 12
    ? `${endereco.slice(0, 6)}…${endereco.slice(-4)}`
    : endereco;
  const taxa = feeTier ? ` ${feeTier}` : "";
  return `${dex || "—"}${taxa} · ${curto}`;
}

function motivoDe(e: unknown): string {
  if (ehIndisponivel(e)) return `geckoterminal ${e.motivo} (status ${e.status})`;
  return String(e).slice(0, 160);
}

/**
 * Mede UMA piscina: as velas de 1m e os agregados de 24h.
 *
 * ⚠️ `getOHLCVOuFalha`, NÃO `getOHLCV`. A segunda devolve `[]` tanto para
 * "piscina morta" quanto para "fonte recusou", e a diferença entre as duas é o
 * que esta medição inteira existe para preservar.
 */
async function medirPiscina(
  par: ProPair,
  endereco: string,
  rotulo: string,
  atual: boolean,
  lado: PriceToken,
  agoraMs: number,
  mp: ReturnType<typeof marcapasso>,
): Promise<LinhaDaPiscina> {
  const vazia: LinhaDaPiscina = {
    par: par.id, rede: par.chain, piscina: endereco.toLowerCase(), rotulo, atual,
    porqueNaoLeu: null,
    velasLidas: null, velasParadas: null, minutosComVela: null,
    coberturaPct: null, amplitudeMediaPct: null, atrasoMin: null,
    tvlUsd: null, volume24hUsd: null, trocas24h: null, precoUsd: null,
  };

  if (!(await mp.passo())) {
    return { ...vazia, porqueNaoLeu: "orcamento de tempo da rodada esgotado — nao medida" };
  }

  let medida;
  try {
    const velas = await getOHLCVOuFalha(par.chain, endereco, "1m", VELAS_PEDIDAS, lado);
    medida = medirVelas(velas, agoraMs, JANELA_MIN);
  } catch (e) {
    return { ...vazia, porqueNaoLeu: motivoDe(e) };
  }

  /**
   * ⚠️ A META É MELHOR-ESFORÇO E A VELA NÃO É. Se o `getPoolMeta` falhar, TVL e
   * volume ficam `null` mas a cobertura já foi medida — e a cobertura é a
   * régua da queixa. Marcar a linha inteira como não-lida por causa de uma
   * segunda requisição jogaria fora a medida que importa.
   */
  await mp.passo();
  const meta = await getPoolMeta(par.chain, endereco).catch(() => null);
  const trocas = meta
    ? ((meta.compras24h ?? 0) + (meta.vendas24h ?? 0)) || null
    : null;

  return {
    ...vazia,
    ...medida,
    tvlUsd: meta?.tvlUsd ?? null,
    volume24hUsd: meta?.volume24h ?? null,
    trocas24h: trocas,
    // ⚠️ O lado certo do par: `quote` quando o símbolo que queremos está do
    // outro lado. É a mesma correção que impediu o gráfico de desenhar $1 no
    // lugar de $700 para o WBNB/USDT.
    precoUsd: meta ? (lado === "quote" ? meta.quotePriceUsd : meta.priceUsd) : null,
  };
}

/** As alternativas do mesmo par: mesmo token base E mesmo token quote. */
async function candidatasDe(
  par: ProPair,
  atualEndereco: string,
  meta: PoolMeta | null,
  mp: ReturnType<typeof marcapasso>,
): Promise<{ piscinas: PoolSummary[]; falha: string | null }> {
  const base = meta?.baseTokenAddress?.toLowerCase();
  const quote = meta?.quoteTokenAddress?.toLowerCase();
  if (!base || !quote) {
    return { piscinas: [], falha: "nao foi possivel ler os tokens da piscina atual" };
  }
  try {
    await mp.passo();
    const todas = await getTokenPools(par.chain, base, 20);
    const mesmoPar = todas.filter((p) => {
      const b = p.baseTokenAddress?.toLowerCase();
      const q = p.quoteTokenAddress?.toLowerCase();
      if (!b || !q) return false;
      // ⚠️ POR ENDEREÇO, NUNCA POR SÍMBOLO — e nos DOIS sentidos, porque a
      // mesma dupla aparece invertida conforme a piscina.
      const igual = (b === base && q === quote) || (b === quote && q === base);
      if (!igual) return false;
      if (p.address.toLowerCase() === atualEndereco.toLowerCase()) return false;
      return p.tvlUsd >= TVL_MINIMO_USD;
    });
    mesmoPar.sort((a, b) => b.tvlUsd - a.tvlUsd);
    return { piscinas: mesmoPar.slice(0, MAX_CANDIDATAS), falha: null };
  } catch (e) {
    return { piscinas: [], falha: motivoDe(e) };
  }
}

/**
 * Qual lado da piscina carrega o preço do símbolo que a tela quer mostrar.
 * Mesma decisão que o `ProChart` já toma — repetida aqui porque a medição tem
 * de olhar a MESMA série que o usuário vê, não outra.
 */
function ladoDo(par: ProPair, meta: { baseTokenSymbol: string } | null): PriceToken {
  if (!meta) return "base";
  return meta.baseTokenSymbol.toLowerCase() === par.targetSymbol.toLowerCase()
    ? "base" : "quote";
}

export async function POST(req: Request) {
  await requireAdmin();
  const t0 = Date.now();

  const body = await req.json().catch(() => ({})) as { pares?: string[] };
  /**
   * ⚠️ SEM `pares` NO CORPO, MEDE TODOS. 24 pares × ~4 piscinas × 2 requisições
   * cabe em `maxDuration`, mas o botão manda um subconjunto por padrão para não
   * queimar a cota da GeckoTerminal a cada clique.
   */
  const pedidos = Array.isArray(body.pares) && body.pares.length > 0
    ? PRO_PAIRS.filter((p) => body.pares!.includes(p.id))
    : PRO_PAIRS;

  if (pedidos.length === 0) {
    return NextResponse.json({ error: "nenhum par reconhecido" }, { status: 400 });
  }

  /**
   * ⚠️⚠️ O CORTE É EXPLÍCITO E VOLTA NA RESPOSTA. Em 31/08 esta rota aceitou 23
   * pares num clique, disparou ~200 requisições em rajada, e devolveu 56 de 62
   * leituras em 429 — com "gravado: true" na tela. Uma medição que se afoga na
   * própria sede e reporta sucesso é pior que uma que recusa a rodada.
   */
  const alvos = pedidos.slice(0, MAX_PARES_POR_RODADA);
  const foraDoLote = pedidos.slice(MAX_PARES_POR_RODADA).map((p) => p.id);

  const rodada = randomUUID();
  const agoraMs = Date.now();
  const mp = marcapasso(t0);
  const linhas: LinhaDaPiscina[] = [];
  const vereditos: (JulgamentoDoPar & { par: string; rede: string })[] = [];
  const semCandidata: string[] = [];

  for (const par of alvos) {
    const metaAtual = await getPoolMeta(par.chain, par.pool).catch(() => null);
    const lado = ladoDo(par, metaAtual);

    const { piscinas, falha } = await candidatasDe(par, par.pool, metaAtual, mp);
    if (falha || piscinas.length === 0) {
      semCandidata.push(`${par.id}: ${falha ?? "nenhuma alternativa acima do TVL minimo"}`);
    }

    const doPar: LinhaDaPiscina[] = [];
    doPar.push(await medirPiscina(
      par, par.pool, rotuloDe(par.dex, par.pool, par.feeTier), true, lado, agoraMs, mp,
    ));
    for (const alt of piscinas) {
      /**
       * ⚠️ O LADO É RECALCULADO POR PISCINA. Duas piscinas do mesmo par podem
       * ter os tokens em ordem trocada — foi assim que a V2 do BNB/USDT ficou
       * com USDT como token0. Herdar o lado da piscina atual mediria a série do
       * dólar numa e a do BNB na outra, e a comparação seria entre dois
       * gráficos diferentes.
       */
      const ladoAlt: PriceToken =
        (alt.baseTokenAddress?.toLowerCase() ?? "") === (metaAtual?.baseTokenAddress?.toLowerCase() ?? " ")
          ? lado
          : (lado === "base" ? "quote" : "base");
      doPar.push(await medirPiscina(
        par, alt.address, rotuloDe(alt.dex, alt.address), false, ladoAlt, agoraMs, mp,
      ));
    }

    linhas.push(...doPar);
    vereditos.push({ par: par.id, rede: par.chain, ...julgarPar(doPar) });
  }

  // ── A ESCRITA: é ela que faz disto uma medição e não uma impressão ──
  const db = getSupabaseAdmin();
  let gravado = false;
  let erroAoGravar: string | null = null;
  if (!db) {
    erroAoGravar = "sem service key — nada foi gravado";
  } else {
    const { error: e1 } = await db.from("pro_piscina_medicao").insert(
      linhas.map((l) => ({
        rodada, par: l.par, rede: l.rede, piscina: l.piscina, rotulo: l.rotulo,
        atual: l.atual, janela_min: JANELA_MIN,
        velas_lidas: l.velasLidas, velas_paradas: l.velasParadas,
        minutos_com_vela: l.minutosComVela, cobertura_pct: l.coberturaPct,
        amplitude_media_pct: l.amplitudeMediaPct, atraso_min: l.atrasoMin,
        tvl_usd: l.tvlUsd, volume24h_usd: l.volume24hUsd, trocas24h: l.trocas24h,
        preco_usd: l.precoUsd, porque_nao_leu: l.porqueNaoLeu,
      })),
    );
    const { error: e2 } = await db.from("pro_piscina_veredito").insert(
      vereditos.map((v) => ({
        rodada, par: v.par, rede: v.rede,
        melhor_para_o_grafico: v.melhorParaOGrafico, maior_liquidez: v.maiorLiquidez,
        atual: v.atual, veredito: v.veredito, porque: v.porque,
        lidas: v.lidas, candidatas: v.candidatas,
      })),
    );
    /**
     * ⚠️⚠️ `supabase-js` RESOLVE COM `{ data: null, error }` — NÃO LANÇA. Toda a
     * cicatriz desta casa está nesta linha: um `await` sem olhar `error` acima
     * teria devolvido "gravado: true" com o banco vazio, e a tela diria que a
     * medição está registrada quando não está.
     */
    if (e1 || e2) erroAoGravar = (e1?.message ?? e2?.message ?? "erro").slice(0, 200);
    else gravado = true;
  }

  await recordEvent("admin_pro_piscinas", {
    meta: { rodada, pares: alvos.length, linhas: linhas.length, gravado },
  }).catch(() => {});

  return NextResponse.json({
    rodada,
    janelaMin: JANELA_MIN,
    medidoEm: new Date(agoraMs).toISOString(),
    gravado,
    erroAoGravar,
    semCandidata,
    /**
     * ⚠️ O QUE NÃO COUBE NESTE CLIQUE, nomeado. Sem esta lista o painel diria
     * "medimos" sobre 6 de 24 pares, que é a forma mais barata de mentir.
     */
    foraDoLote,
    maxParesPorRodada: MAX_PARES_POR_RODADA,
    chamadasAFonte: mp.chamadas,
    vereditos,
    linhas,
    /**
     * ⚠️ O QUE ESTA RODADA NÃO MEDIU — dito na resposta, não só no comentário.
     * Sem esta lista o painel convida a ler "maior TVL" como "melhor execução",
     * e não é: profundidade de V3 depende da liquidez por tick.
     */
    naoMedido: [
      "profundidade real por tamanho — a GeckoTerminal não publica liquidez por tick; TVL é proxy e está rotulado como TVL",
      "custo de execução (spread + impacto) em cada piscina — exigiria cotação real por piscina, e a 0x roteia pelo agregador inteiro",
      "estabilidade da cobertura ao longo do dia — esta é UMA janela de " + JANELA_MIN + " minutos, não uma média",
      ...(foraDoLote.length > 0
        ? [`${foraDoLote.length} pares ficaram FORA deste clique (teto de ${MAX_PARES_POR_RODADA} por rodada, imposto pelo limite da fonte): ${foraDoLote.join(", ")}`]
        : []),
    ],
    tookMs: Date.now() - t0,
  });
}
