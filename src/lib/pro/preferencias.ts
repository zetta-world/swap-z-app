/**
 * AS PREFERÊNCIAS DO TERMINAL — o que sobrevive ao refresh.
 *
 * ⚠️ POR QUE ISTO É "PRO" E NÃO ENFEITE. Quem usa o terminal de verdade liga os
 * mesmos três indicadores, no mesmo timeframe, no mesmo par, toda vez que abre.
 * Refazer isso a cada carga é o que separa uma demonstração de uma ferramenta.
 *
 * ⚠️⚠️ E TUDO AQUI FALHA ABERTO. `localStorage` lança em aba privada, com o
 * armazenamento cheio, ou quando a política do navegador barra site data — e um
 * terminal que morre porque não conseguiu lembrar qual indicador estava ligado
 * seria um defeito muito pior que o problema que ele resolve. Toda leitura e
 * toda escrita são embrulhadas; falha vira o padrão, nunca uma tela quebrada.
 */

const CHAVE = "zswap.pro.prefs.v1";

/**
 * ⚠️ VERSÃO NA CHAVE, e não é burocracia. O formato vai mudar — indicador novo,
 * par renomeado — e uma preferência antiga lida como se fosse do formato novo
 * ligaria coisas erradas na tela de quem já usava. Trocar `v1` por `v2`
 * descarta o que não se sabe ler, que é a leitura honesta.
 */
export interface PreferenciasPro {
  pairId?:   string;
  tf?:       string;
  kind?:     string;
  /** Indicadores ligados, por nome. Lista, e não um objeto de booleanos. */
  ligados?:  string[];
}

/**
 * ⚠️ A LISTA É FECHADA. Um nome que não está aqui é DESCARTADO na leitura, e a
 * razão é a mesma de sempre nesta casa: dado de fora não vira estado de dentro
 * sem passar por uma porta. Sem isso, qualquer chave gravada por uma versão
 * futura (ou por alguém mexendo no console) viraria indicador ligado.
 */
export const INDICADORES = [
  "ma", "ema", "bb", "vwap", "ema9", "ema21", "ema100", "ema200", "rsi", "macd", "stochRsi",
] as const;
export type Indicador = (typeof INDICADORES)[number];

const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"];
const KINDS = ["candle", "bar", "line"];

/** Lê o que dá para ler. Qualquer falha ou sujeira devolve `{}`. */
export function lerPreferencias(bruto: string | null | undefined): PreferenciasPro {
  if (!bruto) return {};
  try {
    const o = JSON.parse(bruto) as Record<string, unknown>;
    if (!o || typeof o !== "object") return {};
    const out: PreferenciasPro = {};
    if (typeof o.pairId === "string" && o.pairId.length > 0 && o.pairId.length < 80) out.pairId = o.pairId;
    if (typeof o.tf === "string" && TIMEFRAMES.includes(o.tf)) out.tf = o.tf;
    if (typeof o.kind === "string" && KINDS.includes(o.kind)) out.kind = o.kind;
    if (Array.isArray(o.ligados)) {
      const validos = o.ligados.filter(
        (x): x is Indicador => typeof x === "string" && (INDICADORES as readonly string[]).includes(x));
      out.ligados = [...new Set(validos)];
    }
    return out;
  } catch {
    /**
     * ⚠️ JSON QUEBRADO NÃO DERRUBA A TELA. Devolver `{}` é abrir com o padrão —
     * o mesmo resultado de nunca ter salvado nada, que é exatamente o certo.
     */
    return {};
  }
}

export function escreverPreferencias(p: PreferenciasPro): string {
  return JSON.stringify({
    pairId: p.pairId, tf: p.tf, kind: p.kind,
    ligados: [...new Set(p.ligados ?? [])].filter((x) => (INDICADORES as readonly string[]).includes(x)),
  });
}

/** ⚠️ Toda a interação com o navegador em um lugar só, e toda ela protegida. */
export function carregar(): PreferenciasPro {
  try {
    return lerPreferencias(globalThis.localStorage?.getItem(CHAVE));
  } catch {
    return {};
  }
}

export function salvar(p: PreferenciasPro): void {
  try {
    globalThis.localStorage?.setItem(CHAVE, escreverPreferencias(p));
  } catch {
    /* aba privada, cota cheia, política do navegador — o terminal segue igual */
  }
}
