import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * ⚠️⚠️ A TRAVA QUE FALTAVA — e que custou o shell inteiro em produção (24/08).
 *
 * `lib/supabase/server.ts` tem uma guarda que LANÇA se for avaliado no
 * navegador. Ela existe para transformar vazamento da service-role key em queda
 * barulhenta, e é boa. O problema é o que ela derruba: o módulo é avaliado
 * assim que o pacote do cliente carrega, então o erro não fica no componente
 * culpado — ele mata o `Z-SWAP` inteiro, em qualquer rota.
 *
 * Foi exatamente isso: `ÚlfhéðnarPanel.tsx` (`"use client"`) importou `estadoDa`
 * de um módulo que, na PRIMEIRA LINHA, importava `getSupabaseAdmin`. O
 * `type-check`, o `lint`, o `build` e 1.696 testes passaram — porque o defeito
 * é de AVALIAÇÃO no navegador, não de compilação. Quem achou foi o dono, no
 * celular, com a aplicação fora do ar.
 *
 * ⚠️ E A IMPORTAÇÃO ERA DE TIPO PURO. `estadoDa` não toca banco. Não importa:
 * o empacotador puxa o MÓDULO, não a função. Uma função pura morando ao lado de
 * um import de servidor é uma armadilha carregada.
 *
 * Esta trava percorre a árvore de imports — não só o primeiro nível, porque o
 * caminho real tinha um salto: painel → `mensagens.ts` → `supabase/server`.
 */

const RAIZ = path.join(process.cwd(), "src");
const PROIBIDOS = ["lib/supabase/server", "@/lib/supabase/server"];

function arquivosDe(dir: string): string[] {
  const saida: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivosDe(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) saida.push(p);
  }
  return saida;
}

/**
 * ⚠️ COMENTÁRIO NÃO É IMPORT — e a primeira versão desta trava não sabia disso.
 *
 * Ela acusou `ulfhednar/mensagem.ts`, que não importa nada: o que casou foi a
 * frase `from "@/lib/supabase/server"` escrita DENTRO do comentário que explica
 * por que aquele arquivo existe. Instrumento que afirma o que não sabe é o
 * padrão que as auditorias de 23/08 acharam dez vezes — inclusive três vezes
 * nas próprias ferramentas de auditoria.
 */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Os caminhos que um `import` do arquivo aponta, já resolvidos em disco. */
function importesLocais(arquivo: string): string[] {
  const src = semComentarios(fs.readFileSync(arquivo, "utf8"));
  const alvos: string[] = [];
  // `import ... from "x"`, `export ... from "x"`, e `import("x")`
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const bruto = m[1];
    let base: string;
    if (bruto.startsWith("@/")) base = path.join(RAIZ, bruto.slice(2));
    else if (bruto.startsWith(".")) base = path.resolve(path.dirname(arquivo), bruto);
    else continue; // pacote do node_modules: não é nosso problema
    for (const suf of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
      const tent = base + suf;
      if (fs.existsSync(tent) && fs.statSync(tent).isFile()) { alvos.push(tent); break; }
    }
  }
  return alvos;
}

/** Devolve o CAMINHO até o módulo proibido, ou `null`. O caminho é o recado. */
function caminhoAteOServidor(entrada: string): string[] | null {
  const vistos = new Set<string>();
  const fila: string[][] = [[entrada]];
  while (fila.length) {
    const trilha = fila.shift()!;
    const atual = trilha[trilha.length - 1];
    if (vistos.has(atual)) continue;
    vistos.add(atual);
    const rel = path.relative(RAIZ, atual).replace(/\\/g, "/");
    if (PROIBIDOS.some((p) => rel === `${p}.ts` || rel === p)) return trilha;
    for (const prox of importesLocais(atual)) fila.push([...trilha, prox]);
  }
  return null;
}

describe("nenhum componente cliente alcança supabase/server", () => {
  const clientes = arquivosDe(RAIZ).filter((f) => {
    const cabeca = fs.readFileSync(f, "utf8").slice(0, 200);
    return /^\s*["']use client["']/m.test(cabeca);
  });

  it("existem componentes cliente para varrer (senão a trava é decorativa)", () => {
    // ⚠️ Invariante nº 33: varredura que não achou nada precisa provar que
    // olhou. Sem isto, um seletor quebrado passa como "tudo limpo".
    expect(clientes.length).toBeGreaterThan(20);
  });

  it.each(clientes.map((f) => [path.relative(RAIZ, f), f] as const))(
    "%s não arrasta o cliente de serviço para o navegador",
    (_rotulo, arquivo) => {
      const trilha = caminhoAteOServidor(arquivo);
      const desenho = trilha?.map((p) => path.relative(RAIZ, p)).join("\n  → ");
      expect(
        trilha === null ? null : `\n  ${desenho}\n\nMova o que é puro para um módulo sem import de servidor.`,
      ).toBeNull();
    },
  );
});
