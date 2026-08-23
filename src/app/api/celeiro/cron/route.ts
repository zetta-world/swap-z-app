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
  posicoesAbertas, abrirPosicao, varrerAbertas, agentesComAbertas, margemDa,
} from "@/lib/celeiro/store";
import {
  lerRegime, permite, alvoLimpaOPedagio, alavancagemCoerente, stopPorVolatilidade,
  MULTIPLO_DO_PEDAGIO, type Vela,
} from "@/lib/celeiro/regime";
import { tamanhoDaPosicao } from "@/lib/celeiro/agentes";
import { decidir as decidirBase } from "@/lib/celeiro/base-convergencia";
import { portaoDeProfundidade, converterLivro } from "@/lib/celeiro/profundidade";
import { portaoDeSobrevivencia, municaoDoDia } from "@/lib/celeiro/pool-novo";
import { lerCandidato, candidatosDe, getNewPoolsForChain } from "@/lib/celeiro/pool-fonte";
import { getPairDetail } from "@/lib/api/dexscreener";
import { investigar } from "@/lib/celeiro/investigar";
import { mutacaoEmCurso, bracoDaPosicao, posicoesDesde } from "@/lib/celeiro/store";
import { taxaPorPerna } from "@/lib/celeiro/taxas";

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
  const velas = new Map<string, Vela[]>();

  for (const sym of SIMBOLOS) {
    const par = `${sym.toUpperCase()}_USDT`;
    precos.set(sym, await umNumero(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${par}`,
      (c) => Number((c as Array<{ last?: string }>)?.[0]?.last)));
    livros.set(sym, await umLivro(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${par}&limit=50`));
    velas.set(sym, await uMasVelas(`https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${par}&interval=15m&limit=80`));
  }
  const precoDe = (sym: string) => precos.get(sym) ?? null;

  /**
   * ⚠️⚠️ OS ÓRFÃOS — agente que saiu do registro e deixou posição aberta.
   *
   * A CICATRIZ (23/08): o `maker_de_faixa` foi apagado quando a autópsia
   * condenou a estratégia, e deixou DUAS posições vivas. O varredor abaixo é
   * chamado por agente NOMEADO, numa lista escrita à mão — e ele não estava
   * nela. Ficaram $100 congelados, uma delas parada EXATAMENTE em cima do
   * stop e 3,4h além do limite de 8h, sem ninguém para fechá-la.
   *
   * ⚠️ O pior não era o dinheiro: a autópsia que MATOU o agente se calcula
   * sobre posições FECHADAS. Essas duas nunca entrariam, e o número que
   * justificou a decisão ficaria permanentemente incompleto.
   *
   * A lista de quem OPERA é uma decisão; a lista de quem FECHA não pode ser.
   * Quem tem posição aberta é pergunta para a TABELA.
   */
  const VARRIDOS_NO_TICK = new Set([
    "cacador_de_tendencia", "alavancado_de_tendencia", "convergencia_base", "pool_novo",
  ]);
  const orfaos = (await agentesComAbertas(db)).filter((a) => !VARRIDOS_NO_TICK.has(a));
  if (orfaos.length > 0) {
    const varridos: Record<string, unknown> = {};
    for (const orf of orfaos) varridos[orf] = await varrerAbertas(db, orf, precoDe, agora);
    relato.orfaos = { agentes: orfaos, varridos };
    /**
     * ⚠️ SEMPRE grava quando encontra órfão. Não é caminho feliz: agente fora
     * do registro com capital vivo é estado que ninguém escolheu, e some da
     * tela se depender de alguém abrir o relatório do tick.
     */
    recordEvent("celeiro_orfaos", { meta: { agentes: orfaos, varridos } });
  }

  const operados: Record<string, unknown> = {};

  for (const id of ["cacador_de_tendencia", "alavancado_de_tendencia", "convergencia_base"] as const) {
    const ag = agentePor(id)!;
    const gen = await genomaAtivo(db, id, id === "convergencia_base"
      ? { margemPp: 0.15, horasLimite: 8 }
      : {
          /**
           * ⚠️ O ALVO NASCE ACIMA DO PEDÁGIO, e não é escolha de gosto. Com
           * múltiplo 6 sobre uma ida-e-volta de 0,225%, o mínimo é 1,35%. O
           * Maker de Faixa morreu com 0,6% — perdendo acertando 65,5%.
           */
          alvoPct: 2.0, stopPct: 1.2, horasLimite: 48,
          multiploDoPedagio: MULTIPLO_DO_PEDAGIO,
        });

    // Primeiro FECHA o que já venceu — antes de pensar em abrir mais.
    const fechados = await varrerAbertas(db, id, precoDe, agora);

    const abertas = await posicoesAbertas(db, id);
    /**
     * ⚠️⚠️ A EXPOSIÇÃO É SOMADA EM MARGEM, E CRESCE DENTRO DO TICK.
     *
     * Dois defeitos consertados aqui em 23/08:
     *
     * (1) Somava NOCIONAL. Com o teto governando nocional, um agente com
     *     alavanca de 10× ficava preso abaixo de 0,6× da própria banca — a
     *     alavanca que ele calculava não podia existir. Teto e alavanca eram
     *     duas guardas escritas sem saber uma da outra, e o teto ganhava sempre.
     *
     * (2) Era `const`, calculado FORA do laço de símbolos. As posições abertas
     *     na mesma rodada não se enxergavam: três símbolos abriam cada um
     *     achando que os outros não existiam. Com 3 símbolos passava raspando;
     *     com mais, o teto vaza sem nada aparecer no extrato.
     */
    let expostoUsd = abertas.reduce((soma, p) => soma + margemDa(p), 0);

    /**
     * ⚠️ O BRAÇO DO A/B — e ele alterna por POSIÇÃO, não por símbolo. Dividir
     * por símbolo daria a cada braço um conjunto DIFERENTE de ativos, e o teste
     * mediria "BTC contra ETH" em vez de "genoma antigo contra novo".
     *
     * Sem mutação em curso, `bracoDaPosicao` devolve `null` e nada é marcado:
     * rotular o que não está sendo testado envenenaria o julgamento seguinte
     * com dados de antes.
     */
    const emTeste = await mutacaoEmCurso(db, id);
    let abertasDesde = emTeste?.aplicadaEmMs != null
      ? await posicoesDesde(db, id, emTeste.aplicadaEmMs) : 0;
    const exames: Array<Record<string, unknown>> = [];

    for (const sym of SIMBOLOS) {
      if (abertas.some((p) => p.simbolo === sym)) continue;   // uma por símbolo
      const preco = precoDe(sym);
      if (preco === null) { exames.push({ sym, abre: false, porque: "sem preço" }); continue; }

      let abre = false, porque = "", lado: "buy" | "sell" = "buy";
      let alvo = 0, stop = 0, alavanca = 1;

      /**
       * ⚠️ A TAXA SAI DA PRAÇA E DO PAPEL DO AGENTE, não de uma constante da
       * arena. Antes de 23/08 os quatro agentes de futuros pagavam taxa de
       * spot — e o Caçador, que é spot, pagava METADE do que devia.
       */
      const taxaPerna = taxaPorPerna(ag.modalidade, ag.execucao);

      if (id === "convergencia_base") {
        const perp = await umNumero(
          `https://api.gateio.ws/api/v4/futures/usdt/tickers?contract=${sym.toUpperCase()}_USDT`,
          (c) => Number((c as Array<{ last?: string }>)?.[0]?.last));
        const d = decidirBase(perp > 0 ? { perp, spot: preco } : null, Number(gen?.params.margemPp ?? 0.15));
        abre = d.abre; porque = d.porque;
        lado = d.lado === "vender_perp" ? "sell" : "buy";
        const b = Math.abs(d.basePct ?? 0);
        alvo = lado === "buy" ? preco * (1 + b / 100) : preco * (1 - b / 100);
        stop = lado === "buy" ? preco * (1 - b / 100) : preco * (1 + b / 100);
      } else {
        /**
         * ⚠️⚠️ O LADO VEM DO REGIME MEDIDO, nunca de opinião. Alta compra,
         * baixa vende (só quem tem futuros), sangrando ninguém opera.
         *
         * ⚠️ E SPOT NÃO VENDE: sem futuros não há como lucrar na queda
         * acumulando USDT — em spot, "vender na baixa" é apenas sair.
         */
        const podeVender = ag.modalidade === "futuros_gate";
        const regime = lerRegime(velas.get(sym) ?? []);
        const perm = permite(regime, podeVender);
        porque = perm.porque;

        if (!perm.opera || perm.lado === null) {
          exames.push({ sym, abre: false, porque, estado: regime.estado });
          continue;
        }
        lado = perm.lado;

        /**
         * ⚠️ A INVARIANTE QUE MATOU O MAKER. Alvo que não limpa o pedágio por
         * múltiplo declarado NÃO ABRE — e a recusa vai para o extrato como
         * recusa, não como prejuízo.
         */
        const alvoPct = Number(gen?.params.alvoPct ?? 2.0);
        const limpa = alvoLimpaOPedagio(
          alvoPct,
          Number(gen?.params.multiploDoPedagio ?? MULTIPLO_DO_PEDAGIO),
          taxaPerna * 2,
        );
        if (!limpa.passa) {
          exames.push({ sym, abre: false, porque: limpa.porque });
          continue;
        }

        /**
         * ⚠️ I2 — O STOP SAI DO RUÍDO MEDIDO, não de um número fixo.
         *
         * As três primeiras entradas decididas morreram no stop, todas no SOL,
         * todas em exatamente −1,200%. Com amplitude de 0,98%/vela, o stop de
         * 1,2% ficava DENTRO do ruído: 39,6% das janelas de 1,5h o tocam sem
         * tendência nenhuma. O mesmo 1,2% no BTC (0,32%/vela) é outra coisa.
         *
         * `volatilidadePct` já era medido aqui — só alimentava a alavanca.
         */
        const st = stopPorVolatilidade(regime.volatilidadePct, Number(gen?.params.stopPct ?? 1.2));
        const stopPct = st.stopPct;
        alvo = lado === "buy" ? preco * (1 + alvoPct / 100) : preco * (1 - alvoPct / 100);
        stop = lado === "buy" ? preco * (1 - stopPct / 100) : preco * (1 + stopPct / 100);

        /**
         * ⚠️ ALAVANCAGEM PELO PIOR CASO MEDIDO, com teto duro do registro. Pode
         * devolver 1× — e isso é RESULTADO, não falha.
         */
        const a = alavancagemCoerente(regime.piorContraPct, ag.alavancagemMaxima);
        alavanca = a.vezes;
        porque = `${porque} · ${limpa.porque} · alavanca ${a.porque} · ${st.porque}`;
        abre = true;
      }

      if (!abre) { exames.push({ sym, abre: false, porque }); continue; }

      /**
       * ⚠️ O TAMANHO SAI DA BANCA, não de um número escrito no cron. E o teto de
       * exposição é o "sem suicídio" do mandato: sem ele, três posições de 25%
       * viram 75% da banca em risco sem ninguém ter decidido isso.
       */
      const t = tamanhoDaPosicao(ag, expostoUsd, alavanca);
      if (!t.cabe) { exames.push({ sym, abre: false, porque: t.porque }); continue; }

      const prof = portaoDeProfundidade(livros.get(sym) ?? null, t.usd);
      if (!prof.passa) { exames.push({ sym, abre: false, porque: prof.porque }); continue; }

      const braco = bracoDaPosicao(emTeste != null, abertasDesde);
      const posId = await abrirPosicao(db, {
        agente: id, simbolo: sym, lado, usd: t.usd, alavanca: t.alavanca,
        taxaPernaPct: taxaPerna,
        precoEntrada: preco, alvo, stop,
        derrapagemPct: prof.derrapagemPct ?? 0,
        horasLimite: Number(gen?.params.horasLimite ?? 48),
      }, gen?.versao ?? null,
        {
          porque, alavanca: t.alavanca, margemUsd: t.margemUsd,
          exposicao: t.exposicaoDepois,
          /** ⚠️ GRAVADA na posição: ela precisa FECHAR com a taxa que ABRIU. */
          taxaPernaPct: taxaPerna,
          modalidade: ag.modalidade, execucao: ag.execucao,
        },
        braco);
      if (posId) { abertasDesde++; expostoUsd += t.margemUsd; }

      exames.push({
        sym, abre: posId !== null, porque, lado,
        usd: t.usd, margemUsd: t.margemUsd, alavanca: t.alavanca, braco,
      });
    }

    operados[id] = {
      genomaVersao: gen?.versao ?? null,
      fechados, abertas: abertas.length,
      expostoMargemUsd: expostoUsd, bancaUsd: ag.bancaUsd, exames,
    };
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

  // ── ⑤ O INVESTIGADOR ────────────────────────────────────────────────────
  /**
   * ⚠️ POR ÚLTIMO, E MELHOR-ESFORÇO. Ele não opera dinheiro: derrubar o tick por
   * causa dele seria parar o que GANHA por causa do que APRENDE. E vem depois
   * das aberturas para que a mutação aplicada agora só valha no próximo ciclo —
   * trocar o genoma no meio do tick faria metade das posições nascerem com um
   * parâmetro e metade com outro, sem ninguém ter decidido isso.
   */
  try {
    relato.investigador = await investigar(db, agora);
  } catch (e) {
    relato.investigador = { erro: e instanceof Error ? e.message : String(e) };
  }

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
async function uMasVelas(url: string): Promise<Vela[]> {
  try {
    const r = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return [];
    const c = await r.json();
    if (!Array.isArray(c)) return [];
    /**
     * ⚠️ O REGIME PRECISA DE MÁXIMA E MÍNIMA, não só do fechamento. A
     * volatilidade que separa "baixa" de "sangrando" e o pior movimento contra
     * que dimensiona a alavanca saem da amplitude da vela — com só o fechamento
     * os dois ficariam cegos justamente para o evento que liquida.
     *
     * Formato da Gate.io: [t, volume, close, high, low, ...].
     */
    return c.map((v) => Array.isArray(v)
        ? { fechamento: Number(v[5]), maxima: Number(v[3]), minima: Number(v[4]) }
        : { fechamento: Number.NaN, maxima: Number.NaN, minima: Number.NaN })
      .filter((x) => Number.isFinite(x.fechamento) && Number.isFinite(x.maxima) && Number.isFinite(x.minima));
  } catch { return []; }
}
