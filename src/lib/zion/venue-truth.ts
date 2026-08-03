/**
 * A CONFERÊNCIA MANUAL, AUTOMATIZADA.
 *
 * O terceiro passo que a auditoria da coorte pediu era o mais simples de todos:
 * abrir duas corretoras no mesmo par, no mesmo instante, e ver se a diferença
 * de 0.7% está mesmo lá. Se não estiver, o "spread" era do feed.
 *
 * Fazer isso na mão responde uma vez. Isto responde toda vez, e guarda a
 * resposta — que é a diferença entre desconfiar e saber.
 *
 * O QUE ELE MEDE, e por que não é a mesma coisa que o detector de arbitragem:
 *
 * O detector procura o par MAIS DISTANTE entre venues, porque é dele que sairia
 * o lucro. Isso o torna cego para a pergunta que importa aqui: aquele par está
 * longe porque a praça é diferente, ou porque UMA das cotações está errada?
 *
 * A resposta vem da mediana. Com três ou mais cotações do mesmo ativo, a
 * mediana é uma testemunha que não depende de nenhuma delas em particular. O
 * desvio de cada venue em relação a ela, medido em MUITOS símbolos, separa as
 * duas hipóteses de forma que um par isolado nunca separaria:
 *
 *  · Praça genuinamente diferente → desvio consistente e com SINAL: sempre um
 *    pouco mais barata, ou sempre um pouco mais cara.
 *  · Feed com ruído ou atraso → desvio grande e SEM sinal: ora acima, ora
 *    abaixo, com média perto de zero e dispersão alta.
 *
 * É exatamente o que a coorte viu de lado: uma venue nos DOIS lados das pernas.
 * Aqui a mesma coisa aparece de frente, e com número.
 */

export interface VenueQuote { venue: string; priceUsd: number }

export interface VenueStat {
  venue: string;
  /** Em quantos símbolos ela foi observada. */
  symbols: number;
  /** Desvio MÉDIO em relação à mediana, com sinal, em %. */
  biasPct: number;
  /** Desvio ABSOLUTO médio, em %. O tamanho do erro, sem o sinal. */
  dispersionPct: number;
  /** Maior desvio absoluto observado, em %. */
  worstPct: number;
  /**
   * O veredito da venue:
   *  · "estável"  — desvio pequeno; nada a declarar.
   *  · "cara"/"barata" — desvio consistente COM sinal: praça diferente.
   *  · "ruidosa"  — desvio grande e sem sinal: o preço oscila em volta dos
   *                 outros, que é feed, não mercado.
   */
  verdict: "estável" | "cara" | "barata" | "ruidosa";
}

/** Mediana simples — a testemunha que não depende de nenhuma cotação. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Classifica uma venue pelo par (viés, dispersão).
 *
 * A regra de decisão é a razão entre as duas. Se quase todo o desvio tem o
 * mesmo sinal, |viés| ≈ dispersão, e a venue é sistematicamente cara ou barata.
 * Se o desvio troca de sinal, os positivos cancelam os negativos, |viés| fica
 * muito menor que a dispersão — e é ruído.
 *
 * `noiseFloorPct` existe porque abaixo de um certo tamanho a distinção não
 * importa: uma venue que oscila 0.02% em volta das outras é normal, não é
 * defeito. Chamar isso de "ruidosa" seria produzir alarme onde não há.
 */
export function classifyVenue(
  biasPct: number, dispersionPct: number, noiseFloorPct = 0.08, signalRatio = 0.6,
): VenueStat["verdict"] {
  if (dispersionPct < noiseFloorPct) return "estável";
  if (Math.abs(biasPct) / dispersionPct >= signalRatio) return biasPct > 0 ? "cara" : "barata";
  return "ruidosa";
}

/**
 * Mede cada venue contra a mediana dos pares, símbolo a símbolo.
 *
 * Só considera símbolos com 3+ cotações: com duas, a "mediana" é a média das
 * duas e cada uma fica exatamente à mesma distância dela — o cálculo roda e não
 * informa nada. Silenciosamente incluir esses casos diluiria o resultado com
 * zeros disfarçados de medição.
 */
export function measureVenues(
  bySymbol: Map<string, VenueQuote[]>, minVenues = 3,
): VenueStat[] {
  const soma = new Map<string, { bias: number; abs: number; worst: number; n: number }>();

  for (const quotes of bySymbol.values()) {
    const validas = quotes.filter((q) => q.priceUsd > 0);
    if (validas.length < minVenues) continue;
    const med = median(validas.map((q) => q.priceUsd));
    if (!(med > 0)) continue;
    for (const q of validas) {
      const desvio = (q.priceUsd / med - 1) * 100;
      const acc = soma.get(q.venue) ?? { bias: 0, abs: 0, worst: 0, n: 0 };
      acc.bias += desvio;
      acc.abs += Math.abs(desvio);
      acc.worst = Math.max(acc.worst, Math.abs(desvio));
      acc.n++;
      soma.set(q.venue, acc);
    }
  }

  return [...soma.entries()]
    .map(([venue, a]) => {
      const biasPct = a.bias / a.n;
      const dispersionPct = a.abs / a.n;
      return {
        venue, symbols: a.n, biasPct, dispersionPct, worstPct: a.worst,
        verdict: classifyVenue(biasPct, dispersionPct),
      };
    })
    .sort((x, y) => y.dispersionPct - x.dispersionPct);
}

/**
 * A conclusão em uma frase — o que a medição diz sobre a estratégia.
 *
 * Existe porque uma tabela de desvios é evidência, não resposta. A pergunta do
 * dono foi "está indo bem mesmo ou é ilusão?", e uma tabela obriga cada leitor a
 * refazer o raciocínio sozinho — inclusive eu, daqui a duas semanas.
 */
export function truthVerdict(stats: VenueStat[], floorPct: number): string {
  if (stats.length === 0) return "sem cotações suficientes para medir — 3 venues por símbolo é o mínimo";
  const ruidosas = stats.filter((s) => s.verdict === "ruidosa");
  const maior = stats[0];
  if (maior.dispersionPct < floorPct / 2) {
    return `nenhuma venue se afasta o bastante da mediana para gerar o spread de ${floorPct.toFixed(2)}% que a mesa exige `
      + `(o pior desvio médio é ${maior.dispersionPct.toFixed(3)}%). O spread que a mesa vinha capturando não estava no mercado.`;
  }
  if (ruidosas.length > 0) {
    return `${ruidosas.map((s) => s.venue).join(", ")} oscila(m) em volta da mediana sem viés consistente `
      + `(desvio ${ruidosas[0].dispersionPct.toFixed(3)}%, viés ${ruidosas[0].biasPct.toFixed(3)}%) — isso é feed, não praça mais barata.`;
  }
  return `os desvios têm sinal consistente: são praças com preço próprio, não ruído. `
    + `Maior: ${maior.venue} ${maior.biasPct > 0 ? "acima" : "abaixo"} da mediana em ${Math.abs(maior.biasPct).toFixed(3)}%.`;
}
