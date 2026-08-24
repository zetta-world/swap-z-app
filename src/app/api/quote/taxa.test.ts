/**
 * A TAXA NO CAMINHO DA COTAÇÃO — Fase 9.2.
 *
 * ⚠️ Esta é a primeira vez que o projeto tira dinheiro do usuário no ato do
 * swap. As travas aqui protegem três coisas, e nenhuma é sobre o valor da
 * taxa: que ela NÃO seja pedida sem destino, que ela NÃO vaze para a Solana, e
 * que ela chegue à TELA — cobrar sem dizer é o que destrói confiança de uma vez.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tokenDaTaxa, ZEROX_NATIVE } from "@/lib/api/zerox";

function semComentarios(c: string): string {
  return c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}
const rota  = semComentarios(readFileSync("src/app/api/quote/route.ts", "utf8"));
const zerox = semComentarios(readFileSync("src/lib/api/zerox.ts", "utf8"));
const lifi  = semComentarios(readFileSync("src/lib/api/lifi.ts", "utf8"));
const jup   = semComentarios(readFileSync("src/lib/api/jupiter.ts", "utf8"));

describe("a taxa só é pedida com destinatário", () => {
  /**
   * ⚠️ `swapFeeBps` sem `swapFeeRecipient` é cotação recusada — ou, pior,
   * aceita retendo para lugar nenhum. Os dois lados andam juntos.
   */
  it("0x exige bps E destinatário antes de mandar qualquer coisa", () => {
    expect(zerox).toContain("if (!(bps > 0) || !args.feeRecipient) return;");
    expect(zerox).toContain('params.set("swapFeeBps"');
    expect(zerox).toContain('params.set("swapFeeRecipient"');
  });

  /**
   * ⚠️ O TESTE ACIMA PASSOU VERDE ENQUANTO NENHUM SWAP COBRAVA NADA.
   *
   * Ele lê o ARQUIVO e acha `params.set("swapFeeBps"` dentro de `aplicarTaxa`.
   * Só que `aplicarTaxa` era chamada apenas em `fetchZeroXPrice` — a cotação
   * INDICATIVA, a que a tela usa para mostrar número. A cotação FIRME, que
   * vira a transação assinada, nunca a chamava.
   *
   * Resultado: a taxa aparecia na tela e não existia na transação. Todo swap
   * desde que a cobrança foi ligada cobrou ZERO, e a suíte inteira dizia que
   * estava tudo certo — porque provava que o código EXISTIA, nunca que ele
   * era CHAMADO no caminho que importa.
   *
   * Este teste exige a CHAMADA, nas duas funções, uma por uma.
   */
  it("as DUAS cotações aplicam a taxa — a indicativa e a FIRME", () => {
    const corpoDe = (nome: string): string => {
      const i = zerox.indexOf(`export async function ${nome}(`);
      expect(i, `${nome} não existe`).toBeGreaterThan(-1);
      const j = zerox.indexOf("\nexport ", i + 1);
      return zerox.slice(i, j === -1 ? undefined : j);
    };
    expect(corpoDe("fetchZeroXPrice"), "a indicativa perdeu a taxa")
      .toContain("aplicarTaxa(params, args)");
    expect(corpoDe("fetchZeroXQuote"), "a FIRME é a que vira transação assinada")
      .toContain("aplicarTaxa(params, args)");
  });

  it("LI.FI idem", () => {
    expect(lifi).toContain("if ((args.feeBps ?? 0) > 0 && args.feeRecipient)");
  });

  /**
   * ⚠️ A LI.FI RECEBE FRAÇÃO, NÃO PONTOS-BASE. Mandar `100` ali seria pedir
   * 10.000% — a conversão fica no ponto de contato, não em quem chama.
   */
  it("a LI.FI recebe fração, e a conversão está no ponto de contato", () => {
    /**
     * ⚠️ A ASSERÇÃO TEM QUE CITAR A LINHA DA TAXA, não só o divisor.
     *
     * A primeira versão conferia `"/ 10_000).toString()"` — string que também
     * aparece na conversão de SLIPPAGE, três linhas acima. A mutação que
     * trocava a fração por bps passou verde: o teste achava o divisor do
     * vizinho e dava por conferido. Achado pelo próprio teste de mutação.
     */
    expect(lifi).toContain('params.set("fee", ((args.feeBps as number) / 10_000).toString())');
    expect(lifi).not.toMatch(/params\.set\("fee",\s*String\(args\.feeBps\)\)/);
  });

  /**
   * ⚠️ O TOKEN DA TAXA É ESCOLHIDO, NÃO ASSUMIDO — e este teste substituiu um
   * que exigia `swapFeeToken = args.buyToken` sempre.
   *
   * Aquela asserção passava verde enquanto DOIS swaps de verdade não cobravam
   * nada (11/08, 04:49 e 04:54): o 0x não retém taxa em token NATIVO, e nos
   * dois a saída era BNB nativo. O teste conferia o que o código escrevia, e o
   * código escrevia a coisa errada com convicção.
   *
   * O comportamento agora tem teste próprio em `tokenDaTaxa` — aqui fica só a
   * trava de que os três parâmetros andam juntos, e que nenhum vai sem token.
   */
  it("sem token utilizável, NENHUM parâmetro de taxa é mandado", () => {
    expect(zerox).toContain("const token = tokenDaTaxa(args.sellToken, args.buyToken);");
    expect(zerox).toContain("if (!token) return;");
    expect(zerox).toContain('params.set("swapFeeToken", token)');
  });
});

/**
 * ⚠️ A CICATRIZ DE 11/08 — dois swaps que não cobraram nada e ninguém viu.
 *
 * O dono trocou USDT por BNB na BSC duas vezes. Nas duas mandamos
 * `swapFeeBps=100` e `swapFeeRecipient` certo; nas duas o 0x devolveu
 * `integratorFee: null`. Ele **não retém taxa em token nativo**, e o token que
 * declarávamos era sempre o de saída — que ali era o nativo.
 *
 * A tela dizia "Taxa da plataforma 1,00%". A cobrança era ZERO. A cotação
 * voltava 200, o swap funcionava, o usuário ficava feliz, e a receita não
 * existia — não havia nada na tela nem no log que separasse isso de cobrar.
 */
describe("tokenDaTaxa — a taxa sai em QUALQUER direção", () => {
  const NATIVO = ZEROX_NATIVE;
  const USDT   = "0x55d398326f99059ff775485246999027b3197955";
  const WETH   = "0x2170ed0880ac9a755fd29b2688956bd959f933f8";

  it("saída ERC-20: cobra na saída, que é o que o usuário recebe", () => {
    expect(tokenDaTaxa(NATIVO, USDT)).toBe(USDT);
    expect(tokenDaTaxa(WETH, USDT)).toBe(USDT);
  });

  /** ⚠️ O caso exato dos dois swaps perdidos: USDT → BNB nativo. */
  it("saída NATIVA: cobra na entrada em vez de não cobrar nada", () => {
    expect(tokenDaTaxa(USDT, NATIVO)).toBe(USDT);
    expect(tokenDaTaxa(WETH, NATIVO)).toBe(WETH);
  });

  /**
   * ⚠️ O endereço do nativo do 0x é `0xEeee…EEeE`, com maiúsculas no meio.
   * Comparar sem normalizar faria a detecção falhar para quem mandasse
   * minúsculo — e falhar aqui significa voltar a não cobrar, em silêncio.
   */
  it("reconhece o nativo em qualquer caixa", () => {
    expect(tokenDaTaxa(USDT, NATIVO.toLowerCase())).toBe(USDT);
    expect(tokenDaTaxa(USDT, NATIVO.toUpperCase())).toBe(USDT);
    expect(tokenDaTaxa(NATIVO.toLowerCase(), USDT)).toBe(USDT);
  });

  /**
   * Nativo dos dois lados não é troca. Se chegar aqui, é melhor não pedir taxa
   * do que pedir uma que o 0x vai ignorar em silêncio — que é o defeito que
   * este arquivo inteiro existe para não repetir.
   */
  it("nativo dos dois lados devolve null, e aí nada é pedido", () => {
    expect(tokenDaTaxa(NATIVO, NATIVO)).toBeNull();
  });

  /** A escolha nunca devolve um token que não é um dos dois da troca. */
  it("nunca inventa um terceiro token", () => {
    for (const [s, b] of [[USDT, WETH], [NATIVO, USDT], [USDT, NATIVO]] as const) {
      const t = tokenDaTaxa(s, b);
      if (t !== null) expect([s, b]).toContain(t);
    }
  });
});

/**
 * ⚠️ E QUANDO O AGREGADOR NÃO CONFIRMAR, ALGUÉM TEM QUE SABER.
 *
 * A correção acima resolve o caso conhecido. O alerta resolve o PRÓXIMO: se
 * outro par, outra cadeia ou outro agregador parar de reter, isso vira
 * mensagem em vez de silêncio.
 */
describe("taxa pedida e não retida vira alerta", () => {
  it("a rota alerta nos DOIS agregadores", () => {
    expect(rota).toContain("function alertarTaxaNaoRetida");
    expect((rota.match(/alertarTaxaNaoRetida\(\{/g) ?? []).length).toBe(2);
  });

  /**
   * ⚠️ NÃO BLOQUEIA A COTAÇÃO. O caminho que falha FECHADO é o do usuário;
   * a nossa receita é o outro lado. Recusar a troca de alguém porque nós não
   * fomos pagos transformaria um problema nosso em prejuízo dele.
   */
  it("mas NÃO derruba a cotação por causa disso", () => {
    expect(rota).not.toMatch(/taxa_nao_retida[\s\S]{0,200}status:\s*4\d\d/);
    expect(rota).toContain('kind: "taxa_nao_retida"');
  });
});

describe("a Solana não cobra — e a ausência é declarada", () => {
  it("a Jupiter não recebe platformFeeBps", () => {
    expect(jup).not.toContain('params.set("platformFeeBps"');
  });

  /** A família da cadeia decide, e `bpsEfetivos` devolve 0 sem conta. */
  it("a rota decide a taxa por família de cadeia", () => {
    expect(rota).toContain('fromChain === "solana" ? "solana" : "evm"');
    expect(rota).toContain("bpsEfetivos(planoDoCotante, familiaCadeia)");
  });
});

describe("a taxa chega à tela", () => {
  /**
   * ⚠️ COBRAR SEM DIZER destrói confiança de uma vez, e não se recupera. A
   * taxa vai em TODA resposta de sucesso — inclusive quando é zero, porque
   * "0%" e "campo ausente" são afirmações diferentes.
   */
  it("toda resposta de sucesso carrega a taxa", () => {
    const sucessos = rota.match(/ok: true/g) ?? [];
    const comTaxa  = rota.match(/taxa,/g) ?? [];
    expect(sucessos.length).toBeGreaterThan(0);
    expect(comTaxa.length).toBe(sucessos.length);
  });

  it("a taxa devolvida traz plano, bps e porcentagem", () => {
    expect(rota).toContain("tier: planoDoCotante");
    expect(rota).toContain("pct:");
  });
});

describe("a divulgação chega ao usuário antes da assinatura", () => {
  const card = readFileSync("src/components/swap/SwapCard.tsx", "utf8");
  const hook = readFileSync("src/lib/hooks/useQuotes.ts", "utf8");
  const msgs = readFileSync("src/lib/i18n/messages.ts", "utf8");

  /**
   * ⚠️ A TRAVA QUE MAIS IMPORTA DESTA FASE. Reter 1% sem dizer é o que a
   * primeira pessoa a conferir no explorador transforma em acusação pública —
   * e isso não se recupera. A cobrança e a divulgação sobem juntas, ou nenhuma
   * das duas sobe.
   */
  it("o card do swap mostra a taxa da plataforma", () => {
    expect(card).toContain("swap.platformFee");
    expect(card).toContain("taxaPlataforma");
  });

  it("a taxa viaja da rota até a tela", () => {
    expect(hook).toContain("taxa:         body.taxa ?? null");
    expect(card).toContain("taxaPlataforma={quotesState.taxa}");
  });

  it("a explicação existe nos 4 idiomas", () => {
    expect((msgs.match(/platformFee:/g) ?? [])).toHaveLength(4);
    expect((msgs.match(/platformFeeTip:/g) ?? [])).toHaveLength(4);
  });

  /** ⚠️ Zero também é dito. "0%" e campo ausente são afirmações diferentes. */
  it("a linha aparece mesmo quando a taxa é zero", () => {
    expect(card).toContain("{taxaPlataforma && (");
    expect(card).not.toContain("taxaPlataforma.pct > 0 && (");
  });
});

describe("sem sessão, o plano é o mais caro", () => {
  /**
   * ⚠️ Falha de resolução vira `free` — NUNCA "sem taxa". O contrário faria
   * qualquer erro de sessão virar swap de graça.
   */
  it("o fallback do plano é free, não ausência de taxa", () => {
    expect(rota).toContain('if (!s) return "free";');
    expect(rota).toContain('catch { return "free"; }');
  });
});
