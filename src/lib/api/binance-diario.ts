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

/** Uma vela diária completa. `dia` é ISO curto (YYYY-MM-DD). */
export interface VelaDiaria {
  dia: string;
  abre: number;
  alta: number;
  baixa: number;
  fecha: number;
}

export interface VelasDiarias {
  velas: VelaDiaria[];
  /** `host:status` quando não deu. Ausente em sucesso. */
  falha?: string;
}

/**
 * ⚠️ O TETO DA BINANCE É 1.000 VELAS POR CHAMADA — e isso é uma TRUNCAGEM
 * SILENCIOSA, não um erro (14/08).
 *
 * Mil velas diárias são 2 anos e 9 meses. Pedir dez anos com `limit=1000`
 * devolve 200 OK, uma lista bem formada, e **os 2,7 anos mais antigos da
 * janela** — sem nada indicando que o resto ficou de fora. É exatamente a forma
 * do teto de 1.000 linhas do PostgREST que já vazou capital das carteiras de
 * papel em 01/08: um limite do transporte lido como se fosse o tamanho do
 * mundo.
 *
 * O walk-forward é a leitura que mais sofreria: menos velas = menos dobras, e
 * poucas dobras é justamente o disfarce que ele existe para desmascarar.
 */
const TETO_POR_CHAMADA = 1000;
/** Guarda contra laço infinito se a fonte devolver sempre a mesma página. */
const MAX_PAGINAS = 20;

/**
 * Velas diárias completas, PAGINADAS até cobrir a janela pedida.
 *
 * Contrato idêntico ao dos fechamentos: falha devolve lista VAZIA com o motivo,
 * e **nunca lança**. Quem consome precisa distinguir "não medimos" de "medimos
 * zero" (invariante nº 6).
 *
 * ⚠️ PÁGINA PARCIAL ENCERRA A BUSCA. Menos que o teto quer dizer que a fonte
 * chegou ao fim do que tem; continuar pedindo devolveria vazio para sempre.
 *
 * ⚠️ E O SUCESSO PARCIAL É SUCESSO. Se a primeira página vem e a terceira
 * falha, devolvemos o que veio COM o motivo preenchido — em vez de jogar fora
 * dois anos de dado bom por causa de um 429. Quem lê decide se a janela que
 * sobrou serve.
 */
export async function fetchVelasDiarias(
  symbol: string, desdeMs: number, ateMs: number,
): Promise<VelasDiarias> {
  const velas: VelaDiaria[] = [];
  const vistos = new Set<string>();
  let cursor = Math.floor(desdeMs);
  const fim = Math.ceil(ateMs);

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    if (cursor > fim) break;
    const url = `${BINANCE_DATA}/api/v3/klines?symbol=${symbol}USDT&interval=1d`
      + `&startTime=${cursor}&endTime=${fim}&limit=${TETO_POR_CHAMADA}`;
    let linhas: Array<[number, string, string, string, string, ...unknown[]]>;
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        return { velas, falha: `binance ${symbol}:${res.status}` };
      }
      linhas = await res.json() as typeof linhas;
    } catch (e) {
      return { velas, falha: `binance ${symbol}:${String(e).slice(0, 60)}` };
    }
    if (!Array.isArray(linhas) || linhas.length === 0) break;

    let ultimoT = cursor;
    for (const l of linhas) {
      const t = Number(l[0]);
      const abre = parseFloat(l[1]), alta = parseFloat(l[2]);
      const baixa = parseFloat(l[3]), fecha = parseFloat(l[4]);
      if (!(t > 0)) continue;
      ultimoT = Math.max(ultimoT, t);
      if (![abre, alta, baixa, fecha].every(Number.isFinite)) continue;
      const dia = new Date(t).toISOString().slice(0, 10);
      // Páginas consecutivas podem repetir a vela da borda; a data é a chave.
      if (vistos.has(dia)) continue;
      vistos.add(dia);
      velas.push({ dia, abre, alta, baixa, fecha });
    }
    if (linhas.length < TETO_POR_CHAMADA) break;   // fonte esgotou a janela
    cursor = ultimoT + 86_400_000;                 // próxima vela, sem sobrepor
  }

  if (velas.length === 0) return { velas, falha: `binance ${symbol}: sem velas` };
  velas.sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
  return { velas };
}

/**
 * Fechamentos diários.
 *
 * ⚠️ Deriva de `fetchVelasDiarias` de propósito: com duas buscas separadas, uma
 * correção de paginação ou de tratamento de falha precisaria ser lembrada em
 * dois lugares — e foi para não ter duas que este módulo nasceu (invariante
 * nº 7). O contrato de saída não mudou.
 */
export async function fetchFechamentosDiarios(
  symbol: string, desdeMs: number, ateMs: number,
): Promise<FechamentosDiarios> {
  const r = await fetchVelasDiarias(symbol, desdeMs, ateMs);
  const porDia = new Map<string, number>();
  for (const v of r.velas) porDia.set(v.dia, v.fecha);
  if (porDia.size === 0) return { porDia, falha: r.falha ?? `binance ${symbol}: sem velas` };
  return r.falha ? { porDia, falha: r.falha } : { porDia };
}
