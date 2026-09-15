/**
 * ⚠️⚠️ DCA SIMULADO E DCA REAL SÃO CAPACIDADES DIFERENTES — achados A112, A114,
 * A115. Cenários F e G do briefing.
 *
 * Produção foi encontrada com `dca_liberado = "true"` e, ao lado, a
 * justificativa: *"aberto em 25/08 para o primeiro teste SIMULADO"*. O mesmo
 * interruptor liberava o caminho REAL — e ninguém lê a justificativa a tempo.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decidirCapacidade, CHAVE_DCA_REAL, CHAVE_DCA_SIMULADO, CHAVE_LEGADA_SIMULADO,
} from "@/lib/dca/capacidade";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("① A112 — o real nasce FECHADO", () => {
  it("⚠️⚠️ sem registro de `dca_real_liberado`, real é RECUSADO", () => {
    const v = decidirCapacidade("real", { simulado: "true", real: null });
    expect(v.permitido).toBe(false);
    expect(v.causa).toBe("sem_registro");
  });

  it("⚠️⚠️ e o interruptor do SIMULADO não abre o real", () => {
    // Este é o achado inteiro: `dca_liberado = true` foi aberto para um teste
    // sem dinheiro, e liberava o caminho que gasta.
    const v = decidirCapacidade("real", { simulado: "true", real: null });
    expect(v.permitido).toBe(false);
  });

  it("⚠️ o gêmeo positivo: com a chave REAL aberta, o real passa", () => {
    // Sem isto, uma função que recusasse sempre passaria no bloco acima.
    expect(decidirCapacidade("real", { simulado: null, real: "true" }).permitido).toBe(true);
  });

  it("simulado continua aberto pela chave legada — teste em curso não cai", () => {
    expect(decidirCapacidade("simulado", { simulado: "true", real: null }).permitido).toBe(true);
  });

  it("⚠️ falha de leitura é FECHADO, com causa própria", () => {
    // Colapsar `indisponivel` em `fechado_por_decisao` transformaria falha de
    // infraestrutura em "o dono não liberou", e ninguém iria olhar o banco.
    const v = decidirCapacidade("real", { simulado: undefined, real: undefined });
    expect(v.permitido).toBe(false);
    expect(v.causa).toBe("indisponivel");
  });

  it("qualquer coisa que não seja exatamente 'true' é fechado", () => {
    for (const lixo of ["TRUE", "1", "sim", "", "yes"]) {
      expect(decidirCapacidade("real", { simulado: null, real: lixo }).permitido, lixo).toBe(false);
    }
  });

  it("⚠️⚠️ a chave legada NUNCA é consultada para o caminho real", () => {
    const FONTE = semComentarios(readFileSync("src/lib/dca/capacidade.ts", "utf8"));
    const i = FONTE.indexOf("real: achar(");
    expect(i).toBeGreaterThan(-1);
    /**
     * ⚠️ A ASSERÇÃO É SOBRE O IDENTIFICADOR NO FONTE, não sobre o valor da
     * constante — o fonte escreve `achar(CHAVE_DCA_REAL)`, e a primeira versão
     * desta trava procurava a string "dca_real_liberado", que só existe na
     * declaração. Âncora tem de casar com o que está escrito.
     */
    const linhaDoReal = FONTE.slice(i, i + 120);
    expect(linhaDoReal).toContain("CHAVE_DCA_REAL");
    expect(linhaDoReal).not.toContain("CHAVE_LEGADA_SIMULADO");
    expect(linhaDoReal).not.toContain("CHAVE_DCA_SIMULADO");
    // E as três chaves são mesmo distintas.
    expect(new Set([CHAVE_DCA_REAL, CHAVE_DCA_SIMULADO, CHAVE_LEGADA_SIMULADO]).size).toBe(3);
  });

  it("⚠️ e o cron CONFERE a capacidade antes de qualquer coisa", () => {
    const CRON = semComentarios(readFileSync("src/app/api/dca/cron/route.ts", "utf8"));
    expect(CRON).toMatch(/decidirCapacidade\(/);
    // ⚠️ Antes do gate de automação: "este produto pode mover dinheiro?" é
    // pergunta anterior a "esta carteira pode automatizar?".
    expect(CRON.indexOf("decidirCapacidade(")).toBeLessThan(CRON.indexOf("decidirAutomacao("));
  });
});

describe("② A114 — a chave do DCA real é verificada antes de ser guardada", () => {
  const ROTA = semComentarios(readFileSync("src/app/api/dca/planos/route.ts", "utf8"));

  it("⚠️⚠️ `verificarChave` roda ANTES de `guardarConexao`", () => {
    // A rota de armar o autopilot faz isto desde 09/08. Esta não fazia.
    const iVerifica = ROTA.indexOf("verificarChave(");
    const iGuarda   = ROTA.indexOf("guardarConexao({");
    expect(iVerifica).toBeGreaterThan(-1);
    expect(iGuarda).toBeGreaterThan(-1);
    expect(iVerifica).toBeLessThan(iGuarda);
  });

  it("⚠️⚠️ chave que PODE SACAR é recusada para dinheiro real", () => {
    expect(ROTA).toMatch(/decidirArmar\(permissao\)/);
    expect(ROTA).toMatch(/if \(!decisao\.permitido\)/);
    expect(ROTA).toMatch(/chave_pode_sacar/);
  });

  it("⚠️ e só o caminho REAL passa por isso — simulado não pede chave", () => {
    const iModoReal = ROTA.indexOf('if (modo === "real")');
    expect(iModoReal).toBeGreaterThan(-1);
    expect(ROTA.indexOf("verificarChave(")).toBeGreaterThan(iModoReal);
  });
});

describe("③ A115 — o cofre é a fonte autoritativa, sem fallback silencioso", () => {
  const SESSOES = semComentarios(readFileSync("src/lib/autopilot/sessions.ts", "utf8"));
  const CONEXOES = semComentarios(readFileSync("src/lib/cex/conexoes.ts", "utf8"));

  it("⚠️⚠️ `lerConexaoPorId` distingue 'não existe' de 'não deu para ler'", () => {
    // Devolver `null` nos dois casos é o que fazia a leitura falhada cair no
    // segredo LEGADO — e a propriedade do cofre morrer quando o banco piora.
    expect(CONEXOES).toMatch(/Promise<Conexao \| null \| undefined>/);
    expect(CONEXOES).toMatch(/if \(error\) return undefined;/);
    expect(CONEXOES).toMatch(/if \(!data\) return null;/);
  });

  it("⚠️⚠️ com `conexao_id`, os TRÊS casos ruins BLOQUEIAM", () => {
    const i = SESSOES.indexOf("export async function credenciaisDaSessao");
    const corpo = SESSOES.slice(i, SESSOES.indexOf("\nexport ", i + 10));
    expect(corpo).toMatch(/if \(c === undefined\)[\s\S]{0,140}throw/);
    expect(corpo).toMatch(/if \(c === null\)[\s\S]{0,140}throw/);
    expect(corpo).toMatch(/if \(!c\.is_active\)[\s\S]{0,140}throw/);
  });

  it("⚠️⚠️ e NÃO existe caminho do cofre para o segredo legado", () => {
    const i = SESSOES.indexOf("export async function credenciaisDaSessao");
    const corpo = SESSOES.slice(i, SESSOES.indexOf("\nexport ", i + 10));
    // Dentro do ramo `if (row.conexao_id)` não pode haver `decryptSessionCreds`.
    const iRamo = corpo.indexOf("if (row.conexao_id)");
    const iFimRamo = corpo.indexOf("return { creds: decryptSessionCreds(row)");
    expect(iRamo).toBeGreaterThan(-1);
    expect(iFimRamo).toBeGreaterThan(iRamo);
    expect(corpo.slice(iRamo, iFimRamo)).not.toContain("decryptSessionCreds");
  });

  it("⚠️ o caminho legado sobrevive SÓ para sessão sem `conexao_id`, e é medido", () => {
    // Ele é explícito e contado (`origem: "sessao"`), não um `return` mudo de
    // fim de função. Quando o contador zerar, `creds_cipher` sai da tabela.
    const i = SESSOES.indexOf("export async function credenciaisDaSessao");
    const corpo = SESSOES.slice(i, SESSOES.indexOf("\nexport ", i + 10));
    expect(corpo).toMatch(/origem: "sessao"/);
    expect(corpo).toMatch(/origem: "cofre"/);
  });

  it("⚠️⚠️ no DCA, falha de leitura NÃO encerra o plano como revogado", () => {
    // `!conexao` cobria `null` e `undefined` juntos: uma queda de banco matava
    // um plano de poupança do cliente, com um motivo que dizia outra coisa.
    const CRON = semComentarios(readFileSync("src/app/api/dca/cron/route.ts", "utf8"));
    expect(CRON).toMatch(/if \(conexao === undefined\)/);
    expect(CRON).toMatch(/if \(conexao === null \|\| !conexao\.is_active\)/);
    expect(CRON).not.toMatch(/if \(!conexao \|\| !conexao\.is_active\)/);
  });
});
