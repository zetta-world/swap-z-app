/**
 * A ROTA DA BANCADA — onde o motor puro encontra o cliente, a cota e o banco.
 *
 * ⚠️⚠️ ELA NÃO DECIDE NADA. Cota é `bancada/cotas.ts`, portão do pedágio é
 * `bancada/vocabulario.ts`, aritmética é `motor.ts` e `veredito.ts`, isolamento
 * é `bancada/store.ts`. Aqui há só a costura — e é de propósito: regra de
 * negócio dentro de rota é onde nenhum teste alcança, e foi assim que a arena
 * antiga acumulou defeito que só aparecia em produção.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { checkFeatureTier, denialResponse } from "@/lib/tier/enforce";
import { rateLimitDurable } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { donoDaSessao } from "@/lib/bancada/dono";
import {
  abrirRodada, fecharRodada, gravarResultado, consumoDaJanela, gravarOperacoes,
} from "@/lib/bancada/store";
import { lerEstrategia, oPortaoDoPedagio } from "@/lib/bancada/vocabulario";
import { decidir, type PedidoDeRodada } from "@/lib/bancada/cotas";
import { rodar } from "@/lib/bancada/motor";
import { resumir, julgar } from "@/lib/bancada/veredito";
import { velasDoIntervalo } from "@/lib/mercado/store";
import { ultimaVelaFechada } from "@/lib/mercado/velas";
import type { Operacao } from "@/lib/bancada/motor";
import { rodarMesa, agregar, MAX_BARRAS_AVALIADAS } from "@/lib/bancada/mesa-real";
import { mesaPodeRodar, custoIdaEVoltaDaMesa } from "@/lib/bancada/mesas-da-casa";
import { deskFor } from "@/lib/zion/desks";
import { identidadeDaRodada, janelaEmDias } from "@/lib/bancada/identidade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ ESTE LIMITE NÃO É A COTA, é o freio de rajada. A cota conta 24h e mede
 * plano; isto impede que um laço aberto por engano dispare cem rodadas em um
 * minuto antes de a cota sequer ser lida.
 */
const RL_OPTS = { windowMs: 60_000, max: 12 };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return denialResponse({ kind: "unauthenticated" });

  const verificado = donoDaSessao(session);
  // ⚠️ Não deveria acontecer com sessão válida, mas um `!` aqui trocaria um
  // estado impossível por um crash de produção.
  if (!verificado) return denialResponse({ kind: "unauthenticated" });
  const { dono, chain } = verificado;

  const portao = await checkFeatureTier("bancadaBacktest");
  if (portao) return denialResponse(portao);

  const rl = await rateLimitDurable(`bancada:rajada:${dono.toLowerCase()}`, RL_OPTS);
  if (!rl.ok) {
    return json({ ok: false, error: "muitas_rodadas_seguidas", retryAfter: rl.retryAfter }, 429);
  }

  const db = getSupabaseAdmin();
  if (!db) {
    /**
     * ⚠️ SEM BANCO A BANCADA NÃO RODA — e isto é o oposto do que `mercado/store`
     * faz sozinho. Lá, cair para a fonte é melhor-esforço honesto numa leitura;
     * aqui a rodada precisa ser CONTADA e GRAVADA. Rodar sem poder contar
     * entrega a cota inteira de graça e produz resultado que ninguém revê.
     */
    return json({ ok: false, error: "sem_banco", porque: "a bancada está indisponível por alguns instantes." }, 503);
  }

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo_invalido" }, 400); }
  const o = (corpo ?? {}) as Record<string, unknown>;

  /**
   * ⚠️⚠️ DOIS MODOS, e o segundo é o que o dono pediu ao dizer "não tem como
   * escolher" diante dos cards das mesas.
   *
   *   · própria — o cliente monta no vocabulário fechado;
   *   · MESA    — ele roda **o seletor real da casa** (`mesa-real.ts`), a mesma
   *     linha de código que a FREYJA roda, sobre os símbolos e a janela dele.
   *
   * ⚠️ O modo MESA não recebe alvo nem stop: eles saem do playbook, da
   * volatilidade daquele instante. Aceitar um alvo do cliente aqui seria voltar
   * a aproximar a mesa — o defeito que este modo existe para não cometer.
   */
  const idDaMesa = typeof o.mesa === "string" ? o.mesa : null;
  const mesa = idDaMesa ? deskFor(idDaMesa) : null;
  /**
   * ⚠️⚠️ `mesaPodeRodar`, NÃO `mesasElegiveis`. As duas listas medem coisas
   * diferentes e confundi-las foi o defeito de 07/09: `mesasElegiveis` diz quem
   * merece um CARD (mesa mecânica e viva), e a rota usava isso para decidir quem
   * podia RODAR. Resultado: dez mesas rodáveis e um único seletor por baixo —
   * ULLR e FREYJA devolveram `+2,140788280112371%` idênticos.
   *
   * ⚠️ E o filtro tem de estar AQUI, não só no botão. Uma checagem que mora só
   * na tela é uma checagem que qualquer `curl` contorna, e a rodada gravada
   * carregaria o nome de uma mesa que não rodou.
   */
  if (idDaMesa && (!mesa || !mesaPodeRodar(idDaMesa))) {
    return json({ ok: false, error: "mesa_nao_rodavel",
      porque: "esta mesa aparece na vitrine mas ainda não roda aqui: a regra dela não é a que esta bancada reproduz." }, 400);
  }

  // ── 1. O vocabulário: `unknown` vira estratégia, ou recusa com motivo ──
  let estrategia: import("@/lib/bancada/vocabulario").EstrategiaDoCliente;
  if (mesa) {
    /**
     * ⚠️ A PRAÇA VEM DO CLIENTE, o resto vem da mesa. É exatamente a pergunta
     * que a FREYJA existe para responder — *"a mesma regra paga na DEX como na
     * CEX?"* — agora na mão de quem paga.
     *
     * ⚠️ `alvoPct`/`stopPct` ficam em ZERO de propósito, e isso não é um valor:
     * é a ausência de um. `equilibrioExigido` devolve `null` sem denominador, e
     * a tela recebe a ressalva `bracketVariavel` explicando que nesta mesa não
     * existe UM acerto-para-empatar. Publicar um número único ali seria
     * inventar uma régua que a estratégia não tem.
     */
    const pracaEscolhida = o.praca === "spot_gate" || o.praca === "futuros_gate" || o.praca === "dex"
      ? o.praca : (mesa.venue === "dex" ? "dex" : "spot_gate");
    const papelEscolhido = o.papel === "maker" ? "maker" : "taker";
    estrategia = {
      entrada: { tipo: "media", n: 20 },   // não usado no modo mesa — o seletor decide
      direcao: "compra",                   // estas mesas são long-only, por construção
      alvoPct: 0, stopPct: 0,
      horasLimite: mesa.horizonHours ?? 48,
      praca: pracaEscolhida, papel: papelEscolhido,
    };
  } else {
    const lida = lerEstrategia(o.estrategia);
    if (!lida.ok) return json({ ok: false, error: "estrategia_invalida", porque: lida.porque }, 400);
    estrategia = lida.valor;
  }

  const simbolos = Array.isArray(o.simbolos) ? o.simbolos.filter((s): s is string => typeof s === "string") : [];
  const intervalo = typeof o.intervalo === "string" ? o.intervalo : "1d";
  const capitalUsd = typeof o.capitalUsd === "number" ? o.capitalUsd : NaN;
  const janelaDias = typeof o.janelaDias === "number" ? o.janelaDias : NaN;

  /**
   * ⚠️⚠️ A JANELA TERMINA NA ÚLTIMA VELA FECHADA, e quem decide isso é o
   * SERVIDOR — nunca o corpo da requisição.
   *
   * Deixar o cliente mandar `janelaAte` permitiria escolher a janela depois de
   * saber o resultado, que é a forma mais educada de sobreajuste. E a vela do
   * período corrente muda a cada negócio: incluí-la mediria um dia que ainda
   * não aconteceu.
   */
  const fim = ultimaVelaFechada(intervalo, Date.now());
  if (fim == null || !Number.isFinite(janelaDias) || janelaDias <= 0) {
    return json({ ok: false, error: "janela_invalida", porque: "intervalo ou janela em dias inválidos" }, 400);
  }
  const janelaAte = fim;
  const janelaDe = fim - janelaDias * 86_400_000;

  const pedido: PedidoDeRodada = { simbolos, intervalo, janelaDe, janelaAte, capitalUsd, mesa: !!mesa };

  /**
   * ⚠️ UMA CÓPIA SÓ dos params congelados — a que vai para o banco É a que vira
   * a identidade na resposta. Duas montagens iguais hoje são duas montagens
   * diferentes depois do próximo campo, e a divergência apareceria como um
   * cartão que muda de nome ao recarregar a página.
   */
  const paramsCongelados: Record<string, unknown> = mesa
    ? { ...estrategia, mesa: mesa.source, mesaNome: mesa.name }
    : { ...estrategia };

  // ── 2. O portão do pedágio, ANTES da cota ─────────────────────────────
  /**
   * ⚠️ A ORDEM IMPORTA. A rodada recusada aqui é gravada como `recusada` e NÃO
   * consome cota — cobrar por ela puniria o cliente justamente pela mensagem
   * que o impediu de perder dinheiro, e ensinaria a não testar.
   */
  // ⚠️ O portão julga um ALVO FIXO. No modo mesa não há um: o bracket sai do
  // playbook e já respeita o próprio piso de RR (1,8) e o teto de escala do
  // `zion/bracket.ts`. Aplicá-lo aqui recusaria a mesa por um alvo que ela
  // nunca declarou.
  const pedagio = mesa ? { ok: true as const, valor: true as const } : oPortaoDoPedagio(estrategia);
  if (!pedagio.ok) {
    const r = await abrirRodada(dono, chain, db, {
      estrategiaId: null, origem: "propria", capitalUsd: Number.isFinite(capitalUsd) ? capitalUsd : 1,
      simbolos, intervalo, janelaDe, janelaAte,
      praca: estrategia.praca, papel: estrategia.papel, params: { ...estrategia }, custoVelas: 0,
    });
    if (r.ok) await fecharRodada(dono, db, r.valor, "recusada", pedagio.porque);
    return json({ ok: false, error: "pedagio", porque: pedagio.porque, rodadaId: r.ok ? r.valor : null }, 422);
  }

  // ── 3. A cota ─────────────────────────────────────────────────────────
  const { tier } = await getTierForWallet(session.sub, session.chain);
  const consumo = await consumoDaJanela(dono, db);
  const d = decidir(tier, pedido, consumo);
  if (!d.ok) {
    return json({ ok: false, error: d.motivo, porque: d.porque, tier, cota: d.cota, upgradeUrl: "/pricing" },
      d.motivo === "consumo_desconhecido" ? 503 : 429);
  }

  // ── 4. A rodada nasce ANTES de haver resultado ────────────────────────
  const aberta = await abrirRodada(dono, chain, db, {
    estrategiaId: typeof o.estrategiaId === "string" ? o.estrategiaId : null,
    /**
     * ⚠️ `casa` QUANDO É MESA — o registro tem de dizer o que foi rodado.
     * Na primeira rodada real (06/09) uma corrida da FREYJA ficou gravada como
     * `propria` com `intervalo: "1d"`: o histórico do cliente descrevia uma
     * estratégia dele, num prazo que a mesa não usa. Extrato que mente sobre o
     * que aconteceu é pior que extrato ausente.
     */
    origem: mesa ? "casa" : (o.origem === "casa" ? "casa" : "propria"),
    capitalUsd, simbolos,
    // ⚠️ A mesa CAMINHA em 1h, qualquer que seja o intervalo marcado na tela.
    intervalo: mesa ? "1h" : intervalo,
    janelaDe, janelaAte,
    praca: estrategia.praca, papel: estrategia.papel,
    // O `mesa` entra nos params congelados: sem ele, ninguém sabe QUAL mesa foi.
    params: paramsCongelados,
    custoVelas: d.custoVelas,
  });
  if (!aberta.ok) return json({ ok: false, error: "nao_consegui_abrir", porque: aberta.porque }, 500);
  const rodadaId = aberta.valor;

  // ── 5. As velas e o motor ─────────────────────────────────────────────
  const operacoes: Operacao[] = [];
  const problemas: string[] = [];
  const retornosDeSegurar: number[] = [];

  let cortadaPeloTeto = false;
  for (const simbolo of simbolos) {
    if (mesa) {
      /**
       * ⚠️⚠️ O SELETOR DA CASA PRECISA DE QUATRO PRAZOS. `computeIndicators` lê
       * 1h, 4h, 1d e 1w — o regime e o alinhamento saem da comparação entre
       * eles. Buscar só 1h daria um regime sempre "TRANSITIONING", e a mesa
       * ficaria parada por falta de dado em vez de por falta de setup: uma mesa
       * quieta e uma mesa cega têm exatamente a mesma aparência.
       *
       * ⚠️ São quatro leituras por símbolo, e é por isso que a `mercado_vela`
       * existe: na segunda rodada do mesmo par elas não custam requisição.
       */
      const [h1, h4, d1] = await Promise.all([
        velasDoIntervalo(db, simbolo, "1h", janelaDe, janelaAte),
        velasDoIntervalo(db, simbolo, "4h", janelaDe, janelaAte),
        velasDoIntervalo(db, simbolo, "1d", janelaDe, janelaAte),
      ]);
      // ⚠️ A SEMANAL É AGREGADA DAS DIÁRIAS, não substituída por elas. O
      // `DURACAO_MS` não tem "1w", e passar diárias no lugar faria o `htf1w` do
      // seletor ler outra coisa do que lê ao vivo — em silêncio.
      const w1 = agregar(d1.velas, 7);
      for (const [nome, l] of [["1h", h1], ["4h", h4], ["1d", d1]] as const) {
        if (l.porqueIncompleta) problemas.push(`${simbolo} ${nome}: ${l.porqueIncompleta}`);
      }
      if (h1.velas.length < 2) continue;

      const custo = 2 * (estrategia.praca === "dex" ? 0.30 : estrategia.papel === "maker" ? 0.015 : 0.20);
      const r = rodarMesa({ h1: h1.velas, h4: h4.velas, d1: d1.velas, w1 }, simbolo, custo);
      if (r.cortadaPeloTeto) cortadaPeloTeto = true;
      operacoes.push(...r.operacoes);

      const p0 = h1.velas[0].close;
      const pN = h1.velas[h1.velas.length - 1].close;
      if (p0 > 0) retornosDeSegurar.push(((pN - p0) / p0) * 100);
      continue;
    }

    const leitura = await velasDoIntervalo(db, simbolo, intervalo, janelaDe, janelaAte);
    if (leitura.porqueIncompleta) problemas.push(`${simbolo}: ${leitura.porqueIncompleta}`);
    if (leitura.velas.length < 2) continue;

    // ⚠️ O símbolo viaja na operação: sem ele a tela não sabe de qual série
    // veio a entrada quando o cliente roda vários pares.
    operacoes.push(...rodar(leitura.velas, estrategia).operacoes.map((op) => ({ ...op, simbolo })));

    /**
     * ⚠️ O COMPETIDOR É "SEGURAR", medido na MESMA janela e SEM custo.
     *
     * Sem custo de propósito: comprar e não mexer paga uma ida e volta só, e
     * cobrar dele o mesmo pedágio da estratégia que operou quarenta vezes
     * inventaria vantagem para o nosso lado. O competidor tem de ser difícil de
     * bater — senão o veredito vira propaganda.
     */
    const p0 = leitura.velas[0].close;
    const pN = leitura.velas[leitura.velas.length - 1].close;
    if (p0 > 0) retornosDeSegurar.push(((pN - p0) / p0) * 100);
  }

  const resumo = resumir({ operacoes, velasLidas: d.custoVelas, aindaAbertas: 0 }, estrategia);
  const competidorPct = retornosDeSegurar.length > 0
    ? retornosDeSegurar.reduce((s, x) => s + x, 0) / retornosDeSegurar.length
    // ⚠️ `null`, nunca 0: zero afirmaria que o mercado ficou parado.
    : null;

  // ⚠️ No modo mesa, o alvo e o stop mudam a cada operação — não há um
  // acerto-para-empatar único, e a ressalva diz isso em vez de a tela mostrar
  // um número inventado.
  const v = julgar(resumo, estrategia, competidorPct, mesa ? ["bracketVariavel"] : []);
  /**
   * ⚠️⚠️ DUAS LISTAS, E A DIFERENÇA IMPORTA NA TELA.
   *
   *   · as CHAVES (`v.naoMedidoChaves`) — ressalvas estruturais, iguais em toda
   *     rodada, e traduzidas pelo cliente nos quatro idiomas;
   *   · os PROBLEMAS — o que deu errado NESTA leitura ("BTC 1h: chegaram 66% da
   *     janela"), que só existe como frase e não tem chave.
   *
   * Misturá-las numa lista só obrigaria a tela a adivinhar qual item já foi
   * traduzido — e a errar, mostrando a mesma ressalva duas vezes, uma em
   * português. O banco continua guardando a soma das duas em `nao_medido`,
   * porque quem abre o Postgres quer o texto legível.
   */
  const problemasDaLeitura = [...problemas];
  // ⚠️ Teto de barras é DECLARADO, nunca silencioso — regra da casa.
  if (cortadaPeloTeto) {
    problemasDaLeitura.push(`a janela foi cortada em ${MAX_BARRAS_AVALIADAS} barras de 1h — o resto do período não foi avaliado`);
  }
  const naoMedido = [...v.naoMedido, ...problemasDaLeitura];

  /**
   * ⚠️⚠️ O RETORNO DESTA ESCRITA É LIDO. Ele não era — e `supabase-js` RESOLVE
   * com `{ data: null, error }` em vez de lançar, então uma coluna faltando (ou
   * uma migration não aplicada) apagaria a rodada do histórico sem uma linha de
   * log, sem erro na tela, e com a resposta parecendo perfeita. O cliente só
   * descobriria ao recarregar a página e não achar mais o teste dele — que é
   * exatamente a queixa que o histórico foi feito para resolver.
   */
  const gr = await gravarResultado(dono, db, rodadaId, {
    brutoPct: resumo.brutoPct,
    taxaPct: resumo.taxaPct,
    derrapagemPct: resumo.derrapagemPct,
    liquidoPct: resumo.liquidoCompostoPct,
    n: resumo.n, acertos: resumo.acertos,
    equilibrioExigidoPct: v.equilibrioPct,
    veredito: v.veredito, naoMedido,
    /**
     * ⚠️⚠️ AS CHAVES E O COMPETIDOR SÃO GRAVADOS (0042) — sem eles o histórico
     * teria de escolher entre calar a comparação com ficar em caixa (metade do
     * veredito) e inventá-la, e mostraria a ressalva em português para uma tela
     * de quatro idiomas.
     */
    naoMedidoChaves: v.naoMedidoChaves,
    competidorPct,
  });
  /**
   * ⚠️⚠️ AS OPERAÇÕES SÃO GRAVADAS — foi o que faltava (06/09). Sem elas o
   * cliente lê um veredito e não tem como conferir: não vê quando entrou, a que
   * preço, por que saiu, nem qual playbook abriu.
   *
   * ⚠️ Melhor-esforço, mas NÃO em silêncio: se a gravação falhar, o motivo
   * entra em `nao_medido` em vez de a tela mostrar uma lista vazia como se não
   * houvesse operação nenhuma.
   */
  const g = await gravarOperacoes(dono, db, rodadaId, operacoes.map((op) => ({
    simbolo: op.simbolo ?? simbolos[0] ?? "?",
    abriuEm: op.abriuEm, fechouEm: op.fechouEm,
    entrada: op.entrada, saida: op.saida, desfecho: op.desfecho,
    brutoPct: op.brutoPct, liquidoPct: op.liquidoPct,
    playbook: op.playbook ?? null,
  })));
  if (!g.ok) {
    const aviso = `o detalhe das operações não foi gravado: ${g.porque}`;
    naoMedido.push(aviso);
    problemasDaLeitura.push(aviso);
  }
  // ⚠️ Aqui só cabe avisar na RESPOSTA: a linha que guardaria o aviso é
  // justamente a que não foi gravada.
  if (!gr.ok) {
    problemasDaLeitura.push(`este resultado NÃO entrou no seu histórico: ${gr.porque}`);
  }

  await fecharRodada(dono, db, rodadaId, gr.ok ? "concluida" : "falhou",
    gr.ok ? undefined : gr.porque);

  return json({
    ok: true, rodadaId, tier,
    quando: new Date().toISOString(),
    restamHoje: d.restamHoje - 1,
    /**
     * ⚠️⚠️ A RESPOSTA DIZ QUEM RODOU — e pela MESMA função que o histórico usa
     * ao reler o banco (`identidadeDaRodada`). Duas montagens de rótulo
     * divergiriam sem ninguém perceber, e divergiriam justamente onde mais
     * confunde: duas rodadas parecidas, lado a lado na tela.
     */
    identidade: identidadeDaRodada(mesa ? "casa" : "propria", paramsCongelados),
    contexto: {
      simbolos,
      intervalo: mesa ? "1h" : intervalo,
      janelaDias: janelaEmDias(janelaDe, janelaAte),
      praca: estrategia.praca, papel: estrategia.papel, capitalUsd,
    },
    veredito: { ...v, naoMedido, naoMedidoTexto: problemasDaLeitura },
    resumo,
    competidorPct,
    // ⚠️ Devolvidas na resposta para a tela não precisar de uma segunda volta —
    // e ordenadas, porque uma lista de entradas fora de ordem não se lê.
    operacoes: [...operacoes].sort((a, b) => a.abriuEm - b.abriuEm),
  });
}
