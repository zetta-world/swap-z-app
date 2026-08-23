import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { AGENTES, FAIXAS, ROTULO_DA_FAIXA, oControle, agentesDaFaixa } from "@/lib/celeiro/agentes";
import { taxaPorPerna } from "@/lib/celeiro/taxas";
import {
  extratoDe, ranquear, curvaAcumulada, contraOPiso, usdtProduzido,
  retornoSobreCapital,
  type Fluxo, type Causa,
} from "@/lib/celeiro/fluxo";

export const dynamic = "force-dynamic";

/** Os símbolos que o Celeiro opera — os mesmos do cron. */
const SIMBOLOS = ["BTC", "ETH", "SOL"] as const;

/**
 * O preço à vista de cada símbolo, ou `null` por símbolo que não leu.
 *
 * ⚠️⚠️ FALHA COMO NULL, NUNCA COMO ZERO. Um preço zero faria toda posição
 * aberta aparecer com prejuízo total na tela — e o painel afirmaria uma perda
 * catastrófica que não existe. "Não li" e "vale zero" são coisas diferentes e
 * a tela precisa saber qual das duas está vendo.
 */
async function precosAgora(): Promise<Record<string, number | null>> {
  const fora: Record<string, number | null> = {};
  await Promise.all(SIMBOLOS.map(async (sym) => {
    try {
      const r = await fetch(
        `https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${sym}_USDT`,
        { cache: "no-store", signal: AbortSignal.timeout(4_000) },
      );
      const j = await r.json() as Array<{ last?: string }>;
      const n = Number(j?.[0]?.last);
      fora[sym] = Number.isFinite(n) && n > 0 ? n : null;
    } catch { fora[sym] = null; }
  }));
  return fora;
}

interface LinhaPosicao {
  id: string; agente: string; simbolo: string; lado: "buy" | "sell";
  usd: string | number; preco_entrada: string | number;
  alvo: string | number; stop: string | number;
  horas_limite: number; aberta_em: string;
  fechada_em: string | null; preco_saida: string | number | null;
  motivo_saida: string | null; meta: Record<string, unknown> | null;
}

/**
 * O PAINEL DO CELEIRO — uma tabela POR FAIXA, nunca uma lista com tudo dentro.
 *
 * ⚠️⚠️ POR QUE SEPARADO POR FAIXA E NÃO UM RANKING SÓ. O portão de profundidade
 * mostra que o MESMO livro aprova 100 USD com 0% de derrapagem e reprova 800
 * com 7,45%. Logo o mesmo agente rende diferente em tamanhos diferentes, e uma
 * tabela única compararia coisas distintas — que é a versão em USDT do erro de
 * comparar day trade com swing na mesma régua.
 *
 * ⚠️ E O CONTROLE APARECE EM TODA FAIXA. Um agente que rende menos que o
 * Aluguel de Ocioso está destruindo valor: bastaria deixar o USDT parado
 * rendendo. Sem a linha do piso na MESMA tela, curva bonita e inútil passa por
 * vitória — foi assim que "+7,04% com amostra pequena" virou notícia boa.
 */

interface LinhaFluxo {
  agente: string;
  causa: Causa;
  usdt: string | number;
  ocorreu_em: string;
  braco: "controle" | "mutacao" | null;
  genoma_versao: number | null;
}

export async function GET() {
  /**
   * ⚠️ `requireAdmin()` NÃO DEVOLVE RESPOSTA DE ERRO — ele lança `notFound()`
   * quando nega, e devolve `{ wallet }` quando aprova.
   *
   * A primeira versão daqui fazia `const negado = await requireAdmin(); if
   * (negado) return negado;` — e como `{ wallet }` é truthy, a rota SEMPRE
   * devolveria `{"wallet":"0x…"}` no lugar dos dados. O painel nunca mostraria
   * nada, e o motivo não apareceria em log nenhum.
   *
   * Quem pegou foi o tipo gerado do Next em `.next/types`, que só existe depois
   * de um build — `tsc --noEmit` sozinho passa batido. É o mesmo padrão que o
   * torneio usa desde sempre: chamar e ignorar o retorno.
   */
  await requireAdmin();

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ erro: "sem banco" }, { status: 503 });

  // leitura-limitada: 20 mil lançamentos cobrem meses do arranque do Celeiro.
  // Passando disso, a agregação sai daqui e vira consulta no banco.
  const { data, error } = await db
    .from("celeiro_fluxos")
    .select("agente, causa, usdt, ocorreu_em, braco, genoma_versao")
    .order("ocorreu_em", { ascending: false })
    .limit(20_000);

  if (error) return NextResponse.json({ erro: error.message }, { status: 500 });

  const fluxos: Fluxo[] = (data ?? []).map((r: LinhaFluxo) => ({
    agente: r.agente,
    causa: r.causa,
    usdt: Number(r.usdt) || 0,
    ocorreuEmMs: Date.parse(r.ocorreu_em),
    braco: r.braco,
    genomaVersao: r.genoma_versao,
  }));

  /**
   * ⚠️ AS POSIÇÕES VÊM JUNTO, e não numa segunda chamada do painel. O extrato
   * (`celeiro_fluxos`) diz QUANTO entrou e saiu; ele não diz o que está ABERTO
   * agora nem quanto capital está preso. Eram duas perguntas e o painel só
   * sabia responder uma — "com quanto cada agente está operando" não tinha
   * resposta na tela.
   */
  const [posRes, precos] = await Promise.all([
    db.from("celeiro_posicoes")
      .select("id, agente, simbolo, lado, usd, preco_entrada, alvo, stop, horas_limite, "
        + "aberta_em, fechada_em, preco_saida, motivo_saida, meta")
      .order("aberta_em", { ascending: false })
      .limit(2_000),
    precosAgora(),
  ]);
  const posicoes: LinhaPosicao[] = (posRes.data ?? []) as LinhaPosicao[];
  const agora = Date.now();

  /**
   * O retrato de capital e posições de um agente.
   *
   * ⚠️⚠️ MARGEM E NOCIONAL SÃO COISAS DIFERENTES e a tela mostra as duas. A
   * margem é o que sai da banca; o nocional é o que o mercado move. Um agente
   * de 10× tem nocional muito maior que a banca — e ver só um dos dois números
   * dá a impressão errada em qualquer direção.
   */
  function retratoDe(agenteId: string, bancaUsd: number) {
    const minhas = posicoes.filter((p) => p.agente === agenteId);
    const abertasBrutas = minhas.filter((p) => p.fechada_em === null);

    const abertas = abertasBrutas.map((p) => {
      const meta = (p.meta ?? {}) as Record<string, unknown>;
      const alavanca = Number(meta.alavanca) >= 1 ? Number(meta.alavanca) : 1;
      const nocionalUsd = Number(p.usd) || 0;
      const margemUsd = Number(meta.margemUsd) > 0
        ? Number(meta.margemUsd) : nocionalUsd / alavanca;
      const entrada = Number(p.preco_entrada) || 0;
      const atual = precos[p.simbolo] ?? null;
      const movPct = atual !== null && entrada > 0
        ? (p.lado === "buy" ? (atual - entrada) / entrada : (entrada - atual) / entrada) * 100
        : null;
      const horasAbertas = (agora - Date.parse(p.aberta_em)) / 3_600_000;
      return {
        id: p.id, simbolo: p.simbolo, lado: p.lado,
        nocionalUsd, margemUsd, alavanca,
        precoEntrada: entrada, precoAtual: atual,
        alvo: Number(p.alvo) || 0, stop: Number(p.stop) || 0,
        /** ⚠️ NÃO REALIZADO e só de PREÇO — a segunda perna ainda não foi paga. */
        movPct,
        naoRealizadoUsd: movPct === null ? null : nocionalUsd * movPct / 100,
        taxaPernaPct: Number.isFinite(Number(meta.taxaPernaPct))
          ? Number(meta.taxaPernaPct) : null,
        horasAbertas, horasLimite: p.horas_limite,
        /** ⚠️ Passou do limite e ninguém fechou: é órfã, e a tela tem de gritar. */
        vencida: horasAbertas >= p.horas_limite,
      };
    });

    const fechadas = minhas.filter((p) => p.fechada_em !== null);
    const porMotivo: Record<string, number> = { alvo: 0, stop: 0, tempo: 0, liquidacao: 0 };
    for (const f of fechadas) {
      const m = String(f.motivo_saida ?? "");
      if (m in porMotivo) porMotivo[m]++;
    }

    const margemUsd = abertas.reduce((s, a) => s + a.margemUsd, 0);
    const nocionalUsd = abertas.reduce((s, a) => s + a.nocionalUsd, 0);
    return {
      abertas,
      fechadas: { total: fechadas.length, porMotivo },
      capital: {
        bancaUsd,
        margemComprometidaUsd: margemUsd,
        livreUsd: bancaUsd - margemUsd,
        nocionalUsd,
        exposicaoPct: bancaUsd > 0 ? margemUsd / bancaUsd * 100 : 0,
      },
      /** ⚠️ Sem preço, o não realizado é NULL na tela em vez de virar zero. */
      semPreco: abertas.some((a) => a.precoAtual === null),
    };
  }

  const controle = oControle();

  /**
   * ⚠️ AGENTE SEM NENHUM LANÇAMENTO APARECE MESMO ASSIM, com `semDado: true`.
   * Escondê-lo faria um agente quebrado — que nunca escreveu fluxo — sumir da
   * tela em silêncio, e "não apareceu" é indistinguível de "não existe". É a
   * mesma razão de o extrato dizer "sem dado" em vez de devolver zero.
   */
  const fluxosDe = (a: string) => fluxos.filter((f) => f.agente === a);
  const usdtPiso = usdtProduzido(fluxosDe(controle.id));

  /**
   * ⚠️⚠️ O RETORNO DO PISO É A RÉGUA HONESTA. Comparar USDT absoluto premiava
   * quem arrisca mais: o Aluguel rende sobre $1.000 e um alavancado pode ter
   * $1.500 de exposição efetiva. Sobre capital, a pergunta fica justa — para
   * cada dólar administrado, quanto sobrou?
   */
  const retornoDoPisoPct = retornoSobreCapital(usdtPiso, controle.bancaUsd, null).pct;

  const faixas = FAIXAS.map((faixa) => {
    const doGrupo = agentesDaFaixa(faixa).map((a) => a.id);
    // O piso entra em toda faixa, mesmo não pertencendo a ela.
    const comControle = doGrupo.includes(controle.id) ? doGrupo : [...doGrupo, controle.id];
    const ranking = ranquear(fluxos, comControle, controle.id);

    /**
     * ⚠️ O DESTAQUE É POR FAIXA, e só existe se houver com quem comparar. Um
     * selo de "melhor" numa faixa com um agente só premiaria a ausência de
     * concorrência — e o piso, que é convidado, nunca pode levá-lo.
     */
    const concorrentes = ranking.filter(
      (r) => !r.ehControle && fluxosDe(r.agente).length > 0,
    );
    const destaque = concorrentes.length >= 2 && concorrentes[0].usdt > 0
      ? concorrentes[0].agente : null;

    return {
      faixa,
      rotulo: ROTULO_DA_FAIXA[faixa],
      linhas: ranking.map((r) => {
        const a = AGENTES.find((x) => x.id === r.agente)!;
        const meus = fluxosDe(r.agente);
        const e = extratoDe(r.agente, fluxos);
        return {
          ...r,
          nome: a.nome,
          modalidade: a.modalidade,
          ritmo: a.ritmo,
          motor: a.motor,
          capitalMinimoUsd: a.capitalMinimoUsd,
          mecanismo: a.mecanismo,
          naoFaz: a.naoFaz,
          /** De onde veio e por onde vazou — a resposta que o placar antigo não dava. */
          porCausa: e.porCausa,
          vazamentos: e.vazamentos,
          fontes: e.fontes,
          lancamentos: meus.length,
          semDado: meus.length === 0,
          /** O agente só pertence a esta faixa; o controle é convidado. */
          convidado: !doGrupo.includes(r.agente),
          /** A linha do minigráfico: USDT acumulado ao longo do tempo. */
          serie: curvaAcumulada(meus),
          /** Como comparar com o piso sem produzir número que estoura a tela. */
          piso: contraOPiso(r.usdt, usdtPiso, r.ehControle),
          /** A régua honesta: % da própria banca, e a diferença em pp. */
          retorno: retornoSobreCapital(r.usdt, a.bancaUsd, r.ehControle ? null : retornoDoPisoPct),
          bancaUsd: a.bancaUsd,
          alavancagemMaxima: a.alavancagemMaxima,
          tetoDeExposicao: a.tetoDeExposicao,
          categoria: a.categoria,
          execucao: a.execucao,
          /** ⚠️ A taxa que ESTE agente paga — a régua deixa de ser da arena. */
          taxaPernaPct: taxaPorPerna(a.modalidade, a.execucao),
          ...retratoDe(r.agente, a.bancaUsd),
          destaque: r.agente === destaque,
        };
      }),
    };
  });

  /**
   * ⚠️ O RESUMO SOMA CADA AGENTE UMA VEZ SÓ. As faixas repetem o piso como
   * convidado — somar as linhas das três tabelas contaria o Aluguel de Ocioso
   * três vezes e inflaria o total do Celeiro sem que nada tivesse rendido.
   */
  const instantes = fluxos.map((f) => f.ocorreuEmMs).filter(Number.isFinite);
  const resumo = {
    usdtTotal: usdtProduzido(fluxos),
    lancamentos: fluxos.length,
    agentesComDado: new Set(fluxos.map((f) => f.agente)).size,
    deMs: instantes.length ? Math.min(...instantes) : null,
    ateMs: instantes.length ? Math.max(...instantes) : null,
    /**
     * ⚠️ "ATIVO" É MEDIDO, NÃO DECLARADO: houve lançamento na última hora?
     * Um selo fixo de "ativo e transmitindo" continuaria verde com o cron morto,
     * que é a morte muda que este projeto já pagou três vezes.
     */
    ativo: instantes.length > 0 && (Date.now() - Math.max(...instantes)) < 3_600_000,
    ultimoMs: instantes.length ? Math.max(...instantes) : null,
  };

  return NextResponse.json({
    arena: "celeiro",
    controle: controle.id,
    /**
     * ⚠️ O ESTADO DE ARRANQUE É DITO, NÃO DEDUZIDO. Um painel todo zerado é
     * ambíguo: pode ser "ninguém rendeu nada" ou "nada foi lançado ainda". A
     * primeira é um resultado; a segunda é ausência de medição, e confundi-las
     * é o começo de toda leitura errada.
     */
    semNenhumLancamento: fluxos.length === 0,
    totalDeLancamentos: fluxos.length,
    resumo,
    faixas,
  });
}
