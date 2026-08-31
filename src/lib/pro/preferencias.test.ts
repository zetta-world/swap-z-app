import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { lerPreferencias, escreverPreferencias, INDICADORES } from "@/lib/pro/preferencias";

/**
 * ⚠️ O QUE SOBREVIVE AO REFRESH — item 9.
 *
 * Quem usa o terminal liga os mesmos três indicadores, no mesmo timeframe, no
 * mesmo par, toda vez que abre. Refazer isso a cada carga é o que separa uma
 * demonstração de uma ferramenta.
 *
 * ⚠️⚠️ MAS DADO GUARDADO NO NAVEGADOR É DADO DE FORA. Ele pode estar corrompido,
 * ter sido escrito por outra versão, ou por alguém no console — e nada disso
 * pode virar estado da tela sem passar por uma porta.
 */

describe("⚠️ ler é filtrar, não confiar", () => {
  it("lê o que é válido", () => {
    const p = lerPreferencias(JSON.stringify({ pairId: "bnb-usdt-pcs-v3", tf: "15m", kind: "line", ligados: ["rsi", "macd"] }));
    expect(p).toEqual({ pairId: "bnb-usdt-pcs-v3", tf: "15m", kind: "line", ligados: ["rsi", "macd"] });
  });

  it("⚠️⚠️ indicador que não está na lista fechada é DESCARTADO", () => {
    // Sem isso, qualquer chave gravada por uma versão futura — ou por alguém
    // mexendo no console — viraria indicador ligado.
    const p = lerPreferencias(JSON.stringify({ ligados: ["rsi", "__proto__", "drop", "macd"] }));
    expect(p.ligados).toEqual(["rsi", "macd"]);
  });

  it("⚠️ timeframe e tipo de gráfico inválidos somem", () => {
    const p = lerPreferencias(JSON.stringify({ tf: "3s", kind: "hologram" }));
    expect(p.tf).toBe(undefined);
    expect(p.kind).toBe(undefined);
  });

  it("⚠️⚠️ JSON quebrado NÃO derruba a tela — devolve o padrão", () => {
    // Abrir no padrão é o mesmo resultado de nunca ter salvado nada, que é
    // exatamente o certo.
    expect(lerPreferencias("{isto não é json")).toEqual({});
    expect(lerPreferencias("null")).toEqual({});
    expect(lerPreferencias("[1,2,3]").ligados).toBe(undefined);
    expect(lerPreferencias(null)).toEqual({});
    expect(lerPreferencias(undefined)).toEqual({});
  });

  it("⚠️ tipo errado no lugar certo também é descartado", () => {
    const p = lerPreferencias(JSON.stringify({ pairId: 42, tf: ["5m"], ligados: "rsi" }));
    expect(p).toEqual({});
  });

  it("⚠️ pairId absurdamente longo não entra", () => {
    expect(lerPreferencias(JSON.stringify({ pairId: "x".repeat(500) })).pairId).toBe(undefined);
  });

  it("repetido vira único", () => {
    expect(lerPreferencias(JSON.stringify({ ligados: ["rsi", "rsi", "rsi"] })).ligados).toEqual(["rsi"]);
  });
});

describe("escrever e ler fecham o ciclo", () => {
  it("ida e volta preserva o que é válido", () => {
    const original = { pairId: "eth-usdc-uni-v3-005", tf: "1h", kind: "candle", ligados: [...INDICADORES] };
    expect(lerPreferencias(escreverPreferencias(original))).toEqual(original);
  });

  it("⚠️ escrever também filtra — lixo não chega ao armazenamento", () => {
    const s = escreverPreferencias({ ligados: ["rsi", "inventado"] as never });
    expect(JSON.parse(s).ligados).toEqual(["rsi"]);
  });
});

/**
 * ⚠️⚠️ AS DUAS ARMADILHAS DA LIGAÇÃO, e as duas quebram de formas que só
 * aparecem em produção.
 */
describe("como o terminal usa", () => {
  const semComentario = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const TERM = semComentario(readFileSync("src/components/pro/ProTerminal.tsx", "utf8"));

  it("⚠️ lê DEPOIS da montagem, nunca no `useState` inicial", () => {
    // Este componente renderiza no servidor, onde `localStorage` não existe.
    // Ler no estado inicial daria marcação diferente entre servidor e cliente —
    // o erro de hidratação que faz o React descartar a árvore e remontar.
    expect(TERM).not.toMatch(/useState\([^)]*carregar\(\)/);
    expect(TERM).toMatch(/useEffect\(\(\) => \{\s*const p = carregar\(\);/);
  });

  it("⚠️⚠️ NÃO salva antes de ter lido", () => {
    // Sem a guarda, o primeiro efeito de salvar rodaria com os padrões e
    // SOBRESCREVERIA o guardado — apagando a preferência no instante em que o
    // usuário abre a página.
    expect(TERM).toMatch(/if \(!prefsCarregadas\) return;/);
    expect(TERM).toMatch(/setPrefsCarregadas\(true\)/);
  });

  it("o efeito de salvar depende de tudo que ele salva", () => {
    const deps = TERM.match(/\}, \[prefsCarregadas, pair\.id, tf, kind, ([^\]]*)\]\)/);
    expect(deps, "deps do efeito de salvar").not.toBe(null);
    for (const nome of ["maOn", "emaOn", "bb", "vwap", "rsiOn", "macd", "stochRsi"]) {
      expect(deps![1], nome).toContain(nome);
    }
  });
});
