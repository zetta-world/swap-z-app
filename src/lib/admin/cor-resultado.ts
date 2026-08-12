/**
 * A COR DE UM RESULTADO — e por que ela não pode olhar só a vantagem.
 *
 * ⚠️ A CICATRIZ (12/08). O dono remediu o laboratório inteiro e reclamou:
 * "temos muitos números negativos verdes". Ele estava certo, e o defeito era
 * sistemático.
 *
 *   `grid_bot`: total −51,46% · segurar −66,91%
 *   cor = totalPct > segurarPct ? verde : vermelho   →   VERDE
 *
 * A grade perdeu METADE DO CAPITAL e o número saiu verde, porque perdeu menos
 * que segurar. O mesmo em `amm_lp`: a piscina rendeu −53% e a tela pintou de
 * verde a "vantagem" de +0,73 pontos sobre segurar, que rendeu −54%.
 *
 * ⚠️ E O VEREDITO JÁ ESTAVA CERTO. A invariante nº 18 foi escrita em 10/08
 * justamente por isso, e as funções de veredito passaram a devolver `morta`
 * nesses casos. **Só a COR ficou para trás.** O texto dizia "PERDEU", o selo
 * dizia MORTA, e o número grande no topo estava verde — e o olho vai no
 * número grande colorido, não no parágrafo.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A REGRA, e ela tem três estados porque existem três situações:
 *
 *   · perdeu dinheiro          → VERMELHO, sempre. Bater o índice não salva.
 *   · ganhou dinheiro E o índice → VERDE
 *   · ganhou dinheiro e PERDEU do índice → ÂMBAR
 *
 * O terceiro caso é o que um booleano não consegue dizer: rendeu, mas segurar
 * teria rendido mais. Não é derrota (você tem mais dinheiro) nem vitória (você
 * escolheu pior que não escolher). Pintar de verde esconde a segunda metade;
 * de vermelho, a primeira.
 *
 * ⚠️ E AUSÊNCIA NÃO É PERDA. `null` sai cinza, nunca vermelho — "não medimos"
 * e "deu negativo" são coisas diferentes, e esta é a mesma família de defeito
 * que a Fase 10 desfez no vocabulário do veredito.
 */

export type ClasseResultado = "ganhou" | "perdeu" | "so_perdeu_menos" | "sem_dado";

/**
 * Classifica o resultado a partir do ABSOLUTO e, quando existe, da vantagem
 * sobre o competidor.
 *
 * @param absolutoPct  quanto a mesa rendeu de fato. **Este é quem manda.**
 * @param vantagemPct  quanto ela ficou acima do competidor. Opcional: sem ele,
 *                     a classificação é só sobre ganhar ou perder dinheiro.
 */
export function classificarResultado(
  absolutoPct: number | null | undefined,
  vantagemPct?: number | null,
): ClasseResultado {
  if (absolutoPct == null || !Number.isFinite(absolutoPct)) return "sem_dado";
  /**
   * ⚠️ ZERO NÃO É GANHO. Ficar no lugar depois de correr risco e pagar custo é
   * perder — e `> 0` em vez de `>= 0` é o que separa os dois.
   */
  if (absolutoPct <= 0) return "perdeu";
  if (vantagemPct == null || !Number.isFinite(vantagemPct)) return "ganhou";
  return vantagemPct > 0 ? "ganhou" : "so_perdeu_menos";
}

const COR_POR_CLASSE: Record<ClasseResultado, string> = {
  ganhou:           "var(--adm-green)",
  perdeu:           "var(--adm-red)",
  so_perdeu_menos:  "var(--adm-amber)",
  sem_dado:         "var(--adm-ink-3)",
};

/** A cor da régua acima. Use SEMPRE esta função — nunca um ternário na tela. */
export function corDoResultado(
  absolutoPct: number | null | undefined,
  vantagemPct?: number | null,
): string {
  return COR_POR_CLASSE[classificarResultado(absolutoPct, vantagemPct)];
}

/**
 * Uma frase curta para acompanhar a cor quando ela sozinha enganaria.
 *
 * ⚠️ ÂMBAR PRECISA DE LEGENDA. Verde e vermelho são intuitivos; "ganhou
 * dinheiro mas perdeu do índice" não tem cor óbvia em lugar nenhum, e uma cor
 * que ninguém sabe ler é decoração.
 */
export function legendaDoResultado(
  absolutoPct: number | null | undefined,
  vantagemPct?: number | null,
): string | null {
  switch (classificarResultado(absolutoPct, vantagemPct)) {
    case "perdeu":
      return vantagemPct != null && vantagemPct > 0
        ? "perdeu dinheiro — só perdeu MENOS que o competidor"
        : null;
    case "so_perdeu_menos":
      return "rendeu, mas o competidor rendeu mais";
    default:
      return null;
  }
}

/**
 * A cor de um P&L de livro — e por que ela NÃO é a mesma de `corDoResultado`.
 *
 * ⚠️ ZERO AQUI NÃO É PERDA, e essa é a diferença inteira.
 *
 * Em `corDoResultado`, zero é vermelho: uma estratégia que rendeu 0% depois de
 * correr risco e pagar custo perdeu. Já um P&L de operação em zero é
 * literalmente zero — a operação não realizou resultado, e pintá-la de
 * vermelho afirmaria prejuízo que não houve.
 *
 * ⚠️ MAS ELE TAMBÉM NÃO É VERDE, que era o defeito (12/08). As colunas de P&L
 * usavam `n >= 0 ? verde : vermelho`, então **zero e NULO saíam verdes** — o
 * painel de operações mostrava "+$0" em verde em toda linha, e "não sabemos o
 * resultado" ficava com a mesma cara de "deu lucro".
 *
 * Três estados, de novo: lucro é verde, prejuízo é vermelho, e zero-ou-
 * desconhecido é neutro. Cor de vitória em cima de ausência é a mentira mais
 * barata que uma tela consegue contar.
 */
export function corDoPnl(pnl: number | null | undefined): string {
  if (pnl == null || !Number.isFinite(pnl) || pnl === 0) return "var(--adm-ink-3)";
  return pnl > 0 ? "var(--adm-green)" : "var(--adm-red)";
}
