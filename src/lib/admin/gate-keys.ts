/**
 * As CHAVES dos gates do flywheel, e a classificação de quem gasta token.
 *
 * POR QUE ESTE ARQUIVO É SEPARADO DE `gates.ts` (auditoria 01/08):
 *
 * `gates.ts` importa o cliente Supabase de servidor, então nada marcado
 * `"use client"` pode importá-lo. O painel de admin, que é client, era obrigado
 * a REDIGITAR a lista de gates — e redigitou errado três vezes:
 *
 *   1. `pause_oracle` e `pause_arbiter2` existiam no cron mas não apareciam no
 *      painel: mesas que só se apagavam por deploy.
 *   2. O disjuntor de custo pausava só `pause_tournament`, uma chave que já
 *      estava desligada — disparava sem cortar gasto nenhum (30/07).
 *   3. Mesmo depois do conserto, faltavam `pause_agent_a`, `pause_radar` e
 *      `pause_sniper` na lista de corte (01/08).
 *
 * Três bugs, uma causa: a mesma verdade escrita em lugares diferentes. Aqui não
 * há import de servidor, então servidor E cliente derivam da MESMA fonte.
 *
 * Os comentários de cada gate (o que a mesa faz, e por que tem gate próprio)
 * seguem em `gates.ts`, junto do leitor que os consome.
 */

export type FlywheelGateKey =
  | "pause_backtest" | "pause_agent_a" | "pause_agent_b" | "pause_tournament"
  | "pause_paper" | "pause_radar" | "pause_sniper" | "pause_arbiter"
  | "pause_oracle" | "pause_arbiter2"
  | "pause_ragnarok" | "pause_ragnarok_ai" | "pause_ragnarok_dex" | "pause_ullr"
  | "pause_zion" | "pause_bancada"
  | "pause_urdr"
  | "pause_arbiter2_lev"
  /**
   * ⚠️ GATE PRÓPRIO DO DCA, e não o do autopilot.
   *
   * Abrir robô de IA ao público e abrir plano de poupança ao público são
   * decisões DIFERENTES, com riscos diferentes — e agora podem ser tomadas em
   * dias diferentes. O DCA também tem rota de cron própria: um bug na IA não
   * pode parar a poupança de ninguém junto.
   */
  | "pause_dca";

export const FLYWHEEL_GATE_KEYS: FlywheelGateKey[] = [
  "pause_backtest", "pause_agent_a", "pause_agent_b", "pause_tournament",
  "pause_paper", "pause_radar", "pause_sniper", "pause_arbiter",
  "pause_oracle", "pause_arbiter2",
  "pause_ragnarok", "pause_ragnarok_ai", "pause_ragnarok_dex", "pause_ullr",
  "pause_zion", "pause_urdr", "pause_arbiter2_lev",
  "pause_bancada",
  "pause_dca",
];

/**
 * Este gate corta gasto de TOKEN quando fechado?
 *
 * O disjuntor de custo de IA mantinha a lista de quem desligar escrita à mão
 * dentro do watchdog. Toda mesa nova nascia fora dela — e ninguém percebia,
 * porque o disjuntor continuava disparando, mandando o alerta e cortando os
 * gates antigos. Um disjuntor que dispara e não corta o gasto é PIOR que não
 * ter disjuntor: ele produz o registro de que agiu.
 *
 * Agora a classificação mora ao lado da definição do gate e o watchdog deriva a
 * lista. Gate novo sem entrada aqui não compila (o `Record` é total), e
 * `gates.test.ts` cobra a classificação explícita.
 *
 * `false` significa "fechar este gate não é a ferramenta certa para cortar
 * custo". Nas mesas mecânicas porque não há custo nenhum a cortar — e desligar
 * calaria o GRUPO DE CONTROLE que dá sentido à comparação com as mesas de IA,
 * fazendo o experimento perder o eixo justo exatamente quando o dinheiro
 * aperta, que é quando ele mais importa.
 *
 * ⚠ CORREÇÃO 01/08 (mesmo dia) — `pause_backtest` ESTAVA `true` E ISSO ESTAVA
 * ERRADO.
 *
 * Ele é o master das varreduras, então "gasta token" parecia óbvio. Mas ele
 * envolve o tick INTEIRO: dentro dele rodam VÖLUNDR, SKAÐI, FREYJA e ULLR, que
 * são justamente as mesas mecânicas. Fechá-lo num corte de custo derrubaria o
 * grupo de controle junto — exatamente o que o parágrafo acima proíbe. Eu
 * escrevi a regra e violei na linha seguinte.
 *
 * E não custava nada em economia: TODO caminho que gasta token dentro daquele
 * cron já tem gate próprio — `pause_agent_a`, `pause_agent_b`,
 * `pause_tournament`, `pause_oracle`, `pause_ragnarok_ai`. Fechar esses corta o
 * gasto por inteiro e deixa as mesas mecânicas trabalhando.
 *
 * Continua desligável À MÃO pelo painel quando o operador quiser parar tudo. O
 * que ele não é: ferramenta de corte AUTOMÁTICO de custo.
 */
export const GATE_SPENDS_TOKENS: Record<FlywheelGateKey, boolean> = {
  pause_backtest:     false,  // master do tick — fechá-lo levaria o CONTROLE junto
  pause_agent_a:      true,   // ZION self_scan
  pause_agent_b:      true,   // Ferrari híbrido
  pause_tournament:   true,   // stack multi-provedor
  pause_radar:        true,   // brain-wake do radar
  pause_sniper:       true,   // SNIPER
  pause_oracle:       true,   // VÖLVA
  pause_ragnarok_ai:  true,   // MÍMIR
  pause_zion:         true,   // o /api/zion do usuário — o maior de todos
  pause_paper:        false,  // preço público, zero LLM
  pause_arbiter:      false,  // detector de spread, zero LLM
  pause_arbiter2:     false,  // spot+perp hedgeado, zero LLM
  pause_ragnarok:     false,  // VÖLUNDR — seletor mecânico
  // ⚠️ DCA não chama modelo nenhum: é relógio + ordem a mercado. Zero LLM, e
  // por isso fora do corte automático de custo. Continua desligável à mão.
  pause_dca:          false,
  pause_ragnarok_dex: false,  // FREYJA — mesmo seletor mecânico, praça DEX
  pause_ullr:         false,  // ULLR — regra de idade/liquidez/fluxo, sem LLM
  pause_urdr:         false,  // URÐR — obedece ao histórico medido, zero LLM
  pause_arbiter2_lev: false,  // gêmeos alavancados 3×/5×, zero LLM
  /**
   * ⚠️⚠️ A BANCADA DO CLIENTE TEM GATE PRÓPRIO — e ela ganhou um porque não
   * tinha (07/09, achado em auditoria).
   *
   * O tique dos agentes do cliente pendurava em `pause_paper`, o MESMO gate do
   * experimento da casa na Gate.io. O rótulo que o operador lê no painel é
   * "PAPER · GATE.IO — pausar só congela o experimento": ele desligaria o que
   * acha ser um teste interno e pararia, junto, o produto que o cliente PAGA
   * para usar — sem uma palavra na tela dizendo por quê.
   *
   * ⚠️ E ele NÃO entra no corte automático de custo: zero LLM, e o que ele
   * pausa é receita. Desligar continua possível à mão, com o rótulo certo.
   */
  pause_bancada:      false,
};

/** Os gates que o disjuntor de custo deve fechar. Derivado, nunca digitado. */
export const TOKEN_SPENDING_GATES: FlywheelGateKey[] =
  FLYWHEEL_GATE_KEYS.filter((k) => GATE_SPENDS_TOKENS[k]);

/* ─────────────────────────────────────────────────────────────────────────
 * O MAPA DOS INTERRUPTORES — o que cada chave REALMENTE faz (R0.3, C1/C12).
 *
 * ⚠️ Mora aqui pelo mesmo motivo das chaves: os dois painéis são client e não
 * podem importar `kill-switches.ts`/`gates.ts` (cliente Supabase de servidor).
 *
 * ⚠️⚠️ OS RÓTULOS ANTIGOS PROMETIAM O QUE O CÓDIGO NÃO FAZ: "Show maintenance
 * page to all users" (nada no `middleware.ts` lê `maintenance_mode`) e "Disable
 * all swap execution" (`disable_swap` só barra a cotação FIRME). O operador
 * virava a chave e acreditava ter feito outra coisa. O texto agora sai daqui,
 * e `consumidores` é CONFERIDO contra o código em
 * `interruptores-consumidores.test.ts` — um mapa que mente reprova o CI.
 * ───────────────────────────────────────────────────────────────────────── */

export const PLATFORM_KILL_KEYS = ["disable_swap", "disable_cex", "maintenance_mode"] as const;
export type PlatformKillKey = (typeof PLATFORM_KILL_KEYS)[number];

export type ChaveDeInterruptor = PlatformKillKey | FlywheelGateKey;

/** Tudo que `POST /admin/api/killswitch` aceita. Derivado, nunca digitado. */
export const CHAVES_DE_INTERRUPTOR: ChaveDeInterruptor[] = [...PLATFORM_KILL_KEYS, ...FLYWHEEL_GATE_KEYS];

/**
 * O que o CONSUMIDOR faz quando não consegue ler a chave.
 *   · `fecha`    — bloqueia (dinheiro que sai: ordem de corretora);
 *   · `abre`     — segue como se a chave estivesse desligada;
 *   · `por_rota` — cada consumidor escolhe (ver `kill-switches.ts`).
 */
export type DirecaoNaFalha = "fecha" | "abre" | "por_rota";

export interface MapaDoInterruptor {
  direcaoNaFalha: DirecaoNaFalha;
  /** Arquivos FORA do admin que leem a chave no código. Conferido pelo teste. */
  consumidores:   string[];
  bloqueia:       string;
  naoBloqueia:    string;
  /** Mexer nele mexe em dinheiro ou receita de cliente: o painel confirma nos dois sentidos. */
  dinheiro?:      boolean;
  /** Só tem efeito com o master `pause_backtest` desligado (roda dentro do bloco dele). */
  sobMaster?:     boolean;
  /** Sem consumidor nenhum. O texto diz por que a chave ainda existe. */
  aposentado?:    string;
}

const BACKTEST = "src/app/api/zion/backtest/route.ts";
const RADAR    = "src/app/api/radar/route.ts";
const GATE_ABRE = "abre" as const;

export const MAPA_INTERRUPTORES: Record<ChaveDeInterruptor, MapaDoInterruptor> = {
  disable_swap: {
    direcaoNaFalha: "abre",
    consumidores: ["src/app/api/quote/route.ts"],
    bloqueia: "a cotação FIRME (/api/quote mode=quote) — o payload assinável novo",
    naoBloqueia: "cotação de lista, transação já cotada ou assinada, broadcast feito pela carteira. "
      + "Leitura falha → a cotação SEGUE (exceção documentada: o usuário ainda assina)",
    dinheiro: true,
  },
  disable_cex: {
    direcaoNaFalha: "fecha",
    consumidores: [
      "src/app/api/cex/order/route.ts", "src/app/api/autopilot/session/route.ts",
      "src/lib/cex/execucao/executor.ts",
    ],
    bloqueia: "ordem nova de corretora (manual e autopilot), armar sessão de autopilot e a passada "
      + "do executor (autopilot e DCA, inclusive simulado)",
    naoBloqueia: "cancelar ordem, revogar chave, ler saldo. Leitura falha → BLOQUEIA",
    dinheiro: true,
  },
  maintenance_mode: {
    direcaoNaFalha: "por_rota",
    consumidores: [
      "src/app/api/cex/order/route.ts", "src/app/api/quote/route.ts",
      "src/app/api/autopilot/session/route.ts", "src/lib/cex/execucao/executor.ts",
    ],
    bloqueia: "o mesmo que disable_swap + disable_cex juntos, nas mesmas rotas",
    naoBloqueia: "NÃO mostra página de manutenção (nada no middleware lê esta chave); o resto do site "
      + "segue no ar. Leitura falha → cotação segue, ordem de corretora bloqueia",
    dinheiro: true,
  },
  pause_backtest: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST],
    bloqueia: "as varreduras do tick (mesas mecânicas e de IA dentro do bloco do master)",
    naoBloqueia: "resolução, paper da casa, bancada do cliente, radar, arbiters, ZION do usuário, DCA",
  },
  pause_agent_a: {
    direcaoNaFalha: GATE_ABRE, consumidores: [],
    bloqueia: "nada — nenhum código lê esta chave",
    naoBloqueia: "tudo",
    aposentado: "Agent A saiu do tick em 27/07; a chave ficou por histórico. Recomendação ao dono: "
      + "aposentar (tirar do painel e do corte automático de custo, manter a linha no banco)",
  },
  pause_agent_b: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "o Agent B híbrido (também exige HYBRID_B_ENABLED)", naoBloqueia: "as outras mesas",
  },
  pause_tournament: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "o torneio de provedores diretos", naoBloqueia: "as outras mesas",
  },
  pause_paper: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST],
    bloqueia: "o agente de papel DA CASA (Gate.io)", naoBloqueia: "a bancada dos clientes (pause_bancada)",
  },
  pause_radar: {
    direcaoNaFalha: GATE_ABRE, consumidores: [RADAR],
    bloqueia: "o acorde do modelo nos gatilhos do radar", naoBloqueia: "a detecção de gatilho e o heartbeat",
  },
  pause_sniper: {
    direcaoNaFalha: GATE_ABRE, consumidores: [RADAR],
    bloqueia: "o SNIPER legado (só tem efeito com SNIPER_LEGACY=on)", naoBloqueia: "o resto do radar",
  },
  pause_arbiter: {
    direcaoNaFalha: GATE_ABRE, consumidores: [RADAR],
    bloqueia: "a mesa ARBITER (papel)", naoBloqueia: "as outras mesas do radar",
  },
  pause_oracle: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "a VÖLVA (tese diária)", naoBloqueia: "as outras mesas",
  },
  pause_arbiter2: {
    direcaoNaFalha: GATE_ABRE, consumidores: [RADAR],
    bloqueia: "a mesa ARBITER 2.0 (papel) e os gêmeos alavancados junto", naoBloqueia: "as outras mesas do radar",
  },
  pause_ragnarok: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "VÖLUNDR/SKAÐI (mecânicas)", naoBloqueia: "MÍMIR (pause_ragnarok_ai) e FREYJA (pause_ragnarok_dex)",
  },
  pause_ragnarok_ai: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "MÍMIR (mesa de IA)", naoBloqueia: "as mesas mecânicas",
  },
  pause_ragnarok_dex: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "FREYJA (praça DEX)", naoBloqueia: "as mesas de CEX",
  },
  pause_ullr: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "ULLR (lançamentos on-chain)", naoBloqueia: "as outras mesas",
  },
  pause_zion: {
    direcaoNaFalha: GATE_ABRE, consumidores: ["src/app/api/zion/route.ts"],
    bloqueia: "o ZION do USUÁRIO (/api/zion responde 503)",
    naoBloqueia: "cotação e swap. Leitura falha → o ZION SEGUE (decisão D-KS-1 pendente; o teto diário amortece)",
    dinheiro: true,
  },
  pause_urdr: {
    direcaoNaFalha: GATE_ABRE, consumidores: [BACKTEST], sobMaster: true,
    bloqueia: "URÐR (mecânica por histórico)", naoBloqueia: "as outras mesas",
  },
  pause_arbiter2_lev: {
    direcaoNaFalha: GATE_ABRE, consumidores: [RADAR],
    bloqueia: "só os gêmeos alavancados 3×/5× (papel)", naoBloqueia: "o ARBITER 2.0 sem alavanca",
  },
  pause_bancada: {
    direcaoNaFalha: GATE_ABRE,
    consumidores: ["src/app/api/bancada/tique/route.ts", "src/app/api/bancada/agentes/route.ts", BACKTEST],
    bloqueia: "o tique dos agentes que os CLIENTES contrataram (receita); a tela do cliente diz que a casa pausou",
    naoBloqueia: "o paper da casa. Leitura falha → o tique SEGUE",
    dinheiro: true,
  },
  pause_dca: {
    direcaoNaFalha: GATE_ABRE, consumidores: ["src/app/api/dca/cron/route.ts", "src/app/api/dca/planos/route.ts"],
    bloqueia: "entrada nova dos planos de DCA na corretora do CLIENTE (dinheiro real); o recovery continua",
    naoBloqueia: "o recovery de intents vivos. Leitura falha → a entrada nova SEGUE, segurada pela "
      + "liberação do DCA e pelo disable_cex do executor (decisão D-KS-2 pendente)",
    dinheiro: true,
  },
};

/**
 * Gates SEM consumidor que continuam na lista — explícitos, para o teste de
 * completude não aceitar um fantasma novo por omissão.
 */
export const INTERRUPTORES_SEM_CONSUMIDOR: ChaveDeInterruptor[] = ["pause_agent_a"];
