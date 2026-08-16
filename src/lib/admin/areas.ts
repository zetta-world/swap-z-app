/**
 * AS ÁREAS DO PAINEL — o mapa que quebra o amontoado.
 *
 * ⚠️⚠️ POR QUE ISTO EXISTE (16/08). O dono abriu o admin e disse:
 *
 *   "só porque é um painel admin inspirado em terminal cyberpunk não é
 *    obrigado ficar essa bagunça, tudo amontoado (…) veja o laboratório, está
 *    um amontoado de grades espremidas para tudo, sendo que muita coisa ali
 *    merece sua própria UI"
 *
 * Ele tinha razão, e o número prova: **50 painéis, 20 deles numa categoria
 * só** (`lab`). O grid era um `auto-fill minmax(400px)` chapado — nenhuma
 * hierarquia, tudo do mesmo tamanho e da mesma importância, e as "categorias"
 * eram um filtro de chip, não um lugar.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ A DIVISÃO QUE IMPORTA: MESAS ≠ MEDIÇÕES.
 *
 * A categoria `lab` misturava duas coisas que não são a mesma:
 *
 *   · quem OPERA   — torneio, carteira paper, aprendizado, ligas, barra de
 *                    lançamento. Mesas vivas, dinheiro simulado andando agora.
 *   · o que MEDE   — backtests, custo de corretora, liquidez, rotação de
 *                    grade. Perguntas sobre o passado, sem mesa nenhuma viva.
 *
 * É a MESMA separação que o dono cobrou dias antes, sobre os conceitos:
 * *"mesa, estratégia, paper, agente, torneio… nada, quando tudo deveria ser
 * isolado"*. A tela repetia a confusão que o modelo de dados já tinha. Separar
 * aqui é a primeira vez que a interface concorda com a crítica.
 *
 * ⚠️ ÁREA NÃO É CATEGORIA. A `category` de cada módulo continua existindo e
 * governa o chip antigo; a área é uma camada ACIMA dela, e o mapa é explícito
 * (`AREA_DA_CATEGORIA`) em vez de derivado por regra esperta. Regra esperta
 * erra em silêncio quando alguém cria uma categoria nova; um mapa explícito
 * com teste de cobertura FALHA, que é o comportamento desejado.
 */

import { MODULE_REGISTRY, type ModuleCategory, type ModuleId } from "@/lib/admin/modules";

export type AreaId =
  | "comando"
  | "mesas"
  | "medicoes"
  | "dinheiro"
  | "operacao"
  | "pessoas"
  | "sistema";

export interface Area {
  id: AreaId;
  /** Nome curto — cabe no menu de bandeja do celular. */
  label: string;
  icon: string;
  /** A pergunta que esta área responde, em uma linha. */
  pergunta: string;
  /**
   * Faixa de contexto no topo da área. `null` = não precisa.
   *
   * ⚠️ Só existe onde confundir custa caro. Um aviso em toda tela é um aviso
   * que ninguém lê — a faixa do laboratório existe porque misturar USDT
   * simulado com receita real já aconteceu.
   */
  aviso: string | null;
  ordem: number;
}

export const AREAS: Area[] = [
  {
    id: "comando", label: "COMANDO", icon: "⌘", ordem: 1,
    pergunta: "o que precisa da minha atenção agora?",
    aviso: null,
  },
  {
    id: "mesas", label: "MESAS", icon: "♛", ordem: 2,
    pergunta: "quem está operando, com que resultado, e aprendendo o quê?",
    aviso: "MESAS — dinheiro SIMULADO de carteira paper. Nada aqui é receita "
      + "nem dinheiro real; é o experimento andando agora.",
  },
  {
    id: "medicoes", label: "MEDIÇÕES", icon: "🔬", ordem: 3,
    pergunta: "o que o histórico diz sobre cada estratégia?",
    aviso: "MEDIÇÕES — perguntas sobre o PASSADO, rodadas sob demanda. Nenhuma "
      + "mesa opera a partir daqui, e nenhum número desta área é dinheiro.",
  },
  {
    id: "dinheiro", label: "DINHEIRO", icon: "💰", ordem: 4,
    pergunta: "quanto entrou, quanto custou, quanto sobrou?",
    aviso: "DINHEIRO — receita e custo REAIS da plataforma. Não confundir com "
      + "o resultado simulado das mesas.",
  },
  {
    id: "operacao", label: "OPERAÇÃO", icon: "⚙", ordem: 5,
    pergunta: "o autopilot e as sessões estão saudáveis?",
    aviso: null,
  },
  {
    id: "pessoas", label: "PESSOAS", icon: "👥", ordem: 6,
    pergunta: "quem usa, quanto cresce, em que plano?",
    aviso: null,
  },
  {
    id: "sistema", label: "SISTEMA", icon: "🛡", ordem: 7,
    pergunta: "travas, auditoria, saúde e registro",
    aviso: null,
  },
];

/**
 * ⚠️ O MAPA É EXPLÍCITO, e tem de ser exaustivo.
 *
 * Toda `ModuleCategory` aparece aqui. Se alguém criar uma categoria nova e
 * esquecer desta linha, o teste de cobertura falha — em vez de o painel novo
 * sumir da navegação sem ninguém notar, que é exatamente como a `lab` virou um
 * depósito de vinte painéis.
 */
export const AREA_DA_CATEGORIA: Record<ModuleCategory, AreaId> = {
  command:     "comando",
  receita:     "dinheiro",
  custos:      "dinheiro",
  margem:      "dinheiro",
  mercado:     "dinheiro",
  operacao:    "operacao",
  crescimento: "pessoas",
  lab:         "medicoes",   // ⚠️ o padrão; a exceção manda mais (ver abaixo)
  bench:       "sistema",
  controls:    "sistema",
  logs:        "sistema",
};

/**
 * ⚠️⚠️ AS MESAS SAEM DA `lab` POR NOME, E É A DECISÃO CENTRAL DESTE ARQUIVO.
 *
 * Estes painéis têm `category: "lab"` no registro — e o registro está certo,
 * porque tudo isso é laboratório no sentido de "dinheiro simulado". Mas na
 * TELA eles não pertencem ao mesmo lugar que um backtest de liquidez:
 *
 *   · o torneio ordena mesas que estão operando AGORA
 *   · a carteira paper é o extrato dessas mesas
 *   · o volante de aprendizado diz se elas ainda aprendem
 *   · a barra de lançamento decide quem vê dinheiro real
 *
 * São o EXPERIMENTO VIVO. O resto da `lab` são perguntas sobre o passado, que
 * rodam quando alguém aperta um botão e não têm mesa nenhuma do outro lado.
 *
 * ⚠️ Por que exceção por NOME e não uma categoria nova: mudar a `category` de
 * dez módulos mexeria no chip antigo, no `admin-layout` salvo do dono e na
 * ordem declarada — três coisas com teste próprio, por causa de uma decisão de
 * navegação. A área é uma camada acima; ela pode discordar da categoria sem
 * reescrevê-la, e a lista abaixo é curta o bastante para ser lida de uma vez.
 */
export const MESAS: readonly ModuleId[] = [
  "tournament",      // ordena as mesas vivas
  "paper",           // o extrato delas
  "ragnarok",        // a biblioteca de playbooks operando
  "aprendizado",     // o volante ainda gira?
  "ligas",           // a divisão entre elas
  "launch-gate",     // quem pode ver dinheiro real
  "arbiter-cohort",  // as mesas market-neutral
  "rendimento",      // quanto cada mesa rendeu
] as const;

/** A área de um módulo — a exceção por nome vence o mapa por categoria. */
export function areaDoModulo(id: ModuleId): AreaId | null {
  if (MESAS.includes(id)) return "mesas";
  const m = MODULE_REGISTRY.find((x) => x.id === id);
  return m ? AREA_DA_CATEGORIA[m.category] : null;
}

/** Os módulos de uma área, na ordem declarada do registro. */
export function modulosDaArea(area: AreaId): ModuleId[] {
  return MODULE_REGISTRY
    .filter((m) => areaDoModulo(m.id) === area)
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map((m) => m.id);
}

/** A ficha da área, ou `null` se o id não existe (URL digitada à mão). */
export function areaPorId(id: string): Area | null {
  return AREAS.find((a) => a.id === id) ?? null;
}

/**
 * ⚠️ QUANTOS PAINÉIS EM CADA ÁREA — usado no menu.
 *
 * Serve para o dono ver de fora que uma área está inchando de novo. Vinte
 * painéis numa categoria só não apareceu do nada: foi crescendo um por vez, e
 * nada na tela contava.
 */
export function contagemPorArea(): Record<AreaId, number> {
  const out = {} as Record<AreaId, number>;
  for (const a of AREAS) out[a.id] = modulosDaArea(a.id).length;
  return out;
}
