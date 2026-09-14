/**
 * ⚠️⚠️ O 51º PLANO NÃO PODIA SER PARADO — achado A18 da auditoria externa.
 *
 * O PATCH autorizava pausar/encerrar com
 * `planosDaCarteira(wallet).find(p => p.id === id)`, e essa lista tem teto de
 * **50**, ordenada do mais novo para o mais velho.
 *
 * O cron lê `planosVencidos` com teto de **200**. Do 51º plano mais antigo em
 * diante havia uma assimetria com dinheiro dentro: **o executor enxergava
 * planos que o controlador não conseguia parar**. Pausar e encerrar devolviam
 * 404 `nao_encontrado` — e o plano seguia comprando, janela após janela, sem
 * botão que o alcançasse.
 *
 * É o botão de parar que não para, pela terceira vez nesta auditoria (#418
 * autopilot, #418 kill-switch, e agora o DCA).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const leia = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ROTA_BRUTA = leia("src/app/api/dca/planos/route.ts");
const ROTA   = semComentarios(ROTA_BRUTA);
const STORE  = semComentarios(leia("src/lib/dca/store.ts"));
const CRON   = semComentarios(leia("src/app/api/dca/cron/route.ts"));
const PAINEL = semComentarios(leia("src/components/cex/DcaPanel.tsx"));
const MSG    = leia("src/lib/i18n/messages.ts");

describe("① autorização é consulta dirigida, não busca em lista", () => {
  it("⚠️⚠️ PATCH e GET buscam UM plano pelo par (carteira, id)", () => {
    const chamadas = [...ROTA.matchAll(/await planoDaCarteira\(session\.sub, /g)].length;
    expect(chamadas, "PATCH e o extrato do GET").toBe(2);
  });

  it("⚠️⚠️ e NENHUM caminho autoriza por `.find` na lista paginada", () => {
    // Era `planos.find(p => p.id === planoId)` e `meus.find(p => p.id === id)`.
    expect(ROTA).not.toMatch(/planosDaCarteira\([^)]*\)[\s\S]{0,80}\.find\(/);
    expect(ROTA).not.toMatch(/\.find\(\(p\) => p\.id === (planoId|id)\)/);
  });

  it("⚠️ a consulta do store filtra pela CARTEIRA — id sozinho não autoriza", () => {
    const i = STORE.indexOf("export async function planoDaCarteira");
    expect(i).toBeGreaterThan(0);
    const corpo = STORE.slice(i, STORE.indexOf("\n}", i));
    expect(corpo).toMatch(/\.eq\("wallet_address", wallet\)/);
    expect(corpo).toMatch(/\.eq\("id", planoId\)/);
  });
});

describe("② falha de banco não vira 'não é seu'", () => {
  it("⚠️⚠️ 503, não 404 — 404 mandaria o dono procurar no lugar errado", () => {
    // O plano dele está lá, ativo e comprando. Dizer "não existe" é a pior
    // resposta possível: ele para de procurar.
    const tratamentos = [...ROTA.matchAll(/if \(meu === undefined\)/g)].length;
    expect(tratamentos, "GET e PATCH").toBe(2);
    expect([...ROTA.matchAll(/error: "banco_indisponivel" \}, \{ status: 503 \}/g)]).toHaveLength(2);
  });

  it("⚠️ o store distingue os três estados: erro, não-é-seu, e o plano", () => {
    expect(STORE).toMatch(/Promise<PlanoRow \| null \| undefined>/);
    const i = STORE.indexOf("export async function planoDaCarteira");
    const corpo = STORE.slice(i, STORE.indexOf("\n}", i));
    expect(corpo).toMatch(/if \(!db\) return undefined/);
    expect(corpo).toMatch(/if \(error \|\| !Array\.isArray\(data\)\) return undefined/);
  });
});

describe("③ e a lista diz que está cortada", () => {
  it("⚠️⚠️ o executor lê MAIS que o controlador mostrava — a assimetria é a doença", () => {
    // Estes dois números divergirem é aceitável; o que não é aceitável é a tela
    // mostrar o menor deles e afirmar que é tudo.
    expect(STORE).toMatch(/planosDaCarteira\(wallet: string, teto = 50\)/);
    expect(CRON).toMatch(/planosVencidos\(/);
  });

  it("⚠️ `null` (não sei) é diferente de `false` (mostrei tudo)", () => {
    expect(STORE).toMatch(/haMaisPlanos\(wallet: string, teto = 50\): Promise<boolean \| null>/);
    const i = STORE.indexOf("export async function haMaisPlanos");
    const corpo = STORE.slice(i, STORE.indexOf("\n}", i));
    expect(corpo).toMatch(/if \(!db\) return null/);
    expect(corpo).toMatch(/return data\.length > teto/);
  });

  it("⚠️⚠️ e a tela só avisa quando SABE — `cortada === true`, não truthy", () => {
    // `if (cortada)` trataria `null` como "mostrei tudo" calado, que é a
    // afirmação que este aviso existe para impedir.
    expect(PAINEL).toMatch(/cortada === true &&/);
    expect(PAINEL).toMatch(/cex\.dcaListaCortada/);
  });

  it("os QUATRO locales têm o aviso", () => {
    expect([...MSG.matchAll(/dcaListaCortada:/g)]).toHaveLength(4);
  });
});
