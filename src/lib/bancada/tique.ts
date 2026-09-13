/**
 * O TICK DO PAPEL ADIANTE — a costura entre a decisão pura e o banco.
 *
 * ⚠️ A ARITMÉTICA VIVE EM `papel.ts`, testada sem rede. Aqui só há leitura,
 * escrita e o laço — a mesma separação de `celeiro/store.ts` e `mercado/store.ts`.
 *
 * ⚠️⚠️ ELE É MELHOR-ESFORÇO E NUNCA DERRUBA O CHAMADOR. Ele roda pendurado no
 * cron do `/api/zion/backtest`, que faz muita coisa mais importante em 30
 * minutos: uma mesa de cliente com problema não pode levar junto o flywheel, o
 * oráculo e o papel da casa.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierForWallet } from "@/lib/tier/check";
import { velasDoIntervalo } from "@/lib/mercado/store";
import { lerEstrategia } from "@/lib/bancada/vocabulario";
import {
  mesasLigadasParaOCron, mesasDasPosicoesParaOCron, posicoesAbertasParaOCron, abrirPosicao, fecharPosicao,
  gravarUltimoTique, marcarTiqueAdiado, type MesaDoCron,
} from "@/lib/bancada/store";
import { motivoFechado, type VistoNoSimbolo } from "@/lib/bancada/ultimo-tique";
import { duracaoDoIntervaloMs } from "@/lib/mercado/velas";
import {
  mesasQuePodemTickar, decidirAbertura, decidirFechamentoDaPosicao,
  aVezDeQuem, tickAtual, TRABALHO_POR_TICK, AGENTES_POR_TICK, DONOS_POR_TICK, custoDoTrabalho,
  type Mesa, type MesaPropria,
} from "@/lib/bancada/papel";
import { decidirAberturaDoAgente, INTERVALO_DO_AGENTE, BARRAS_DE_AQUECIMENTO } from "@/lib/bancada/agente";
import { agregar } from "@/lib/bancada/mesa-real";
import { taxaDaBancadaPct, type Praca, type Papel } from "@/lib/bancada/vocabulario";
import type { WalletChain } from "@/lib/supabase/types";
import type { Dono } from "@/lib/bancada/dono";

/** Quantas velas o tick lê por símbolo. Suficiente para o gatilho mais longo. */
const VELAS_POR_MESA = 420;

/**
 * ⚠️⚠️ O AGENTE PRECISA DE MUITO MAIS HISTÓRIA QUE UMA MÉDIA MÓVEL.
 *
 * `computeIndicators` devolve vazio abaixo de 52 velas de 1h, e o EMA50/ADX só
 * assentam depois de ~200 (`BARRAS_DE_AQUECIMENTO`). Ler 420 velas para um
 * agente o deixaria decidindo com indicador recém-nascido — e uma instância que
 * decide errado por falta de aquecimento é indistinguível, na tela, de uma que
 * decide errado por ter uma tese ruim.
 */
const VELAS_POR_AGENTE = BARRAS_DE_AQUECIMENTO + 200;

/** Ida e volta, em %, na praça daquela linha. */
function custoDaLinha(praca: Praca, papel: Papel): number {
  return 2 * taxaDaBancadaPct(praca, papel);
}

export interface ResumoDoTique {
  mesas: number;
  abertas: number;
  fechadas: number;
  /** Mesas ignoradas por o plano do dono não as cobrir mais (downgrade). */
  cortadasPorPlano: number;
  /**
   * ⚠️ Quantas ficaram para o PRÓXIMO tick por causa do teto de trabalho.
   *
   * Ela é contada e reportada porque "adiada" e "parada" são coisas diferentes,
   * e sem esse número a única forma de descobrir que o teto está apertado seria
   * um cliente reclamando que a mesa dele não abre. ⚠️ E elas voltam: a janela
   * de `aVezDeQuem` rola a cada tick.
   */
  adiadas: number;
  problemas: string[];
}

/**
 * Um tick de todas as mesas vivas.
 *
 * ⚠️ A CHAIN VEM DA SESSÃO ORIGINAL? Não — aqui não há sessão. `getTierForWallet`
 * precisa dela para saber se checa passe na Solana, e a linha da estratégia
 * guarda a `chain` de quando foi criada. Ela é lida do banco junto com a mesa.
 */
export async function tiqueDoPapelAdiante(
  db: SupabaseClient, agoraMs: number = Date.now(),
): Promise<ResumoDoTique> {
  const resumo: ResumoDoTique = {
    mesas: 0, abertas: 0, fechadas: 0, cortadasPorPlano: 0, adiadas: 0, problemas: [],
  };

  const ligadas = await mesasLigadasParaOCron(db);
  if (ligadas.length === 0) return resumo;

  const abertas = await posicoesAbertasParaOCron(db);

  /**
   * ⚠️⚠️ QUEM ABRIU TEM DE FECHAR, MESA LIGADA OU NÃO (12/09).
   *
   * O fechamento procurava a mesa dentro de `ligadas` e pulava a posição quando
   * não achava. Como `ligadas` só traz `papel_adiante = true` e não arquivada,
   * PAUSAR, ARQUIVAR ou DISPENSAR congelava a posição ABERTA para sempre — e as
   * órfãs iam se acumulando na cabeça da fila de `posicoesAbertasParaOCron`
   * (ordenada por `aberta_em`, teto 500) até nenhuma posição viva ser lida.
   *
   * Desligar a mesa diz "não abra mais". Nunca "esqueça o que já está no ar".
   */
  const mesasDasAbertas = await mesasDasPosicoesParaOCron(db, [...new Set(abertas.map((p) => p.estrategiaId))]);
  const mesaPorId = new Map(mesasDasAbertas.map((m) => [m.id, m]));

  /**
   * ⚠️⚠️ OS SÍMBOLOS ABERTOS DE CADA MESA, e não UMA posição por mesa (12/09).
   *
   * Era um `Map<estrategiaId, posicao>` montado com `set` em laço: a última
   * sobrescrevia as anteriores. Com três posições abertas na mesma mesa, o
   * `delete` ao fechar UMA apagava a marca das outras duas — a mesa voltava a
   * parecer livre e reabria por cima do que já estava no ar.
   */
  const abertasPorEstrategia = new Map<string, Set<string>>();
  const ultimaVelaPorEstrategia = new Map<string, number>();
  for (const p of abertas) {
    const s = abertasPorEstrategia.get(p.estrategiaId) ?? new Set<string>();
    s.add(p.simbolo); abertasPorEstrategia.set(p.estrategiaId, s);
    // ⚠️ A MAIOR vela, não a última lida: é ela que impede reavaliar o mesmo sinal.
    const v = p.velaEm ?? null;
    if (v != null) ultimaVelaPorEstrategia.set(p.estrategiaId, Math.max(ultimaVelaPorEstrategia.get(p.estrategiaId) ?? 0, v));
  }

  // ── 1. Fechar o que já venceu ────────────────────────────────────
  for (const p of abertas) {
    const mesa = mesaPorId.get(p.estrategiaId);
    if (!mesa) {
      // ⚠️ A LINHA DA ESTRATÉGIA SUMIU e a posição ficou. Não dá para fechar
      // sem praça/papel, e ficar calado foi o defeito anterior.
      resumo.problemas.push(`${p.id}: posição aberta sem linha de estratégia (${p.estrategiaId})`);
      continue;
    }

    /**
     * ⚠️⚠️ O BRACKET VEM DA POSIÇÃO, NÃO DA REGRA (0043).
     *
     * Antes daqui o fechamento relia o alvo da ESTRATÉGIA: editar a estratégia
     * movia, retroativamente, o alvo de posições já abertas — o resultado
     * mudava depois do fato e nada denunciava. E numa instância de agente nem
     * existe "a regra" de onde reler: o bracket sai da volatilidade daquele
     * instante, e duas posições da mesma instância têm alvos diferentes.
     *
     * ⚠️ Posição antiga (pré-0043) não tem `horas_limite`; nela o horizonte
     * cai para o da estratégia, que era o valor com que ela de fato nasceu.
     */
    if (p.alvoPct == null || p.stopPct == null) {
      resumo.problemas.push(`${p.id}: posição sem bracket gravado`);
      continue;
    }
    let horas = p.horasLimite;
    if (horas == null) {
      const lida = lerEstrategia(mesa.params);
      if (!lida.ok) { resumo.problemas.push(`${mesa.id}: ${lida.porque}`); continue; }
      horas = lida.valor.horasLimite;
    }

    // ⚠️ `aberta_em` é quando a LINHA nasceu — é ele que datam a posição para o
    // fechamento; `vela_em` é de qual vela veio o sinal, e serve à guarda de
    // reabertura. Confundir os dois foi o remendo que a 0040 desfez.
    const abertaEmMs = Date.parse(p.abertaEm) || 0;
    // ⚠️ O agente CAMINHA em 1h; a estratégia própria, no intervalo dela.
    const intervaloDaLeitura = mesa.mesa ? INTERVALO_DO_AGENTE : mesa.intervalo;
    const leitura = await velasDoIntervalo(
      db, p.simbolo, intervaloDaLeitura,
      // ⚠️ A janela começa na ABERTURA da posição: velas anteriores a ela não
      // podem fechá-la, e trazê-las só gastaria leitura.
      // ⚠️ Mesma correção da janela: o recuo segue o intervalo da leitura.
      abertaEmMs > 0 ? abertaEmMs : agoraMs - VELAS_POR_MESA * (duracaoDoIntervaloMs(intervaloDaLeitura) ?? 3_600_000),
      agoraMs, agoraMs,
    );
    const dir = p.lado === "long" ? 1 : -1;
    const f = decidirFechamentoDaPosicao({
      entrada: p.entrada, tamanhoUsd: p.tamanhoUsd, abertaEmMs,
      alvo: p.entrada * (1 + dir * (p.alvoPct / 100)),
      stop: p.entrada * (1 - dir * (p.stopPct / 100)),
      horasLimite: horas,
      lado: p.lado,
      custoIdaEVoltaPct: custoDaLinha(mesa.praca, mesa.papel),
    }, leitura.velas, agoraMs);
    if (!f) continue;

    const r = await fecharPosicao(p.dono, db, p.id, f.status, f.saida, f.resultadoPct);
    // ⚠️ TIRA O SÍMBOLO, não a mesa inteira: as outras posições dela seguem no ar.
    if (r.ok) { resumo.fechadas++; abertasPorEstrategia.get(p.estrategiaId)?.delete(p.simbolo); }
    else resumo.problemas.push(`fechar ${p.id}: ${r.porque}`);
  }

  // ── 2. Agrupar por dono e aplicar o teto do plano ────────────────
  const porDono = new Map<Dono, MesaDoCron[]>();
  for (const m of ligadas) {
    const lista = porDono.get(m.dono) ?? [];
    lista.push(m);
    porDono.set(m.dono, lista);
  }

  /**
   * ⚠️⚠️ A JANELA GIRA ENTRE DONOS TAMBÉM (13/09).
   *
   * ACHADO DA AUDITORIA, e é o `aVezDeQuem` aplicado pela metade: ele rolava
   * DENTRO de um dono, e o laço ENTRE donos seguia sendo um corte estável na
   * ordem de `criada_em`. Como o teto por plano é de 3 a 10 mesas, a rotação
   * interna virava no-op (`n <= teto`), e quem caía fora do teto GLOBAL era
   * sempre o mesmo cliente: o mais novo, o que acabou de pagar. A tela dizia
   * LIGADA e o agente dele não rodava em tick nenhum, nunca.
   *
   * *"Isso não é uma fila, é um corte"* — a frase já estava neste arquivo,
   * sobre o corte entre mesas. Valia igual um nível acima.
   */
  const donosNaFila = [...porDono.keys()];
  const donosDaVez = aVezDeQuem(donosNaFila, DONOS_POR_TICK, tickAtual(agoraMs));

  /**
   * ⚠️ CARIMBAR QUEM O TETO DEIXOU DE FORA, e não só quem `aVezDeQuem` adiou.
   *
   * Sem isto, `ultimo_tique` envelhece e `saudeDoTique` chama de `atrasado` —
   * que a tela traduz como "o problema é nosso, e nós também estamos vendo",
   * ou seja, um incidente DESCONHECIDO no lugar de um teto conhecido. E
   * `resumo.adiadas`, que é o número pelo qual a casa descobre que o teto está
   * apertado, ficava cego justamente para o teto que morde primeiro.
   */
  const cortadasPeloTeto: string[] = [];
  for (const d of donosNaFila) {
    if (donosDaVez.includes(d)) continue;
    for (const m of porDono.get(d) ?? []) cortadasPeloTeto.push(m.id);
  }

  let processadas = 0;
  for (const dono of donosDaVez) {
    const doDono = porDono.get(dono) ?? [];
    if (processadas >= TRABALHO_POR_TICK) {
      for (const m of doDono) cortadasPeloTeto.push(m.id);
      continue;
    }

    /**
     * ⚠️ O ORÇAMENTO É POR DONO, não só global — senão a rotação só troca QUEM
     * é atropelado. Um único cliente com muitas mesas gordas consumiria a
     * invocação inteira e empurraria todo mundo atrás dele, que é exatamente o
     * defeito que a rotação existe para não ter.
     */
    const tetoDesteDono = Math.max(1, Math.ceil(TRABALHO_POR_TICK / donosDaVez.length));
    const processadasAntes = processadas;

    /**
     * ⚠️⚠️ O TIER É RELIDO A CADA TICK. Quem cai de `trader` para `pro` para de
     * tickar sozinho — sem isso continuaria consumindo cron para sempre depois
     * de parar de pagar por isso, e nada quebraria para denunciar.
     */
    const chain: WalletChain = dono.startsWith("0x") ? "evm" : "solana";
    const { tier } = await getTierForWallet(dono, chain);

    /**
     * ⚠️⚠️ AS DUAS ESPÉCIES DE MESA, E O TIPO OBRIGA A SEPARÁ-LAS (0043).
     *
     *   · `mesa === null` — estratégia própria: `params` é o vocabulário
     *     fechado do cliente, e `sinais()` decide;
     *   · `mesa` preenchido — INSTÂNCIA DE AGENTE do investidor: `params` é
     *     `null` porque o bracket sai da volatilidade a cada operação, e quem
     *     decide é o seletor real da casa.
     *
     * Guardar um `EstrategiaDoCliente` de fachada na instância faria o tick
     * abrir posições com um alvo que a mesa nunca declarou.
     */
    const comoMesa: Mesa[] = doDono.flatMap((m): Mesa[] => {
      const abertasDela = abertasPorEstrategia.get(m.id);
      const base = {
        id: m.id, dono, simbolos: m.simbolos,
        intervalo: m.mesa ? INTERVALO_DO_AGENTE : m.intervalo,
        ultimaAberturaMs: ultimaVelaPorEstrategia.get(m.id) ?? null,
        // ⚠️ `size > 0`, não `Boolean(aberta)`: o conjunto pode existir e estar
        // vazio depois de a última posição fechar nesta mesma passagem.
        temPosicaoAberta: (abertasDela?.size ?? 0) > 0,
        criadaEm: m.criadaEm,
      };
      if (m.mesa) return [{ ...base, mesa: m.mesa, params: null }];
      const lida = lerEstrategia(m.params);
      if (!lida.ok) { resumo.problemas.push(`${m.id}: ${lida.porque}`); return []; }
      return [{ ...base, mesa: null, params: lida.valor }];
    });

    const { tickam, cortadas } = mesasQuePodemTickar(comoMesa, tier);
    resumo.cortadasPorPlano += cortadas.length;

    /**
     * ⚠️⚠️ AS DUAS ESPÉCIES TÊM ORÇAMENTOS SEPARADOS, porque custam coisas
     * diferentes: a própria pede 1 leitura por símbolo; a instância de agente
     * pede 3 mais `computeIndicators`. Ver `AGENTES_POR_TICK`.
     *
     * ⚠️ E A JANELA ROLA (`aVezDeQuem`): com um corte fixo sobre uma ordem
     * estável, as mesmas primeiras mesas ganhariam em TODO tick e a de número
     * `teto+1` nunca rodaria. Isso não é uma fila, é um corte — e era o que o
     * código fazia enquanto o comentário afirmava o contrário.
     */
    const agora = tickAtual(agoraMs);
    const proprias = tickam.filter((m) => m.mesa == null);
    const instancias = tickam.filter((m) => m.mesa != null);
    const daVez = [
      ...aVezDeQuem(proprias, TRABALHO_POR_TICK, agora),
      ...aVezDeQuem(instancias, AGENTES_POR_TICK, agora),
    ];
    const adiadas = [...proprias, ...instancias].filter((m) => !daVez.includes(m));
    resumo.adiadas += adiadas.length;

    /**
     * ⚠️⚠️ QUEM PERDEU A VEZ É CARIMBADO — e isto não é telemetria, é o que
     * impede um alarme falso na tela do cliente.
     *
     * Sem a marca, o intervalo entre duas avaliações de uma instância adiada
     * passa dos 60 minutos que `saudeDoTique` usa para gritar `atrasado`: o
     * único aviso que o investidor tem passaria a disparar por um TETO NOSSO,
     * culpando o agente DELE. Ver `0045_bancada_marcar_adiado.sql`.
     *
     * ⚠️ Melhor-esforço, como todo o resto deste laço: não conseguir carimbar
     * não pode derrubar o tique das que GANHARAM a vez.
     */
    if (adiadas.length > 0) {
      try { await marcarTiqueAdiado(db, adiadas.map((m) => m.id), agoraMs); }
      catch { /* ver acima */ }
    }

    // ── 3. Abrir o que o sinal mandar ─────────────────────────────
    for (const mesa of daVez) {
      // ⚠️ Os DOIS tetos, e o que sobra é carimbado em vez de sumir calado.
      if (processadas >= TRABALHO_POR_TICK || processadas - processadasAntes >= tetoDesteDono) {
        cortadasPeloTeto.push(mesa.id);
        continue;
      }
      /**
       * ⚠️⚠️ O TETO CONTA TRABALHO, NÃO MESAS (12/09).
       *
       * `processadas++` por MESA fazia uma mesa com 10.000 símbolos custar o
       * mesmo que uma com um só. O teto existe para limitar o tempo da função,
       * e o tempo é gasto no laço de dentro: uma leitura de vela por símbolo.
       * Com o teto contando mesas, uma única mesa gorda consumia a invocação
       * inteira e nenhum outro cliente tickava.
       *
       * O teto de símbolos (`lerSimbolos`) fecha a porta de entrada; este
       * fecha a que já está dentro — as linhas gravadas antes da correção.
       */
      // ⚠️ PESADO POR ESPÉCIE: a instância de agente pede 3 leituras por
      // símbolo contra 1 da própria. Ver `custoDoTrabalho`.
      processadas += custoDoTrabalho(mesa);
      resumo.mesas++;

      /**
       * ⚠️⚠️ O QUE ELE VIU EM CADA SÍMBOLO É GUARDADO (0044) — e é isto que
       * responde ao *"informações e resultados em tempo real"* do dono. Sem
       * este registro, "verificou e ficou de fora", "ainda não verificou" e
       * "parou de verificar" desenham exatamente a mesma tela.
       */
      /**
       * ⚠️ `Object.create(null)`, não `{}`: a chave vem do array de símbolos que
       * o cliente gravou, e um símbolo chamado `__proto__` escreveria na chave
       * especial do objeto em vez de numa propriedade comum — o `ultimo_tique`
       * da mesa sairia vazio e a tela diria "nunca foi verificada" sobre uma
       * mesa verificada a cada 30 minutos.
       */
      const visto: Record<string, VistoNoSimbolo> = Object.create(null);

      /**
       * ⚠️⚠️ A GUARDA DE "UMA POSIÇÃO POR MESA" TEM DE ANDAR DENTRO DO LAÇO (12/09).
       *
       * `mesa.temPosicaoAberta` era calculado UMA vez, antes do laço, e o
       * sucesso de `abrirPosicao` nunca voltava para ele. Uma mesa zerada com
       * cinco símbolos que sinalizassem no mesmo tique abria CINCO posições de
       * uma vez — violando a regra que a própria mesa declara, e inflando a
       * amostra do cliente com cinco desfechos correlacionados do mesmo
       * movimento.
       */
      let temAberta = mesa.temPosicaoAberta;

      for (const simbolo of mesa.simbolos) {
        const emMesa: Mesa = { ...mesa, temPosicaoAberta: temAberta };
        const p = emMesa.mesa
          ? await decidirDoAgente(db, emMesa, simbolo, agoraMs, resumo)
          : await decidirDaPropria(db, emMesa as MesaPropria, simbolo, agoraMs);
        visto[simbolo] = p.visto;
        if (!p.abertura) continue;

        const r = await abrirPosicao(mesa.dono, db, { ...p.abertura, estrategiaId: mesa.id, simbolo });
        // ⚠️ SÓ O SUCESSO fecha a guarda. Uma escrita que falhou não abriu nada,
        // e tratá-la como abertura deixaria a mesa muda até o tique seguinte.
        if (r.ok) { resumo.abertas++; temAberta = true; }
        else resumo.problemas.push(`abrir ${mesa.id}/${simbolo}: ${r.porque}`);
      }

      /**
       * ⚠️ MELHOR-ESFORÇO, E O ERRO NÃO VIRA AVISO — a única escrita da bancada
       * de que isso vale. Perder o registro é ruim; derrubar o tique que ia
       * abrir a próxima posição é pior. E a tela percebe sozinha: um
       * `ultimo_tique` velho é exatamente o que `saudeDoTique` chama de
       * `atrasado`.
       */
      try { await gravarUltimoTique(mesa.dono, db, mesa.id, visto, agoraMs); } catch { /* ver acima */ }
    }
  }

  /**
   * ⚠️⚠️ O QUE O TETO CORTOU SAI CARIMBADO, E CONTADO (13/09).
   *
   * As mesas que o teto global deixou de fora não passavam por
   * `marcarTiqueAdiado` nem por `gravarUltimoTique`, então `ultimo_tique`
   * envelhecia e `saudeDoTique` as declarava `atrasado` — um incidente
   * desconhecido no lugar de um teto conhecido. E `resumo.adiadas` ficava cego
   * exatamente para o teto que morde primeiro: o número pelo qual a casa
   * descobriria que precisa subir `TRABALHO_POR_TICK` nunca subia.
   *
   * ⚠️ Melhor-esforço, como o resto do laço: não conseguir carimbar não pode
   * derrubar um tique que já abriu e fechou posições.
   */
  if (cortadasPeloTeto.length > 0) {
    resumo.adiadas += cortadasPeloTeto.length;
    try { await marcarTiqueAdiado(db, [...new Set(cortadasPeloTeto)], agoraMs); }
    catch { /* ver acima */ }
  }

  return resumo;
}

/** O que abrir, sem o `estrategiaId`/`simbolo` que o laço já sabe. */
type Abertura = Omit<Parameters<typeof abrirPosicao>[2], "estrategiaId" | "simbolo">;

/**
 * ⚠️⚠️ O TIQUE DEVOLVE O QUE VIU, NÃO SÓ O QUE ABRIU (0044).
 *
 * O dono, depois de contratar a FREYJA: *"ao contratar o agente deveria
 * aparecer aí no próprio agente, as informações e resultados em tempo real"*.
 * O card sabia dizer "esperando setup" — verdadeiro e inútil, porque não separa
 * "verificou e ficou de fora" de "ainda não verificou" de "parou de verificar".
 *
 * Devolver só `Abertura | null` jogava fora exatamente a informação que
 * responde isso: o preço que ele leu e o motivo pelo qual não operou.
 */
interface Passagem {
  abertura: Abertura | null;
  visto: VistoNoSimbolo;
}

/**
 * ⚠️ Tamanho fixo de papel, nos DOIS caminhos: a bancada mede a IDEIA, não o
 * dimensionamento. Deixar o cliente escolher o tamanho mudaria o resultado sem
 * mudar a estratégia.
 */
const TAMANHO_DE_PAPEL_USD = 1000;

/** A estratégia própria do cliente — vocabulário fechado, bracket fixo. */
async function decidirDaPropria(
  db: SupabaseClient, mesa: MesaPropria, simbolo: string, agoraMs: number,
): Promise<Passagem> {
  /**
   * ⚠️⚠️ A JANELA SEGUE O INTERVALO, NÃO O RELÓGIO (12/09).
   *
   * Era `VELAS_POR_MESA * 3_600_000` — 420 HORAS fixas, qualquer que fosse o
   * intervalo da mesa. O que chegava:
   *
   *     1h → 420 velas ✓      4h → 105 velas      1d → 17 velas
   *
   * O vocabulário aceita período até `nMax = 400` e `sinais()` exige um
   * CRUZAMENTO, então uma média de 20 dias sobre 17 velas devolve `null` em
   * todo índice e a marca sai toda `false`. E "1d" é o PADRÃO da tela
   * (`Bancada.tsx`, `useState("1d")`): a configuração que o cliente vê primeiro
   * NUNCA abria posição, e a tela dizia "sem setup" — que ele lê como "o
   * mercado não deu oportunidade", quando queria dizer "nossa janela é curta
   * demais para calcular o seu indicador".
   *
   * ⚠️ `VELAS_POR_MESA` são VELAS, e agora são mesmo: multiplicar pela duração
   * do intervalo é o que faz o nome da constante virar verdade.
   */
  const durDoIntervalo = duracaoDoIntervaloMs(mesa.intervalo) ?? 3_600_000;
  const leitura = await velasDoIntervalo(
    db, simbolo, mesa.intervalo, agoraMs - VELAS_POR_MESA * durDoIntervalo, agoraMs, agoraMs,
  );
  /**
   * ⚠️⚠️ O CARIMBO DA VELA VIAJA JUNTO DO PREÇO. O cron pode passar às 14:30 e
   * servir um fechamento de 11:00: o cache `mercado_vela` responde com o que
   * tem quando a fonte recusa. Guardar só a hora do CRON faria a tela declarar
   * uma idade ERRADA — pior que não declarar idade nenhuma.
   */
  const ultima = leitura.velas[leitura.velas.length - 1];
  const preco = ultima != null && ultima.close > 0 ? ultima.close : null;
  const velaEm = ultima != null ? ultima.t : null;
  /**
   * ⚠️⚠️ O FECHAMENTO, não a abertura — é ELE que data o dado (08/09).
   *
   * `VelaComTempo.t` é o instante em que a vela ABRE. Uma vela de 1h aberta às
   * 07:00 só termina de se formar às 08:00: antes disso ela nem existia como
   * dado fechado. Medir a idade da abertura faz a tela envelhecer o preço em
   * até uma duração de intervalo inteira — foi assim que o card disse "vela de
   * 104 min atrás" sobre um dado de 44 minutos.
   */
  const durMs = duracaoDoIntervaloMs(mesa.intervalo);
  const velaFechaEm = velaEm != null && durMs != null ? velaEm + durMs : null;

  const d = decidirAbertura(mesa, leitura.velas, agoraMs);
  // ⚠️ O motivo é FECHADO na borda — ver `motivoFechado`. Guardar a string crua
  // punha `ja_tem_posicao` na tela de um cliente chinês.
  if (!d.abre) {
    return { abertura: null, visto: {
      preco, velaEm, velaFechaEm, regime: null,
      motivo: motivoFechado(d.porque), detalhe: null, abriu: false,
    } };
  }
  return { visto: { preco, velaEm, velaFechaEm, regime: null, motivo: null, detalhe: null, abriu: true }, abertura: {
    lado: mesa.params.direcao === "compra" ? "long" : "short",
    entrada: d.preco,
    tamanhoUsd: TAMANHO_DE_PAPEL_USD,
    alvoPct: mesa.params.alvoPct, stopPct: mesa.params.stopPct,
    horasLimite: mesa.params.horasLimite,
    // ⚠️ Cada coluna com o seu significado (0040): `expiraEm` é quando a
    // posição vence, `velaEm` é de qual vela veio o sinal.
    expiraEm: new Date(d.velaMs + mesa.params.horasLimite * 3_600_000).toISOString(),
    velaEm: d.velaMs,
    playbook: null,
  } };
}

/**
 * ⚠️⚠️ A INSTÂNCIA DE AGENTE DO INVESTIDOR — o que faltava (0043).
 *
 * Aqui o seletor REAL da casa decide sobre os símbolos DELE, e a posição que
 * nasce é DELE. Nenhuma linha de `zion_suggestions` participa: o placar da casa
 * fica no livro da casa, e o número que o investidor lê nasce daqui, do zero,
 * a partir do instante em que ele contratou o agente.
 *
 * ⚠️ QUATRO PRAZOS, e nenhum opcional — o regime sai da comparação entre eles.
 * Faltando os altos, o regime sai sempre "TRANSITIONING" e a instância fica
 * parada por FALTA DE DADO em vez de por falta de setup. Uma instância quieta e
 * uma cega têm exatamente a mesma aparência na tela.
 *
 * ⚠️ E É POR ISSO QUE A `mercado_vela` EXISTE: na segunda instância do mesmo
 * par, no mesmo tick, estas leituras não custam requisição nenhuma.
 */
async function decidirDoAgente(
  db: SupabaseClient, mesa: Mesa, simbolo: string, agoraMs: number, resumo: ResumoDoTique,
): Promise<Passagem> {
  const de1h = agoraMs - VELAS_POR_AGENTE * 3_600_000;
  const [h1, h4, d1] = await Promise.all([
    velasDoIntervalo(db, simbolo, "1h", de1h, agoraMs, agoraMs),
    velasDoIntervalo(db, simbolo, "4h", agoraMs - VELAS_POR_AGENTE * 4 * 3_600_000, agoraMs, agoraMs),
    velasDoIntervalo(db, simbolo, "1d", agoraMs - 400 * 86_400_000, agoraMs, agoraMs),
  ]);

  // ⚠️ O último fechamento de 1h que ELE leu — a mesma vela que decide. O
  // carimbo dela vai junto: a idade que a tela mostra tem de ser a do DADO, não
  // a da passagem do cron. Ver a nota gêmea em `decidirDaPropria`.
  const ultima1h = h1.velas[h1.velas.length - 1];
  const preco = ultima1h != null && ultima1h.close > 0 ? ultima1h.close : null;
  const velaEm = ultima1h != null ? ultima1h.t : null;
  // ⚠️ O agente caminha em 1h — o fechamento é a abertura + uma hora. Ver a
  // nota gêmea em `decidirDaPropria`: a idade sai daqui, nunca de `velaEm`.
  const velaFechaEm = velaEm != null ? velaEm + 3_600_000 : null;

  const d = decidirAberturaDoAgente(
    { temPosicaoAberta: mesa.temPosicaoAberta, ultimaAberturaMs: mesa.ultimaAberturaMs },
    simbolo,
    // ⚠️ A SEMANAL É AGREGADA DAS DIÁRIAS, nunca substituída por elas:
    // `DURACAO_MS` não tem "1w", e passar diárias faria o `htf1w` do seletor ler
    // outra coisa do que lê ao vivo — em silêncio.
    { h1: h1.velas, h4: h4.velas, d1: d1.velas, w1: agregar(d1.velas, 7) },
    agoraMs,
  );
  if (!d.abre) {
    /**
     * ⚠️ "AQUECENDO" É DIFERENTE DE "SEM SETUP", e o investidor vai perguntar.
     * Só este motivo entra no resumo: os outros são a mesa trabalhando (ficar
     * de fora é a decisão na maior parte do tempo), e reportá-los encheria o
     * log de ruído até ninguém mais ler nenhum.
     */
    if (d.porque === "aquecendo") {
      resumo.problemas.push(`${mesa.id}/${simbolo}: ainda aquecendo (${h1.velas.length} velas de 1h)`);
    }
    /**
     * ⚠️ O `porque` do agente inclui a prosa livre do SELETOR ("EMA50 acima do
     * preço") — texto que este arquivo não controla e que muda numa entrega do
     * admin. Ele é fechado para tradução e o cru fica em `detalhe`, que a tela
     * nunca imprime como se fosse nosso.
     */
    return { abertura: null, visto: {
      preco, velaEm, velaFechaEm, regime: d.regime,
      motivo: motivoFechado(d.porque), detalhe: d.porque, abriu: false,
    } };
  }

  return { visto: { preco, velaEm, velaFechaEm, regime: d.regime, motivo: null, detalhe: null, abriu: true }, abertura: {
    // ⚠️ Estas mesas são long-only por construção — ver `agente.ts`.
    lado: "long",
    entrada: d.entrada,
    tamanhoUsd: TAMANHO_DE_PAPEL_USD,
    alvoPct: d.alvoPct, stopPct: d.stopPct,
    horasLimite: d.horasLimite,
    expiraEm: new Date(d.velaMs + d.horasLimite * 3_600_000).toISOString(),
    velaEm: d.velaMs,
    // ⚠️ QUAL REGRA ABRIU. Sem isto o extrato do investidor é um número sem
    // como conferir — e a posição viva, ao contrário do backtest, aconteceu
    // uma vez só.
    playbook: d.playbook,
  } };
}
