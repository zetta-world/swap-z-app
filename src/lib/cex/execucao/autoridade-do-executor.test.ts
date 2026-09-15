/**
 * ⚠️⚠️⚠️ A GUARDA ESTRUTURAL — achado A107, seção 9 do briefing.
 *
 *     Nenhum módulo de produto pode chegar em `exchange.createOrder`.
 *     Só o executor autorizado.
 *
 * ⚠️ POR QUE ISTO NÃO É UM `grep`. O briefing pede explicitamente uma guarda
 * que não seja frágil, e esta base já pagou caro por âncora textual: cinco
 * vezes nesta auditoria uma trava casou com o próprio comentário que contava a
 * cicatriz. Procurar a string `createOrder` no repositório pegaria documentação,
 * nome de variável e este arquivo aqui.
 *
 * A pergunta que esta guarda faz é ESTRUTURAL: **quem alcança o primitivo pelo
 * grafo de imports?** Ela constrói o grafo a partir dos `import ... from`
 * (com os comentários removidos ANTES, senão um import citado em prosa vira
 * aresta), e depois faz busca em largura a partir de cada arquivo de produto.
 *
 * ⚠️ E ELA TEM O LADO POSITIVO. Uma guarda que só proíbe passaria verde num
 * repositório onde o executor também foi desligado — que é o desfecho pior.
 * Por isso ela também EXIGE que o caminho legítimo exista: executor → primitivo
 * → `createOrder`, e que os quatro consumidores cheguem ao executor.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";

const RAIZ = "src";

/** ⚠️ Comentários saem ANTES de qualquer leitura. Ver o cabeçalho. */
const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function todosOsArquivos(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) todosOsArquivos(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const ARQUIVOS = todosOsArquivos(RAIZ);
const EH_TESTE = (p: string) => /\.test\.tsx?$/.test(p);

/** Resolve `@/x` e `./x` para um caminho real do repositório. */
function resolverImport(deArquivo: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(RAIZ, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(deArquivo), spec);
  else return null;                    // pacote externo — fora do grafo
  const rel = relative(process.cwd(), base);
  for (const suf of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const cand = rel + suf;
    if (existsSync(cand) && /\.(ts|tsx)$/.test(cand)) return cand;
  }
  return null;
}

/** O grafo: arquivo → arquivos que ele importa. */
const GRAFO = new Map<string, string[]>();
const FONTE = new Map<string, string>();
for (const f of ARQUIVOS) {
  const cru = readFileSync(f, "utf8");
  FONTE.set(f, cru);
  const limpo = semComentarios(cru);
  const destinos: string[] = [];
  for (const m of limpo.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+["']([^"']+)["']/g)) {
    const alvo = resolverImport(f, m[1]);
    if (alvo) destinos.push(alvo);
  }
  for (const m of limpo.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
    const alvo = resolverImport(f, m[1]);
    if (alvo) destinos.push(alvo);
  }
  GRAFO.set(f, destinos);
}

const PRIMITIVO = "src/lib/cex/execucao/venue-primitivo.ts";
const EXECUTOR  = "src/lib/cex/execucao/executor.ts";

/** Quem alcança `alvo` andando pelo grafo, partindo de `de`? */
function alcanca(de: string, alvo: string, proibindo: string[] = []): boolean {
  const vistos = new Set<string>([de]);
  const fila = [de];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const prox of GRAFO.get(atual) ?? []) {
      if (prox === alvo) return true;
      if (proibindo.includes(prox)) continue;
      if (!vistos.has(prox)) { vistos.add(prox); fila.push(prox); }
    }
  }
  return false;
}

describe("① o grafo foi construído de verdade", () => {
  it("⚠️⚠️ senão esta guarda aprovaria o vazio", () => {
    // Um resolvedor que não casa nada devolve um grafo sem arestas, e TODA
    // afirmação de "ninguém alcança" passaria. Esta é a trava da trava.
    expect(ARQUIVOS.length).toBeGreaterThan(300);
    const arestas = [...GRAFO.values()].reduce((t, v) => t + v.length, 0);
    expect(arestas).toBeGreaterThan(500);
    expect(existsSync(PRIMITIVO)).toBe(true);
    expect(existsSync(EXECUTOR)).toBe(true);
  });

  it("⚠️⚠️ as DUAS formas de import resolvem — sentinelas concretas", () => {
    /**
     * ⚠️ CONTAR ARESTAS NÃO BASTA, e eu descobri isso quebrando: mutilei o
     * resolvedor para ignorar imports RELATIVOS e a contagem continuou acima
     * do piso, porque a maioria do repositório usa `@/`. A guarda passou verde
     * com metade do grafo cega — e um atalho por `./` teria escapado.
     *
     * Agora ela exige aresta CONHECIDA de cada forma. Perder qualquer uma das
     * duas quebra o teste, em vez de encolher o grafo em silêncio.
     */
    expect(GRAFO.get(EXECUTOR) ?? [], "aresta @/ do executor").toContain(PRIMITIVO);
    expect(GRAFO.get("src/lib/cex/server.ts") ?? [], "aresta relativa de server.ts")
      .toContain("src/lib/cex/types.ts");
  });
});

describe("② SÓ o primitivo contém a chamada a createOrder", () => {
  it("⚠️⚠️ nenhum outro arquivo de produção a invoca", () => {
    const culpados: string[] = [];
    for (const f of ARQUIVOS) {
      if (f === PRIMITIVO || EH_TESTE(f)) continue;
      const limpo = semComentarios(FONTE.get(f)!);
      // ⚠️ A invocação, não a palavra: `.createOrder(` com receptor.
      if (/\.\s*createOrder\s*\(/.test(limpo)) culpados.push(f);
    }
    expect(culpados, "arquivos chamando createOrder fora do primitivo").toEqual([]);
  });

  it("⚠️ e o primitivo REALMENTE a contém — o caminho legítimo existe", () => {
    // Sem isto, apagar a chamada do repositório inteiro passaria verde.
    expect(/\.\s*createOrder\s*\(/.test(semComentarios(FONTE.get(PRIMITIVO)!))).toBe(true);
  });
});

describe("③ quem importa o primitivo", () => {
  it("⚠️⚠️ só o executor — por import direto", () => {
    const importadores = ARQUIVOS.filter(
      (f) => f !== PRIMITIVO && !EH_TESTE(f) && (GRAFO.get(f) ?? []).includes(PRIMITIVO));
    expect(importadores).toEqual([EXECUTOR]);
  });

  it("⚠️⚠️ e nenhuma ROTA alcança o primitivo sem passar pelo executor", () => {
    /**
     * A pergunta que um `grep` não faz. Um arquivo de produto poderia importar
     * um helper que importa o primitivo — o atalho voltaria por baixo, sem a
     * palavra `createOrder` aparecer em lugar nenhum.
     */
    const rotas = ARQUIVOS.filter((f) => f.startsWith("src/app/") && !EH_TESTE(f));
    const furos = rotas.filter((f) => alcanca(f, PRIMITIVO, [EXECUTOR]));
    expect(furos, "rotas que chegam ao primitivo por fora do executor").toEqual([]);
  });

  it("⚠️ nenhum COMPONENTE alcança o primitivo, nem pelo executor", () => {
    // O navegador não executa ordem: ele pede a uma rota. Um componente que
    // alcançasse o executor levaria o ccxt inteiro para o bundle, junto.
    const componentes = ARQUIVOS.filter((f) => f.startsWith("src/components/") && !EH_TESTE(f));
    const furos = componentes.filter((f) => alcanca(f, PRIMITIVO));
    expect(furos, "componentes de cliente alcançando o primitivo").toEqual([]);
  });
});

describe("④ o lado POSITIVO — o caminho legítimo está inteiro", () => {
  it("⚠️⚠️ o executor alcança o primitivo", () => {
    expect(alcanca(EXECUTOR, PRIMITIVO)).toBe(true);
  });

  it("⚠️⚠️ os TRÊS consumidores alcançam o executor", () => {
    // Uma guarda que só proíbe passaria verde num repositório onde o executor
    // também foi desligado — o desfecho pior.
    const consumidores = [
      "src/app/api/cex/order/route.ts",
      "src/app/api/dca/cron/route.ts",
      "src/app/api/autopilot/cron/route.ts",
    ];
    for (const c of consumidores) {
      expect(existsSync(c), c).toBe(true);
      expect(alcanca(c, EXECUTOR), `${c} precisa chegar ao executor`).toBe(true);
    }
  });

  it("⚠️ e nenhum deles importa o primitivo direto", () => {
    for (const c of ["src/app/api/cex/order/route.ts", "src/app/api/dca/cron/route.ts",
                     "src/app/api/autopilot/cron/route.ts"]) {
      expect((GRAFO.get(c) ?? []).includes(PRIMITIVO), c).toBe(false);
    }
  });
});

describe("⑤ as peças novas estão LIGADAS — não é só código bonito", () => {
  /**
   * ⚠️⚠️ A FAMÍLIA DE DEFEITO DESTA AUDITORIA É "A PEÇA CERTA, DESLIGADA".
   * Doze dos trinta achados anteriores tinham essa forma. Escrever um
   * reconciliador que ninguém chama seria cometê-la no conserto dela.
   */
  const alcancaDeQualquerProducao = (alvo: string) =>
    ARQUIVOS.some((f) => !EH_TESTE(f) && f !== alvo && alcanca(f, alvo));

  it("⚠️⚠️ o RECUPERADOR é chamado por um cron de verdade", () => {
    const CRON = "src/app/api/autopilot/cron/route.ts";
    expect((GRAFO.get(CRON) ?? [])).toContain("src/lib/cex/execucao/reconciliador.ts");
    const fonte = semComentarios(FONTE.get(CRON)!);
    expect(fonte).toMatch(/reconciliarPendentes\(/);
  });

  it("⚠️ a DERIVA DE CONTA é chamada pela reconciliação", () => {
    expect((GRAFO.get("src/lib/cex/execucao/reconciliador.ts") ?? []))
      .toContain("src/lib/cex/execucao/deriva.ts");
    expect(semComentarios(FONTE.get("src/lib/cex/execucao/reconciliador.ts")!))
      .toMatch(/detectarDeriva\(/);
  });

  it("⚠️ o CERTIFICADO e a POLÍTICA são alcançados por produção", () => {
    expect(alcancaDeQualquerProducao("src/lib/autopilot/politica.ts")).toBe(true);
    expect(alcancaDeQualquerProducao("src/lib/autopilot/certificado.ts")).toBe(true);
    expect(alcancaDeQualquerProducao("src/lib/autopilot/tier-da-sessao.ts")).toBe(true);
    expect(alcancaDeQualquerProducao("src/lib/dca/capacidade.ts")).toBe(true);
    expect(alcancaDeQualquerProducao("src/lib/dca/liquidacao.ts")).toBe(true);
  });

  it("⚠️⚠️ `multi-perna` NÃO é chamado por produção — e isso é DECLARADO", () => {
    /**
     * Esta é a única peça desta leva que fica deliberadamente desligada, e o
     * teste existe para que isso seja uma AFIRMAÇÃO e não um esquecimento.
     *
     * Ela dá o vocabulário — exposição residual, compensação, quarentena — para
     * arbitragem multi-perna. Ligá-la significaria construir o executor de
     * arbitragem, e o veredito da auditoria é NO-GO para arbitragem autônoma.
     * Ter o vocabulário não é ter a prova.
     *
     * ⚠️ Quando alguém ligar, este teste quebra — e é aí que a conversa sobre
     * o NO-GO tem de acontecer.
     */
    expect(alcancaDeQualquerProducao("src/lib/cex/execucao/multi-perna.ts")).toBe(false);
  });
});

describe("⑥ o banco falso não vaza para produção", () => {
  it("⚠️ nenhum arquivo de produção importa `banco-falso`", () => {
    const falso = "src/lib/cex/execucao/banco-falso.ts";
    const culpados = ARQUIVOS.filter(
      (f) => !EH_TESTE(f) && f !== falso && (GRAFO.get(f) ?? []).includes(falso));
    expect(culpados).toEqual([]);
  });
});
