/**
 * O VOCABULÁRIO DA BANCADA — parâmetros, nunca código.
 *
 * ⚠️⚠️ POR QUE ISTO É UM FORMULÁRIO E NÃO UM EDITOR (§4.2 do plano).
 *
 * "Deixar o cliente criar a estratégia dele" tem duas leituras, e uma delas é
 * um servidor executando código de estranho. Não vamos abrir essa porta: o
 * construtor é um **vocabulário fechado**, e o que chega da rede é validado
 * para dentro dele ou é recusado com motivo.
 *
 * ⚠️ E A VALIDAÇÃO MORA AQUI, PURA, não na rota. Regra de negócio dentro de
 * rota é onde nenhum teste alcança — foi assim que a arena antiga acumulou
 * defeito que só aparecia em produção.
 *
 * ⚠️⚠️ O QUE ENTRA AQUI É `unknown`, SEMPRE. Um `as EstrategiaDoCliente` na
 * porta de entrada não valida nada: ele só manda o compilador parar de olhar.
 * `lerEstrategia` existe para que o tipo seja CONQUISTADO, não afirmado.
 */

import { TAXA_POR_PERNA, taxaPorPerna } from "@/lib/celeiro/taxas";
import { alvoLimpaOPedagio, MULTIPLO_DO_PEDAGIO } from "@/lib/celeiro/regime";
import type { Modalidade, Execucao } from "@/lib/celeiro/agentes";

/** As praças que a bancada oferece. ⚠️ São as MESMAS de `TAXA_POR_PERNA` — o
 *  cliente mede na praça em que a casa opera, não numa média inventada. */
export const PRACAS = ["spot_gate", "futuros_gate", "dex"] as const;
export type Praca = (typeof PRACAS)[number];

export const PAPEIS = ["maker", "taker"] as const;
export type Papel = (typeof PAPEIS)[number];

export const DIRECOES = ["compra", "venda"] as const;
export type Direcao = (typeof DIRECOES)[number];

/**
 * Os três gatilhos de entrada.
 *
 * ⚠️ CANÔNICOS E POUCOS, de propósito. `benchmarks.ts` já explica por quê:
 * varrer parâmetro procurando o melhor produz sobreajuste com cara de
 * descoberta. Aqui o cliente escolhe o `n`, e é decisão dele — mas o menu de
 * FAMÍLIAS é curto e de livro.
 */
export type Entrada =
  /** Fecha acima (compra) ou abaixo (venda) da média de `n` períodos. */
  | { tipo: "media"; n: number }
  /** Rompe a máxima (compra) ou a mínima (venda) das últimas `n` — Donchian. */
  | { tipo: "canal"; n: number }
  /** RSI de `n` períodos cruza `nivel` — sobrevenda compra, sobrecompra vende. */
  | { tipo: "rsi"; n: number; nivel: number };

export interface EstrategiaDoCliente {
  entrada: Entrada;
  direcao: Direcao;
  /** Distância até o alvo, em % do preço de entrada. */
  alvoPct: number;
  /** Distância até o stop, em % do preço de entrada. ⚠️ Pode ser ≠ do alvo. */
  stopPct: number;
  /** Quantas horas a posição pode ficar aberta antes de EXPIRAR. */
  horasLimite: number;
  praca: Praca;
  papel: Papel;
}

/** ⚠️ Limites que existem para o teste ser LEGÍVEL, não para proteger o servidor
 *  (isso é a cota, na fase 3). Um `n` de 5.000 sobre 365 velas nunca dispara. */
export const LIMITES = {
  nMin: 2, nMax: 400,
  rsiNivelMin: 5, rsiNivelMax: 95,
  alvoMinPct: 0.05, alvoMaxPct: 100,
  stopMinPct: 0.05, stopMaxPct: 100,
  horasMin: 1, horasMax: 24 * 90,
} as const;

/**
 * ⚠️ RECUSA COM MOTIVO, nunca `null` mudo.
 *
 * "Configuração inválida" manda o cliente adivinhar. O Maker de Faixa ficou
 * dois dias sem abrir uma posição porque nada dizia por quê — e ali éramos NÓS,
 * com acesso ao banco. Quem chega na plataforma não tem nem isso.
 */
export type Leitura<T> = { ok: true; valor: T } | { ok: false; porque: string };

function numero(v: unknown): number | null {
  // ⚠️ `Number("")` é 0 e `Number(null)` é 0, e os dois passam em `isFinite`.
  // Só `number` de verdade entra — string numérica também não, porque um campo
  // que chega como texto é sinal de que a rota não normalizou.
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function entre(v: number, min: number, max: number): boolean {
  return v >= min && v <= max;
}

function lerEntrada(v: unknown): Leitura<Entrada> {
  if (typeof v !== "object" || v === null) return { ok: false, porque: "entrada ausente" };
  const o = v as Record<string, unknown>;
  const n = numero(o.n);
  if (n == null || !Number.isInteger(n) || !entre(n, LIMITES.nMin, LIMITES.nMax)) {
    return { ok: false, porque: `o período precisa ser um inteiro entre ${LIMITES.nMin} e ${LIMITES.nMax}` };
  }
  switch (o.tipo) {
    case "media": return { ok: true, valor: { tipo: "media", n } };
    case "canal": return { ok: true, valor: { tipo: "canal", n } };
    case "rsi": {
      const nivel = numero(o.nivel);
      if (nivel == null || !entre(nivel, LIMITES.rsiNivelMin, LIMITES.rsiNivelMax)) {
        return { ok: false, porque: `o nível do RSI precisa ficar entre ${LIMITES.rsiNivelMin} e ${LIMITES.rsiNivelMax}` };
      }
      return { ok: true, valor: { tipo: "rsi", n, nivel } };
    }
    default:
      return { ok: false, porque: `gatilho desconhecido — os disponíveis são: média, canal e RSI` };
  }
}

/**
 * Transforma o que veio da rede numa estratégia — ou diz por que não dá.
 *
 * ⚠️ ELE NÃO JULGA SE A ESTRATÉGIA PRESTA. Isso é `oPortaoDoPedagio`, logo
 * abaixo, e a separação importa: "não entendi o que você pediu" e "entendi, e
 * a aritmética diz que não fecha" são respostas diferentes para o cliente.
 */
export function lerEstrategia(bruto: unknown): Leitura<EstrategiaDoCliente> {
  if (typeof bruto !== "object" || bruto === null) return { ok: false, porque: "nada foi enviado" };
  const o = bruto as Record<string, unknown>;

  const entrada = lerEntrada(o.entrada);
  if (!entrada.ok) return entrada;

  const direcao = o.direcao;
  if (direcao !== "compra" && direcao !== "venda") {
    return { ok: false, porque: "escolha comprar ou vender" };
  }

  const alvoPct = numero(o.alvoPct);
  if (alvoPct == null || !entre(alvoPct, LIMITES.alvoMinPct, LIMITES.alvoMaxPct)) {
    return { ok: false, porque: `o alvo precisa ficar entre ${LIMITES.alvoMinPct}% e ${LIMITES.alvoMaxPct}%` };
  }
  const stopPct = numero(o.stopPct);
  if (stopPct == null || !entre(stopPct, LIMITES.stopMinPct, LIMITES.stopMaxPct)) {
    return { ok: false, porque: `o stop precisa ficar entre ${LIMITES.stopMinPct}% e ${LIMITES.stopMaxPct}%` };
  }
  const horasLimite = numero(o.horasLimite);
  if (horasLimite == null || !entre(horasLimite, LIMITES.horasMin, LIMITES.horasMax)) {
    return { ok: false, porque: `o limite de tempo precisa ficar entre ${LIMITES.horasMin}h e ${LIMITES.horasMax}h` };
  }

  const praca = o.praca;
  if (!PRACAS.includes(praca as Praca)) return { ok: false, porque: "praça desconhecida" };
  const papel = o.papel;
  if (!PAPEIS.includes(papel as Papel)) return { ok: false, porque: "papel desconhecido — maker ou taker" };

  return {
    ok: true,
    valor: { entrada: entrada.valor, direcao, alvoPct, stopPct, horasLimite, praca: praca as Praca, papel: papel as Papel },
  };
}

/**
 * A taxa de UMA perna na praça e no papel escolhidos.
 *
 * ⚠️ REUSA `taxaPorPerna` EM VEZ DE COPIAR A TABELA. Uma segunda tabela de taxa
 * é uma segunda verdade sobre dinheiro, e ela diverge da primeira em silêncio no
 * dia em que a Gate mudar o preço — que é o defeito que este repositório já
 * pagou com o Maker de Faixa aposentado por engano.
 */
export function taxaDaBancadaPct(praca: Praca, papel: Papel): number {
  return taxaPorPerna(praca as Modalidade, papel as Execucao);
}

/** ⚠️ Só para a tela: as taxas que o cliente pode escolher, sem inventar número. */
export const TAXAS_VISIVEIS: Record<Praca, Record<Papel, number>> = {
  spot_gate:    { ...TAXA_POR_PERNA.spot_gate },
  futuros_gate: { ...TAXA_POR_PERNA.futuros_gate },
  dex:          { ...TAXA_POR_PERNA.dex },
};

/**
 * ⚠️⚠️ O PORTÃO — a mesma invariante I1 do Celeiro, agora virada para fora.
 *
 * `genomaAbre` recusa uma configuração de agente que nunca poderia operar. Aqui
 * a mesma régua atende o cliente: se o alvo não cobre o pedágio com folga, ele
 * ouve isso ANTES de gastar uma rodada — e ouve o número, não um "inválido".
 *
 * ⚠️ RECUSAR NÃO É PROTEGER O SERVIDOR, É PROTEGER O CLIENTE. A rodada barrada
 * aqui não consome cota nenhuma (`consumoDaJanela` ignora `recusada`): cobrar
 * por ela puniria justamente a mensagem que o impediu de perder dinheiro.
 */
export function oPortaoDoPedagio(
  e: EstrategiaDoCliente,
  multiplo: number = MULTIPLO_DO_PEDAGIO,
): Leitura<true> {
  const pedagio = 2 * taxaDaBancadaPct(e.praca, e.papel);
  /**
   * ⚠️⚠️ O QUE O PORTÃO JULGA É O **ALVO**, e a primeira versão disto usava
   * `Math.max(alvo, stop)` — copiado de `sementeAbreAlgumaVez` sem perguntar se
   * a pergunta era a mesma. Não era, e um teste pegou (05/09).
   *
   * Lá a pergunta é *"esta semente chega a ABRIR posição alguma vez?"*, e ali a
   * maior excursão manda. Aqui a pergunta é *"sobra dinheiro depois do
   * pedágio?"* — e quem paga o pedágio é o ALVO. Com `max`, um alvo de 0,1%
   * contra um stop de 5% PASSAVA: a maior perna cobria a taxa, e o cliente
   * recebia sinal verde para a morte exata do Maker de Faixa — alvo minúsculo,
   * pedágio comendo o movimento inteiro.
   *
   * ⚠️ O stop desproporcional não fica sem resposta, só não é ESTE portão que a
   * dá: ele aparece inteiro em `equilibrioExigido`, que com alvo 0,1% e stop 5%
   * pede 106% de acerto — impossível, e dito com todas as letras.
   */
  const v = alvoLimpaOPedagio(e.alvoPct, multiplo, pedagio);
  if (v.passa) return { ok: true, valor: true };
  return {
    ok: false,
    porque: `${v.porque}. Na ${rotuloDaPraca(e.praca)} como ${e.papel}, a ida e volta custa `
      + `${pedagio.toFixed(3)}% — para valer a pena, o alvo precisaria de pelo menos `
      + `${v.alvoMinimoPct.toFixed(2)}%.`,
  };
}

export function rotuloDaPraca(p: Praca): string {
  switch (p) {
    case "spot_gate":    return "Gate · spot";
    case "futuros_gate": return "Gate · futuros";
    case "dex":          return "DEX";
  }
}
