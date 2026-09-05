/**
 * A COR DO RESULTADO NA UI DO CLIENTE — a REGRA do admin, nunca o CSS dele.
 *
 * ⚠️⚠️ `corDoResultado` devolve `var(--adm-green)`, `var(--adm-red)`,
 * `var(--adm-ink-3)`. Essas variáveis são do TERMINAL ADMIN e não existem nesta
 * árvore — importá-las aqui pintaria tudo de transparente numa tela em que a
 * cor É a mensagem, e ninguém veria o defeito num teste de tipo.
 *
 * ⚠️ O QUE ATRAVESSA É A CLASSIFICAÇÃO, e ela atravessa inteira:
 *
 *   · perdeu dinheiro           → VERMELHO, sempre. Bater o índice não salva.
 *   · ganhou dinheiro E o índice → VERDE
 *   · ganhou e PERDEU do índice  → ÂMBAR (o caso que um booleano não diz)
 *   · sem dado                   → CINZA, nunca vermelho
 *
 * A cicatriz: a grade perdeu METADE DO CAPITAL e o número saiu VERDE, porque
 * perdeu menos que segurar. O veredito já estava certo; só a cor ficou para
 * trás — e o olho vai no número grande colorido, não no parágrafo.
 */

import type { ClasseResultado } from "@/lib/admin/cor-resultado";

export const COR_DO_CLIENTE: Record<ClasseResultado, string> = {
  ganhou:          "text-green",
  perdeu:          "text-red",
  so_perdeu_menos: "text-gold",
  sem_dado:        "text-ink-3",
};

/**
 * ⚠️ AMOSTRA FRACA NÃO GANHA COR DE VEREDITO — nem a de "sem dado", que diria
 * "não medimos". O número existe, é legível, e sai sem autoridade: é a única
 * forma de dizer "ainda não sei" sem mentir para nenhum dos dois lados.
 */
export function corDoNumero(classe: ClasseResultado, pinta: boolean): string {
  return pinta ? COR_DO_CLIENTE[classe] : "text-ink-2";
}
