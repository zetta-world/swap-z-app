/**
 * O REGIME DE TENDÊNCIA DE UMA BASE, para o motor de política.
 *
 * ⚠️ POR QUE ISTO EXISTE EM SEPARADO. `politica.ts` é PURA de propósito: os dois
 * canais têm de chamar a mesma função com o mesmo contrato, e uma função que
 * busca dado sozinha viraria "os dois chamam a mesma coisa com dados
 * diferentes". A busca fica aqui; a decisão, lá.
 *
 * ⚠️⚠️ E `null` É "NÃO MEDIDO", NUNCA "SEM TENDÊNCIA". Falha de rede, símbolo
 * desconhecido e mercado lateral são três coisas; a política trata a primeira
 * como recusa de entrada, que é a direção certa. Devolver `"RANGING"` numa
 * falha seria inventar uma medição.
 */

import { getMarketIndicators } from "@/lib/api/market-indicators";

export async function regimeDaBase(base: string): Promise<string | null> {
  const alvo = (base ?? "").toUpperCase();
  if (!alvo) return null;
  try {
    const r = await getMarketIndicators([alvo]);
    const ind = (r?.indicators ?? []).find(
      (i) => String(i.symbol ?? "").toUpperCase() === alvo);
    return ind?.regime ?? null;
  } catch {
    // ⚠️ Falha vira ausência, e ausência vira recusa de ENTRADA lá na política.
    return null;
  }
}
