import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️⚠️ A CLASSE DE DEFEITO QUE ESTA TRAVA IMPEDE DE VOLTAR.
 *
 * O cliente do Supabase NÃO LANÇA em erro de banco: ele RESOLVE com
 * `{ data: null, error }`. Uma escrita sem conferência é indistinguível de uma
 * escrita bem-sucedida — e no autopilot cada uma dessas falhas tem consequência
 * própria em DINHEIRO REAL:
 *
 *   · posição não gravada  → o bot nunca mais sai daquele trade (#340)
 *   · saída não marcada    → a passada seguinte vende a mesma bolsa DE NOVO
 *   · posição não reaberta → fica presa apontando para ordem morta
 *   · posição não removida → o teto de exposição conta capital que já saiu
 *   · P&L não contabilizado → o STOP DE PERDA DIÁRIA não vê a perda
 *
 * Já custou US$ 450 a 1.000 em catorze carteiras de papel (`engine.ts:492`).
 */

const STORE = readFileSync(join(process.cwd(), "src/lib/autopilot/positions-server.ts"), "utf8");
const CRON  = readFileSync(join(process.cwd(), "src/app/api/autopilot/cron/route.ts"), "utf8");

const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");

/** As funções que escrevem estado de posição ou de risco. */
const ESCRITORAS = [
  "recordServerEntry", "markServerExitArmed", "reopenServerPosition",
  "closeServerPosition", "applySessionPnl",
];

describe("as escritoras devolvem SE gravaram", () => {
  it.each(ESCRITORAS)("%s não devolve void", (fn) => {
    // `Promise<void>` é a assinatura que torna a conferência impossível: quem
    // chama não tem o que checar, e o defeito fica invisível por construção.
    const m = new RegExp(`export async function ${fn}\\([^)]*\\)\\s*:\\s*Promise<([^>]+)>`, "s").exec(STORE);
    expect(m, `${fn} não encontrada — renomeada? atualize esta trava`).not.toBeNull();
    expect(m![1].trim(), `${fn} devolve void — ninguém consegue conferir`).not.toBe("void");
  });
});

describe("o cron CONFERE cada uma delas", () => {
  const codigo = semComentarios(CRON);

  it.each(ESCRITORAS.filter((f) => f !== "recordServerEntry"))(
    "toda chamada a %s passa por exigirGravacao", (fn) => {
      /**
       * ⚠️ Conta CHAMADAS, não presença. Bastar que `exigirGravacao` apareça
       * uma vez no arquivo deixaria a segunda chamada da mesma função entrar
       * sem conferência — e foi exatamente assim que estas quatro passaram
       * despercebidas: cada uma tinha um caminho conferido e outro não.
       */
      const chamadas = [...codigo.matchAll(new RegExp(`await ${fn}\\(`, "g"))].length;
      const conferidas = [...codigo.matchAll(new RegExp(`exigirGravacao\\(\\s*await ${fn}\\(`, "g"))].length;
      expect(chamadas, `${fn} não é chamada no cron — atualize esta trava`).toBeGreaterThan(0);
      expect(conferidas, `${chamadas - conferidas} chamada(s) de ${fn} sem exigirGravacao`).toBe(chamadas);
    });

  it("o alerta carrega a CONSEQUÊNCIA, não só o nome da função", () => {
    // "closeServerPosition falhou" não diz a ninguém o que fazer. "o teto de
    // exposição conta capital que não está mais lá" diz.
    expect(codigo).toMatch(/o stop de perda diaria nao viu esta perda/);
    expect(codigo).toMatch(/vende duas vezes a mesma bolsa/);
    expect(codigo).toMatch(/nunca mais sai deste trade/);
    expect(codigo).toMatch(/teto de exposicao conta capital que nao esta mais la/);
  });
});
