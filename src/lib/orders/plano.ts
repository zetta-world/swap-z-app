import { toBaseUnits, fromBaseUnits } from "@/lib/format";

/**
 * O PLANO DE UMA ORDEM PARCELADA (DCA / TWAP) — a aritmética, em função pura.
 * (auditoria do setor LIMIT/DCA, 24/08)
 *
 * ⚠️⚠️ POR QUE ISTO SAIU DE DENTRO DO COMPONENTE.
 *
 * A conta vivia numa linha do `OrdersView.tsx`:
 *
 *     (a / parseInt(intervals || "1")).toFixed(2)
 *
 * e produzia, com o botão HABILITADO e o resultado salvo como texto no card:
 *
 *   · ciclos "0"    → "$Infinity por ciclo"
 *   · ciclos "-5"   → "$-200.00 por ciclo"
 *   · ciclos "0.5"  → "$Infinity"          (`parseInt` trunca para 0)
 *   · ciclos "1.9"  → "$1000.00"           e o resumo ainda dizia "1.9 ciclos"
 *   · ciclos "1e9"  → "$1000.00"           (`parseInt` PARA no "e")
 *   · ciclos ""     → "$1000.00"           e o resumo dizia "· ciclos"
 *
 * Medido, não inferido: o campo é `type="number"` SEM `min` e SEM `step`, então
 * negativo, fracionário e notação exponencial entram pelo teclado.
 *
 * ⚠️ O RESUMO SE CONTRADIZIA SOZINHO. O "por ciclo" saía do valor parseado e o
 * "ciclos" do texto CRU — daí "$1000.00 por ciclo · 1e9 ciclos" na mesma frase.
 * Por isso `lerCiclos` devolve o número JÁ NORMALIZADO, e quem exibe usa esse,
 * nunca o que o usuário digitou.
 */

/** Por que um valor de ciclos foi recusado. A tela mostra o motivo, não some. */
export type MotivoCiclos =
  | "vazio"        // nada digitado
  | "nao_inteiro"  // "1.9", "0.5" — meio ciclo não existe
  | "menor_que_um" // "0", "-5"
  | "acima_do_teto";

/**
 * ⚠️ TETO DE 365. Não é gosto: `porCiclo` divide, e um plano de um milhão de
 * ciclos devolve zero por ciclo — que é uma ordem que não compra nada, exibida
 * como se fosse válida. Um ano de parcelas diárias cobre qualquer uso real.
 */
export const MAX_CICLOS = 365;

export function lerCiclos(bruto: string | null | undefined): { ok: true; ciclos: number } | { ok: false; motivo: MotivoCiclos } {
  const s = String(bruto ?? "").trim();
  if (s === "") return { ok: false, motivo: "vazio" };
  // ⚠️ Regex e não `parseInt`: o `parseInt` aceita "1e9" devolvendo 1, e
  // aceita "12abc" devolvendo 12. Os dois passam calados.
  // "1.9" e "0.5" são meio ciclo; "1e9" e "12abc" são lixo. Os dois casos
  // param aqui, e a tela diz qual foi.
  if (!/^-?\d+$/.test(s)) return { ok: false, motivo: "nao_inteiro" };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) {
    return { ok: false, motivo: n >= 1 ? "acima_do_teto" : "menor_que_um" };
  }
  if (n > MAX_CICLOS) return { ok: false, motivo: "acima_do_teto" };
  return { ok: true, ciclos: n };
}

/**
 * Quanto vai em CADA ciclo, como string na unidade do token de origem.
 *
 * ⚠️ DIVISÃO EM INTEIRO, NÃO EM `Number`. Reusa os primitivos que a auditoria
 * da ponte deixou (`toBaseUnits`/`fromBaseUnits`, em string) — não porque a
 * divisão aqui movesse dinheiro sozinha, mas porque este número VAI PARA O
 * SWAP CARD, e é onde o usuário assina. Duas convenções de conversão no mesmo
 * caminho é como a ponte quebrou.
 *
 * Devolve `null` quando não há plano — e `null` é "não sei", que a tela mostra
 * como campo vazio em vez de `$0.00`, pelo mesmo motivo de sempre.
 */
export function porCiclo(totalBruto: string | null | undefined, ciclos: number, decimais = 18): string | null {
  if (!Number.isSafeInteger(ciclos) || ciclos < 1) return null;
  if (!Number.isInteger(decimais) || decimais < 0 || decimais > 36) return null;
  const base = toBaseUnits(totalBruto, decimais);
  if (base === "0") return null;
  const porParcela = BigInt(base) / BigInt(ciclos);
  // ⚠️ Divisão inteira TRUNCA. Um total que não divide certo deixa poeira para
  // trás — e é melhor sobrar do que faltar: pedir mais do que o orçamento no
  // último ciclo seria a tela gastando dinheiro que o dono não autorizou.
  if (porParcela <= 0n) return null;
  return aparar(fromBaseUnits(porParcela, decimais));
}

/** Tira zeros à direita que só poluem: "0.0830000…" → "0.083". */
function aparar(s: string): string {
  if (!s.includes(".")) return s;
  const limpo = s.replace(/0+$/, "").replace(/\.$/, "");
  return limpo === "" ? "0" : limpo;
}

/**
 * O que sobrou por não dividir exato. `null` quando não sobra nada.
 *
 * ⚠️ Existe para a tela PODER DIZER. Truncar e calar é a invariante nº 33:
 * o dono somaria os ciclos, veria menos que o orçamento, e não saberia se
 * perdeu dinheiro ou se a conta é assim.
 */
export function sobra(totalBruto: string | null | undefined, ciclos: number, decimais = 18): string | null {
  if (!Number.isSafeInteger(ciclos) || ciclos < 1) return null;
  const base = toBaseUnits(totalBruto, decimais);
  if (base === "0") return null;
  const resto = BigInt(base) % BigInt(ciclos);
  return resto === 0n ? null : aparar(fromBaseUnits(resto, decimais));
}
