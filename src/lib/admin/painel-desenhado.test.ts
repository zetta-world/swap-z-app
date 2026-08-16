import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MODULE_REGISTRY } from "@/lib/admin/modules";
import { modulosDaArea, AREAS } from "@/lib/admin/areas";

/**
 * ⚠️⚠️ A INVARIANTE Nº 32, FINALMENTE COM TESTE — "quem me chama?".
 *
 * O registro (`lib/admin/modules.ts`) diz que um painel EXISTE. O mapa
 * (`components/admin/panel-map.tsx`) diz quem o DESENHA. São dois arquivos, e
 * nada obrigava os dois a concordarem.
 *
 * Em 15/08 eu escrevi o painel da taxa da corretora, registrei o módulo,
 * importei o componente — e esqueci a linha do mapa. Resultado: `tsc` passou,
 * `lint` passou, 1338 testes passaram, o build passou, e a tela ficou vazia. O
 * dono foi procurar o botão e não achou. Eu tinha registrado essa invariante
 * horas antes, e a violei dentro da própria correção dela.
 *
 * ⚠️ POR QUE O TESTE LÊ O ARQUIVO EM VEZ DE IMPORTAR O MAPA: importar
 * `panel-map.tsx` puxa 51 componentes de cliente com `useState`, `fetch` e
 * `useEffect` para dentro do vitest — caro, frágil, e nada disso é necessário
 * para conferir chaves. O defeito é textual (uma linha que não existe), então a
 * verificação também é.
 */
const MAPA = readFileSync("src/components/admin/panel-map.tsx", "utf8");
const REGISTRO = readFileSync("src/lib/admin/modules.ts", "utf8");

/** As chaves declaradas no mapa: `"id": <Componente />`. */
function idsDoMapa(): Set<string> {
  const out = new Set<string>();
  for (const m of MAPA.matchAll(/^\s*"([\w-]+)":\s*</gm)) out.add(m[1]);
  return out;
}

describe("todo painel declarado é DESENHADO", () => {
  it("nenhum módulo do registro fica sem componente no mapa", () => {
    const mapa = idsDoMapa();
    const semDesenho = MODULE_REGISTRY.filter((m) => !mapa.has(m.id)).map((m) => m.id);
    expect(
      semDesenho,
      "declarado em modules.ts e ausente de panel-map.tsx — compila, passa no lint, "
        + "e a tela fica VAZIA. Foi exatamente isto em 15/08.",
    ).toEqual([]);
  });

  it("nenhum componente no mapa aponta para módulo que não existe", () => {
    // O inverso: uma entrada órfã é um componente que nada consegue abrir —
    // trabalho feito e invisível, que é a outra metade da mesma invariante.
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id));
    const orfaos = [...idsDoMapa()].filter((id) => !ids.has(id));
    expect(orfaos, "entrada no mapa sem módulo no registro").toEqual([]);
  });

  /**
   * ⚠️ E O IMPORT TEM DE EXISTIR. A minha correção de 15/08 falhou em duas
   * pontas diferentes em dias diferentes: primeiro faltou a linha do mapa,
   * depois o import estava lá e a linha do mapa não. Três pontas, três formas
   * de a tela ficar vazia — e agora as três são conferidas.
   */
  it("todo componente usado no mapa está importado", () => {
    const usados = [...MAPA.matchAll(/^\s*"[\w-]+":\s*<(\w+)\s*\/>/gm)].map((m) => m[1]);
    const importados = new Set([...MAPA.matchAll(/^import\s+(\w+)\s+from/gm)].map((m) => m[1]));
    const faltando = [...new Set(usados)].filter((c) => !importados.has(c));
    expect(faltando, "usado no mapa e não importado").toEqual([]);
  });
});

describe("todo painel é ALCANÇÁVEL pela navegação", () => {
  /**
   * ⚠️ DESENHADO NÃO BASTA — precisa ter porta. Com a reforma de áreas, um
   * painel fora de toda área existe, desenha, e nenhum menu leva a ele. É o
   * mesmo defeito com outra roupa: trabalho que roda e ninguém vê.
   */
  it("todo módulo aparece em exatamente UMA área", () => {
    const contagem = new Map<string, number>();
    for (const a of AREAS) for (const id of modulosDaArea(a.id)) {
      contagem.set(id, (contagem.get(id) ?? 0) + 1);
    }
    const semPorta = MODULE_REGISTRY.filter((m) => !contagem.has(m.id)).map((m) => m.id);
    const duplicados = [...contagem.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(semPorta, "não aparece em nenhuma área — menu nenhum leva até ele").toEqual([]);
    expect(duplicados, "aparece em duas áreas — a URL dele fica ambígua").toEqual([]);
  });

  /**
   * ⚠️ O REGISTRO E O TIPO `ModuleId` TAMBÉM PODEM DIVERGIR. Um id no registro
   * sem entrada na união de tipos não compila; o contrário compila e some.
   */
  it("todo id do registro está declarado no tipo ModuleId", () => {
    const naUniao = new Set(
      // ⚠️ O `;?` importa: o ÚLTIMO membro da união termina com ponto e
      // vírgula, e sem ele este teste acusaria `platform-events` para sempre.
      // Um teste que dá falso positivo é descartado pelo próximo que o ler.
      [...REGISTRO.matchAll(/^\s*\|\s*"([\w-]+)";?$/gm)].map((m) => m[1]),
    );
    const fora = MODULE_REGISTRY.filter((m) => !naUniao.has(m.id)).map((m) => m.id);
    expect(fora, "no registro e fora do tipo ModuleId").toEqual([]);
  });
});
