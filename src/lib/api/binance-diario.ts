/**
 * FECHAMENTOS DIÁRIOS — uma definição, um lugar.
 *
 * ⚠️ POR QUE ISTO VIROU MÓDULO (Fase 8.2).
 *
 * Esta função existia copiada em `variancia/route.ts` e em `liquidez/route.ts`,
 * e a mesa de rotação seria a TERCEIRA cópia. A nota da Fase 5.1 argumentava
 * que a duplicação era aceitável porque "o que se repete é o ENDEREÇO, não uma
 * verdade" — e isso era defensável com duas cópias.
 *
 * Com três deixa de ser: a partir daqui, um conserto no tratamento de falha ou
 * na normalização do dia teria que ser lembrado em três arquivos, e a
 * invariante nº 7 do laboratório existe exatamente para isso — uma definição
 * por conceito, uma função, um lugar.
 *
 * ⚠️ O CONTRATO QUE NÃO PODE MUDAR: falha devolve mapa VAZIO com o status, e
 * nunca lança. Quem consome tem que conseguir distinguir "não medimos" de
 * "medimos zero" (invariante nº 6), e por isso a falha vem com o host e o
 * código, não como uma lista vazia anônima.
 */

/** Host público de dados da Binance — sem chave, sem estado de conta. */
export const BINANCE_DATA = "https://data-api.binance.vision";

export interface FechamentosDiarios {
  /** dia ISO (YYYY-MM-DD) → fechamento. Vazio quando a fonte recusou. */
  porDia: Map<string, number>;
  /** `host:status` quando não deu. Ausente em sucesso. */
  falha?: string;
}

export async function fetchFechamentosDiarios(
  symbol: string, desdeMs: number, ateMs: number,
): Promise<FechamentosDiarios> {
  const url = `${BINANCE_DATA}/api/v3/klines?symbol=${symbol}USDT&interval=1d`
    + `&startTime=${Math.floor(desdeMs)}&endTime=${Math.ceil(ateMs)}&limit=1000`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return { porDia: new Map(), falha: `binance ${symbol}:${res.status}` };
    const linhas = await res.json() as Array<[number, string, string, string, string, ...unknown[]]>;
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return { porDia: new Map(), falha: `binance ${symbol}: sem velas` };
    }
    const porDia = new Map<string, number>();
    for (const l of linhas) {
      const t = Number(l[0]); const fecha = parseFloat(l[4]);
      if (!(t > 0) || !Number.isFinite(fecha)) continue;
      porDia.set(new Date(t).toISOString().slice(0, 10), fecha);
    }
    return { porDia };
  } catch (e) {
    return { porDia: new Map(), falha: `binance ${symbol}:${String(e).slice(0, 60)}` };
  }
}
