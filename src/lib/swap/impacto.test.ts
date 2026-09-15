/**
 * ⚠️⚠️ A PROTEÇÃO DE IMPACTO MEDIA UMA COTAÇÃO E O USUÁRIO ASSINAVA OUTRA.
 * Achado A21 da auditoria externa.
 *
 * O `SwapCard` calcula o impacto sobre a cotação INDICATIVA e trava o botão com
 * ele. O `ExecuteSwap` busca uma cotação FIRME ao abrir — e, no caminho do 0x,
 * uma TERCEIRA logo antes de enviar, porque o calldata carrega o preço e
 * envelhece rápido. Nenhuma das duas era conferida.
 *
 * Em pool raso é exatamente aí que o número se move: passava-se por um impacto
 * de 1% e assinava-se um de 40%. A guarda existia, media a coisa certa, e
 * apontava para a cotação errada — mesma família do A13.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { impactoPct, impactoDaCotacao } from "./impacto";
import { assessImpact, IMPACT_BLOCK_PCT } from "./impact-guard";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const EXEC = semComentarios(leia("src/components/swap/ExecuteSwap.tsx"));
const CARD = semComentarios(leia("src/components/swap/SwapCard.tsx"));

describe("① a fórmula, em um lugar só", () => {
  it("perda sai negativa — a convenção que `assessImpact` espera", () => {
    // Ele faz `Math.max(0, -impactPct)`: negativo é perda.
    expect(impactoPct(1000, 900)).toBeCloseTo(-10, 9);
    expect(impactoPct(1000, 1100)).toBeCloseTo(10, 9);
  });

  it("⚠️⚠️ SEM PREÇO É `null`, NUNCA 0 — e zero passa em todo limiar", () => {
    // Invariante nº 33 no lugar mais caro: um zero aqui afirma "não há
    // impacto" quando o que houve foi o feed não responder — e passa liberado.
    for (const [a, b] of [[null, 900], [1000, null], [0, 900], [1000, 0], [NaN, 900], [1000, Infinity]] as const) {
      expect(impactoPct(a as number | null, b as number | null)).toBeNull();
    }
    expect(assessImpact(null, null).level).toBe("ok");   // por isso o null NÃO pode virar 0
  });

  it("`impactoDaCotacao` devolve os dois lados em USD junto com o percentual", () => {
    const r = impactoDaCotacao({ entradaDec: 2, saidaDec: 1.8, precoEntradaUsd: 500, precoSaidaUsd: 500 });
    expect(r.entradaUsd).toBe(1000);
    expect(r.saidaUsd).toBe(900);
    expect(r.impactoPct).toBeCloseTo(-10, 9);
  });

  it("⚠️ preço ausente de QUALQUER lado não vira zero no lado bom", () => {
    const r = impactoDaCotacao({ entradaDec: 2, saidaDec: 1.8, precoEntradaUsd: 500, precoSaidaUsd: null });
    expect(r.saidaUsd).toBeNull();
    expect(r.impactoPct).toBeNull();
  });

  it("⚠️⚠️ a aritmética do defeito: 1% na indicativa, 40% na firme", () => {
    // Mesmo par, mesma entrada — só a saída da cotação mudou entre as duas.
    const indicativa = impactoDaCotacao({ entradaDec: 1, saidaDec: 0.99, precoEntradaUsd: 1000, precoSaidaUsd: 1000 });
    const firme      = impactoDaCotacao({ entradaDec: 1, saidaDec: 0.60, precoEntradaUsd: 1000, precoSaidaUsd: 1000 });
    expect(assessImpact(indicativa.impactoPct, indicativa.entradaUsd).level).toBe("ok");
    expect(assessImpact(firme.impactoPct, firme.entradaUsd).level).toBe("block");
    // 40% está acima do teto de bloqueio — é o caso que passava direto.
    expect(40).toBeGreaterThan(IMPACT_BLOCK_PCT);
  });
});

/**
 * ⚠️⚠️ TRAVAS DO FIO — leitura de fonte de propósito. A fórmula acima tem teste
 * que a EXECUTA, e seguiria verde com o modal sem reconferência nenhuma.
 */
describe("② e o modal REALMENTE reconfere antes de assinar", () => {
  it("⚠️⚠️ o veredito sai da cotação FIRME, não da indicativa", () => {
    /**
     * ⚠️ ESTA TRAVA JÁ REPROVOU CÓDIGO MELHOR. A primeira versão casava a
     * FORMA literal (`const impactoFirme = useMemo(…)`) e quebrou quando o
     * veredito virou função, para poder julgar a terceira cotação. Trava que
     * transcreve linha em vez de intenção é a cicatriz nº 4 desta casa.
     *
     * A INTENÇÃO: o veredito da tela sai da função compartilhada, alimentada
     * pela entrada e pela saída da cotação firme.
     */
    expect(EXEC).toMatch(/impactoDaCotacao\(\{ entradaDec: estIn, saidaDec,/);
    expect(EXEC).toMatch(/assessImpact\(i\.impactoPct, i\.entradaUsd\)/);
    expect(EXEC).toMatch(/const vereditoFirme = vereditoDeSaida\(estOut\)/);
  });

  it("⚠️⚠️ e ele BARRA o envio — na única porta das três fontes", () => {
    expect(EXEC).toMatch(/if \(vereditoFirme\.level === "block"\)/);
    const i = EXEC.indexOf('if (vereditoFirme.level === "block")');
    expect(EXEC.slice(i, i + 200)).toMatch(/return;/);
  });

  it("⚠️⚠️ o portão é a PRIMEIRA coisa do `onExecute`, antes de toda assinatura", () => {
    /**
     * ⚠️ ANCORAR EM `setPhase("needs_tx_signature")` MEDIA A COISA ERRADA: a
     * primeira ocorrência está no efeito que busca a cotação firme ao ABRIR o
     * modal, que não envia nada. O que importa é o pedido de assinatura de
     * verdade, e ele mora dentro do `onExecute`.
     */
    const i = EXEC.indexOf("const onExecute = useCallback(async () => {");
    expect(i, "onExecute não encontrado — renomeado? atualize esta trava").toBeGreaterThan(0);
    const corpo = EXEC.slice(i, EXEC.indexOf("}, [vereditoFirme,", i));

    const iPortao = corpo.indexOf('if (vereditoFirme.level === "block")');
    expect(iPortao, "o portão precisa estar DENTRO do onExecute").toBeGreaterThan(0);

    // Toda forma de pedir assinatura, em qualquer das três fontes.
    for (const pedido of ["sendTransactionAsync(", "writeContractAsync(", "signTransaction("]) {
      let de = corpo.indexOf(pedido);
      expect(de, `${pedido} sumiu do onExecute — atualize esta trava`).toBeGreaterThan(0);
      while (de !== -1) {
        expect(de, `${pedido} acontece ANTES do portão`).toBeGreaterThan(iPortao);
        de = corpo.indexOf(pedido, de + 1);
      }
    }
  });

  it("⚠️ `estOut` é resolvido para as TRÊS fontes — 0x, LiFi e Jupiter", () => {
    // Um portão que só cobrisse uma fonte deixaria as outras duas abertas.
    expect(EXEC).toMatch(/source === "0x" && zxQuote/);
    expect(EXEC).toMatch(/source === "lifi" && lfQuote/);
    expect(EXEC).toMatch(/source === "jupiter" && jupResult/);
  });

  it("⚠️ usa os MESMOS preços vivos do cartão, não o snapshot do registro", () => {
    // Medir com preços diferentes nas duas pontas é o defeito de novo, com
    // outra roupa.
    expect(EXEC).toMatch(/const \{ prices: precosVivos \} = useTokenPrices\(\[fromToken, toToken\]\)/);
    expect(CARD).toMatch(/useTokenPrices\(\[fromToken, toToken\]\)/);
  });

  it("⚠️⚠️ e o cartão passou a usar a MESMA função — nada de segunda cópia", () => {
    expect(CARD).toMatch(/impactoDaCotacao\(\{/);
    // A fórmula inline era a porta dos fundos: duas contas do mesmo número.
    expect(CARD).not.toMatch(/\(\(outUsd - inUsd\) \/ inUsd\) \* 100/);
  });
});

/**
 * ⚠️⚠️ A TERCEIRA COTAÇÃO — achado do revisor no #429, e ele estava certo.
 *
 * Minha primeira correção conferia só a cotação FIRME (a segunda) e deixava
 * passar a TERCEIRA: aquela que o caminho do 0x rebusca logo antes de enviar,
 * porque "calldata embeds pricing and goes stale fast". O próprio texto do PR
 * nomeava essa terceira como parte do problema, e a guarda não a cobria.
 *
 * ⚠️ O QUE ME ENGANOU: `fetchFreshZxQuote` chama `setZxQuote(q)`, e eu contei
 * com isso. Mas `setState` NÃO reescreve a constante já capturada no closure de
 * um callback EM EXECUÇÃO — o portão do topo já tinha passado com os números da
 * segunda cotação, e a transação saía com os da terceira.
 */
describe("③ e a TERCEIRA cotação do 0x também passa pelo portão", () => {
  it("⚠️⚠️ o veredito é FUNÇÃO de uma saída, não um valor de outro momento", () => {
    // Um `const` calculado na renderização não acompanha uma cotação buscada
    // DEPOIS, dentro do mesmo callback. Perguntar é o que funciona.
    expect(EXEC).toMatch(/const vereditoDeSaida = useCallback\(\(saidaDec: number \| null\) => \{/);
    expect(EXEC).toMatch(/const vereditoFirme = vereditoDeSaida\(estOut\)/);
  });

  it("⚠️⚠️ a cotação rebuscada é julgada ANTES de virar transação", () => {
    const iRefetch = EXEC.indexOf("q = await fetchFreshZxQuote();");
    const iJulga   = EXEC.indexOf("const vereditoFresco = vereditoDeSaida(");
    const iEnvia   = EXEC.indexOf("const hash = await sendTransactionAsync({", iRefetch);
    expect(iRefetch).toBeGreaterThan(0);
    expect(iJulga, "a terceira cotação não é conferida").toBeGreaterThan(iRefetch);
    expect(iEnvia).toBeGreaterThan(iJulga);
  });

  it("⚠️⚠️ e ela BARRA — o `return` é o que impede a assinatura", () => {
    const i = EXEC.indexOf("if (vereditoFresco.level === \"block\")");
    expect(i).toBeGreaterThan(0);
    expect(EXEC.slice(i, i + 200)).toMatch(/setPhase\("tx_failed"\)[\s\S]{0,60}return;/);
  });

  it("⚠️ o julgamento usa a saída DA COTAÇÃO REBUSCADA, não `estOut`", () => {
    // `estOut` vem do estado `zxQuote`, que o `setZxQuote` só atualiza na
    // renderização seguinte — tarde demais para este envio.
    expect(EXEC).toMatch(/vereditoDeSaida\(Number\(q\.buyAmount\) \/ Math\.pow\(10, toToken\.decimals\)\)/);
  });

  it("⚠️ TODA rebusca de cotação no envio é seguida de um veredito", () => {
    // Se um dia aparecer uma quarta, isto reprova até ela ser conferida.
    const rebuscas = [...EXEC.matchAll(/await fetchFreshZxQuote\(\)/g)].length;
    const vereditos = [...EXEC.matchAll(/const vereditoFresco = vereditoDeSaida\(/g)].length;
    expect(rebuscas).toBeGreaterThan(0);
    expect(vereditos, `${rebuscas} rebusca(s), ${vereditos} veredito(s)`).toBe(rebuscas);
  });
});
