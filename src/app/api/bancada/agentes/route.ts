/**
 * OS AGENTES DO INVESTIDOR — contratar, desligar, e ler O NÚMERO DELE.
 *
 * ⚠️⚠️ ESTA ROTA É O CONSERTO DE 07/09. O dono, olhando a bancada:
 *
 *   *"apenas estamos pegando os resultados das mesas do painel e Admin e
 *   repetindo para o investidor... eu falei que tinha que ser isolado... o
 *   investidor roda estratégia/agente e o mesmo começa a trabalhar e gerar
 *   resultado dali"*.
 *
 * ⚠️ NENHUMA LINHA DE `zion_suggestions` PASSA POR AQUI, e isso é a definição
 * do isolamento — não uma consequência dele. O placar da casa fica no livro da
 * casa (`/api/bancada/mesas-da-casa`, a vitrine, marcada como nossa). O que
 * esta rota devolve nasce de `bancada_posicao` filtrada pelo dono, da instância
 * dele, a partir do instante em que ele contratou o agente.
 *
 * ⚠️ E O NÚMERO NASCE VAZIO, de propósito. Quem contrata hoje vê "0 decididas"
 * hoje. Emprestar as 335 operações da mesa da casa para preencher esse vazio
 * seria vender a nossa amostra como se fosse a dele — que é exatamente o que
 * estava acontecendo.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { checkFeatureTier, denialResponse } from "@/lib/tier/enforce";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { donoDaSessao } from "@/lib/bancada/dono";
import {
  salvarEstrategia, listarEstrategias, contarMesasVivas, ligarPapelAdiante,
  arquivarEstrategia, posicoesDaEstrategia, estrategia as umaEstrategia,
} from "@/lib/bancada/store";
import { desempenhoDaInstancia, inicioDaCobertura, type PosicaoDaInstancia } from "@/lib/bancada/desempenho";
import { mesaPodeRodar } from "@/lib/bancada/mesas-da-casa";
import { deskFor } from "@/lib/zion/desks";
import { INTERVALO_DO_AGENTE } from "@/lib/bancada/agente";
import { lerUltimoTique, saudeDoTique, distanciaAte } from "@/lib/bancada/ultimo-tique";
import { CADENCIA_MS } from "@/lib/bancada/papel";
import { lerSimbolos } from "@/lib/bancada/vocabulario";
import { BANCADA_COTAS } from "@/lib/tier/types";
import { getFlywheelGates } from "@/lib/admin/gates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ QUANTOS SÍMBOLOS UMA INSTÂNCIA ACOMPANHA. Cada símbolo custa três leituras
 * de vela por tick, a cada 30 minutos, para sempre. Não é um limite de
 * correção: é o único custo desta bancada que RECORRE.
 */
const MAX_SIMBOLOS = 5;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function contexto() {
  const session = await getSession();
  if (!session) return { erro: denialResponse({ kind: "unauthenticated" }) } as const;
  const v = donoDaSessao(session);
  if (!v) return { erro: denialResponse({ kind: "unauthenticated" }) } as const;
  const db = getSupabaseAdmin();
  if (!db) return { erro: json({ ok: false, error: "sem_banco" }, 503) } as const;
  const { tier } = await getTierForWallet(session.sub, session.chain);
  return { dono: v.dono, chain: v.chain, db, tier } as const;
}

/**
 * As instâncias deste investidor, cada uma com O EXTRATO DELA.
 *
 * ⚠️ O DESEMPENHO É CALCULADO, NUNCA GUARDADO. Um número gravado numa coluna
 * diverge das linhas que o geraram no primeiro fechamento que falhar — e
 * diverge para o lado bonito, porque quem falha é a escrita do agregado, não a
 * da posição. Contar as linhas toda vez custa uma consulta e não mente.
 */
export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;

  const todas = await listarEstrategias(c.dono, c.db);
  // ⚠️ Só as INSTÂNCIAS DE AGENTE. As estratégias próprias do cliente vivem em
  // `/api/bancada/estrategias`; misturá-las aqui faria a tela somar duas coisas
  // que se medem de formas diferentes.
  const instancias = todas.filter((e) => e.mesa != null && !e.arquivada);

  /**
   * ⚠️ UM "AGORA" SÓ para a resposta inteira. Chamar `Date.now()` dentro do
   * laço faria dois agentes da mesma resposta serem julgados contra relógios
   * diferentes — e a diferença apareceria justamente na fronteira do
   * `atrasado`, que é onde ela mais confunde.
   */
  const agoraMs = Date.now();

  /**
   * ⚠️⚠️ A CASA PODE TER PAUSADO, E O CLIENTE TEM DE SABER (07/09).
   *
   * Sem esta leitura, um incidente do nosso lado desenha um agente "ligado, em
   * dia" que vira `atrasado` sessenta minutos depois — sem causa visível, e com
   * a culpa aparente no agente dele. Um estado nosso não pode chegar ao
   * investidor disfarçado de defeito dele.
   *
   * ⚠️ Best-effort: falha ao ler o gate não derruba a tela. `false` é o padrão
   * honesto — o cron roda com gate ausente, então "não pausado" é a verdade.
   */
  let pausadoPelaCasa = false;
  try { pausadoPelaCasa = (await getFlywheelGates()).pause_bancada === true; } catch { /* ver acima */ }

  const agentes = await Promise.all(instancias.map(async (e) => {
    const posicoes = await posicoesDaEstrategia(c.dono, c.db, e.id);
    // ⚠️ A janela que os NÚMEROS cobrem — não "desde que religou". Ver a nota
    // em `inicioDaCobertura`.
    const desde = inicioDaCobertura(e.papelDesde, e.criadaEm);
    const paraContar: PosicaoDaInstancia[] = posicoes.map((p) => ({
      status: p.status,
      resultadoPct: p.resultadoPct,
      playbook: p.playbook,
      simbolo: p.simbolo,
      abertaEmMs: Date.parse(p.abertaEm) || 0,
      fechadaEmMs: p.fechadaEm ? Date.parse(p.fechadaEm) : null,
    }));
    const desk = deskFor(e.mesa!);

    /**
     * ⚠️⚠️ O QUE ELE VIU NA ÚLTIMA PASSAGEM (0044) — o pedido literal do dono:
     * *"ao contratar o agente deveria aparecer aí no próprio agente, as
     * informações e resultados em tempo real"*.
     *
     * ⚠️ `null` NÃO É VAZIO: significa "ainda não foi verificada", e toda
     * instância passa por esse estado nos primeiros 30 minutos de vida. A tela
     * precisa dos três — verificou-e-ficou-de-fora, ainda-não-verificou,
     * parou-de-verificar — porque hoje eles desenham a mesma coisa.
     */
    const tique = lerUltimoTique(e.ultimoTique);
    const saude = saudeDoTique(tique, CADENCIA_MS, agoraMs);

    return {
      id: e.id,
      mesa: e.mesa,
      nome: desk?.name ?? e.mesa,
      sigilo: desk?.sigil ?? null,
      subtitulo: desk?.subtitle ?? null,
      simbolos: e.simbolos ?? [],
      intervalo: e.intervalo ?? INTERVALO_DO_AGENTE,
      praca: e.praca, papel: e.papel,
      ligada: e.papelAdiante,
      desde: e.papelDesde ?? e.criadaEm,
      // ⚠️ `Number.isFinite(desde)` porque `Date.parse` devolve NaN em lixo, e
      // NaN aqui viraria "rodando há NaN horas" na tela.
      // ⚠️ `agoraMs` VAI EXPLÍCITO: sem ele `desempenhoDaInstancia` chamava o
      // próprio `Date.now()`, e a regra do "um agora só" desta rota valia para
      // a saúde do tique mas não para as horas de cobertura ao lado dela.
      desempenho: desempenhoDaInstancia(paraContar, desde, agoraMs),
      /**
       * ⚠️ AS ÚLTIMAS OPERAÇÕES VIAJAM JUNTO — até 20. É o extrato que
       * sustenta o número: sem ele o investidor lê um percentual e não tem como
       * conferir quando entrou, a que preço, por que saiu, nem qual playbook
       * abriu. A lista completa é a mesma consulta com outro limite, quando
       * fizer falta.
       */
      /**
       * ⚠️ A ÚLTIMA PASSAGEM, COM A IDADE JUNTO. O preço aqui é o fechamento da
       * última vela que o CRON leu — não uma cotação. Publicá-lo sem o carimbo
       * de quando foi lido criaria a expectativa de tempo real que esta bancada
       * não tem e não promete.
       */
      tique: tique == null ? null : { em: tique.em, simbolos: tique.simbolos },
      saude,
      cadenciaMs: CADENCIA_MS,
      /**
       * ⚠️⚠️ QUANTO FALTA PARA O ALVO, calculado no servidor a partir do preço
       * que o tique viu. É a conta que o investidor quer ler pronta — com a
       * posição aberta a 118.733 e o último preço em 121.750, ele quer "faltam
       * 0,4% para o alvo", não quatro números soltos para juntar de cabeça.
       *
       * ⚠️ Sem preço, os três campos são `null` — nunca 0, que diria "chegou".
       */
      operacoes: posicoes.slice(0, 20).map((o) => {
        if (o.status !== "aberta") return { ...o, distancia: null };
        const preco = tique?.simbolos[o.simbolo]?.preco ?? null;
        return { ...o, precoVisto: preco, distancia: distanciaAte(o, preco) };
      }),
    };
  }));

  return json({ ok: true, tier: c.tier, cota: BANCADA_COTAS[c.tier], agentes, pausadoPelaCasa });
}

/** Contratar um agente: nasce uma INSTÂNCIA do investidor, já ligada. */
export async function POST(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;

  /**
   * ⚠️⚠️ O PORTÃO É O DO PAPEL ADIANTE (`trader`), não o do backtest.
   *
   * Contratar um agente é ligar cron: custo que RECORRE a cada 30 minutos, por
   * cliente, para sempre. Backtest custa uma vez. Pôr o custo permanente atrás
   * do portão mais barato inverte a margem — é a nota da §6.3.
   */
  const portao = await checkFeatureTier("bancadaPapelAdiante");
  if (portao) return denialResponse(portao);

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo_invalido" }, 400); }
  const o = (corpo ?? {}) as Record<string, unknown>;

  const id = typeof o.mesa === "string" ? o.mesa : null;
  const desk = id ? deskFor(id) : null;
  /**
   * ⚠️ `mesaPodeRodar`, a MESMA lista do botão de backtest. Contratar uma mesa
   * cuja política o nosso código não reproduz seria pôr o nome dela numa
   * instância que faz outra coisa — o defeito que a lista existe para fechar.
   */
  if (!id || !desk || !mesaPodeRodar(id)) {
    return json({ ok: false, error: "mesa_nao_rodavel", porque:
      "esta mesa aparece na vitrine mas ainda não roda aqui: a regra dela não é a que esta bancada reproduz." }, 400);
  }

  // ⚠️ A MESMA função da rota irmã, desde 12/09: duas leituras do mesmo campo
  // divergiram, e a que não tinha teto deixava um cliente parar o cron de todos.
  const simbolos = lerSimbolos(o.simbolos, MAX_SIMBOLOS);
  // ⚠️ Instância sem símbolo não tem o que tickar: ela nasceria ligada e muda,
  // e "ligada sem nunca abrir" é indistinguível de "quebrada".
  if (simbolos.length === 0) return json({ ok: false, error: "sem_simbolos", porque: "escolha ao menos um símbolo." }, 400);

  // ⚠️ A praça vem do cliente — é a pergunta que a FREYJA existe para fazer,
  // agora na mão de quem paga. O padrão é a praça da mesa.
  const praca = o.praca === "spot_gate" || o.praca === "futuros_gate" || o.praca === "dex"
    ? o.praca : (desk.venue === "dex" ? "dex" : "spot_gate");
  const papel = o.papel === "maker" ? "maker" : "taker";

  /**
   * ⚠️⚠️ A MESMA MESA DUAS VEZES — A TRAVA ESTAVA SÓ NA TELA (14/09).
   *
   * ACHADO DA AUDITORIA. A vitrine apaga o botão com `jaContratada`, e a lista
   * que alimenta esse booleano vinha do card dos agentes — que só monta quando
   * o cliente ABRE a aba dele. No primeiro render a lista é `[]`, então o botão
   * nasce ACESO para toda mesa, inclusive a que ele contratou ontem.
   *
   * E aqui não havia nada: só o teto de `mesasDePapel`. Duas instâncias da
   * mesma mesa são indistinguíveis na tela — mesmo sigilo, mesmo nome, mesmos
   * símbolos, dois números diferentes — e a segunda queima um slot PAGO e
   * consome cron a cada 30 minutos.
   *
   * ⚠️ Trava que mora só na tela é trava que o primeiro render contorna, e que
   * qualquer `curl` ignora. Esta base já pagou essa lição no middleware do
   * admin: o portão que vale é o de baixo.
   */
  const jaTem = (await listarEstrategias(c.dono, c.db))
    .some((e) => e.mesa === id && !e.arquivada);
  if (jaTem) {
    return json({ ok: false, error: "ja_contratada", porque:
      `você já tem ${desk.name} rodando. Dispense a atual antes de contratar de novo.` }, 409);
  }

  const mesas = await contarMesasVivas(c.dono, c.db);
  // ⚠️ `null` = não consegui contar. Recusar é o único caminho honesto: liberar
  // entregaria a cota inteira exatamente quando o banco está ruim.
  if (mesas == null) return json({ ok: false, error: "consumo_desconhecido" }, 503);
  const teto = BANCADA_COTAS[c.tier].mesasDePapel;
  if (mesas >= teto) {
    return json({ ok: false, error: "limite_de_mesas", porque:
      `seu plano roda até ${teto} agente(s) ao mesmo tempo.`, upgradeUrl: "/pricing" }, 429);
  }

  const r = await salvarEstrategia(c.dono, c.chain, c.db, {
    nome: desk.name,
    /**
     * ⚠️⚠️ `params` VAZIO, e é a coisa mais importante desta rota.
     *
     * A tentação é guardar um `EstrategiaDoCliente` de fachada aqui — com
     * `alvoPct: 2.5`, digamos — para o resto do código não precisar de um
     * `null`. Isso faria o tick abrir posições com um alvo que a mesa NUNCA
     * declarou: o bracket dela sai da volatilidade a cada operação. A mentira
     * só apareceria no extrato do investidor, meses depois.
     */
    params: {},
    praca, papel, simbolos,
    // ⚠️ O agente CAMINHA em 1h, como a mesa ao vivo.
    intervalo: INTERVALO_DO_AGENTE,
    mesa: id,
  });
  if (!r.ok) return json({ ok: false, error: "nao_consegui_contratar", porque: r.porque }, 500);

  /**
   * ⚠️ CONTRATAR É LIGAR — e é aqui que `papel_desde` nasce. Sem esse carimbo,
   * o desempenho da instância seria um número sem tempo decorrido, que é o
   * mesmo defeito do número sem amostra.
   *
   * ⚠️ Se o ligar falhar, a instância fica salva e DESLIGADA, e a resposta diz
   * isso. Responder "ok" sobre um agente que não vai tickar é a promessa que
   * `bancada_posicao` já quebrou uma vez.
   */
  const l = await ligarPapelAdiante(c.dono, c.db, r.valor, true);
  if (!l.ok) return json({ ok: false, error: "contratado_mas_desligado", id: r.valor, porque: l.porque }, 500);

  return json({ ok: true, id: r.valor, mesa: id, nome: desk.name });
}

/** Desligar (para de tickar) ou dispensar (arquiva) uma instância. */
export async function PATCH(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo_invalido" }, 400); }
  const o = (corpo ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return json({ ok: false, error: "id_ausente" }, 400);

  /**
   * ⚠️⚠️ A LINHA É LIDA ANTES, PELO DONO, e a checagem não é cerimônia: sem
   * ela esta rota aceitaria o id de uma ESTRATÉGIA PRÓPRIA e a desligaria pela
   * porta dos agentes. O filtro de dono já está em `umaEstrategia` (ele vem
   * antes do filtro de id, por construção); o que falta é o tipo da linha.
   */
  const linha = await umaEstrategia(c.dono, c.db, id);
  if (!linha || linha.mesa == null) return json({ ok: false, error: "nao_encontrado" }, 404);

  if (o.dispensar === true) {
    // ⚠️ ARQUIVA, NÃO APAGA: as posições dela apontam para esta linha, e o
    // investidor não pode perder o histórico do que já rodou por ter desligado.
    const r = await arquivarEstrategia(c.dono, c.db, id);
    return r.ok ? json({ ok: true, dispensada: true }) : json({ ok: false, error: "falhou", porque: r.porque }, 500);
  }

  const ligar = o.ligada === true;
  if (ligar) {
    const portao = await checkFeatureTier("bancadaPapelAdiante");
    if (portao) return denialResponse(portao);
    const mesas = await contarMesasVivas(c.dono, c.db);
    if (mesas == null) return json({ ok: false, error: "consumo_desconhecido" }, 503);
    const teto = BANCADA_COTAS[c.tier].mesasDePapel;
    if (mesas >= teto) {
      return json({ ok: false, error: "limite_de_mesas", porque:
        `seu plano roda até ${teto} agente(s) ao mesmo tempo.`, upgradeUrl: "/pricing" }, 429);
    }
  }

  const r = await ligarPapelAdiante(c.dono, c.db, id, ligar);
  return r.ok ? json({ ok: true, ligada: ligar }) : json({ ok: false, error: "falhou", porque: r.porque }, 500);
}
