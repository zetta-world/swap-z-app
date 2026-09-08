/**
 * ⚠️⚠️ O CABEÇALHO DO TERMINAL DIZIA "24h" SOBRE 4 HORAS — 08/09.
 *
 * A rota devolve no máximo 250 velas (`getOHLCV(..., 250, ...)`), e 250 velas
 * NÃO são 24 horas em todo timeframe:
 *
 *     1m  →   4,2h        (o rótulo errava por 6×)
 *     5m  →  20,8h        ← o timeframe PADRÃO da tela
 *     15m →  62,5h        a partir daqui sobra janela
 *     1h  → 250h · 4h → 41 dias · 1d → 250 dias
 *
 * E o erro era MUDO das duas maneiras. A variação pegava a vela mais antiga
 * disponível quando não achava uma de 24h atrás (`first24 ? … : rows[0]`) — uma
 * substituição silenciosa —, e o volume somava `min(linhas, ticks24h)`, que com
 * 250 linhas é "tudo o que houver", chamado de "Vol 24h".
 *
 * A correção não é buscar mais vela: é a tela DIZER a janela que tem. Quem
 * opera num gráfico de 1 minuto e lê "+3,2% 24h" está lendo quatro horas — e
 * essa é uma diferença que muda decisão.
 */
import type { Candle, Timeframe } from "@/lib/api/geckoterminal";

/** Quanto tempo dura UMA vela de cada timeframe, em segundos. */
const SEGUNDOS_POR_VELA: Record<Timeframe, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3_600, "4h": 14_400, "1d": 86_400,
};

const H24 = 24 * 3_600;

export interface Janela {
  /** Quantas horas as velas em mãos realmente cobrem. `null` sem vela. */
  horasCobertas: number | null;
  /** A janela alcança 24h de verdade? É isto que autoriza o rótulo "24h". */
  cobre24h: boolean;
  /** Fechamento de referência da variação. `null` = não há de onde variar. */
  referencia: number | null;
  variacaoPct: number | null;
  maxima: number | null;
  minima: number | null;
  volume: number | null;
}

/**
 * ⚠️ A JANELA SAI DO TEMPO DAS VELAS, não da contagem delas. Uma fonte com
 * buraco (par sem negócio às 3h da manhã) devolve menos velas do que o período
 * sugere, e contar linhas diria uma janela maior do que a real.
 */
export function janelaDoCabecalho(rows: ReadonlyArray<Candle>, tf: Timeframe): Janela {
  const vazia: Janela = {
    horasCobertas: null, cobre24h: false, referencia: null,
    variacaoPct: null, maxima: null, minima: null, volume: null,
  };
  if (rows.length === 0) return vazia;

  const dur = SEGUNDOS_POR_VELA[tf] ?? 0;
  const primeira = rows[0];
  const ultima = rows[rows.length - 1];
  // ⚠️ `+ dur` porque `time` é a ABERTURA: a janela vai da abertura da primeira
  // ao FECHAMENTO da última. Sem isso, uma única vela de 1d "cobriria zero".
  const spanSeg = (ultima.time + dur) - primeira.time;
  const horasCobertas = spanSeg / 3_600;
  const cobre24h = spanSeg >= H24;

  /**
   * ⚠️ A REFERÊNCIA É A VELA DE 24h ATRÁS QUANDO ELA EXISTE, e a mais antiga
   * quando não existe — mas aí `cobre24h` é `false` e a tela TEM de dizer a
   * janela verdadeira. O defeito antigo era fazer a mesma substituição em
   * silêncio, sob o rótulo "24h".
   */
  const alvo = ultima.time - H24;
  let ref = primeira;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].time <= alvo) { ref = rows[i]; break; }
  }

  /**
   * ⚠️ `> alvo`, não `>=`: a vela que ABRE exatamente 24h atrás fechou 24h
   * atrás menos a duração dela — ela é a REFERÊNCIA da variação, não parte da
   * janela. Com `>=` o "Vol 24h" somava 24h + uma vela.
   */
  const dentro = cobre24h ? rows.filter((c) => c.time > alvo) : rows;

  return {
    horasCobertas,
    cobre24h,
    referencia: ref.close,
    // ⚠️ Referência zero ou negativa não vira divisão: `null` é "não dá para
    // calcular", e 0% diria "não mudou".
    variacaoPct: ref.close > 0 ? ((ultima.close - ref.close) / ref.close) * 100 : null,
    maxima: Math.max(...dentro.map((c) => c.high)),
    minima: Math.min(...dentro.map((c) => c.low)),
    volume: dentro.reduce((acc, c) => acc + c.volume, 0),
  };
}

/**
 * O rótulo honesto da janela: `"24h"` quando ela cobre 24h, e o tamanho real
 * quando não cobre.
 */
export function rotuloDaJanela(j: Janela): string {
  if (j.cobre24h) return "24h";
  if (j.horasCobertas == null) return "—";
  // Abaixo de 10h o decimal importa (4,2h ≠ 4h); acima, arredondar basta.
  return j.horasCobertas < 10
    ? `${j.horasCobertas.toFixed(1).replace(".", ",")}h`
    : `${Math.round(j.horasCobertas)}h`;
}
