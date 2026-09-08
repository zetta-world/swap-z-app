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
  mesasLigadasParaOCron, posicoesAbertasParaOCron, abrirPosicao, fecharPosicao,
  gravarUltimoTique, marcarTiqueAdiado, type MesaDoCron,
} from "@/lib/bancada/store";
import { motivoFechado, type VistoNoSimbolo } from "@/lib/bancada/ultimo-tique";
import { duracaoDoIntervaloMs } from "@/lib/mercado/velas";
import {
  mesasQuePodemTickar, decidirAbertura, decidirFechamentoDaPosicao,
  aVezDeQuem, tickAtual, MESAS_POR_TICK, AGENTES_POR_TICK,
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
  const abertasPorEstrategia = new Map<string, typeof abertas[number]>();
  for (const p of abertas) abertasPorEstrategia.set(p.estrategiaId, p);

  // ── 1. Fechar o que já venceu ────────────────────────────────────
  for (const p of abertas) {
    const mesa = ligadas.find((m) => m.id === p.estrategiaId);
    if (!mesa) continue;

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
      abertaEmMs > 0 ? abertaEmMs : agoraMs - VELAS_POR_MESA * 3_600_000,
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
    if (r.ok) { resumo.fechadas++; abertasPorEstrategia.delete(p.estrategiaId); }
    else resumo.problemas.push(`fechar ${p.id}: ${r.porque}`);
  }

  // ── 2. Agrupar por dono e aplicar o teto do plano ────────────────
  const porDono = new Map<Dono, MesaDoCron[]>();
  for (const m of ligadas) {
    const lista = porDono.get(m.dono) ?? [];
    lista.push(m);
    porDono.set(m.dono, lista);
  }

  let processadas = 0;
  for (const [dono, doDono] of porDono) {
    if (processadas >= MESAS_POR_TICK) break;

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
      const aberta = abertasPorEstrategia.get(m.id);
      const base = {
        id: m.id, dono, simbolos: m.simbolos,
        intervalo: m.mesa ? INTERVALO_DO_AGENTE : m.intervalo,
        ultimaAberturaMs: aberta?.velaEm ?? null,
        temPosicaoAberta: Boolean(aberta),
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
      ...aVezDeQuem(proprias, MESAS_POR_TICK, agora),
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
      if (processadas >= MESAS_POR_TICK) break;
      processadas++;
      resumo.mesas++;

      /**
       * ⚠️⚠️ O QUE ELE VIU EM CADA SÍMBOLO É GUARDADO (0044) — e é isto que
       * responde ao *"informações e resultados em tempo real"* do dono. Sem
       * este registro, "verificou e ficou de fora", "ainda não verificou" e
       * "parou de verificar" desenham exatamente a mesma tela.
       */
      const visto: Record<string, VistoNoSimbolo> = {};

      for (const simbolo of mesa.simbolos) {
        const p = mesa.mesa
          ? await decidirDoAgente(db, mesa, simbolo, agoraMs, resumo)
          : await decidirDaPropria(db, mesa as MesaPropria, simbolo, agoraMs);
        visto[simbolo] = p.visto;
        if (!p.abertura) continue;

        const r = await abrirPosicao(mesa.dono, db, { ...p.abertura, estrategiaId: mesa.id, simbolo });
        if (r.ok) resumo.abertas++;
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
  const leitura = await velasDoIntervalo(
    db, simbolo, mesa.intervalo, agoraMs - VELAS_POR_MESA * 3_600_000, agoraMs, agoraMs,
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
