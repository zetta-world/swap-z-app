/**
 * ⚠️⚠️ EXCLUIR UMA ORDEM COW ATIVA APAGAVA O REGISTRO SEM CANCELÁ-LA.
 * Achado A24 da auditoria externa.
 *
 * O botão "excluir" chama `deletePendingOrder(id)`, que remove a linha do
 * `localStorage` — e só. Uma ordem enviada à CoW vive no ORDERBOOK DELES, sob um
 * `orderUid`, e continua lá: pode preencher horas depois, contra uma carteira
 * que o dono acredita estar limpa.
 *
 * ⚠️ E `cow.ts` NÃO TEM CANCELAMENTO. Só `submitCowOrder` e
 * `fetchCowOrderStatus`. O comentário de `CowSubmissionResult` chega a dizer
 * "API slug used in subsequent requests (status / cancel)" — o cancelamento foi
 * previsto e nunca escrito. O botão prometia o que o módulo não tem.
 *
 * ⚠️⚠️ E APAGAR ERA PIOR QUE NÃO FAZER NADA: o laço de 60s só consulta o status
 * de ordens que estão NA LISTA. Sem o registro, uma ordem que preencher não
 * deixa rastro nenhum na tela do dono.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { podeApagarORegistro, linkDoExplorerCow } from "./apagar-ordem";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const LISTA = semComentarios(leia("src/components/orders/ZionOrdersList.tsx"));
const COW   = leia("src/lib/limit/cow.ts");
const MSG   = leia("src/lib/i18n/messages.ts");

describe("① só se apaga o registro de uma ordem que não pode mais preencher", () => {
  it("⚠️⚠️ ordem VIVA (`open`) não pode ser apagada", () => {
    const v = podeApagarORegistro({ cow: { lastStatus: "open" } });
    expect(v.pode).toBe(false);
    if (v.pode) return;
    expect(v.porque).toBe("viva");
  });

  it("⚠️⚠️ status DESCONHECIDO também não — não saber não é estar morta", () => {
    // É o estado de "a consulta de status ainda não respondeu". Tratá-lo como
    // morto é exatamente o defeito, por outra porta.
    for (const cow of [{ lastStatus: "unknown" as const }, {}]) {
      const v = podeApagarORegistro({ cow });
      expect(v.pode, JSON.stringify(cow)).toBe(false);
      if (!v.pode) expect(v.porque).toBe("desconhecida");
    }
  });

  it("os três estados MORTOS liberam o apagamento", () => {
    for (const st of ["fulfilled", "cancelled", "expired"] as const) {
      expect(podeApagarORegistro({ cow: { lastStatus: st } }).pode, st).toBe(true);
    }
  });

  it("ordem só local pode ser apagada — apagar o registro É apagar a ordem", () => {
    expect(podeApagarORegistro({}).pode).toBe(true);
    expect(podeApagarORegistro({ cow: null }).pode).toBe(true);
  });
});

describe("② o link para onde o dono CONSEGUE cancelar", () => {
  it("monta a URL do explorer para as redes que a CoW atende", () => {
    expect(linkDoExplorerCow("ethereum", "0xabc")).toBe("https://explorer.cow.fi/mainnet/orders/0xabc");
    expect(linkDoExplorerCow("arbitrum", "0xabc")).toBe("https://explorer.cow.fi/arbitrum_one/orders/0xabc");
    expect(linkDoExplorerCow("base", "0xabc")).toBe("https://explorer.cow.fi/base/orders/0xabc");
  });

  it("⚠️ rede sem CoW ou uid vazio devolve `null` — nada de link quebrado", () => {
    expect(linkDoExplorerCow("solana", "0xabc")).toBeNull();
    expect(linkDoExplorerCow("ethereum", "")).toBeNull();
  });

  it("⚠️⚠️ os slugs NÃO divergem dos que `cow.ts` usa na API", () => {
    // Dois mapas do mesmo dado é a porta dos fundos que esta auditoria já
    // encontrou várias vezes. Se um for editado sem o outro, isto reprova.
    for (const [chain, slug] of [["ethereum", "mainnet"], ["arbitrum", "arbitrum_one"], ["base", "base"]] as const) {
      expect(COW).toMatch(new RegExp(`${chain}:\\s*"${slug}"`));
      expect(linkDoExplorerCow(chain, "0x1")).toContain(`/${slug}/`);
    }
  });
});

/**
 * ⚠️⚠️ TRAVA DO FIO — a regra acima tem teste que a EXECUTA, e seguiria verde
 * com a lista apagando tudo como antes.
 */
describe("③ e a lista REALMENTE consulta a regra antes de apagar", () => {
  it("⚠️⚠️ `onDelete` pergunta antes, e desiste quando a resposta é não", () => {
    expect(LISTA).toMatch(/const veredito = podeApagarORegistro\(\{ cow: ordem\?\.cow \?\? null \}\)/);
    expect(LISTA).toMatch(/if \(!veredito\.pode\) \{/);
    const i = LISTA.indexOf("if (!veredito.pode) {");
    expect(LISTA.slice(i, i + 160)).toMatch(/return;/);
  });

  it("⚠️⚠️ e a consulta vem ANTES do `deletePendingOrder`", () => {
    const iRegra = LISTA.indexOf("podeApagarORegistro(");
    const iApaga = LISTA.indexOf("deletePendingOrder(id)");
    expect(iRegra).toBeGreaterThan(0);
    expect(iApaga).toBeGreaterThan(iRegra);
  });

  it("⚠️ a tela distingue VIVA de DESCONHECIDA — são situações diferentes", () => {
    expect(LISTA).toMatch(/naoApagavel\.porque === "viva" \? "orders\.cowAindaViva" : "orders\.cowStatusDesconhecido"/);
  });

  it("⚠️ e oferece o link do explorer, que é onde dá para cancelar de verdade", () => {
    expect(LISTA).toMatch(/linkDoExplorerCow\(bloqueada\.cow\.chain, bloqueada\.cow\.orderUid\)/);
    expect(LISTA).toMatch(/orders\.cowCancelarLa/);
  });

  it("as TRÊS chaves existem nos QUATRO locales", () => {
    for (const k of ["cowAindaViva", "cowStatusDesconhecido", "cowCancelarLa"]) {
      expect([...MSG.matchAll(new RegExp(`${k}:`, "g")), ], k).toHaveLength(4);
    }
  });
});
