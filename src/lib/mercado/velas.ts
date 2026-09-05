/**
 * AS VELAS QUE SÓ SE BUSCA UMA VEZ — a fase 0 da bancada do cliente.
 *
 * ⚠️⚠️ POR QUE ESTA CAMADA EXISTE, e por que ela é a PRIMEIRA coisa a existir.
 *
 * Um backtest desta casa não custa token: `benchmarks.ts` e `regime.ts` são
 * puros, sem chamada de modelo nenhuma. O que ele custa é **CPU e vela** — e a
 * vela era o problema.
 *
 * Hoje `fetchTimedCandles` guarda no cache de dados do Next com
 * `revalidate: 3600`, e essa chave inclui o `limit`. Dois clientes pedindo
 * janelas diferentes do MESMO símbolo erram o cache e fazem duas buscas. Com N
 * clientes, N buscas para o mesmo BTC — contra um limite por IP que os IPs de
 * saída da Vercel compartilham com o resto do mundo.
 *
 * ⚠️ E ISSO NÃO É HIPÓTESE. Em 31/08 a medição de piscinas disparou ~200
 * requisições em rajada e voltou com **56 de 62 leituras em 429**. A rodada
 * inteira não foi evidência sobre nada.
 *
 * **Vela de período FECHADO nunca muda.** Então ela se busca uma vez e se serve
 * para sempre: o milésimo backtest de BTC passa de mil buscas para zero, e o
 * custo marginal do teste vira só CPU.
 *
 * ⚠️ ESTE ARQUIVO É PURO — sem rede, sem banco. Quem fala com os dois é
 * `mercado/store.ts`. A separação é a mesma do resto da casa: a aritmética que
 * decide o que buscar precisa ser testável sem subir nada.
 */

/** Uma vela com o instante em que ela ABRIU (unix ms). */
export interface VelaComTempo {
  t: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Quanto dura cada intervalo, em ms.
 *
 * ⚠️ FECHADO DE PROPÓSITO. Um `Record` aberto aceitaria `"3d"` e devolveria
 * `undefined`, que viraria `NaN` na aritmética de fronteira — e uma vela nunca
 * fecharia. Intervalo desconhecido devolve `null`, e quem chama decide.
 */
export const DURACAO_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export function duracaoDoIntervaloMs(intervalo: string): number | null {
  const d = DURACAO_MS[intervalo];
  return typeof d === "number" && d > 0 ? d : null;
}

/**
 * Esta vela já FECHOU?
 *
 * ⚠️⚠️ É A INVARIANTE QUE SUSTENTA O CACHE INTEIRO. A vela do período corrente
 * muda a cada negócio: o `close` dela às 10h não é o `close` dela às 23h.
 * Gravar a vela de hoje seria servir o preço das 10h para sempre, e o backtest
 * de amanhã leria um dia que nunca existiu daquele jeito.
 *
 * Só vela fechada entra no banco. A corrente continua vindo da fonte, viva,
 * a cada chamada — é o único pedaço que não dá para cachear, e é barato porque
 * é UMA vela.
 */
export function velaFechada(t: number, intervalo: string, agoraMs: number): boolean {
  const d = duracaoDoIntervaloMs(intervalo);
  if (d == null) return false;
  if (!Number.isFinite(t) || !Number.isFinite(agoraMs)) return false;
  return t + d <= agoraMs;
}

/** O início da última vela FECHADA em `agoraMs`. `null` se o intervalo não existe. */
export function ultimaVelaFechada(intervalo: string, agoraMs: number): number | null {
  const d = duracaoDoIntervaloMs(intervalo);
  if (d == null || !Number.isFinite(agoraMs)) return null;
  // A vela corrente começou em floor(agora/d)*d; a última fechada é a anterior.
  return Math.floor(agoraMs / d) * d - d;
}

/**
 * O que já buscamos com sucesso, para um par (símbolo, intervalo).
 *
 * ⚠️⚠️ COBERTURA É O QUE FOI PERGUNTADO, NÃO O QUE VEIO.
 *
 * A tentação é deduzir buracos da ausência de vela: "não tenho a vela de 3 de
 * março, logo preciso buscar 3 de março". Isso re-busca **para sempre** todo dia
 * em que a fonte genuinamente não tem vela — feriado, par recém-listado, hora
 * sem negócio. O custo que esta camada existe para eliminar voltaria pela
 * porta dos fundos.
 *
 * Guardando a FAIXA perguntada, uma vela ausente dentro dela é ausência
 * medida — e a gente para de perguntar.
 */
export interface Cobertura {
  /** Menor `abriu_em` já coberto por uma busca bem-sucedida. */
  cobertoDe: number;
  /** Maior `abriu_em` já coberto. */
  cobertoAte: number;
  /**
   * ⚠️ A FONTE ACABOU antes de `cobertoDe` — ela não tem histórico mais antigo.
   *
   * Sem esta marca, todo backtest de um par listado há seis meses pediria dois
   * anos, receberia seis meses, e tentaria de novo na próxima. Para sempre.
   */
  fonteEsgotou: boolean;
}

/** Uma faixa a buscar, inclusiva nas duas pontas. */
export interface Faixa { de: number; ate: number }

/**
 * O que falta buscar para responder [desde, ate] — e nada além disso.
 *
 * ⚠️ O TETO É A ÚLTIMA VELA FECHADA, sempre. Pedir além dela traria a vela
 * corrente, que não pode ser gravada (ver `velaFechada`).
 */
export function oQueFaltaBuscar(
  cobertura: Cobertura | null,
  desde: number,
  ate: number,
  intervalo: string,
  agoraMs: number,
): Faixa[] {
  const fim = ultimaVelaFechada(intervalo, agoraMs);
  if (fim == null) return [];

  const alvoAte = Math.min(ate, fim);
  if (!Number.isFinite(desde) || !Number.isFinite(alvoAte) || desde > alvoAte) return [];

  // Nunca buscamos nada: a janela inteira.
  if (!cobertura) return [{ de: desde, ate: alvoAte }];

  const faltam: Faixa[] = [];

  /**
   * ⚠️ O LADO ANTIGO SÓ É BUSCADO SE A FONTE NÃO TIVER ACABADO. É esta linha
   * que impede a re-busca eterna do histórico que não existe.
   */
  if (desde < cobertura.cobertoDe && !cobertura.fonteEsgotou) {
    faltam.push({ de: desde, ate: cobertura.cobertoDe - 1 });
  }

  // O lado novo: o tempo sempre avança, então esta ponta reabre sozinha.
  if (alvoAte > cobertura.cobertoAte) {
    faltam.push({ de: cobertura.cobertoAte + 1, ate: alvoAte });
  }

  return faltam;
}

/**
 * Junta a cobertura antiga com o que a busca de fato trouxe.
 *
 * ⚠️⚠️ SÓ ESTENDE COM O QUE VEIO, NUNCA COM O QUE FOI PEDIDO (05/09).
 *
 * `fetchTimedCandles` faz `break` no primeiro erro e devolve o que já tinha
 * juntado — uma resposta PARCIAL indistinguível de uma completa. Se a cobertura
 * fosse estendida até o `ate` pedido, um 429 no meio da paginação viraria um
 * buraco permanente: a faixa ficaria marcada como coberta e as velas que
 * faltaram nunca mais seriam buscadas.
 *
 * Por isso a cobertura anda até a vela mais extrema que REALMENTE chegou.
 */
export function estenderCobertura(
  atual: Cobertura | null,
  trazidas: ReadonlyArray<{ t: number }>,
  /**
   * ⚠️ `true` só quando a FONTE disse que acabou — devolveu menos do que cabia
   * na página, não quando a busca falhou. Falha e fim de histórico são estados
   * diferentes, e confundi-los congela o histórico no ponto do erro.
   */
  fonteEsgotou = false,
): Cobertura | null {
  const ts = trazidas.map((v) => v.t).filter((t) => Number.isFinite(t));
  if (ts.length === 0) {
    // Nada veio: a cobertura não anda. Mas se a fonte AVISOU que acabou, isso
    // é informação e fica gravada.
    return atual ? { ...atual, fonteEsgotou: atual.fonteEsgotou || fonteEsgotou } : null;
  }
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  if (!atual) return { cobertoDe: min, cobertoAte: max, fonteEsgotou };
  return {
    cobertoDe: Math.min(atual.cobertoDe, min),
    cobertoAte: Math.max(atual.cobertoAte, max),
    fonteEsgotou: atual.fonteEsgotou || fonteEsgotou,
  };
}

/**
 * A fatia canônica: [desde, ate], em ordem cronológica.
 *
 * ⚠️⚠️ É ESTA FUNÇÃO QUE FAZ O CACHE VALER (§6.1 do plano). A busca é SEMPRE da
 * janela máxima; quem quer 90 dias e quem quer 2 anos leem o MESMO material e
 * cortam aqui, em memória. Se a busca acompanhasse o `limit` de cada cliente,
 * cada janela viraria uma chave diferente e o ganho evaporaria — que é
 * exatamente o defeito do cache de hoje.
 */
export function fatiar<T extends { t: number }>(
  velas: ReadonlyArray<T>, desde: number, ate: number,
): T[] {
  return velas
    .filter((v) => Number.isFinite(v.t) && v.t >= desde && v.t <= ate)
    .sort((a, b) => a.t - b.t);
}

/**
 * As N velas mais recentes até `ate` — a forma que o backtest pede.
 *
 * ⚠️ DEVOLVE O QUE TEM, e quem chama compara com o que pediu. Completar com
 * vela inventada, ou repetir a última, criaria histórico que não aconteceu; e
 * devolver vazio por faltar uma esconderia uma medição possível.
 */
export function ultimas<T extends { t: number }>(
  velas: ReadonlyArray<T>, n: number, ate: number,
): T[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  return fatiar(velas, -Infinity, ate).slice(-Math.floor(n));
}

/**
 * Quanto trabalho uma rodada custa — a régua da cota (§6.2 do plano).
 *
 * ⚠️ O TETO É TRABALHO, NÃO CONTAGEM. "Dez testes por dia" sozinho deixa um
 * free pedir 3 símbolos × 1 ano dez vezes e consumir mais que um trader
 * disciplinado. `símbolos × velas` é o que de fato custa CPU.
 */
export function custoDaRodada(simbolos: number, velasPorSimbolo: number): number {
  if (!Number.isFinite(simbolos) || !Number.isFinite(velasPorSimbolo)) return 0;
  return Math.max(0, Math.floor(simbolos)) * Math.max(0, Math.floor(velasPorSimbolo));
}
