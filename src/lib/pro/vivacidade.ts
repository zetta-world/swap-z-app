/**
 * ⚠️⚠️ O QUE O SELO DO TERMINAL PODE AFIRMAR — 08/09.
 *
 * O selo dizia, na dica de ferramenta, *"última vela há {N}s"* — e o `N` era a
 * idade da BUSCA, não a da vela. São coisas diferentes: o terminal repesca a
 * cada poucos segundos e recebe de volta a MESMA vela em formação. Num gráfico
 * de 1h, "última vela há 8s" é lido como "acabou de fechar uma vela" quando a
 * verdade pode ser "esta vela abriu há 52 minutos".
 *
 * É a mesma cicatriz do `velaEm` da bancada, aqui no terminal: um instante
 * verdadeiro sobre OUTRA coisa, exibido sob um rótulo que promete esta.
 *
 * ⚠️ E RESPOSTA VAZIA NÃO É VIDA. Um `200` com `candles: []` carimbava o selo
 * de verde igual: a fonte responde, e o gráfico está vazio. Quem olha vê
 * "AO VIVO" sobre nada desenhado.
 *
 * As duas idades continuam existindo porque as duas importam, e cada uma
 * responde a uma pergunta:
 *   - `fonteHaMs` — a fonte está respondendo? (é o que pinta o selo)
 *   - `velaHaMs`  — o dado desenhado é recente? (é o que a dica explica)
 */
import type { Timeframe } from "@/lib/api/geckoterminal";

/** Quanto tempo dura UMA vela de cada timeframe. */
export const DURACAO_MS: Record<Timeframe, number> = {
  "1m": 60_000, "5m": 300_000, "15m": 900_000,
  "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000,
};

/**
 * ⚠️ O ATRASO TOLERADO SEGUE O TIMEFRAME. Num gráfico de 1 dia, trinta segundos
 * sem resposta é normal; num de 1 minuto, é sintoma. Limite fixo daria falso
 * alarme num extremo e falso silêncio no outro.
 */
export const TOLERANCIA_MS: Record<Timeframe, number> = {
  "1m": 35_000, "5m": 65_000, "15m": 95_000, "1h": 185_000, "4h": 365_000, "1d": 905_000,
};

export interface LeituraDoGrafico {
  /** Quando a última busca voltou. `null` = nenhuma ainda. */
  buscaEmMs: number | null;
  /**
   * ABERTURA da última vela recebida, em ms. `null` = a fonte respondeu e não
   * veio vela nenhuma — que NÃO é o mesmo que "ainda não perguntei".
   *
   * ⚠️ É a abertura mesmo; a duração do timeframe é somada aqui dentro. Guardar
   * a abertura e exibi-la como se fosse o fechamento foi o defeito da bancada.
   */
  velaAbreEmMs: number | null;
}

export type Selo = "aguardando" | "sem_vela" | "ao_vivo" | "atrasado";

export interface Vivacidade {
  selo: Selo;
  /** Há quanto tempo a FONTE respondeu. `null` quando nunca respondeu. */
  fonteHaMs: number | null;
  /** Há quanto tempo a última vela FECHOU. `null` = não dá para saber. */
  velaHaMs: number | null;
  tetoMs: number;
}

export function vivacidadeDoGrafico(
  leitura: LeituraDoGrafico, tf: Timeframe, agoraMs: number,
): Vivacidade {
  const tetoMs = TOLERANCIA_MS[tf] ?? 60_000;

  // ⚠️ Ausência é ausência: nada chegou ainda não é "parado" nem "vivo".
  if (leitura.buscaEmMs == null) {
    return { selo: "aguardando", fonteHaMs: null, velaHaMs: null, tetoMs };
  }

  // ⚠️ Nunca negativo: relógio local contra carimbo local, mas um ajuste de
  // horário faria "respondeu daqui a 3s".
  const fonteHaMs = Math.max(0, agoraMs - leitura.buscaEmMs);

  /**
   * ⚠️ A IDADE É DO FECHAMENTO DA VELA, não da abertura. Uma vela de 1h aberta
   * agora tem idade NEGATIVA de fechamento — ela ainda está em formação, e o
   * `max(0, …)` a trata como fresquíssima, que é a verdade.
   */
  const velaHaMs = leitura.velaAbreEmMs == null
    ? null
    : Math.max(0, agoraMs - (leitura.velaAbreEmMs + (DURACAO_MS[tf] ?? 0)));

  // ⚠️ A fonte responder com a lista vazia não é vida: não há o que desenhar.
  if (leitura.velaAbreEmMs == null) {
    return { selo: "sem_vela", fonteHaMs, velaHaMs: null, tetoMs };
  }

  return { selo: fonteHaMs <= tetoMs ? "ao_vivo" : "atrasado", fonteHaMs, velaHaMs, tetoMs };
}
