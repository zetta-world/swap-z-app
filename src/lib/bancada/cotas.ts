/**
 * A COTA DA BANCADA — a decisão pura, antes de qualquer vela ser buscada.
 *
 * ⚠️ ELA NÃO FALA COM O BANCO NEM COM A REDE. Recebe o tier, o pedido e o
 * consumo já lido, e devolve deixa-ou-recusa com motivo. A rota é quem busca;
 * aqui só há aritmética, e é isso que permite testá-la sem subir nada.
 */

import { BANCADA_COTAS, type Tier, type CotaDaBancada } from "@/lib/tier/types";
import { duracaoDoIntervaloMs } from "@/lib/mercado/velas";
import type { ConsumoDoDia } from "@/lib/bancada/store";

export interface PedidoDeRodada {
  simbolos: string[];
  intervalo: string;
  janelaDe: number;
  janelaAte: number;
  capitalUsd: number;
}

export type MotivoDaRecusa =
  | "cota_esgotada"
  | "capital_acima_do_teto"
  | "simbolos_demais"
  | "janela_longa_demais"
  | "trabalho_demais"
  | "pedido_incoerente"
  /** ⚠️ Não é "negado", é "não consegui contar". Ver a nota em `decidir`. */
  | "consumo_desconhecido";

export type DecisaoDaCota =
  | { ok: true; custoVelas: number; cota: CotaDaBancada; restamHoje: number }
  | { ok: false; motivo: MotivoDaRecusa; porque: string; cota: CotaDaBancada };

/**
 * ⚠️⚠️ O TETO DE TRABALHO POR RODADA — o buraco que o plano deixou aberto.
 *
 * §6.2 diz que "o freio interno é símbolos × DIAS por rodada". Isso não limita
 * trabalho nenhum: um ano em velas de 1 minuto são **525.600 velas por
 * símbolo**, contra 365 em velas diárias. O mesmo "1 ano, 3 símbolos" do plano
 * free custa 1.400 vezes mais numa granularidade e cabe na outra, e a régua não
 * enxerga a diferença.
 *
 * ⚠️ O teto aqui é `símbolos × dias × 24` — o equivalente a varrer a janela
 * inteira em velas de UMA HORA. Ele deixa passar tudo que é uso normal (diário,
 * 4h, 1h) e barra a patologia (1m sobre meses), que é onde a busca vira rajada
 * contra o limite por IP da fonte. Em 31/08 uma rajada dessas voltou com 56 de
 * 62 leituras em 429 — a rodada inteira não foi evidência sobre nada.
 *
 * ⚠️ E O QUE CUSTA NÃO É A CPU, É A BUSCA. O motor é linear e roda 26 mil velas
 * em milissegundos; o que dói é a primeira ida à fonte. Por isso o teto é
 * generoso: depois da tabela de velas, a segunda vez que alguém pedir o mesmo
 * BTC não custa requisição nenhuma.
 */
export function tetoDeVelasPorRodada(cota: CotaDaBancada): number {
  return cota.simbolosPorTeste * cota.janelaMaxDias * 24;
}

/** Quantas velas esta rodada vai ler. `null` se o intervalo não existe. */
export function custoDoPedido(p: PedidoDeRodada): number | null {
  const dur = duracaoDoIntervaloMs(p.intervalo);
  if (dur == null) return null;
  const span = p.janelaAte - p.janelaDe;
  if (!Number.isFinite(span) || span <= 0) return null;
  const porSimbolo = Math.ceil(span / dur);
  return p.simbolos.length * porSimbolo;
}

const DIA_MS = 86_400_000;

export function decidir(
  tier: Tier,
  pedido: PedidoDeRodada,
  /**
   * ⚠️ `null` = A LEITURA DO CONSUMO FALHOU, e não "consumo zero". A diferença
   * decide dinheiro: zero liberaria a cota inteira justamente quando o banco
   * está ruim.
   */
  consumo: ConsumoDoDia | null,
): DecisaoDaCota {
  const cota = BANCADA_COTAS[tier];

  if (!Array.isArray(pedido.simbolos) || pedido.simbolos.length === 0) {
    return { ok: false, motivo: "pedido_incoerente", porque: "escolha pelo menos um símbolo", cota };
  }
  if (!Number.isFinite(pedido.capitalUsd) || pedido.capitalUsd <= 0) {
    return { ok: false, motivo: "pedido_incoerente", porque: "o capital simulado precisa ser positivo", cota };
  }

  const custoVelas = custoDoPedido(pedido);
  if (custoVelas == null) {
    return { ok: false, motivo: "pedido_incoerente", porque: `intervalo ou janela inválidos: ${pedido.intervalo}`, cota };
  }

  /**
   * ⚠️⚠️ AQUI A BANCADA FALHA FECHADO, e o ZION falha ABERTO — e a diferença
   * NÃO é inconsistência.
   *
   * `consumeAnalysisQuota` libera quando o banco cai, com a regra certa para
   * ela: uma proteção que derruba o produto quando ela própria falha não é
   * proteção, e a resposta do ZION continua BOA nesse estado.
   *
   * Aqui a resposta não continua boa. Sem banco, `velasDoIntervalo` cai para a
   * fonte a cada rodada: o resultado sai com buracos de vela E cada teste vira
   * uma rajada contra um limite por IP que os IPs da Vercel dividem com o
   * mundo. Liberar seria entregar medição ruim ao preço mais caro que ela tem.
   *
   * Então a recusa é honesta e diz o que houve — nunca um "cota esgotada" que
   * mentiria sobre o motivo.
   */
  if (!consumo) {
    return {
      ok: false, motivo: "consumo_desconhecido",
      porque: "não consegui ler quantos testes você já rodou hoje, então não vou rodar mais um "
        + "às cegas. Sem essa leitura o resultado sairia com buracos de dado. Tente de novo em instantes.",
      cota,
    };
  }

  if (consumo.rodadas >= cota.backtestsPorDia) {
    return {
      ok: false, motivo: "cota_esgotada",
      porque: `você já rodou ${consumo.rodadas} testes nas últimas 24 horas, que é o limite do seu plano. `
        + "A cota é uma janela móvel: ela reabre aos poucos, conforme os testes antigos completam 24h.",
      cota,
    };
  }

  if (pedido.capitalUsd > cota.capitalMaxUsd) {
    return {
      ok: false, motivo: "capital_acima_do_teto",
      porque: `o capital simulado do seu plano vai até $${cota.capitalMaxUsd.toLocaleString("pt-BR")}.`,
      cota,
    };
  }

  if (pedido.simbolos.length > cota.simbolosPorTeste) {
    return {
      ok: false, motivo: "simbolos_demais",
      porque: `seu plano testa até ${cota.simbolosPorTeste} símbolo(s) por rodada.`,
      cota,
    };
  }

  const dias = (pedido.janelaAte - pedido.janelaDe) / DIA_MS;
  if (dias > cota.janelaMaxDias) {
    return {
      ok: false, motivo: "janela_longa_demais",
      porque: `seu plano olha até ${cota.janelaMaxDias} dias de histórico — você pediu ${Math.round(dias)}.`,
      cota,
    };
  }

  const teto = tetoDeVelasPorRodada(cota);
  if (custoVelas > teto) {
    return {
      ok: false, motivo: "trabalho_demais",
      porque: `${pedido.simbolos.length} símbolo(s) em velas de ${pedido.intervalo} sobre essa janela dão `
        + `${custoVelas.toLocaleString("pt-BR")} velas, e o teto por rodada é ${teto.toLocaleString("pt-BR")}. `
        + "Use um intervalo maior (1h, 4h, 1d) ou uma janela mais curta — a leitura fica igual de boa e sai na hora.",
      cota,
    };
  }

  return { ok: true, custoVelas, cota, restamHoje: cota.backtestsPorDia - consumo.rodadas };
}
