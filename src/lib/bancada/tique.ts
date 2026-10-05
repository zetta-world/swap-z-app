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
import { getTiersForWallets } from "@/lib/tier/check";
import { velasDoIntervalo, type LeituraDeVelas } from "@/lib/mercado/store";
import { lerEstrategia } from "@/lib/bancada/vocabulario";
import {
  mesasLigadasParaOCron, mesasDasPosicoesParaOCron, posicoesAbertasParaOCron, abrirPosicao, fecharPosicao,
  gravarUltimosTiques, marcarTiqueAdiado, type MesaDoCron, type UltimoTiqueEmLote,
} from "@/lib/bancada/store";
import { motivoFechado, type VistoNoSimbolo } from "@/lib/bancada/ultimo-tique";
import { duracaoDoIntervaloMs } from "@/lib/mercado/velas";
import {
  mesasQuePodemTickar, decidirAbertura, decidirFechamentoDaPosicao,
  type Mesa, type MesaPropria,
} from "@/lib/bancada/papel";
import {
  decidirAberturaDoAgente, prepararAgente, INTERVALO_DO_AGENTE, BARRAS_DE_AQUECIMENTO, type PreparoDoAgente,
} from "@/lib/bancada/agente";
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
   * ⚠️ Quantas ficaram para o PRÓXIMO tick por causa do orçamento do tique.
   *
   * Ela é contada e reportada porque "adiada" e "parada" são coisas diferentes,
   * e sem esse número a única forma de descobrir que o orçamento está apertado
   * seria um cliente reclamando que a mesa dele não abre. ⚠️ E elas voltam: o
   * cursor do tique começa por elas na passagem seguinte.
   */
  adiadas: number;
  /** CE-09: séries de velas DISTINTAS lidas nesta passagem (o custo real de I/O). */
  leituras: number;
  /** CE-09: `true` quando todas as mesas elegíveis foram avaliadas nesta passagem. */
  cicloCompleto: boolean;
  problemas: string[];
}

/**
 * ⚠️⚠️ O ORÇAMENTO DO TIQUE É DE LEITURAS E DE TEMPO (CE-09), não de mesas.
 *
 * O tique roda PENDURADO no cron de `/api/zion/backtest` (maxDuration 60 s),
 * DEPOIS das varreduras do flywheel e do LLM (30–45 s). O que sobra é o que ele
 * tem. Antes, o teto era "120 unidades de trabalho" contadas por MESA — mas o
 * que custa é LER a série de velas, e a mesma série (BTC 1h) serve a todas as
 * mesas que olham BTC em 1h no mesmo tique. Com as leituras compartilhadas, o
 * custo cresce com o número de PARES, não de mesas.
 *
 *   · `prazoMs`     — tempo de relógio desta passagem; o que não coube é
 *                     carimbado como adiado e vem primeiro na próxima.
 *   · `leiturasMax` — séries distintas lidas (cada uma = cobertura + páginas).
 *
 * Os padrões cabem no que sobra do cron de 60 s. Uma rota dedicada
 * (`/api/bancada/tique`) pode passar um prazo maior.
 */
export const PRAZO_DO_TIQUE_MS = Number(process.env.BANCADA_TIQUE_PRAZO_MS ?? 15_000);
export const LEITURAS_POR_TIQUE = Number(process.env.BANCADA_LEITURAS_POR_TIQUE ?? 400);
/** Tier do dono: aceita o cache até ~1h (ver `getTiersForWallets`). Papel não move dinheiro. */
export const TOLERANCIA_DO_TIER_MS = 55 * 60_000;
/** Onde mora o cursor da fila justa (admin_kv é o KV de operação da casa). */
export const CHAVE_DO_CURSOR = "bancada:tique:cursor";

export interface OpcoesDoTique {
  prazoMs?: number;
  leiturasMax?: number;
  /** Relógio de PAREDE para o prazo (o `agoraMs` pode ser simulado). */
  relogio?: () => number;
}

/**
 * ⚠️⚠️ UMA LEITURA POR SÉRIE POR TIQUE (CE-09).
 *
 * `velasDoIntervalo` com os mesmos argumentos devolve a mesma série dentro de
 * uma passagem — o banco não muda no meio dela a não ser pelas velas que a
 * própria leitura grava, e essas voltam iguais na leitura seguinte. Guardar a
 * PROMESSA (não o resultado) junta também as leituras simultâneas do agente.
 */
class LeitorDoTique {
  private readonly cache = new Map<string, Promise<LeituraDeVelas>>();
  leituras = 0;
  constructor(private readonly db: SupabaseClient, private readonly agoraMs: number) {}
  velas(simbolo: string, intervalo: string, desde: number): Promise<LeituraDeVelas> {
    const chave = `${simbolo}|${intervalo}|${desde}`;
    let p = this.cache.get(chave);
    if (!p) {
      this.leituras++;
      p = velasDoIntervalo(this.db, simbolo, intervalo, desde, this.agoraMs, this.agoraMs);
      this.cache.set(chave, p);
    }
    return p;
  }
}

/**
 * Um tick de todas as mesas vivas.
 *
 * ⚠️ A CHAIN VEM DA SESSÃO ORIGINAL? Não — aqui não há sessão. `getTierForWallet`
 * precisa dela para saber se checa passe na Solana, e a linha da estratégia
 * guarda a `chain` de quando foi criada. Ela é lida do banco junto com a mesa.
 */
export async function tiqueDoPapelAdiante(
  db: SupabaseClient, agoraMs: number = Date.now(), opcoes: OpcoesDoTique = {},
): Promise<ResumoDoTique> {
  const resumo: ResumoDoTique = {
    mesas: 0, abertas: 0, fechadas: 0, cortadasPorPlano: 0, adiadas: 0, leituras: 0, cicloCompleto: false, problemas: [],
  };
  const relogio = opcoes.relogio ?? Date.now;
  const prazo = relogio() + (opcoes.prazoMs ?? PRAZO_DO_TIQUE_MS);
  const leiturasMax = opcoes.leiturasMax ?? LEITURAS_POR_TIQUE;
  const leitor = new LeitorDoTique(db, agoraMs);
  const semTempo = () => relogio() >= prazo;

  const ligadas = await mesasLigadasParaOCron(db);
  const abertas = await posicoesAbertasParaOCron(db);
  /**
   * ⚠️ SEM MESA LIGADA, AINDA HÁ O QUE FECHAR (CE-09). Antes o tique voltava aqui
   * se nenhuma mesa estivesse ligada — e as posições de mesas pausadas ficavam
   * no ar, contra a regra escrita logo abaixo ("quem abriu tem de fechar").
   */
  if (ligadas.length === 0 && abertas.length === 0) return resumo;

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
  /**
   * ⚠️⚠️ UMA LEITURA POR PAR, NÃO POR POSIÇÃO (CE-09).
   *
   * Cada posição lia as velas desde a SUA abertura. Posições do mesmo par e
   * intervalo leem agora UMA série, desde a abertura mais antiga do grupo, e
   * cada uma recebe só as velas a partir da sua: `lerDoBanco` filtra
   * `abriu_em ≥ desde`, e filtrar a série maior pelo mesmo limite devolve as
   * mesmas velas. A decisão (`decidirFechamentoDaPosicao`) não muda.
   */
  interface ItemDeFechamento {
    p: (typeof abertas)[number]; mesa: MesaDoCron; horas: number; abertaEmMs: number; desde: number;
  }
  const grupos = new Map<string, { simbolo: string; intervalo: string; desdeMin: number; itens: ItemDeFechamento[] }>();
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
    // ⚠️ A janela começa na ABERTURA da posição: velas anteriores a ela não
    // podem fechá-la, e trazê-las só gastaria leitura.
    // ⚠️ Mesma correção da janela: o recuo segue o intervalo da leitura.
    const desde = abertaEmMs > 0
      ? abertaEmMs
      : agoraMs - VELAS_POR_MESA * (duracaoDoIntervaloMs(intervaloDaLeitura) ?? 3_600_000);
    const chave = `${p.simbolo}|${intervaloDaLeitura}`;
    const g = grupos.get(chave) ?? { simbolo: p.simbolo, intervalo: intervaloDaLeitura, desdeMin: desde, itens: [] };
    g.desdeMin = Math.min(g.desdeMin, desde);
    g.itens.push({ p, mesa, horas, abertaEmMs, desde });
    grupos.set(chave, g);
  }

  let gruposPendentes = grupos.size;
  for (const g of grupos.values()) {
    // ⚠️ FECHAR VEM ANTES DE ABRIR, e o prazo vale aqui também: o que não coube
    // é declarado, e o próximo tique o lê de novo (nada se perde).
    if (semTempo()) {
      const restantes = [...grupos.values()].slice(grupos.size - gruposPendentes).reduce((s, x) => s + x.itens.length, 0);
      resumo.problemas.push(`fechamento: prazo do tique esgotado — ${restantes} posição(ões) ficam para o próximo`);
      break;
    }
    gruposPendentes--;
    const leitura = await leitor.velas(g.simbolo, g.intervalo, g.desdeMin);
    for (const { p, mesa, horas, abertaEmMs, desde } of g.itens) {
      const velas = desde === g.desdeMin ? leitura.velas : leitura.velas.filter((v) => v.t >= desde);
      const dir = p.lado === "long" ? 1 : -1;
      const f = decidirFechamentoDaPosicao({
        entrada: p.entrada, tamanhoUsd: p.tamanhoUsd, abertaEmMs,
        alvo: p.entrada * (1 + dir * (p.alvoPct! / 100)),
        stop: p.entrada * (1 - dir * (p.stopPct! / 100)),
        horasLimite: horas,
        lado: p.lado,
        custoIdaEVoltaPct: custoDaLinha(mesa.praca, mesa.papel),
      }, velas, agoraMs);
      if (!f) continue;

      const r = await fecharPosicao(p.dono, db, p.id, f.status, f.saida, f.resultadoPct);
      // ⚠️ TIRA O SÍMBOLO, não a mesa inteira: as outras posições dela seguem no ar.
      if (r.ok) { resumo.fechadas++; abertasPorEstrategia.get(p.estrategiaId)?.delete(p.simbolo); }
      else resumo.problemas.push(`fechar ${p.id}: ${r.porque}`);
    }
  }

  // ── 2. Agrupar por dono e aplicar o teto do PLANO ────────────────
  const porDono = new Map<Dono, MesaDoCron[]>();
  for (const m of ligadas) {
    const lista = porDono.get(m.dono) ?? [];
    lista.push(m);
    porDono.set(m.dono, lista);
  }

  /**
   * ⚠️⚠️ O TIER É RELIDO A CADA TICK — EM LOTE (CE-09). Quem cai de `trader`
   * para `pro` para de tickar sozinho; sem isso continuaria consumindo cron para
   * sempre depois de parar de pagar por isso. A leitura é do `tier_cache` em
   * lotes de 100, com tolerância de ~1h (`TOLERANCIA_DO_TIER_MS`).
   */
  const chainDe = (d: Dono): WalletChain => (d.startsWith("0x") ? "evm" : "solana");
  const tiers = ligadas.length > 0
    ? await getTiersForWallets([...porDono.keys()].map((d) => ({ address: d, chain: chainDe(d) })), TOLERANCIA_DO_TIER_MS)
    : new Map();

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
  const elegiveis = new Map<string, Mesa>();
  for (const [dono, doDono] of porDono) {
    const tier = tiers.get(dono)?.tier ?? "free";
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
    // ⚠️ O teto do PLANO olha TODAS as mesas do dono (ordem de criação), não só
    // as que caem nesta passagem — senão a mesa excedente de um downgrade
    // ticaria quando aparecesse numa janela diferente das outras.
    const { tickam, cortadas } = mesasQuePodemTickar(comoMesa, tier);
    resumo.cortadasPorPlano += cortadas.length;
    for (const m of tickam) elegiveis.set(m.id, m);
  }

  /**
   * ⚠️⚠️ A FILA É JUSTA ENTRE TODAS AS MESAS, COM CURSOR (CE-09).
   *
   * Antes: as 200 mesas mais antigas (o resto nunca entrava), e dentro delas 12
   * donos por tique. Medido (CE-10): com 3.250 desks, 3.050 nunca eram vistos e
   * 30 eram avaliados por tique. Agora a fila é a lista INTEIRA, em ordem de
   * `id`, e cada passagem começa onde a anterior parou (`admin_kv`). Como o
   * custo é por PAR e não por mesa, a passagem costuma cobrir todas; quando o
   * orçamento acaba antes, o resto é carimbado como adiado e é o primeiro da
   * próxima. Nenhuma mesa fica para sempre de fora, e nenhum dono monopoliza:
   * cada um entra com as mesas que o plano dele cobre (o teto acima).
   */
  const fila = ligadas.filter((m) => elegiveis.has(m.id)).map((m) => m.id);
  const cursor = await lerCursor(db);
  let inicio = cursor == null ? 0 : fila.findIndex((id) => id > cursor);
  if (inicio < 0) inicio = 0;

  const preparos = new Map<string, PreparoDoAgente>();
  const ultimos: UltimoTiqueEmLote[] = [];
  const cortadasPeloTeto: string[] = [];
  let ultimoAvaliado: string | null = null;

  // ── 3. Abrir o que o sinal mandar ─────────────────────────────
  for (let k = 0; k < fila.length; k++) {
    const mesa = elegiveis.get(fila[(inicio + k) % fila.length])!;
    // ⚠️ O ORÇAMENTO, e o que sobra é carimbado em vez de sumir calado.
    if (semTempo() || leitor.leituras >= leiturasMax) {
      for (let j = k; j < fila.length; j++) cortadasPeloTeto.push(fila[(inicio + j) % fila.length]);
      break;
    }
    /**
     * ⚠️⚠️ O TETO CONTA TRABALHO, NÃO MESAS (12/09) — e agora conta o trabalho
     * que CUSTA (CE-09): as séries distintas lidas por `leitor`, checadas no
     * topo deste laço. Contar mesas (ou símbolos × peso) cobrava duas vezes a
     * mesma leitura de BTC 1h que dez mesas compartilham.
     */
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
        ? await decidirDoAgente(leitor, preparos, emMesa, simbolo, agoraMs, resumo)
        : await decidirDaPropria(leitor, emMesa as MesaPropria, simbolo, agoraMs);
      visto[simbolo] = p.visto;
      if (!p.abertura) continue;

      const r = await abrirPosicao(mesa.dono, db, { ...p.abertura, estrategiaId: mesa.id, simbolo });
      // ⚠️ SÓ O SUCESSO fecha a guarda. Uma escrita que falhou não abriu nada,
      // e tratá-la como abertura deixaria a mesa muda até o tique seguinte.
      if (r.ok) { resumo.abertas++; temAberta = true; }
      else resumo.problemas.push(`abrir ${mesa.id}/${simbolo}: ${r.porque}`);
    }

    ultimos.push({ id: mesa.id, dono: mesa.dono, visto });
    ultimoAvaliado = mesa.id;
  }
  resumo.cicloCompleto = fila.length > 0 && cortadasPeloTeto.length === 0;
  resumo.leituras = leitor.leituras;

  /**
   * ⚠️ MELHOR-ESFORÇO, E O ERRO NÃO VIRA AVISO — a única escrita da bancada
   * de que isso vale. Perder o registro é ruim; derrubar o tique que ia
   * abrir a próxima posição é pior. E a tela percebe sozinha: um
   * `ultimo_tique` velho é exatamente o que `saudeDoTique` chama de
   * `atrasado`. ⚠️ CE-09: em LOTE (0074), com queda para o PATCH antigo.
   */
  try { await gravarUltimosTiques(db, ultimos, agoraMs); } catch { /* ver acima */ }

  /**
   * ⚠️⚠️ O QUE O ORÇAMENTO CORTOU SAI CARIMBADO, E CONTADO (13/09).
   *
   * Sem a marca, `ultimo_tique` envelhece e `saudeDoTique` declara `atrasado`
   * — um incidente desconhecido no lugar de um teto conhecido. E
   * `resumo.adiadas` é o número pelo qual a casa descobre que o orçamento está
   * apertado.
   *
   * ⚠️ Melhor-esforço, como o resto do laço: não conseguir carimbar não pode
   * derrubar um tique que já abriu e fechou posições.
   */
  if (cortadasPeloTeto.length > 0) {
    resumo.adiadas += cortadasPeloTeto.length;
    try { await marcarTiqueAdiado(db, [...new Set(cortadasPeloTeto)], agoraMs); }
    catch { /* ver acima */ }
  }

  // O cursor anda até a última mesa avaliada: a próxima passagem começa depois dela.
  if (ultimoAvaliado != null) {
    try { await gravarCursor(db, ultimoAvaliado, agoraMs); } catch { /* melhor-esforço: sem cursor, recomeça do início */ }
  }

  return resumo;
}

async function lerCursor(db: SupabaseClient): Promise<string | null> {
  try {
    // leitura-limitada: uma chave só — é um cursor, não um histórico.
    const { data } = await db.from("admin_kv").select("value").eq("key", CHAVE_DO_CURSOR).limit(1);
    const v = data?.[0]?.value;
    return typeof v === "string" && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

async function gravarCursor(db: SupabaseClient, id: string, agoraMs: number): Promise<void> {
  await db.from("admin_kv").upsert(
    { key: CHAVE_DO_CURSOR, value: id, updated_at: new Date(agoraMs).toISOString() },
    { onConflict: "key" },
  );
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
  leitor: LeitorDoTique, mesa: MesaPropria, simbolo: string, agoraMs: number,
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
  // ⚠️ CE-09: a mesma série (par, intervalo, janela) serve a todas as mesas do tique.
  const leitura = await leitor.velas(simbolo, mesa.intervalo, agoraMs - VELAS_POR_MESA * durDoIntervalo);
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
  leitor: LeitorDoTique, preparos: Map<string, PreparoDoAgente>,
  mesa: Mesa, simbolo: string, agoraMs: number, resumo: ResumoDoTique,
): Promise<Passagem> {
  const de1h = agoraMs - VELAS_POR_AGENTE * 3_600_000;
  const [h1, h4, d1] = await Promise.all([
    leitor.velas(simbolo, "1h", de1h),
    leitor.velas(simbolo, "4h", agoraMs - VELAS_POR_AGENTE * 4 * 3_600_000),
    leitor.velas(simbolo, "1d", agoraMs - 400 * 86_400_000),
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

  // ⚠️ A SEMANAL É AGREGADA DAS DIÁRIAS, nunca substituída por elas:
  // `DURACAO_MS` não tem "1w", e passar diárias faria o `htf1w` do seletor ler
  // outra coisa do que lê ao vivo — em silêncio.
  const velasDoAgente = { h1: h1.velas, h4: h4.velas, d1: d1.velas, w1: agregar(d1.velas, 7) };
  /**
   * ⚠️ CE-09: a ANÁLISE (indicadores + seletor) é do SÍMBOLO, não da instância —
   * todas as instâncias que olham este par neste tique leem as mesmas velas.
   * Ela sai uma vez; cada instância aplica as próprias guardas por cima
   * (`decidirAberturaDoAgente` com o preparo). Prova: `agente.equivalencia.test.ts`.
   */
  let preparo = preparos.get(simbolo);
  if (!preparo) { preparo = prepararAgente(simbolo, velasDoAgente, agoraMs); preparos.set(simbolo, preparo); }
  const d = decidirAberturaDoAgente(
    { temPosicaoAberta: mesa.temPosicaoAberta, ultimaAberturaMs: mesa.ultimaAberturaMs },
    simbolo, velasDoAgente, agoraMs, preparo,
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
