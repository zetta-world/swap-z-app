import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { melhorBuyAmount } from "@/lib/pro/profundidade";

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
