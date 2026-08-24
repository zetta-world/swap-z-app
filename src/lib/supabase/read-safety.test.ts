import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A CLASSE INTEIRA DE ERRO, TRAVADA DE UMA VEZ.
 *
 * ⚠️ POR QUE ISTO É UM TESTE E NÃO UMA REGRA DE REVISÃO.
 *
 * O mesmo defeito apareceu CINCO vezes em duas semanas, sempre descoberto pelo
 * estrago e nunca pela leitura:
 *
 *   1. O vazamento de caixa original — dedup truncado em 1.000 linhas, as mesas
 *      reabrindo posições que já tinham, caixa debitado por posição inexistente.
 *   2. `resolvePaperPositions` lendo posição arquivada como viva.
 *   3. `reconcileWallets` pedindo `.limit(20000)` e recebendo ~1.000 — o que fez
 *      o reparo pagar US$ 1.429,09 de déficit fantasma.
 *   4. `arbiter2` lendo arquivada como aberta e devolvendo US$ 100,19 ao caixa.
 *   5. A reconciliação da bancada reportando números que ela mesma inventou.
 *
 * Cada um foi consertado como INCIDENTE. Ninguém perguntou quantos mais
 * existiam. Quando a pergunta foi feita, a resposta era 47.
 *
 * Consertar 47 à mão sem esta trava significa consertar 47 e ganhar o 48º na
 * semana seguinte. Uma correção que depende de alguém lembrar não é correção,
 * é uma intenção com data de validade.
 *
 * AS DUAS REGRAS
 *
 * `limit` NÃO É GARANTIA. É um pedido do cliente; o PostgREST tem teto próprio
 * no servidor (tipicamente 1.000). Pedir 20.000 devolve 1.000, sem erro, sem
 * aviso e sem ordem definida. Só `selectAllRows`/`.range()` percorre tudo.
 *
 * `archived_at` SEPARA MEDIÇÃO DE HISTÓRICO. Ler sem o filtro mistura trade
 * vivo com trade retirado da medição — e nos caminhos que creditam caixa, isso
 * vira dinheiro.
 *
 * COMO DECLARAR UM RECORTE LEGÍTIMO
 *
 * Nem toda leitura precisa do universo: "os últimos 50 eventos da tela" é um
 * recorte honesto. Mas ele tem que ser DECLARADO, porque a diferença entre
 * recorte e truncamento não está no código — está na intenção, e intenção não
 * declarada é indistinguível de esquecimento.
 *
 *   // leitura-limitada: <por que este recorte basta>
 *   // inclui-arquivadas: <por que o histórico entra aqui>
 */

const CRESCEM = ["paper_positions", "zion_suggestions", "platform_events", "admin_audit_log"];
const ARQUIVAVEIS = ["paper_positions", "zion_suggestions"];

function arquivosTs(dir: string, out: string[] = []): string[] {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) arquivosTs(p, out);
    else if (/\.tsx?$/.test(nome) && !nome.includes(".test.")) out.push(p);
  }
  return out;
}

interface Leitura { arquivo: string; linha: number; tabela: string; janela: string; antes: string }

function leituras(): Leitura[] {
  const out: Leitura[] = [];
  for (const arquivo of arquivosTs("src")) {
    const linhas = readFileSync(arquivo, "utf8").split("\n");
    for (let i = 0; i < linhas.length; i++) {
      const m = /\.from\("(\w+)"\)/.exec(linhas[i]);
      if (!m) continue;
      // O encadeamento inteiro: até o `;` que fecha, ou 14 linhas.
      let janela = "";
      for (let k = i; k < Math.min(i + 14, linhas.length); k++) {
        janela += linhas[k] + "\n";
        if (linhas[k].includes(";")) break;
      }
      if (!/\.select\(/.test(janela)) continue;
      // ESCRITAS NÃO SÃO LEITURAS. `upsert(...).select()` devolve o que foi
      // gravado — não há universo a truncar, e exigir paginação ali seria
      // ruído. Um teste que grita onde não há problema é o começo de um teste
      // que ninguém lê.
      if (/\.(upsert|insert|update|delete)\(/.test(janela)) continue;
      // `head: true` conta linhas sem trazê-las. Também não trunca.
      if (/head:\s*true/.test(janela)) continue;
      out.push({
        arquivo, linha: i + 1, tabela: m[1], janela,
        // As 8 linhas anteriores carregam a declaração — e, quando a leitura é
        // o corpo de um `selectAllRows`, a chamada que a envolve.
        antes: linhas.slice(Math.max(0, i - 8), i).join("\n"),
      });
    }
  }
  return out;
}

/** Uma linha só, para o operador ir direto ao ponto. */
const ref = (l: Leitura) => `${l.arquivo}:${l.linha} (${l.tabela})`;

describe("nenhuma leitura pode truncar em silêncio", () => {
  it("toda leitura de tabela que cresce é paginada, apontada ou DECLARADA", () => {
    const faltando = leituras().filter((l) => {
      if (!CRESCEM.includes(l.tabela)) return false;
      // Paginada: percorre tudo, por construção.
      if (/\.range\(|selectAllRows/.test(l.janela) || /selectAllRows/.test(l.antes)) return false;
      // Apontada: uma linha específica não tem o que truncar.
      if (/maybeSingle\(\)|\.single\(\)|\.eq\("id"|\.eq\("key"|\.in\("key"/.test(l.janela)) return false;
      // Declarada: o recorte é intencional e o motivo está escrito.
      if (/leitura-limitada:/.test(l.antes)) return false;
      return true;
    });

    expect(faltando.map(ref), [
      "",
      "Estas leituras podem voltar truncadas SEM erro e sem aviso.",
      "`limit` é um pedido; o PostgREST tem teto próprio (~1.000 linhas).",
      "",
      "Conserte com `selectAllRows`, ou declare o recorte na linha acima:",
      "  // leitura-limitada: <por que este recorte basta>",
      "",
    ].join("\n")).toEqual([]);
  });
});

describe("nenhuma leitura mistura arquivado com vivo", () => {
  it("toda leitura de tabela arquivável filtra `archived_at` ou DECLARA que não", () => {
    const faltando = leituras().filter((l) => {
      if (!ARQUIVAVEIS.includes(l.tabela)) return false;
      if (/archived_at/.test(l.janela)) return false;
      if (/\.eq\("id"|maybeSingle\(\)|\.single\(\)/.test(l.janela)) return false;
      if (/inclui-arquivadas:/.test(l.antes)) return false;
      return true;
    });

    expect(faltando.map(ref), [
      "",
      "Estas leituras misturam trade VIVO com trade retirado da medição.",
      "Nos caminhos que creditam caixa, isso vira dinheiro (US$ 100,19 em 03/08).",
      "",
      "Conserte com `.is(\"archived_at\", null)`, ou declare na linha acima:",
      "  // inclui-arquivadas: <por que o histórico entra aqui>",
      "",
    ].join("\n")).toEqual([]);
  });
});

describe("a trava não pode ser fácil de contornar", () => {
  it("as duas listas de tabelas não estão vazias", () => {
    // Um dia alguém "conserta" a suíte esvaziando a lista. O teste percebe.
    expect(CRESCEM.length).toBeGreaterThan(3);
    expect(ARQUIVAVEIS.length).toBeGreaterThan(1);
  });

  it("o scanner realmente enxerga o código — não passa por varrer nada", () => {
    // Sem isto, um erro no caminho ou no regex faria a suíte passar por vazio,
    // que é a pior forma de um teste falhar: dizendo que está tudo bem.
    const todas = leituras();
    expect(todas.length).toBeGreaterThan(40);
    expect(todas.some((l) => l.tabela === "paper_positions")).toBe(true);
  });
});
