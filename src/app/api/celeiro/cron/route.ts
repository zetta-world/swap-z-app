import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { recordEvent } from "@/lib/admin/track";
import { oControle, agentePor } from "@/lib/celeiro/agentes";
import { acumular, lerTaxaDeEmprestimo } from "@/lib/celeiro/aluguel";
import {
  lerSerieDeFunding, colher, portao, anualizar, PERIODOS_POR_DIA,
  CUSTO_DO_CICLO_PCT,
} from "@/lib/celeiro/funding-colheita";
import {
  registrarFluxo, ultimoLancamentoMs, genomaAtivo, lerRelogio, marcarRelogio,
  posicoesAbertas, abrirPosicao, varrerAbertas,
} from "@/lib/celeiro/store";
import { medirLateralidade, deveCotar, type Fatia } from "@/lib/celeiro/faixa-maker";
import { decidir as decidirBase } from "@/lib/celeiro/base-convergencia";
import { portaoDeProfundidade, converterLivro } from "@/lib/celeiro/profundidade";
import { portaoDeSobrevivencia, municaoDoDia } from "@/lib/celeiro/pool-novo";
import { lerCandidato, candidatosDe, getNewPoolsForChain } from "@/lib/celeiro/pool-fonte";
import { getPairDetail } from "@/lib/api/dexscreener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O DESPERTADOR DO CELEIRO.
 *
 * ⚠️ SÓ OS DOIS AGENTES DE RENDA ACORDAM AQUI, e é decisão e não atraso. O
 * Aluguel de Ocioso é o CONTROLE — sem ele medindo, nenhum outro número tem
 * régua. A Colheita de Funding é a única fonte que sobreviveu a uma medição
 * honesta. Os três de estrutura e evento entram quando estes dois provarem que
 * o extrato fecha; ligar cinco de uma vez faria um erro de contabilidade
 * aparecer em cinco lugares e não se saber de onde veio.
 *
 * ⚠️ TUDO EM PAPEL. Funding, base e profundidade são dados PÚBLICOS — dá para
 * medir de verdade sem arriscar um centavo. A arena antiga queimou dois meses
 * num sinal pior que uma moeda porque a régua estava errada; aqui a régua vem
 * primeiro. Quando o extrato provar USDT positivo em amostra que aguente,
 * liga-se credencial.
 */

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/** O capital de papel de cada agente. Um número, num lugar só. */
const CAPITAL_PAPEL_USD = Number(process.env.CELEIRO_CAPITAL_PAPEL_USD ?? 1000);

/** Os símbolos que a Colheita examina. Poucos e líquidos, de propósito. */
const SIMBOLOS = (process.env.CELEIRO_SIMBOLOS ?? "BTC,ETH,SOL").split(",").map((s) => s.trim());

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, erro: "unauthorized" }, { status: 401 });
  }
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, erro: "sem banco" }, { status: 503 });

  const agora = Date.now();
  const relato: Record<string, unknown> = {};

  // ── ① O CONTROLE ────────────────────────────────────────────────────────
  const controle = oControle();
  const taxa = await lerTaxaDeEmprestimo();

  if (taxa === null) {
    /**
     * ⚠️ TAXA NÃO LIDA NÃO CREDITA NADA, e o silêncio fica registrado. Creditar
     * com a taxa de ontem inventaria juro de um período que ninguém observou —
     * e como este agente é a RÉGUA, o erro contaminaria o julgamento de todos os
     * outros de uma vez.
     */
    relato.aluguel = { creditou: 0, porque: "taxa não lida — não medido não credita" };
    await recordEvent("celeiro_tick", { meta: { agente: controle.id, semTaxa: true } });
  } else {
    /**
     * ⚠️ O RELÓGIO VEM DO `admin_kv`, NÃO DO EXTRATO. O crédito é sempre
     * `agora − último visto`, e o "último visto" precisa avançar mesmo nos ticks
     * que creditam zero. Se ele viesse do extrato, o primeiro tick (que não
     * credita nada, de propósito) não deixaria marca — e o controle ficaria
     * congelado em zero para sempre, fazendo TODO agente parecer vencedor.
     */
    const ultimo = await lerRelogio(db, controle.id);
    const a = acumular(CAPITAL_PAPEL_USD, taxa.taxaAnualPct, ultimo, agora);
    const escreveu = a.usdt > 0
      ? await registrarFluxo(db, {
          agente: controle.id, causa: "aluguel", usdt: a.usdt,
          ref: `aluguel:${agora}`,
          meta: { taxaAnualPct: taxa.taxaAnualPct, fonte: taxa.fonte, porque: a.porque,
                  cortadoPorTeto: a.cortadoPorTeto },
        })
      : false;

    // O relógio avança SEMPRE que a taxa foi lida — inclusive no tick zero.
    await marcarRelogio(db, controle.id, agora);

    relato.aluguel = {
      creditou: a.usdt, escreveu, taxaAnualPct: taxa.taxaAnualPct,
      cortadoPorTeto: a.cortadoPorTeto, porque: a.porque,
    };
  }

  // ── ② A COLHEITA DE FUNDING ─────────────────────────────────────────────
  const colheita = agentePor("colheita_funding")!;
  const genoma = await genomaAtivo(db, colheita.id, {
    janelaDias: 30,
    limiteDeSerie: 200,
    /** A folga exigida ACIMA do controle, em pontos percentuais ao ano. */
    margemSobreControlePp: 2,
  });

  const controleAnual = taxa?.taxaAnualPct ?? 0;
  const margem = Number(genoma?.params.margemSobreControlePp ?? 2);
  const janelaDias = Number(genoma?.params.janelaDias ?? 30);
  const exames: Array<Record<string, unknown>> = [];

  for (const simbolo of SIMBOLOS) {
    const serie = await lerSerieDeFunding(simbolo, Number(genoma?.params.limiteDeSerie ?? 200));
    if (serie === null) {
      exames.push({ simbolo, entra: false, porque: "série não lida — não medido não é aprovado" });
      continue;
    }
    const c = colher(serie);

    /**
     * ⚠️ O PORTÃO COMPARA COM O CONTROLE MAIS A MARGEM, nunca com zero. Funding
     * positivo não basta: render menos que o Aluguel de Ocioso significa montar
     * duas pernas e correr risco de liquidação para ganhar menos do que
     * emprestar o USDT parado.
     *
     * ⚠️ E QUANDO A TAXA DO CONTROLE NÃO FOI LIDA, `controleAnual` é 0 — o que
     * BAIXARIA a barra em vez de levantá-la. Por isso o exame é pulado: sem
     * régua não há aprovação, só ausência de comparação.
     */
    if (taxa === null) {
      exames.push({ simbolo, entra: false, porque: "sem a taxa do controle não há barra para comparar" });
      continue;
    }
    const p = portao(c, controleAnual + margem, janelaDias);
    exames.push({
      simbolo, entra: p.entra, porque: p.porque,
      anualPct: anualizar(c, janelaDias),
      periodos: c.periodos, fatiaNegativa: c.fatiaNegativa,
      equilibrioEmDias: c.equilibrioEmDias,
    });

    if (!p.entra) continue;

    /**
     * A posição de papel: entra uma vez e passa a colher. A entrada paga METADE
     * do ciclo — as outras duas pernas serão pagas na saída, e cobrá-las agora
     * faria o agente parecer pior do que é enquanto a posição vive.
     */
    const jaEntrou = await ultimoLancamentoMs(db, colheita.id, "taxa");
    if (jaEntrou === null) {
      await registrarFluxo(db, {
        agente: colheita.id, causa: "taxa",
        usdt: -(CAPITAL_PAPEL_USD * (CUSTO_DO_CICLO_PCT / 2) / 100),
        simbolo, ref: `entrada:${simbolo}:${agora}`, genomaVersao: genoma?.versao ?? null,
        meta: { pernas: 2, de: "spot compra + perp venda", porque: p.porque },
      });
      continue;   // sem funding ainda: a posição nasceu neste instante
    }

    const ultimoFunding = await ultimoLancamentoMs(db, colheita.id, "funding");
    const desde = ultimoFunding ?? jaEntrou;
    const periodosDecorridos = Math.floor((agora - desde) / (8 * 3_600_000));
    if (periodosDecorridos < 1) continue;

    /**
     * ⚠️ USA A TAXA MAIS RECENTE PUBLICADA, não a média da janela. A média
     * descreve o passado; quem paga o próximo período é a taxa vigente. Creditar
     * a média inventaria um funding que ninguém recebeu.
     */
    const recente = serie[serie.length - 1]?.taxaPct ?? 0;
    const usdt = CAPITAL_PAPEL_USD * (recente / 100) * periodosDecorridos;
    if (usdt !== 0) {
      await registrarFluxo(db, {
        agente: colheita.id, causa: "funding", usdt,
        simbolo, ref: `funding:${simbolo}:${agora}`, genomaVersao: genoma?.versao ?? null,
        meta: { periodos: periodosDecorridos, taxaPct: recente, porDia: PERIODOS_POR_DIA },
      });
    }
  }

  relato.colheita = { genomaVersao: genoma?.versao ?? null, controleAnualPct: controleAnual, margem, exames };

  // ── ③ OS AGENTES QUE OPERAM ────────────────────────────────────────────
  /**
   * ⚠️ ATÉ 21/08 ESTES DOIS ERAM CÓDIGO MORTO. Tinham `deveCotar()` e
   * `decidir()` — o "devo?" — e nada os chamava. Cabeça sem mão. O dono
   * apontou, com razão: um agente que não opera não é um agente.
   */
  const precos = new Map<string, number>();
  const livros = new Map<string, ReturnType<typeof converterLivro>>();
  const velas = new Map<string, Fatia[]>();

  for (const sym of SIMBOLOS) {
    const par = `${sym.toUpperCase()}_USDT`;
    precos.set(sym, await umNumero(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${par}`,
      (c) => Number((c as Array<{ last?: string }>)?.[0]?.last)));
    livros.set(sym, await umLivro(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${par}&limit=50`));
    velas.set(sym, await uMasVelas(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${par}&interval=15m&limit=80`));
  }
  const precoDe = (sym: string) => precos.get(sym) ?? null;

  const operados: Record<string, unknown> = {};

  for (const id of ["maker_de_faixa", "convergencia_base"] as const) {
    const ag = agentePor(id)!;
    const gen = await genomaAtivo(db, id, id === "maker_de_faixa"
      ? { multiploDoAcaso: 1.5, horasLimite: 8, alvoPct: 0.6, stopPct: 0.6 }
      : { margemPp: 0.15, horasLimite: 8 });

    // Primeiro FECHA o que já venceu — antes de pensar em abrir mais.
    const fechados = await varrerAbertas(db, id, precoDe, agora);

    const abertas = await posicoesAbertas(db, id);
    const exames: Array<Record<string, unknown>> = [];

    for (const sym of SIMBOLOS) {
      if (abertas.some((p) => p.simbolo === sym)) continue;   // uma por símbolo
      const preco = precoDe(sym);
      if (preco === null) { exames.push({ sym, abre: false, porque: "sem preço" }); continue; }

      const veredito = id === "maker_de_faixa"
        ? deveCotar(medirLateralidade(velas.get(sym) ?? []), Number(gen?.params.multiploDoAcaso ?? 1.5))
        : { cota: false, porque: "" };

      let abre = false, porque = "", lado: "buy" | "sell" = "buy", alvo = 0, stop = 0;

      if (id === "maker_de_faixa") {
        abre = veredito.cota; porque = veredito.porque;
        /**
         * ⚠️ O MAKER NÃO ESCOLHE LADO POR OPINIÃO. Ele cota comprado no fundo da
         * faixa medida — se o par sair da faixa, `deveCotar` fecha e ele PARA,
         * em vez de virar direcional. É a fronteira escrita no `naoFaz` dele.
         */
        const p = Number(gen?.params.alvoPct ?? 0.6);
        lado = "buy"; alvo = preco * (1 + p / 100); stop = preco * (1 - p / 100);
      } else {
        const perp = await umNumero(
          `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${sym.toUpperCase()}_USDT`,
          (c) => Number((c as Array<{ last?: string }>)?.[0]?.last));
        const d = decidirBase(perp > 0 ? { perp, spot: preco } : null, Number(gen?.params.margemPp ?? 0.15));
        abre = d.abre; porque = d.porque;
        lado = d.lado === "vender_perp" ? "sell" : "buy";
        // A base fecha na convergência: alvo é o spot, stop é a base dobrando.
        const b = Math.abs(d.basePct ?? 0);
        alvo = lado === "buy" ? preco * (1 + b / 100) : preco * (1 - b / 100);
        stop = lado === "buy" ? preco * (1 - b / 100) : preco * (1 + b / 100);
      }

      if (!abre) { exames.push({ sym, abre: false, porque }); continue; }

      /**
       * ⚠️⚠️ O PORTÃO DE PROFUNDIDADE, NO TAMANHO REAL. É o que faltava na
       * arbitragem antiga: a sonda existia, media certo 4.085 vezes, e não
       * bloqueava nada. Aqui ela decide.
       */
      const usd = Math.max(ag.capitalMinimoUsd, 50);
      const prof = portaoDeProfundidade(livros.get(sym) ?? null, usd);
      if (!prof.passa) { exames.push({ sym, abre: false, porque: prof.porque }); continue; }

      const posId = await abrirPosicao(db, {
        agente: id, simbolo: sym, lado, usd,
        precoEntrada: preco, alvo, stop,
        derrapagemPct: prof.derrapagemPct ?? 0,
        horasLimite: Number(gen?.params.horasLimite ?? 8),
      }, gen?.versao ?? null, { porque, derrapagem: prof.porque });

      exames.push({ sym, abre: posId !== null, porque, lado, usd, derrapagemPct: prof.derrapagemPct });
    }

    operados[id] = { genomaVersao: gen?.versao ?? null, fechados, abertas: abertas.length, exames };
  }
  relato.operados = operados;

  // ── ④ POOL NOVO ────────────────────────────────────────────────────────
  /**
   * ⚠️ ESTE AGENTE FICOU FORA ATÉ 21/08, e a razão importa: o portão dele exige
   * liquidez travada, concentração do top 10 e teste de venda — e nada no
   * repositório respondia a isso. Ligá-lo com esses portões devolvendo "ok"
   * teria sido PIOR que não rodá-lo: apostaria sem verificar nada, com a
   * aparência de estar protegido. É o defeito do "escudo MEV" que era adesivo.
   *
   * As três fontes já existiam (`getNewPoolsForChain`, `getPairDetail`,
   * `getTokenSecurity`); faltava a ponte, agora em `pool-fonte.ts`.
   */
  const poolAg = agentePor("pool_novo")!;
  const genPool = await genomaAtivo(db, poolAg.id, {
    tetoDiario: 3, tamanhoUsd: 50, horasLimite: 24, cadeia: "base",
  });

  const tetoDiario = Number(genPool?.params.tetoDiario ?? 3);
  const tamanhoUsd = Number(genPool?.params.tamanhoUsd ?? 50);
  const cadeia = String(genPool?.params.cadeia ?? "base");

  const desdeMeiaNoite = new Date(agora); desdeMeiaNoite.setUTCHours(0, 0, 0, 0);
  const { count: gastasHoje } = await db
    .from("celeiro_posicoes").select("*", { count: "exact", head: true })
    .eq("agente", poolAg.id).gte("aberta_em", desdeMeiaNoite.toISOString());

  const mun = municaoDoDia(gastasHoje ?? 0, tetoDiario, tamanhoUsd);
  const examesPool: Array<Record<string, unknown>> = [];

  /**
   * ⚠️⚠️ PRIMEIRO FECHAR, e este agente quase nasceu sem conseguir.
   *
   * `precoDe` só conhece BTC/ETH/SOL — os símbolos da Gate.io. Uma posição de
   * pool abriria e NUNCA fecharia, porque ninguém sabia cotá-la: o capital
   * sumiria do experimento sem jamais aparecer como perda, que é pior do que
   * perder. O preço de cada pool aberto vem da dexscreener, pelo endereço
   * guardado no `meta` da posição.
   */
  const abertasPool = await posicoesAbertas(db, poolAg.id);
  const precoPool = new Map<string, number>();
  for (const pos of abertasPool) {
    const pool = typeof pos.meta.pool === "string" ? pos.meta.pool : null;
    const cad = typeof pos.meta.cadeia === "string" ? pos.meta.cadeia : null;
    if (!pool || !cad) continue;
    const par = await getPairDetail(cad, pool).catch(() => null);
    if (par && par.priceUsd > 0) precoPool.set(pos.simbolo, par.priceUsd);
  }
  const fechadosPool = await varrerAbertas(
    db, poolAg.id, (sym) => precoPool.get(sym) ?? null, agora,
  );

  if (mun.restam > 0) {
    const novos = await getNewPoolsForChain(cadeia, 12).catch(() => []);
    /**
     * ⚠️ TETO DE CANDIDATOS POR TICK. Cada um custa duas chamadas de rede
     * (dexscreener + GoPlus). Sem teto, uma lista longa estoura o `maxDuration`
     * de 60s e o tick MORRE no meio — deixando posições abertas sem varredura.
     */
    for (const c of candidatosDe(novos).slice(0, Math.min(6, mun.restam * 2))) {
      const lido = await lerCandidato(c.chain, c.poolAddress, c.tokenAddress, c.nome, agora);
      const portao = portaoDeSobrevivencia(lido.pool);
      examesPool.push({ nome: c.nome, entra: portao.entra, recusas: portao.recusas });
      if (!portao.entra) continue;

      /**
       * ⚠️ PREÇO REAL, NUNCA UM ESPAÇO RESERVADO. A primeira versão deste bloco
       * abria com `precoEntrada: 1, alvo: 3, stop: 0.5` — números inventados. O
       * P&L seria calculado contra ficção e entraria no extrato como se fosse
       * dinheiro, envenenando o ranking e o Investigador de uma vez.
       */
      const par = await getPairDetail(c.chain, c.poolAddress).catch(() => null);
      if (!par || !(par.priceUsd > 0)) {
        examesPool.push({ nome: c.nome, entra: false, recusas: ["sem preço para entrar"] });
        continue;
      }

      /**
       * ⚠️ ASSIMETRIA DECLARADA: alvo em 3× e stop em −50%. Esta é a única
       * categoria em que perder quase sempre é aceitável — desde que o ganho
       * raro pague a série e cada perda seja do TAMANHO COMBINADO, nunca maior.
       */
      await abrirPosicao(db, {
        agente: poolAg.id, simbolo: c.nome, lado: "buy", usd: tamanhoUsd,
        precoEntrada: par.priceUsd,
        alvo: par.priceUsd * 3, stop: par.priceUsd * 0.5,
        derrapagemPct: 0, horasLimite: Number(genPool?.params.horasLimite ?? 24),
      }, genPool?.versao ?? null, { pool: c.poolAddress, cadeia: c.chain });

      if (examesPool.filter((e) => e.entra).length >= mun.restam) break;
    }
  }

  relato.poolNovo = {
    genomaVersao: genPool?.versao ?? null,
    municao: mun, cadeia, exames: examesPool,
    fechados: fechadosPool, abertas: abertasPool.length,
  };

  await recordEvent("celeiro_tick", { meta: relato });
  return NextResponse.json({ ok: true, emMs: agora, ...relato });
}

/** Uma leitura numérica que devolve 0 quando não dá para confiar. */
async function umNumero(url: string, extrair: (corpo: unknown) => number): Promise<number> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return 0;
    const n = extrair(await r.json());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return 0; }
}

/** O livro de ofertas de venda. `null` reprova no portão — nunca vira livro vazio. */
async function umLivro(url: string): Promise<ReturnType<typeof converterLivro>> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return null;
    const c = await r.json() as { asks?: unknown };
    return converterLivro(c?.asks);
  } catch { return null; }
}

/** As velas de 15 min, para o teste de lateralidade. */
async function uMasVelas(url: string): Promise<Fatia[]> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return [];
    const c = await r.json();
    if (!Array.isArray(c)) return [];
    return c.map((v) => ({ fechamento: Number(Array.isArray(v) ? v[5] : Number.NaN) }))
            .filter((f) => Number.isFinite(f.fechamento));
  } catch { return []; }
}
