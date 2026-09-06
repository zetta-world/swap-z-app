/**
 * ⚠️⚠️ TODA CLASSE DE COR APONTA PARA UM TOKEN QUE EXISTE.
 *
 * A cicatriz (06/09): a bancada usava `bg-bg-0/60` nos `<input>`. A escala de
 * fundo deste tema é `bg` (DEFAULT), `bg-1`…`bg-4` — **`bg-0` não existe**.
 *
 * ⚠️ E UMA CLASSE DO TAILWIND QUE NÃO RESOLVE NÃO VIRA CSS NENHUM. Ela não
 * avisa, não quebra o `build`, não aparece no `type-check` e não falha em teste
 * nenhum: o elemento simplesmente fica sem aquela propriedade. No caso, os
 * `<input>` caíram no branco padrão do navegador e a tela ficou com quatro
 * retângulos brancos gritando contra o tema escuro — quem viu foi o dono, na
 * tela, e não a nossa rede de 2.537 testes.
 *
 * É a mesma família de "duas fontes, uma silenciosa" que esta base persegue: o
 * token existia na cabeça de quem escreveu e não no `tailwind.config.ts`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();

/** Os degraus definidos para cada escala de cor do tema. */
function escalasDoTema(): Record<string, Set<string>> {
  const cfg = fs.readFileSync(path.join(RAIZ, "tailwind.config.ts"), "utf8");
  const escalas: Record<string, Set<string>> = {};
  // `nome: {` seguido de chaves `DEFAULT:` / `1:` / `dim:` até o `},`
  for (const m of cfg.matchAll(/^\s{8}(\w[\w-]*):\s*\{([^}]*)\}/gm)) {
    const nome = m[1];
    const degraus = new Set<string>();
    for (const d of m[2].matchAll(/^\s*([\w-]+):\s*["']/gm)) degraus.add(d[1]);
    if (degraus.size > 0) escalas[nome] = degraus;
  }
  return escalas;
}

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivos(p));
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) saida.push(p);
  }
  return saida;
}

/** ⚠️ Comentário não é classe — a nota que EXPLICA o defeito cita `bg-bg-0`. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("as classes de cor apontam para tokens que existem", () => {
  const escalas = escalasDoTema();

  it("o tema tem as escalas que este teste sabe conferir", () => {
    // Se o `tailwind.config.ts` mudar de forma, o teste avisa em vez de passar
    // vazio — um teste que não confere nada é pior que nenhum.
    for (const nome of ["bg", "ink", "cyan", "gold"]) {
      expect(escalas[nome], `escala ${nome}`).toBeDefined();
    }
    expect(escalas.bg.has("0")).toBe(false);   // a cicatriz, fixada
    expect(escalas.bg.has("1")).toBe(true);
  });

  it("⚠️ nenhum componente usa um degrau inexistente", () => {
    const culpados: string[] = [];
    // `bg-bg-2`, `text-ink-3`, `border-cyan/40`, `bg-gold/5` …
    const uso = /\b(?:bg|text|border|from|to|via|ring|shadow|fill|stroke|decoration|outline|divide|placeholder|caret|accent)-([a-z]+)-([a-z0-9]+)(?:\/\d+)?\b/g;

    for (const arq of arquivos(path.join(RAIZ, "src"))) {
      const src = semComentarios(fs.readFileSync(arq, "utf8"));
      for (const m of src.matchAll(uso)) {
        const [, escala, degrau] = m;
        const conhecida = escalas[escala];
        // Escala que não é do tema (ex.: `bg-white`, `text-red-500` do Tailwind
        // padrão) não é assunto deste teste.
        if (!conhecida) continue;
        if (!conhecida.has(degrau)) {
          culpados.push(`${arq.replace(RAIZ + "/", "")}  →  ${m[0]}  (a escala \`${escala}\` não tem \`${degrau}\`)`);
        }
      }
    }

    expect(
      culpados.length === 0 ? null
        : `\n  ${culpados.join("\n  ")}\n\n`
          + "Uma classe do Tailwind que não resolve não vira CSS nenhum — e não avisa.",
    ).toBeNull();
  });
});
