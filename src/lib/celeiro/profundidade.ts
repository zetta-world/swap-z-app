/**
 * O PORTÃO DE PROFUNDIDADE — cotação não é liquidez.
 *
 * ⚠️⚠️ ESTE MÓDULO EXISTE POR CAUSA DE UM CADÁVER.
 *
 * A mesa de arbitragem da arena antiga contabilizou lucro por semanas lendo o
 * TOPO do livro. Quando alguém finalmente andou a profundidade, em 4.085
 * medições:
 *
 *   teórico médio (o que o ledger anotava)   +0,451%
 *   realista médio (andando o livro)         −0,629%
 *   derrapagem média                          1,081%
 *   ainda positivos depois da profundidade   17 de 4.085  (0,4%)
 *
 * A diferença era a profundidade comendo o spread inteiro e mais um pouco. E a
 * mesa abria assim mesmo, porque a sonda existia e não bloqueava nada — quatro
 * mil medições corretas foram para um feed que ninguém agregava.
 *
 * ⚠️ NO CELEIRO O PORTÃO É PRÉ-REQUISITO, NÃO OBSERVAÇÃO (P3). Nenhuma posição
 * nasce sem passar por aqui, no TAMANHO REAL do agente. É a razão de o ranking
 * ser separado por faixa de capital: o mesmo agente tem retorno diferente em
 * tamanhos diferentes, e comparar $50 com $5.000 na mesma tabela compara coisas
 * distintas.
 */

/** Um nível do livro: preço e quantidade disponível naquele preço. */
export interface Nivel {
  preco: number;
  quantidade: number;
}

export interface Caminhada {
  /** O tamanho conseguiu ser preenchido dentro do livro lido? */
  preencheu: boolean;
  /** Preço médio ponderado do que foi preenchido. `null` se nada preencheu. */
  precoMedio: number | null;
  /** Quanto do alvo (em USD) o livro cobriu. */
  usdPreenchido: number;
  /** O preço do topo — a cotação que a tela mostraria. */
  precoDoTopo: number | null;
}

/**
 * Anda o livro consumindo níveis até completar o tamanho pedido.
 *
 * ⚠️ NÍVEIS INVÁLIDOS SÃO IGNORADOS, NÃO CORRIGIDOS. Preço zero ou quantidade
 * negativa numa resposta de corretora é sinal de leitura ruim; "consertar" com
 * um palpite produziria um preço médio que ninguém pode obter.
 */
export function andarOLivro(niveis: readonly Nivel[], usdAlvo: number): Caminhada {
  const bons = niveis.filter(
    (n) => Number.isFinite(n.preco) && n.preco > 0
        && Number.isFinite(n.quantidade) && n.quantidade > 0,
  );
  if (bons.length === 0 || !(usdAlvo > 0)) {
    return { preencheu: false, precoMedio: null, usdPreenchido: 0, precoDoTopo: null };
  }

  const precoDoTopo = bons[0].preco;
  let restante = usdAlvo;
  let usdGasto = 0;
  let unidades = 0;

  for (const n of bons) {
    if (restante <= 0) break;
    const usdNoNivel = n.preco * n.quantidade;
    const usar = Math.min(restante, usdNoNivel);
    usdGasto += usar;
    unidades += usar / n.preco;
    restante -= usar;
  }

  return {
    preencheu: restante <= 1e-9,
    precoMedio: unidades > 0 ? usdGasto / unidades : null,
    usdPreenchido: usdGasto,
    precoDoTopo,
  };
}

export interface Veredito {
  passa: boolean;
  /** Quanto a profundidade encareceu, em % — sempre ≥ 0. */
  derrapagemPct: number | null;
  porque: string;
}

/**
 * Teto de derrapagem tolerada, em % do preço.
 *
 * ⚠️ É UM TETO POR OPERAÇÃO, não uma média. A arbitragem morreu com derrapagem
 * MÉDIA de 1,081% — mas a média já era o desastre consumado. Um teto por
 * operação recusa a operação ruim antes de ela entrar na média.
 */
export const TETO_DE_DERRAPAGEM_PCT = Number(process.env.CELEIRO_TETO_DERRAPAGEM_PCT ?? 0.15);

/**
 * O portão.
 *
 * ⚠️⚠️ LIVRO QUE NÃO PÔDE SER LIDO **REPROVA**. É a aplicação direta de
 * `inconclusivo ≠ aprovado`: a alternativa seria abrir posição na ausência de
 * evidência, que é exatamente o hábito que produziu o cadáver do cabeçalho.
 *
 * ⚠️ LIVRO FINO TAMBÉM É UMA RESPOSTA, não uma falha. Significa que o preço de
 * topo não existe no tamanho que o agente quer operar — abrir ali seria comprar
 * a cotação e não a liquidez.
 */
export function portaoDeProfundidade(
  niveis: readonly Nivel[] | null,
  usdAlvo: number,
  tetoPct: number = TETO_DE_DERRAPAGEM_PCT,
): Veredito {
  if (niveis === null) {
    return {
      passa: false, derrapagemPct: null,
      porque: "profundidade não lida — não medido não é aprovado",
    };
  }
  const c = andarOLivro(niveis, usdAlvo);
  if (!c.preencheu || c.precoMedio === null || c.precoDoTopo === null) {
    return {
      passa: false, derrapagemPct: null,
      porque: `livro sem profundidade para ${usdAlvo.toFixed(2)} USD `
        + `(cobriu ${c.usdPreenchido.toFixed(2)})`,
    };
  }

  const derrapagemPct = Math.abs(c.precoMedio - c.precoDoTopo) / c.precoDoTopo * 100;
  if (derrapagemPct > tetoPct) {
    return {
      passa: false, derrapagemPct,
      porque: `derrapagem ${derrapagemPct.toFixed(3)}% acima do teto `
        + `${tetoPct.toFixed(2)}% — o topo prometia ${c.precoDoTopo}, o livro entrega `
        + `${c.precoMedio.toFixed(6)}`,
    };
  }
  return {
    passa: true, derrapagemPct,
    porque: `${usdAlvo.toFixed(2)} USD cabem com ${derrapagemPct.toFixed(3)}% de derrapagem`,
  };
}

/**
 * A derrapagem em USDT, para o extrato.
 *
 * ⚠️ ELA VIRA UMA LINHA `derrapagem` NO EXTRATO, separada de `taxa` e de
 * `preco`. Somá-la ao preço esconderia a causa — e foi não separar as causas
 * que impediu a arena antiga de explicar como uma mesa acerta 70% e perde
 * dinheiro.
 */
export function derrapagemEmUsdt(usdAlvo: number, derrapagemPct: number): number {
  if (!(usdAlvo > 0) || !Number.isFinite(derrapagemPct) || derrapagemPct <= 0) return 0;
  return -(usdAlvo * derrapagemPct / 100);
}

/**
 * Converte o formato da Gate.io (`[[preco, quantidade], ...]`) em níveis.
 *
 * ⚠️ Devolve `null` — e nunca `[]` — quando a resposta não dá para confiar.
 * Lista vazia passaria por "livro sem ofertas", que o portão trataria como
 * medição; `null` é o que ele trata como ausência de medição.
 */
export function converterLivro(bruto: unknown): Nivel[] | null {
  if (!Array.isArray(bruto)) return null;
  const out: Nivel[] = [];
  for (const linha of bruto) {
    if (!Array.isArray(linha) || linha.length < 2) continue;
    const preco = Number(linha[0]);
    const quantidade = Number(linha[1]);
    if (!Number.isFinite(preco) || !Number.isFinite(quantidade)) continue;
    out.push({ preco, quantidade });
  }
  return out.length > 0 ? out : null;
}
