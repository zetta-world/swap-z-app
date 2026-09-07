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
  type MesaDoCron,
} from "@/lib/bancada/store";
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
    resumo.adiadas += (proprias.length + instancias.length) - daVez.length;

    // ── 3. Abrir o que o sinal mandar ─────────────────────────────
    for (const mesa of daVez) {
      if (processadas >= MESAS_POR_TICK) break;
      processadas++;
      resumo.mesas++;

      for (const simbolo of mesa.simbolos) {
        const nova = mesa.mesa
          ? await decidirDoAgente(db, mesa, simbolo, agoraMs, resumo)
          : await decidirDaPropria(db, mesa as MesaPropria, simbolo, agoraMs);
        if (!nova) continue;

        const r = await abrirPosicao(mesa.dono, db, { ...nova, estrategiaId: mesa.id, simbolo });
        if (r.ok) resumo.abertas++;
        else resumo.problemas.push(`abrir ${mesa.id}/${simbolo}: ${r.porque}`);
      }
    }
  }

  return resumo;
}

/** O que abrir, sem o `estrategiaId`/`simbolo` que o laço já sabe. */
type Abertura = Omit<Parameters<typeof abrirPosicao>[2], "estrategiaId" | "simbolo">;

/**
 * ⚠️ Tamanho fixo de papel, nos DOIS caminhos: a bancada mede a IDEIA, não o
 * dimensionamento. Deixar o cliente escolher o tamanho mudaria o resultado sem
 * mudar a estratégia.
 */
const TAMANHO_DE_PAPEL_USD = 1000;

/** A estratégia própria do cliente — vocabulário fechado, bracket fixo. */
async function decidirDaPropria(
  db: SupabaseClient, mesa: MesaPropria, simbolo: string, agoraMs: number,
): Promise<Abertura | null> {
  const leitura = await velasDoIntervalo(
    db, simbolo, mesa.intervalo, agoraMs - VELAS_POR_MESA * 3_600_000, agoraMs, agoraMs,
  );
  const d = decidirAbertura(mesa, leitura.velas, agoraMs);
  if (!d.abre) return null;
  return {
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
  };
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
): Promise<Abertura | null> {
  const de1h = agoraMs - VELAS_POR_AGENTE * 3_600_000;
  const [h1, h4, d1] = await Promise.all([
    velasDoIntervalo(db, simbolo, "1h", de1h, agoraMs, agoraMs),
    velasDoIntervalo(db, simbolo, "4h", agoraMs - VELAS_POR_AGENTE * 4 * 3_600_000, agoraMs, agoraMs),
    velasDoIntervalo(db, simbolo, "1d", agoraMs - 400 * 86_400_000, agoraMs, agoraMs),
  ]);

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
    return null;
  }

  return {
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
  };
}
