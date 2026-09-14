/**
 * ⚠️⚠️ O LAÇO INFINITO DE FETCH DA ABA "AGENTES" (14/09).
 *
 * ACHADO DA AUDITORIA, por DUAS lentes independentes, pelas duas pontas — e é
 * o tipo de defeito que esta base não consegue pegar com teste normal: o
 * vitest roda em `environment: "node"`, então nada dentro de um `.tsx` é
 * executado. A trava tem de olhar a FONTE.
 *
 * O ciclo era:
 *
 *   `carregar` tinha `[onMesas]` nas deps · o pai passava uma arrow ANÔNIMA
 *   → fetch resolve → `onMesas(lista.map(…))` → `setJaContratadas(ARRAY NOVO)`
 *   → dois arrays nunca são `Object.is`-iguais, então o pai SEMPRE re-renderiza
 *   → nova arrow → novo `carregar` → deps do efeito mudaram → fetch de novo → …
 *
 * Sem ponto de parada, contra a rota mais cara da bancada. E só no caminho
 * FELIZ: numa falha `lista` é `null` e `onMesas` nem é chamado — o defeito
 * aparecia exatamente quando tudo dava certo.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * ⚠️ SEM COMENTÁRIOS ANTES DE COMPARAR. As notas destes arquivos CITAM o código
 * antigo para explicar o defeito, e uma trava que proibisse descrever o erro
 * corrigido proibiria documentar — esta base vive das notas.
 */
const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const AGENTES = semComentarios(readFileSync("src/components/bancada/Agentes.tsx", "utf8"));
const BANCADA = semComentarios(readFileSync("src/components/bancada/Bancada.tsx", "utf8"));

describe("① a corrente do laço está quebrada dos DOIS lados", () => {
  it("⚠️⚠️ `carregar` tem identidade estável — deps vazias, não `[onMesas]`", () => {
    // Era `}, [onMesas]);` — a dep que fechava o ciclo.
    expect(AGENTES).not.toMatch(/\}, \[onMesas\]\)/);
    expect(AGENTES).toMatch(/const carregar = useCallback\([\s\S]*?\n  \}, \[\]\)/);
  });

  it("⚠️ o aviso ao pai sai de um ref, não da closure", () => {
    expect(AGENTES).toMatch(/const onMesasRef = useRef\(onMesas\)/);
    expect(AGENTES).toMatch(/onMesasRef\.current\?\.\(lista\.map/);
    // e o ref é mantido em dia
    expect(AGENTES).toMatch(/onMesasRef\.current = onMesas/);
  });

  it("⚠️ o pai passa um callback ESTÁVEL, não uma arrow no JSX", () => {
    expect(BANCADA).toMatch(/const aoSaberDasMesas = useCallback\(/);
    expect(BANCADA).toMatch(/onMesas=\{aoSaberDasMesas\}/);
    // A arrow anônima não pode voltar.
    expect(BANCADA).not.toMatch(/onMesas=\{\(m\) =>/);
  });

  it("⚠️ e ele não grava array novo quando o conteúdo é o mesmo", () => {
    // `setJaContratadas(m)` cru re-renderizava a cada leitura, para sempre.
    expect(BANCADA).toMatch(/setJaContratadas\(\(a\) =>[\s\S]{0,120}a\.every/);
  });

  /**
   * ⚠️ O intervalo de 60s era código morto: dependia de `carregar`, então era
   * destruído e recriado a cada volta do laço e nunca chegava aos 60.000 ms.
   * Com `carregar` estável ele passa a ser o que a nota dele diz que é.
   */
  it("⚠️ a recarga de 60s deixa de ser código morto", () => {
    expect(AGENTES).toMatch(/setInterval\(\(\) => \{ void carregar\(\); \}, 60_000\)/);
    expect(AGENTES).toMatch(/\}, \[carregar\]\)/);
  });
});

describe("② a aba de agentes decide com a resposta do servidor", () => {
  /**
   * ⚠️ `temAgentes` só era escrito por `<Agentes>`, e `<Agentes>` só montava
   * quando `aba === "agentes"` — que dependia de `temAgentes`. Ciclo fechado:
   * o valor nunca saía de `null`, a regra documentada nunca acontecia, e quem
   * pagava por três agentes caía em "Contratar" toda vez.
   */
  it("⚠️⚠️ `<Agentes>` monta sempre — escondido, nunca desmontado", () => {
    expect(BANCADA).toMatch(/<div hidden=\{aba !== "agentes"\}>/);
    // O `{aba === "agentes" && <Agentes` era o ciclo.
    expect(BANCADA).not.toMatch(/aba === "agentes" && \(<>[\s\S]{0,400}<Agentes/);
  });

  it("⚠️ e a regra da aba inicial continua sendo a documentada", () => {
    expect(BANCADA).toMatch(/const aba = abaEscolhida \?\? \(temAgentes \? "agentes" : "contratar"\)/);
  });
});

describe("③ a gêmea é recusada pelo SERVIDOR, não só pela tela", () => {
  const ROTA = semComentarios(readFileSync("src/app/api/bancada/agentes/route.ts", "utf8"));

  /**
   * ⚠️ A vitrine apagava o botão com `jaContratada`, e essa lista chegava vazia
   * no primeiro render. Trava que mora só na tela é trava que o primeiro render
   * contorna — e que qualquer `curl` ignora.
   */
  it("⚠️⚠️ contratar a mesma mesa duas vezes é 409, não outro slot pago", () => {
    expect(ROTA).toMatch(/\.some\(\(e\) => e\.mesa === id && !e\.arquivada\)/);
    expect(ROTA).toMatch(/error: "ja_contratada"/);
    expect(ROTA).toMatch(/\}, 409\)/);
  });

  it("⚠️ a recusa vem ANTES de gastar a cota — senão ela cobra pelo que negou", () => {
    const iJaTem = ROTA.indexOf('"ja_contratada"');
    const iCota  = ROTA.indexOf("contarMesasVivas(c.dono, c.db)");
    expect(iJaTem).toBeGreaterThan(0);
    expect(iCota).toBeGreaterThan(0);
    expect(iJaTem).toBeLessThan(iCota);
  });
});
