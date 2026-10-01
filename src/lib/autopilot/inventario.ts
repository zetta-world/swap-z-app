/**
 * ⚠️⚠️⚠️ O QUE O BOT POSSUI — UMA RESPOSTA SÓ, DO SERVIDOR (A131).
 *
 * Havia DOIS livros de posição para o mesmo piloto:
 *
 *   A) servidor — `public.autopilot_positions`: inventário, exposição,
 *      `quantoPodeVender`, `exit_armed`, reconciliação de conta, P&L;
 *   B) navegador — Zustand/localStorage `zswap_autopilot_positions_v1`:
 *      exposição do navegador, compra local, venda local, P&L local.
 *
 * Os dois não eram a mesma autoridade, e o canal que dispara dinheiro real
 * pela `/api/cex/order` consultava o SEGUNDO. O ataque cabe em três linhas:
 *
 *     posição do bot no servidor:   0,01 BTC
 *     saldo do cliente na conta:    1,00 BTC
 *     cartão pede:                  VENDER 0,50 BTC
 *
 * O cron limitava a 0,01 (`quantoPodeVender`, chamado só por ele). O navegador
 * não limitava nada — e 0,49 BTC do PATRIMÔNIO DO DONO seriam vendidos por um
 * mandato que o bot não tem.
 *
 * ⚠️ `localStorage` continua existindo, e não é autoridade financeira. Ele
 * pode renderizar, adiantar tela, guardar preferência. Ele não pode dizer
 * quanto vender, se pode vender, nem quanta exposição existe. Divergiu do
 * servidor, o servidor ganha.
 *
 * ⚠️ MANUAL NÃO ENTRA AQUI (§20/§54). Vender o próprio ativo é direito do dono
 * e não passa por posse do bot. Estas regras valem para origem AUTÔNOMA.
 */

import { quantoPodeVender } from "@/lib/autopilot/venda-limitada";
import type { LeituraDeUmaPosicao, LeituraDePosicoes } from "@/lib/autopilot/positions-server";
import type { AutopilotPositionRow } from "@/lib/supabase/types";

// ── POSSE ────────────────────────────────────────────────────────────────

export type MotivoDaRecusaDeVenda =
  | "livro_ilegivel"
  | "sem_posicao"
  | "saida_ja_armada"
  | "quantidade_invalida";

export type AutorizacaoDeVendaAutonoma =
  | { ok: true; qtd: number; limitada: boolean; naPosicao: number }
  | { ok: false; motivo: MotivoDaRecusaDeVenda; porque: string };

/**
 * Quanto desta venda autônoma pertence ao bot?
 *
 * ⚠️ TRÊS RECUSAS E UM LIMITE, nesta ordem:
 *   · livro ilegível  → recusa (não se vende sem saber o que é do bot);
 *   · sem posição     → recusa (o saldo da conta NÃO é mandato);
 *   · saída armada    → recusa (uma ordem de venda viva já cobre esta bolsa);
 *   · pediu demais    → LIMITA à posição, com telemetria dizendo que o
 *                        excedente era patrimônio do usuário (§9).
 */
export function avaliarVendaAutonoma(args: {
  leitura: LeituraDeUmaPosicao;
  pedido: unknown;
}): AutorizacaoDeVendaAutonoma {
  const { leitura, pedido } = args;
  if (!leitura.ok) {
    return { ok: false, motivo: "livro_ilegivel",
      porque: `nao deu para ler o livro de posicoes: ${leitura.porque} — `
        + "sem saber o que pertence ao bot, nenhuma venda autonoma sai" };
  }
  const pos = leitura.posicao;
  if (!pos || pos.status === "closed" || !(Number(pos.base_amount) > 0)) {
    return { ok: false, motivo: "sem_posicao",
      porque: "o bot nao tem posicao aberta nesta moeda — o saldo da conta e "
        + "do usuario, e vende-lo nao esta no mandato do autopilot" };
  }
  /**
   * ⚠️ UMA SAÍDA ARMADA JÁ É UMA ORDEM VIVA NA CORRETORA. Uma segunda venda
   * despeja a MESMA bolsa duas vezes. É a mesma conduta do cron, que pula e
   * deixa a ordem armada resolver sozinha.
   */
  if (pos.status === "exit_armed") {
    return { ok: false, motivo: "saida_ja_armada",
      porque: "ja existe uma ordem de saida viva para esta posicao — uma "
        + "segunda venda despejaria a mesma bolsa duas vezes" };
  }
  const venda = quantoPodeVender(pedido, pos.base_amount);
  if (!venda.ok) {
    return { ok: false, motivo: "quantidade_invalida", porque: venda.porque };
  }
  return { ok: true, qtd: venda.qtd, limitada: venda.limitada, naPosicao: venda.naPosicao };
}

// ── EXPOSIÇÃO ────────────────────────────────────────────────────────────

/**
 * ⚠️ O TETO POR MODO DE RISCO VIVIA SÓ NO CRON (`RISK_EXPOSURE_USD`), e o
 * navegador tinha um teto próprio no Zustand. Dois números para a mesma
 * pergunta é como o A131 começou. Agora é um, e os dois canais o leem daqui.
 */
export const RISK_EXPOSURE_USD: Record<string, number> = {
  conservador: 75, moderado: 200, agressivo: 400,
};

export function tetoDeExposicaoDoRisco(riskMode: string | null | undefined): number {
  return RISK_EXPOSURE_USD[String(riskMode)] ?? RISK_EXPOSURE_USD.moderado;
}

/**
 * A exposição do bot: o custo das posições que ele ainda mantém.
 *
 * ⚠️ `closed` fora da conta; `exit_armed` DENTRO. Uma saída armada ainda é
 * capital exposto — a ordem pode não preencher.
 */
export function calcularExposicaoUsd(posicoes: AutopilotPositionRow[]): number {
  return posicoes
    .filter((p) => p.status !== "closed")
    .reduce((soma, p) => {
      const custo = Number(p.cost_usd);
      return soma + (Number.isFinite(custo) ? custo : 0);
    }, 0);
}

export type AvaliacaoDeExposicao =
  | { ok: true; exposicaoAtualUsd: number; depoisUsd: number; tetoUsd: number }
  | { ok: false; motivo: "livro_ilegivel" | "teto_estourado"; porque: string };

/**
 * Esta entrada cabe no teto de exposição da sessão?
 *
 * ⚠️ LIVRO ILEGÍVEL RECUSA (A133). `[]` por erro de banco faria a exposição
 * parecer zero, e o teto liberaria o valor inteiro de novo.
 */
export function avaliarExposicaoParaEntrada(args: {
  leitura: LeituraDePosicoes;
  novaEntradaUsd: number;
  tetoUsd: number;
}): AvaliacaoDeExposicao {
  const { leitura, novaEntradaUsd, tetoUsd } = args;
  if (!leitura.ok) {
    return { ok: false, motivo: "livro_ilegivel",
      porque: `nao deu para ler o livro de posicoes: ${leitura.porque} — `
        + "exposicao desconhecida nao autoriza entrada nova" };
  }
  const atual = calcularExposicaoUsd(leitura.posicoes);
  const depois = atual + (Number.isFinite(novaEntradaUsd) ? novaEntradaUsd : Number.NaN);
  if (!Number.isFinite(depois)) {
    return { ok: false, motivo: "teto_estourado",
      porque: "nocional da entrada nao mensuravel — sem medida nao ha como conferir teto" };
  }
  if (depois > tetoUsd) {
    return { ok: false, motivo: "teto_estourado",
      porque: `exposicao ${atual.toFixed(2)} + entrada ${novaEntradaUsd.toFixed(2)} `
        + `passa do teto ${tetoUsd} do modo de risco desta sessao` };
  }
  return { ok: true, exposicaoAtualUsd: atual, depoisUsd: depois, tetoUsd };
}
