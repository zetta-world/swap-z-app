import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️⚠️ O DEFEITO QUE ESTA TRAVA IMPEDE DE VOLTAR (25/08).
 *
 * O dono criou o primeiro plano de DCA simulado. O cron passou 48 segundos
 * depois, com o plano JÁ VENCIDO — e não fez nada. Nenhum ciclo, nenhum evento,
 * nenhuma pista. Ele veria "0 de 3 comprados" para sempre.
 *
 * Duas causas, as duas minhas:
 *
 *   1. o gate lido era o do AUTOPILOT (`autopilot_cex_liberado`), uma chave que
 *      nunca existiu no banco — e "sem registro" significa FECHADO. O plano de
 *      poupança, que não toca a IA, foi barrado por uma trava que existe para
 *      segurar o robô. O plano do projeto já dizia que o gate seria próprio;
 *      escrevi isso no documento e não no código.
 *
 *   2. barrado devolvia só `{ acao: "barrado" }` no corpo da resposta HTTP, que
 *      ninguém lê. É a invariante nº 7 — fechado não pode ser silencioso.
 *
 * ⚠️ E O CRON DO AUTOPILOT JÁ FAZIA CERTO: lá as sessões barradas viram linha
 * com a causa. Eu li aquele arquivo para escrever este e copiei a estrutura sem
 * a parte que importava.
 */

const CRON = readFileSync(join(process.cwd(), "src/app/api/dca/cron/route.ts"), "utf8");
const LIB  = readFileSync(join(process.cwd(), "src/lib/autopilot/liberacao.ts"), "utf8");
const semComentarios = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/^(\s*)\/\/.*$/gm, "$1");
const CODIGO = semComentarios(CRON);

describe("o DCA lê o gate DELE, não o do autopilot", () => {
  it("existem chaves próprias para o DCA", () => {
    expect(LIB).toMatch(/CHAVE_LIBERACAO_DCA = "dca_liberado"/);
    expect(LIB).toMatch(/CHAVE_PILOTOS_DCA\s*=\s*"dca_pilotos"/);
  });

  it("⚠️ o cron do DCA passa 'dca' — sem isso ele herda a trava do robô de IA", () => {
    expect(CODIGO).toMatch(/lerLiberacao\("dca"\)/);
    expect(CODIGO).toMatch(/lerPilotos\("dca"\)/);
  });

  it("as chaves do autopilot continuam intactas", () => {
    // O conserto não pode ter mexido no gate que protege dinheiro real.
    expect(LIB).toMatch(/CHAVE_LIBERACAO = "autopilot_cex_liberado"/);
    expect(LIB).toMatch(/CHAVE_PILOTOS\s*=\s*"autopilot_cex_pilotos"/);
  });

  it("o padrão sem argumento continua sendo o autopilot", () => {
    // Qualquer chamador antigo tem de seguir lendo o que lia. Trocar o padrão
    // silenciosamente abriria o gate do robô para quem só queria o do DCA.
    expect(LIB).toMatch(/lerLiberacao\(produto: "autopilot" \| "dca" = "autopilot"\)/);
    expect(LIB).toMatch(/lerPilotos\(produto: "autopilot" \| "dca" = "autopilot"\)/);
  });
});

describe("barrado deixa rastro", () => {
  it("grava um evento com a causa", () => {
    expect(CODIGO).toMatch(/recordEvent\("dca_barrado"/);
    expect(CODIGO).toMatch(/causa: v\.causa/);
  });

  it("⚠️ o evento diz COMO destravar, não só que travou", () => {
    // "barrado" sozinho manda o dono adivinhar. O texto nomeia a chave e o
    // valor que abrem — a diferença entre um alarme e uma instrução.
    expect(CRON).toMatch(/dca_liberado/);
    expect(CRON).toMatch(/dca_pilotos/);
  });

  it("é AGUARDADO — na Vercel a função congela depois da resposta", () => {
    expect(CODIGO).toMatch(/await recordEvent\("dca_barrado"/);
  });

  it("tem dedup, e o comentário não promete mais do que o código faz", () => {
    // ⚠️ A primeira versão deste conserto tinha o comentário do dedup e NÃO
    // tinha o dedup. Comentário afirmando o que o código não faz é o mesmo
    // defeito, uma camada acima.
    expect(CODIGO).toMatch(/primeiraVezNaJanela\(`barrado:\$\{p\.id\}:\$\{v\.causa\}`, 3_600_000\)/);
    expect(CODIGO).toMatch(/async function primeiraVezNaJanela/);
  });

  it("o dedup FALHA PARA O LADO DE GRAVAR", () => {
    // Se o admin_kv não responder, o evento sai: duplicata é ruído, ausência é
    // cegueira, e entre os dois o ruído é barato.
    expect(CODIGO).toMatch(/catch \{ return true; \}/);
  });
});
