import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * ⚠️⚠️ DCA SIMULADO E DCA REAL SÃO CAPACIDADES DIFERENTES — achado A112.
 *
 * Produção foi encontrada com:
 *
 *     dca_liberado        = "true"
 *     dca_liberado:motivo = "aberto em 25/08 para o primeiro teste SIMULADO — o"
 *
 * O interruptor foi aberto para testar SEM dinheiro, e o mesmo interruptor
 * libera o caminho REAL. A justificativa está escrita ao lado dele e ninguém
 * consegue lê-la a tempo: quem abre uma porta para um teste não está abrindo
 * para o dinheiro do cliente, mas o código não sabia a diferença.
 *
 * ⚠️ O MODO NO PAYLOAD NÃO BASTA, e o briefing diz isso com todas as letras.
 * Um plano real é criado com `modo: "real"`; se a capacidade não existir como
 * coisa separada, o único freio é a validação do campo — e validação de campo
 * não é controle de capacidade.
 *
 * ⚠️ REAL NASCE FECHADO. `dca_real_liberado` ausente = FECHADO, e ausência é o
 * estado de hoje: ninguém precisa desligar nada para o veredito NO-GO valer.
 */

export const CHAVE_DCA_SIMULADO = "dca_simulado_liberado";
export const CHAVE_DCA_REAL     = "dca_real_liberado";
export const CHAVE_MOTIVO_REAL  = "dca_real_liberado:motivo";

/**
 * ⚠️ A CHAVE ANTIGA CONTINUA SENDO LIDA — para o SIMULADO, e só.
 *
 * Migrar um interruptor apagando o antigo desligaria o que está ligado, sem
 * aviso, no meio de um teste em curso. `dca_liberado` passa a significar o que
 * a justificativa dele sempre disse: o simulado está aberto.
 *
 * Ela NUNCA é consultada para o caminho real. É este parágrafo que separa as
 * duas capacidades, e `capacidade.test.ts` trava que ele continua verdade.
 */
export const CHAVE_LEGADA_SIMULADO = "dca_liberado";

export type ModoDoPlano = "simulado" | "real";

export type CausaDaCapacidade =
  | "aberto"
  | "fechado_por_decisao"
  | "sem_registro"
  | "indisponivel";

export interface EstadoDasCapacidades {
  /** O valor bruto de `dca_simulado_liberado`, ou da chave legada. */
  simulado: string | null | undefined;
  /** O valor bruto de `dca_real_liberado`. `undefined` = não deu para ler. */
  real: string | null | undefined;
}

export interface VereditoDaCapacidade {
  permitido: boolean;
  causa: CausaDaCapacidade;
}

/**
 * A capacidade exigida por ESTE plano está aberta?
 *
 * ⚠️ PURA DE PROPÓSITO, como as irmãs desta casa: é decisão sobre um estado
 * lido, e ela precisa ser exercitável sem banco.
 *
 * ⚠️ `undefined` (não deu para ler) é FECHADO, e com causa própria. Colapsar
 * `indisponivel` em `fechado_por_decisao` transformaria uma falha de
 * infraestrutura em "o dono não liberou", e ninguém iria olhar o banco.
 */
export function decidirCapacidade(
  modo: ModoDoPlano, estado: EstadoDasCapacidades,
): VereditoDaCapacidade {
  const bruto = modo === "real" ? estado.real : estado.simulado;
  if (bruto === undefined) return { permitido: false, causa: "indisponivel" };
  if (bruto === null)      return { permitido: false, causa: "sem_registro" };
  if (bruto === "true")    return { permitido: true,  causa: "aberto" };
  return { permitido: false, causa: "fechado_por_decisao" };
}

/**
 * Lê as duas capacidades do `admin_kv`.
 *
 * ⚠️ UMA IDA AO BANCO PARA AS DUAS, e `undefined` quando a leitura falha — é o
 * que faz `decidirCapacidade` distinguir "o dono fechou" de "não consegui
 * olhar". Devolver `null` nos dois casos devolveria o defeito que este módulo
 * existe para não ter.
 */
export async function lerCapacidades(
  db: SupabaseClient<Database> | null,
): Promise<EstadoDasCapacidades> {
  if (!db) return { simulado: undefined, real: undefined };
  try {
    const { data, error } = await db.from("admin_kv")
      .select("key, value")
      .in("key", [CHAVE_DCA_SIMULADO, CHAVE_LEGADA_SIMULADO, CHAVE_DCA_REAL]);
    if (error) return { simulado: undefined, real: undefined };
    const linhas = data ?? [];
    const achar = (k: string) => {
      const r = linhas.find((x) => x.key === k);
      return r === undefined ? null : (r.value ?? null);
    };
    /**
     * ⚠️ A CHAVE NOVA MANDA; a legada é o fallback do SIMULADO. Um teste em
     * curso não pode ser desligado pela chegada desta migração — mas quem
     * escrever a chave nova passa a mandar, e a legada some com o tempo.
     */
    const nova = achar(CHAVE_DCA_SIMULADO);
    return {
      simulado: nova !== null ? nova : achar(CHAVE_LEGADA_SIMULADO),
      /** ⚠️ O REAL NÃO TEM FALLBACK. Ausente = fechado, e é o estado de hoje. */
      real: achar(CHAVE_DCA_REAL),
    };
  } catch {
    return { simulado: undefined, real: undefined };
  }
}
