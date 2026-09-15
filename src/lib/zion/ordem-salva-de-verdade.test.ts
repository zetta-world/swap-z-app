/**
 * ⚠️⚠️ UM DOS TRÊS CHAMADORES DIZIA "SALVA" SEM TER SALVO.
 * Achado A23 da auditoria externa.
 *
 * `savePendingOrder` devolve `null` quando o `localStorage` recusa — cheio,
 * janela privada, dados do site limpos. O store já estava certo: ele foi MUDADO
 * de propósito para devolver isso, e o cabeçalho dele diz que "o defeito era de
 * CLASSE — `safeWrite` era `void` e ninguém podia conferir".
 *
 * Dois dos três chamadores conferem, e cada um carrega a cicatriz por escrito:
 *
 *   OrdersView            "antes engolia e o toast dizia 'salva'"
 *   SignLimitOrderButton  "devolvia um objeto mesmo quando o localStorage
 *                          estava cheio, e o attachCowOrder seguinte fazia…"
 *
 * O terceiro descartava o retorno e mostrava "salva" incondicionalmente: o dono
 * fechava a tela acreditando ter uma ordem agendada que não existia.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => semComentarios(readFileSync(join(process.cwd(), p), "utf8"));

const ROUTER = leia("src/components/zion/ZionExecuteRouter.tsx");
const VIEW   = leia("src/components/orders/OrdersView.tsx");
const BOTAO  = leia("src/components/zion/SignLimitOrderButton.tsx");
const STORE  = leia("src/lib/zion/orders.ts");
const MSG    = readFileSync(join(process.cwd(), "src/lib/i18n/messages.ts"), "utf8");

describe("① o store continua devolvendo SE gravou", () => {
  it("⚠️ `savePendingOrder` devolve `PendingOrder | null`, não void", () => {
    expect(STORE).toMatch(/export function savePendingOrder\([^)]*\): PendingOrder \| null/);
    expect(STORE).toMatch(/return safeWrite\(existing\) \? order : null/);
  });

  it("⚠️ e `safeWrite` devolve booleano — era `void`, e ninguém podia conferir", () => {
    expect(STORE).toMatch(/function safeWrite\(orders: PendingOrder\[\]\): boolean/);
  });
});

describe("② os TRÊS chamadores conferem", () => {
  it("⚠️⚠️ nenhum descarta o retorno de `savePendingOrder`", () => {
    // Um `savePendingOrder(card);` solto é o defeito inteiro.
    for (const [nome, src] of [["router", ROUTER], ["view", VIEW], ["botao", BOTAO]] as const) {
      expect(src, `${nome} descarta o retorno`).not.toMatch(/^\s*savePendingOrder\(card\);\s*$/m);
    }
  });

  it("⚠️⚠️ o router BARRA e avisa quando não gravou", () => {
    expect(ROUTER).toMatch(/if \(!savePendingOrder\(card\)\) \{/);
    const i = ROUTER.indexOf("if (!savePendingOrder(card)) {");
    const ramo = ROUTER.slice(i, i + 200);
    expect(ramo).toMatch(/toast\.error\(t\("orders\.saveFailedToast"\)\)/);
    expect(ramo).toMatch(/return;/);
  });

  it("⚠️⚠️ e o 'salva' só sai DEPOIS da conferência", () => {
    const iConfere = ROUTER.indexOf("if (!savePendingOrder(card))");
    const iSalva = ROUTER.indexOf('toast.success(t("toast.saved")');
    expect(iConfere).toBeGreaterThan(0);
    expect(iSalva).toBeGreaterThan(iConfere);
  });

  it("os outros dois continuam como estavam", () => {
    expect(VIEW).toMatch(/if \(!savePendingOrder\(card\)\) \{/);
    expect(BOTAO).toMatch(/const saved = savePendingOrder\(card\)/);
    expect(BOTAO).toMatch(/saved !== null && attachCowOrder\(/);
  });
});

describe("③ e a frase diz que a ordem NÃO foi criada", () => {
  it("⚠️ não é um erro genérico — o dono precisa saber que não há ordem", () => {
    expect(MSG).toMatch(/saveFailedToast:.*A ordem NÃO foi criada/);
  });

  it("a chave existe nos QUATRO locales", () => {
    expect([...MSG.matchAll(/saveFailedToast:/g)]).toHaveLength(4);
  });
});
