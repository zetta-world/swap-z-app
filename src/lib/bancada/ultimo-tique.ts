/**
 * O QUE O AGENTE ACABOU DE FAZER — e há quanto tempo.
 *
 * ⚠️⚠️ ESTE MÓDULO EXISTE POR UMA FRASE DO DONO (07/09), logo depois de
 * contratar a FREYJA: *"ao contratar o agente deveria aparecer aí no próprio
 * agente, as informações e resultados em tempo real"*.
 *
 * O card sabia dizer "esperando setup". É verdade e é inútil, porque não separa
 * as três coisas que o investidor precisa distinguir:
 *
 *   1. VERIFICOU e ficou de fora — e existe um motivo, que é a mesa trabalhando;
 *   2. AINDA NÃO VERIFICOU — contratado há 3 minutos, e o cron é de 30;
 *   3. QUEBRADO — parou de tickar e ninguém sabe.
 *
 * As três desenhavam a mesma tela. É a mesma família do Maker de Faixa, que
 * ficou dois dias sem abrir posição sem ninguém notar — e ali éramos NÓS, com
 * acesso ao banco.
 *
 * ⚠️ E NADA AQUI É "AO VIVO". O preço guardado é o fechamento da última vela que
 * o cron leu, e a idade dele viaja junto, sempre. Um número sem a idade cria a
 * expectativa de cotação — que esta bancada não tem e não promete.
 *
 * ⚠️ PURO: o vitest desta base roda em `environment: "node"`.
 */

/** O que o tique viu num símbolo. */
export interface VistoNoSimbolo {
  /** Fechamento da última vela lida. `null` = o tique não conseguiu ler. */
  preco: number | null;
  /**
   * Por que NÃO abriu. `null` quando abriu.
   *
   * ⚠️ É o motivo do SELETOR ("EMA50 acima do preço"), não uma frase nossa:
   * ficar de fora é a decisão na maior parte do tempo, e o investidor tem
   * direito de ver qual regra o segurou.
   */
  motivo: string | null;
  abriu: boolean;
}

export interface UltimoTique {
  /** Unix ms de quando o cron passou por esta instância. */
  em: number;
  simbolos: Record<string, VistoNoSimbolo>;
}

function numeroOuNulo(v: unknown): number | null {
  // ⚠️ `Number(null)` é 0 e passa em `isFinite`. Um preço zero na tela do
  // investidor é pior que um traço: ele parece medido.
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Lê a coluna `ultimo_tique` (jsonb, portanto `unknown`).
 *
 * ⚠️ `null` = NUNCA FOI VERIFICADA, e é um estado legítimo — toda instância
 * passa por ele nos primeiros 30 minutos. Devolver um objeto vazio no lugar
 * faria a tela dizer "verificado, nada encontrado" sobre algo que não foi
 * verificado.
 */
export function lerUltimoTique(v: unknown): UltimoTique | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const em = numeroOuNulo(o.em);
  if (em == null || em <= 0) return null;

  const simbolos: Record<string, VistoNoSimbolo> = {};
  const cru = o.simbolos;
  if (cru != null && typeof cru === "object") {
    for (const [k, val] of Object.entries(cru as Record<string, unknown>)) {
      const s = (val ?? {}) as Record<string, unknown>;
      simbolos[k] = {
        preco: numeroOuNulo(s.preco),
        motivo: typeof s.motivo === "string" && s.motivo.length > 0 ? s.motivo : null,
        abriu: s.abriu === true,
      };
    }
  }
  return { em, simbolos };
}

/**
 * ⚠️ O CRON ANDA DE 30 EM 30 MINUTOS — a mesma cadência de `papel.ts`. Vive
 * aqui de novo? Não: quem quiser o número importa de lá. Este módulo só recebe.
 */
export type Saude = "nunca_verificado" | "em_dia" | "atrasado";

/**
 * A instância está sendo verificada como devia?
 *
 * ⚠️⚠️ TRÊS ESTADOS, e o terceiro é o que faltava. `atrasado` é o que separa
 * "a mesa está quieta" de "a mesa parou" — e sem ele o investidor não tem como
 * saber que o cron morreu. Ele é o alarme que a casa teria querido ter quando o
 * Maker de Faixa ficou dois dias mudo.
 *
 * ⚠️ A TOLERÂNCIA É DE DOIS CICLOS, não de um. Um tique pode atrasar por
 * disputa de teto de trabalho (`aVezDeQuem`) sem nada estar errado; gritar no
 * primeiro atraso ensinaria a ignorar o aviso.
 */
export function saudeDoTique(
  t: UltimoTique | null, cadenciaMs: number, agoraMs: number,
): Saude {
  if (t == null) return "nunca_verificado";
  return agoraMs - t.em > cadenciaMs * 2 ? "atrasado" : "em_dia";
}

/**
 * Quanto falta, em % do preço atual, para o alvo e para o stop.
 *
 * ⚠️⚠️ ESTA CONTA É O "TEMPO REAL" QUE O DONO PEDIU: com a posição aberta a
 * 118.733 e o último preço em 121.750, o investidor quer ler "faltam 0,4% para
 * o alvo", não recalcular de cabeça a partir de quatro números soltos.
 *
 * ⚠️ SEM PREÇO, DEVOLVE `null` — nunca 0. Zero aqui diria "chegou no alvo".
 *
 * ⚠️ E O SINAL É RELATIVO AO LADO. Numa venda o alvo está ABAIXO da entrada;
 * uma conta que assuma compra mostraria a distância com o sinal trocado, e o
 * investidor leria "faltam 2%" para um alvo que já passou.
 */
export function distanciaAte(
  p: {
    lado: "long" | "short";
    entrada: number;
    alvoPct: number | null;
    stopPct: number | null;
  },
  precoAtual: number | null,
): { alvoPct: number | null; stopPct: number | null; abertoPct: number | null } {
  if (precoAtual == null || !(precoAtual > 0) || !(p.entrada > 0)) {
    return { alvoPct: null, stopPct: null, abertoPct: null };
  }
  const dir = p.lado === "long" ? 1 : -1;
  // Quanto a posição já rendeu, em % da entrada, no sentido do lado.
  const abertoPct = ((precoAtual - p.entrada) / p.entrada) * 100 * dir;
  return {
    // ⚠️ `Math.max(0, ...)`: distância negativa significaria que o alvo já foi
    // ultrapassado sem a posição ter fechado — o que só acontece entre o toque
    // e o próximo tique. Mostrar "faltam −0,3%" seria ruído; zero é a verdade
    // legível ("está no alvo, fecha no próximo tique").
    alvoPct: p.alvoPct == null ? null : Math.max(0, p.alvoPct - abertoPct),
    stopPct: p.stopPct == null ? null : Math.max(0, p.stopPct + abertoPct),
    abertoPct,
  };
}
