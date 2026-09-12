/**
 * ⚠️ O VOCABULÁRIO É A PORTA: tudo o que o cliente manda passa por aqui antes
 * de virar linha no banco ou trabalho no cron.
 */
import { describe, it, expect } from "vitest";
import { lerSimbolos, SIMBOLO_VALIDO } from "@/lib/bancada/vocabulario";

/**
 * ⚠️⚠️ UM CLIENTE PODIA DERRUBAR O CRON DE TODOS OS OUTROS.
 *
 * `/agentes` limitava símbolos em 5 e deduplicava; `/estrategias` não fazia
 * nem uma coisa nem outra, e as duas alimentam o mesmo laço do cron — cujo teto
 * de trabalho conta MESAS, não símbolos.
 */
describe("lerSimbolos — o teto que vale para as DUAS portas", () => {
  it("corta no teto do plano", () => {
    const dezMil = Array.from({ length: 10_000 }, (_, i) => `SYM${i % 900}`);
    expect(lerSimbolos(dezMil, 3)).toHaveLength(3);
    expect(lerSimbolos(dezMil, 10)).toHaveLength(10);
  });

  it("deduplica ANTES de cortar — senão um par sozinho gasta o teto", () => {
    expect(lerSimbolos(["BTC", "BTC", "BTC", "ETH"], 3)).toEqual(["BTC", "ETH"]);
  });

  /**
   * ⚠️ A DEFESA SÃO DUAS PEÇAS, e o teste tem de dizer qual faz o quê.
   *
   * O formato barra `__proto__` (underscore não passa). `CONSTRUCTOR` passa —
   * é um símbolo legítimo de 11 letras — e é inofensivo porque o acumulador
   * `visto` do tique nasce de `Object.create(null)`: sem cadeia de protótipo,
   * nenhuma chave é especial. Fingir que a regex resolve sozinha esconderia a
   * metade que realmente protege.
   */
  it("⚠️ `__proto__` não passa no formato — e o resto é o protótipo nulo do `visto`", () => {
    expect(lerSimbolos(["__proto__", "BTC"], 5)).toEqual(["BTC"]);
    expect(SIMBOLO_VALIDO.test("__proto__")).toBe(false);
    // Este passa no formato, e tem de passar: é um símbolo possível.
    expect(lerSimbolos(["constructor", "BTC"], 5)).toEqual(["CONSTRUCTOR", "BTC"]);
  });

  it("recusa o que não é símbolo, sem derrubar o resto", () => {
    expect(lerSimbolos(["btc", " eth ", "", "A", "MUITOLONGOMESMO", 42, null, {}], 10))
      .toEqual(["BTC", "ETH"]);
    expect(lerSimbolos("BTC", 5)).toEqual([]);
    expect(lerSimbolos(null, 5)).toEqual([]);
  });

  it("teto zero ou negativo não devolve lista vazia por acidente", () => {
    // Um teto quebrado não pode APAGAR os símbolos do cliente em silêncio.
    expect(lerSimbolos(["BTC", "ETH"], 0)).toEqual(["BTC"]);
    expect(lerSimbolos(["BTC", "ETH"], -5)).toEqual(["BTC"]);
  });
});
