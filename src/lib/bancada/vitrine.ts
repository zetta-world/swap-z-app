/**
 * OS NÚMEROS DA BANCADA NA VITRINE — lidos de `BANCADA_COTAS`, nunca digitados.
 *
 * ⚠️⚠️ A FASE 7 É GÊMEA DA 3, e este arquivo é a costura entre as duas. No dia
 * em que a cota entra no código, a vitrine tem de dizer a mesma coisa — senão é
 * a cicatriz do Free/ZION de novo: o card prometia cinco análises, o portão
 * devolvia 402, e cada lado sozinho estava coerente.
 *
 * ⚠️ Mudar um número em `BANCADA_COTAS` muda a página no mesmo commit, sem
 * ninguém lembrar de nada. É a mesma disciplina que `modeloDaVitrine()` impôs
 * ao nome do modelo, pelo mesmo motivo.
 */

import { BANCADA_COTAS, type Tier } from "@/lib/tier/types";

/**
 * Um valor em dólares, curto e DETERMINÍSTICO.
 *
 * ⚠️ SEM `toLocaleString`, de propósito. Ele formata conforme o ambiente, e o
 * servidor e o navegador podem discordar — hidratação quebrada por causa de um
 * ponto decimal é o tipo de defeito que só aparece em produção. `$25k` é igual
 * em toda máquina e em todo idioma.
 */
export function capitalCurto(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd >= 1_000_000) return `$${Math.round(usd / 1_000_000)}M`;
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k`;
  return `$${Math.round(usd)}`;
}

/** As variáveis que as strings `featBancada` e `featPapelAdiante` consomem. */
export function varsDaBancada(tier: Tier): Record<string, string | number> {
  const c = BANCADA_COTAS[tier];
  return {
    backtests: c.backtestsPorDia,
    capital: capitalCurto(c.capitalMaxUsd).replace("$", ""),
    mesas: c.mesasDePapel,
  };
}
