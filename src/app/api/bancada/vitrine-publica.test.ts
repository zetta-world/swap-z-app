/**
 * ⚠️⚠️ A ÚNICA ROTA DA BANCADA ABERTA A QUEM NÃO ENTROU — e a mais cara.
 *
 * ACHADO DA AUDITORIA (lente `ratelimit`, 14/09). `/api/bancada/mesas-da-casa`
 * não tem sessão de propósito, e o `middleware.ts` só cobre `/admin/:path*` —
 * então NADA acima dela limitava coisa alguma. O cache de 30 min é lido no
 * começo e só escrito no FIM: K requisições com o cache vencido TODAS erravam e
 * TODAS varriam `zion_suggestions`. O cache não serializava nada.
 *
 * O Postgres é UM só para a plataforma: derrubar o pool aqui derruba login,
 * swap, admin e os agentes dos clientes pagantes junto.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const ROTA = semComentarios(readFileSync("src/app/api/bancada/mesas-da-casa/route.ts", "utf8"));
const MW   = semComentarios(readFileSync("src/middleware.ts", "utf8"));

describe("① a rota pública tem freio de rajada", () => {
  it("⚠️⚠️ e nada acima dela cobre — o middleware só olha /admin", () => {
    // É isto que torna o freio na própria rota obrigatório, e não redundante.
    expect(MW).toMatch(/matcher: \["\/admin\/:path\*"\]/);
    expect(MW).not.toMatch(/bancada/);
  });

  it("⚠️ a chave é o IP — numa rota ANÔNIMA é o único identificador que existe", () => {
    expect(ROTA).toMatch(/rateLimitDurable\(`vitrine:\$\{getClientId\(req\.headers\)\}`/);
    // Nas rotas COM sessão a chave é a carteira; usar IP lá seria o erro que o
    // DCA já pagou. Aqui não há carteira.
    expect(ROTA).not.toMatch(/getSession/);
  });

  it("⚠️ recusa com 429 e Retry-After, não com silêncio", () => {
    expect(ROTA).toMatch(/status: 429/);
    expect(ROTA).toMatch(/"Retry-After": String\(limite\.retryAfter\)/);
  });
});

describe("② só uma varredura por vez, e quem perde serve o cache velho", () => {
  it("⚠️⚠️ existe trava, e ela falha ABERTA", () => {
    expect(ROTA).toMatch(/const TRAVA = "lock:bancada:mesas-da-casa"/);
    expect(ROTA).toMatch(/if \(!\(await pegouATrava\(db\)\)\)/);
    // Não conseguir ler a trava não pode derrubar a vitrine: o pior caso sem
    // trava é exatamente o que já existia.
    expect(ROTA).toMatch(/catch \{ return true; \}/);
  });

  it("⚠️⚠️ o cache vencido é servido COM RÓTULO PRÓPRIO, nunca como fresco", () => {
    // Devolver "velho" e "fresco" como a mesma coisa é a família de defeito que
    // esta auditoria inteira persegue.
    expect(ROTA).toMatch(/doCache: "vencido"/);
    expect(ROTA).toMatch(/doCache: true/);
  });

  it("⚠️ sem cache nenhum para servir, 503 — não um vazio que parece resposta", () => {
    expect(ROTA).toMatch(/error: "medindo", cartoes: \[\] \}, \{ status: 503 \}/);
  });
});

describe("③ o índice NÃO entrou, e a nota diz por quê", () => {
  /**
   * ⚠️ A leitura óbvia do achado é "falta índice em (source, status,
   * created_at)". Ele foi criado, medido com `explain (analyze, buffers)` sobre
   * as 5.875 linhas reais, e desfeito: seq scan 4,25 ms / 169 buffers contra
   * index scan 3,95 ms / 1.422 buffers. Esta trava existe para que ninguém
   * "conserte" isso de novo sem medir.
   */
  const CRU = readFileSync("src/app/api/bancada/mesas-da-casa/route.ts", "utf8");

  it("⚠️ a medição que desaconselha o índice está escrita no arquivo", () => {
    expect(CRU).toMatch(/O ÍNDICE \*\*NÃO\*\* É A CORREÇÃO/);
    expect(CRU).toMatch(/1\.422 buffers/);
    expect(CRU).toMatch(/QUANDO ELE PASSARIA A PAGAR/);
  });
});
