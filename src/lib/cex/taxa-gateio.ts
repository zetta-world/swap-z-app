/**
 * A TAXA REAL DA CORRETORA versus a que o laboratório SUPÕE.
 *
 * ⚠️ POR QUE ISTO EXISTE (15/08) — P0 do plano fechado com a Luna.
 *
 * Todo resultado direcional deste laboratório é líquido de um custo que **nós
 * escolhemos**:
 *
 *     const COST_PCT = Number(process.env.BACKTEST_COST_PCT ?? 0.2);
 *
 * 0,2% por perna, constante, em `paper/engine.ts`, `zion/cull.ts`,
 * `zion/benchmarks.ts` e nos módulos do laboratório. Quando o veredito diz "o
 * custo matou a borda", em boa parte das medições isso é uma **premissa
 * embutida na simulação**, não uma observação do mundo.
 *
 * Isso não é detalhe: a Grade reprovou com custo de 54,27%; a LP e a DEX↔CEX
 * ficaram positivas por margens (0,82% e 0,019%) menores que a incerteza do
 * próprio custo. Se a premissa estiver errada em qualquer direção, três
 * vereditos mudam.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ O QUE ESTA MEDIÇÃO RESPONDE, E O QUE ELA NÃO RESPONDE.
 *
 * RESPONDE: a taxa PUBLICADA do par na Gate.io está na mesma ordem de grandeza
 * do que o modelo assume?
 *
 * NÃO RESPONDE:
 *
 *  1. **A nossa taxa efetiva.** Nível VIP e desconto por pontos mudam o número
 *     e só aparecem numa consulta AUTENTICADA à conta. Como não há nenhuma
 *     sessão de autopilot ativa (`autopilot_sessions` tem 0 linhas), esse dado
 *     é **DESCONHECIDO** hoje.
 *  2. **Maker ou taker.** O campo público `fee` de `currency_pairs` não separa
 *     os dois. A separação vive em `/wallet/fee`, que exige chave.
 *  3. **Derrapagem.** Não é taxa e não está aqui. O modelo de 0,2% precisa
 *     cobrir taxa E impacto de preço; esta medição só mede a primeira parcela.
 *
 * ⚠️ A LEITURA QUE IMPORTA É A SOBRA, não a taxa. Se a taxa publicada consome
 * quase todo o orçamento de 0,2%, o modelo não tem com que pagar a derrapagem —
 * e aí os resultados do laboratório são OTIMISTAS, não conservadores. Foi
 * exatamente essa a descoberta no lado DEX: o 0x cobra 0,15%, sobrando 0,05
 * ponto para impacto e gás.
 */

/** Host público da Gate.io — sem chave, sem estado de conta. */
export const GATEIO_API = "https://api.gateio.ws/api/v4";

export interface TaxaDoPar {
  /** Par no formato da Gate.io, ex. `BTC_USDT`. */
  par: string;
  /** Símbolo base, em maiúscula. */
  simbolo: string;
  /** Taxa publicada do par, em % (ex.: 0,2). */
  taxaPct: number;
}

export interface ComparacaoCusto {
  /** O que o laboratório assume por perna, em %. */
  modeloPorPernaPct: number;
  /** Mediana das taxas publicadas dos pares consultados, em %. */
  taxaPublicadaPct: number | null;
  /**
   * `modelo − taxa`. É o que sobra, dentro do orçamento do modelo, para pagar
   * derrapagem e qualquer outro custo. **Negativo = o modelo já é insuficiente
   * só com a taxa.**
   */
  sobraParaDerrapagemPct: number | null;
  /** Quantos pares responderam. Sem isto o número não pode ser julgado. */
  pares: number;
  /** Leitura em português, para a tela. */
  veredito: string;
}

/**
 * ⚠️ MEDIANA, NÃO MÉDIA. A Gate.io publica taxas diferentes por par, e um par
 * exótico com taxa alta puxaria a média para um número que nenhuma mesa paga.
 * A mediana descreve o par típico, que é o que as mesas operam.
 */
export function medianaDeTaxas(taxas: readonly number[]): number | null {
  const validas = taxas.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  if (validas.length === 0) return null;
  const meio = Math.floor(validas.length / 2);
  return validas.length % 2 === 1
    ? validas[meio]
    : (validas[meio - 1] + validas[meio]) / 2;
}

/**
 * Compara o que a corretora publica com o que o laboratório assume.
 *
 * ⚠️ O VEREDITO FALA DA SOBRA, e não de "o modelo está certo ou errado".
 * Nenhuma dessas comparações prova que o modelo está correto — ela só diz se
 * ele é *possível*. Um modelo que não cobre nem a taxa é impossível; um que
 * cobre a taxa e deixa sobra ainda pode ser insuficiente para a derrapagem, e
 * isso esta medição não alcança.
 */
export function compararCusto(
  taxas: readonly TaxaDoPar[],
  modeloPorPernaPct: number,
): ComparacaoCusto {
  const mediana = medianaDeTaxas(taxas.map((t) => t.taxaPct));
  const base = { modeloPorPernaPct, taxaPublicadaPct: mediana, pares: taxas.length };

  if (mediana === null) {
    return {
      ...base, sobraParaDerrapagemPct: null,
      veredito: "nenhum par respondeu — a fonte recusou, e isto NÃO é o mesmo que "
        + "taxa zero. Sem dado, o modelo continua sem calibração.",
    };
  }

  const sobra = modeloPorPernaPct - mediana;

  if (sobra < 0) {
    return {
      ...base, sobraParaDerrapagemPct: sobra,
      veredito: `⚠️ O MODELO É INSUFICIENTE SÓ COM A TAXA. A corretora publica `
        + `${mediana.toFixed(3)}% e o laboratório assume ${modeloPorPernaPct.toFixed(3)}% por `
        + `perna — falta ${Math.abs(sobra).toFixed(3)} ponto ANTES de qualquer derrapagem. `
        + "Todo resultado líquido gravado até hoje está otimista, e as estratégias "
        + "aprovadas por margem fina precisam ser relidas.",
    };
  }

  /**
   * ⚠️ O PISO DE 0,05 PONTO NÃO É MEDIÇÃO — é a ordem de grandeza do impacto de
   * preço num par líquido com nocional pequeno. Serve para separar "sobra
   * confortável" de "sobra que só existe no papel", e está exposto porque é
   * convenção: quem discordar muda e VÊ que mudou.
   */
  const PISO_DERRAPAGEM_PCT = 0.05;

  if (sobra < PISO_DERRAPAGEM_PCT) {
    return {
      ...base, sobraParaDerrapagemPct: sobra,
      veredito: `⚠️ SOBRA APERTADA. A taxa publicada é ${mediana.toFixed(3)}% e sobram `
        + `${sobra.toFixed(3)} ponto do orçamento de ${modeloPorPernaPct.toFixed(3)}% para pagar `
        + "derrapagem. É pouco: num par fino ou nocional maior, o impacto sozinho "
        + "come isso. Os resultados do laboratório provavelmente são otimistas.",
    };
  }

  return {
    ...base, sobraParaDerrapagemPct: sobra,
    veredito: `A taxa publicada é ${mediana.toFixed(3)}% e sobram ${sobra.toFixed(3)} ponto do `
      + `orçamento de ${modeloPorPernaPct.toFixed(3)}% para derrapagem. O modelo é POSSÍVEL — `
      + "o que não quer dizer correto: a derrapagem real continua não medida.",
  };
}

/**
 * Busca as taxas publicadas dos pares pedidos.
 *
 * ⚠️ FALHA DEVOLVE LISTA VAZIA COM O MOTIVO, e nunca lança. Quem consome
 * precisa distinguir "não medimos" de "medimos zero" — e uma taxa zero
 * inventada por falha de rede recalibraria o laboratório inteiro para baixo.
 */
export async function fetchTaxasGateio(
  simbolos: readonly string[],
): Promise<{ taxas: TaxaDoPar[]; falha?: string }> {
  const querem = new Set(simbolos.map((s) => s.toUpperCase()));
  try {
    const res = await fetch(`${GATEIO_API}/spot/currency_pairs`, { cache: "no-store" });
    if (!res.ok) return { taxas: [], falha: `gateio:${res.status}` };
    const linhas = await res.json() as Array<{ id?: string; fee?: string; trade_status?: string }>;
    if (!Array.isArray(linhas)) return { taxas: [], falha: "gateio: resposta inesperada" };

    const taxas: TaxaDoPar[] = [];
    for (const l of linhas) {
      const par = String(l.id ?? "");
      if (!par.endsWith("_USDT")) continue;
      const simbolo = par.replace(/_USDT$/, "").toUpperCase();
      if (!querem.has(simbolo)) continue;
      // Par suspenso não é par operável; incluí-lo mediria uma taxa que
      // ninguém paga.
      if (l.trade_status && l.trade_status !== "tradable") continue;
      const taxaPct = parseFloat(String(l.fee ?? ""));
      if (!Number.isFinite(taxaPct) || taxaPct < 0) continue;
      taxas.push({ par, simbolo, taxaPct });
    }
    if (taxas.length === 0) return { taxas, falha: "gateio: nenhum par pedido veio na resposta" };
    return { taxas };
  } catch (e) {
    return { taxas: [], falha: `gateio:${String(e).slice(0, 60)}` };
  }
}
