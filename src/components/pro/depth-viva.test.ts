import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { melhorBuyAmount, tamanhoExecutavel } from "@/lib/pro/profundidade";

/**
 * ⚠️⚠️ A `DEPTH` MOSTRAVA `—` NAS CINCO FAIXAS (31/08).
 *
 * O painel pedia cotação FIRME com o endereço nulo como carteira. Três coisas
 * erradas na mesma linha, e qualquer uma sozinha bastava para o painel nunca
 * responder:
 *
 *   ① `mode=quote` exige carteira real (`taker_required_for_quote`), e o
 *      endereço nulo não constrói transação nenhuma na 0x.
 *   ② `mode=quote` passa pelo KILL-SWITCH DO SWAP — desligar o swap apagaria um
 *      painel de INFORMAÇÃO, que não move dinheiro.
 *   ③ São 10 cotações firmes por atualização contra `RL_FIRM = 25/min`.
 *
 * ⚠️ E O CAMINHO CERTO JÁ EXISTIA. `mode=list` chama `fetchZeroXPrice` —
 * indicativo, sem taker, sem kill-switch, no limite folgado. Impacto de preço é
 * exatamente uma pergunta indicativa: ninguém vai assinar essa cotação.
 */

/**
 * ⚠️ A VARREDURA IGNORA COMENTÁRIO, e isto foi um teste falhando por si mesmo.
 *
 * A primeira versão procurava `mode: "quote"` no arquivo inteiro e acusava — o
 * comentário que EXPLICA o defeito cita a string antiga. Uma trava que não
 * separa código de prosa proíbe documentar o que se consertou, que é o oposto
 * do que este repositório quer.
 */
const semComentario = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DEPTH = semComentario(readFileSync("src/components/pro/ProDepth.tsx", "utf8"));
const ROTA  = readFileSync("src/app/api/quote/route.ts", "utf8");

describe("o painel pede a cotação que a rota sabe dar sem carteira", () => {
  it("⚠️ usa `mode: list`, não `quote`", () => {
    expect(DEPTH).toMatch(/mode:\s+"list"/);
    expect(DEPTH).not.toMatch(/mode:\s+"quote"/);
  });

  it("⚠️⚠️ e não manda mais taker nenhum", () => {
    // Era `0x0000...0000`. Um endereço que não é de ninguém.
    expect(DEPTH).not.toMatch(/taker:\s+"0x0{40}"/);
    expect(DEPTH).not.toMatch(/taker:/);
  });

  it("a rota de fato exige carteira no modo firme — o defeito era real", () => {
    expect(ROTA).toMatch(/if \(!taker\) return NextResponse\.json\(\{ error: "taker_required_for_quote" \}/);
  });

  it("⚠️ e o modo firme passa pelo kill-switch do swap, que não é assunto deste painel", () => {
    expect(semComentario(ROTA)).toMatch(/if \(mode === "quote"\) \{[\s\S]{0,120}checarKillSwitches/);
  });

  it("o modo lista usa o preço INDICATIVO da 0x, que não precisa de taker", () => {
    expect(ROTA).toMatch(/fetchZeroXPrice\(zxArgs, zeroXKey\)/);
  });
});

describe("⚠️ ler a lista sem inventar número", () => {
  it("lista vazia devolve `null`, nunca 0", () => {
    // Zero viraria "impacto de 100%" e a tela pintaria uma pool intransitável a
    // partir de uma resposta vazia.
    expect(melhorBuyAmount({ quotes: [] })).toBe(null);
    expect(melhorBuyAmount({})).toBe(null);
    expect(melhorBuyAmount(null)).toBe(null);
    expect(melhorBuyAmount({ quotes: [{ buyAmount: "0" }] })).toBe(null);
  });

  it("⚠️ pega o MAIOR recebido, não o primeiro da lista", () => {
    // `rankQuotes` ordena ponderando prazo e taxa; para IMPACTO o que interessa
    // é quanto se recebe. Depender da ordem alheia acopla duas decisões.
    expect(melhorBuyAmount({ quotes: [{ buyAmount: "100" }, { buyAmount: "250" }, { buyAmount: "80" }] })).toBe(250);
  });

  it("valor ilegível não derruba a leitura dos outros", () => {
    expect(melhorBuyAmount({ quotes: [{ buyAmount: "abc" }, { buyAmount: "42" }] })).toBe(42);
    expect(melhorBuyAmount({ quotes: [{}, { buyAmount: "7" }] })).toBe(7);
  });

  it("uma cotação só é lida normalmente", () => {
    expect(melhorBuyAmount({ quotes: [{ buyAmount: "1234567890" }] })).toBe(1234567890);
  });
});

/**
 * ⚠️ E A SEGUNDA FILA DO POOL STATS CHEGA NA MESMA RESPOSTA.
 *
 * `market_cap_usd`, `fdv_usd`, `pool_created_at`, o `h1` de preço e volume e o
 * `transactions.h24` são declarados em `GTPoolAttrs`, vêm no mesmo `fetch` e
 * eram descartados por `getPoolMeta`. Zero requisição nova para todos.
 */
describe("o que já chegava e era jogado fora", () => {
  const GT    = readFileSync("src/lib/api/geckoterminal.ts", "utf8");
  const STATS = semComentario(readFileSync("src/components/pro/ProPoolStats.tsx", "utf8"));

  it("⚠️ `PoolMeta` carrega os campos descartados", () => {
    for (const campo of ["marketCapUsd", "fdvUsd", "criadaEmMs", "change1h", "volume1h",
                         "compradores24h", "vendedores24h", "compras24h", "vendas24h"]) {
      expect(GT, campo).toMatch(new RegExp(`${campo}:`));
    }
  });

  it("⚠️⚠️ ausente vira `null`, nunca 0 — `attrNumber` diria zero", () => {
    // Zero em `holders` diria "ninguém tem este token"; em `buyers`, "ninguém
    // comprou". As duas são afirmações fortes construídas sobre ausência.
    expect(GT).toMatch(/function numeroOuNulo/);
    expect(GT).toMatch(/marketCapUsd:\s+numeroOuNulo\(a\.market_cap_usd\)/);
    expect(GT).toMatch(/compradores24h: numeroOuNulo\(a\.transactions\?\.h24\?\.buyers\)/);
  });

  it("⚠️ e a tela mostra — inclusive a linha de CARTEIRAS ÚNICAS", () => {
    expect(STATS).toMatch(/Market cap/);
    expect(STATS).toMatch(/Idade da pool/);
    expect(STATS).toMatch(/Carteiras 24h/);
    expect(STATS).toMatch(/lerParticipacao\(meta\)/);
  });

  it("⚠️ a razão FDV/mcap não sai com metade dos dados", () => {
    expect(STATS).toMatch(/if \(mc == null \|\| fdv == null \|\| !\(mc > 0\)\) return ""/);
  });
});

/**
 * ⚠️⚠️ A PERGUNTA INVERTIDA — item 7 da lista.
 *
 * A matriz responde "qual o impacto de $50k?". Ninguém chega na tela com essa
 * pergunta: a pergunta é "até quanto consigo executar sem pagar caro?". Ela
 * nunca esteve na tela porque exige inverter a tabela.
 */
describe("⚠️ o tamanho executável", () => {
  const l = (size: number, bps: number | null) => ({ size, buyBps: bps, sellBps: bps });

  it("acha o ponto de corte entre duas faixas medidas", () => {
    const r = tamanhoExecutavel([l(1_000, 2), l(10_000, 8), l(50_000, 25), l(250_000, 90)], 30);
    expect(r.usd).not.toBe(null);
    expect(r.usd!).toBeGreaterThan(50_000);
    expect(r.usd!).toBeLessThan(250_000);
    expect(r.texto).toMatch(/acima de ~\$\d+k você paga mais de 30bps/);
  });

  it("⚠️⚠️ interpola em LOG do tamanho, não linearmente", () => {
    // Entre 50k e 250k, com o teto exatamente no meio dos bps, o linear daria
    // 150k. As faixas são geométricas, e o linear sai sistematicamente otimista.
    const r = tamanhoExecutavel([l(50_000, 20), l(250_000, 40)], 30);
    expect(r.usd!).toBeLessThan(150_000);
    expect(r.usd!).toBeGreaterThan(100_000);   // ~111k
  });

  it("⚠️ usa o PIOR dos dois lados — quem executa paga o lado ruim", () => {
    const r = tamanhoExecutavel([{ size: 10_000, buyBps: 5, sellBps: 80 }, { size: 1_000, buyBps: 1, sellBps: 2 }], 30);
    expect(r.usd!).toBeLessThan(10_000);
  });

  it("⚠️⚠️ nunca atravessou: NÃO extrapola além do que foi medido", () => {
    // Dizer "aguenta $5M" a partir de uma medição que parou em $1M seria
    // inventar profundidade que ninguém viu.
    const r = tamanhoExecutavel([l(1_000, 1), l(1_000_000, 4)], 30);
    expect(r.usd).toBe(1_000_000);
    expect(r.texto).toContain("acima disso não foi medido");
  });

  it("⚠️ já estoura na menor faixa: diz isso, e não inventa número abaixo dela", () => {
    const r = tamanhoExecutavel([l(1_000, 55), l(10_000, 120)], 30);
    expect(r.usd).toBe(null);
    expect(r.texto).toContain("já custa 55bps");
  });

  it("⚠️ sem medição nenhuma, cala", () => {
    expect(tamanhoExecutavel([]).usd).toBe(null);
    expect(tamanhoExecutavel([l(1_000, null), l(10_000, null)]).texto).toContain("não medida");
  });

  it("faixa com um lado só ainda conta", () => {
    const r = tamanhoExecutavel([{ size: 1_000, buyBps: 2, sellBps: null }, { size: 10_000, buyBps: 90, sellBps: null }], 30);
    expect(r.usd!).toBeGreaterThan(1_000);
    expect(r.usd!).toBeLessThan(10_000);
  });
});

describe("⚠️ e a leitura invertida chega ao cabeçalho do painel", () => {
  it("o painel calcula e mostra", () => {
    expect(DEPTH).toMatch(/tamanhoExecutavel\(rows\)/);
    expect(DEPTH).toMatch(/\{loading \? "computing…" : executavel\.texto\}/);
  });

  it("⚠️ e fica âmbar quando nem a menor faixa passa — não some no cinza", () => {
    expect(DEPTH).toMatch(/executavel\.usd === null \? "#F5A623"/);
  });
});
