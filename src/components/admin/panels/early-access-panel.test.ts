/**
 * EarlyAccessPanel — a leitura da lista não pode voltar ao desenho antigo.
 *
 * ⚠️ O DEFEITO (Fase 1, achado na revisão de lint): o efeito chamava
 * `load()` — uma função que faz setState — direto no corpo
 * (`react-hooks/set-state-in-effect`). Além do aviso, duas leituras em voo
 * podiam chegar fora de ordem e a resposta VELHA sobrescrevia a nova.
 *
 * O lint só AVISA (o CI não reprova aviso), então esta trava lê a fonte. O
 * vitest roda em `node`, sem DOM: o defeito é de forma, e a forma é conferida.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(process.cwd(), "src/components/admin/panels/EarlyAccessPanel.tsx"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("EarlyAccessPanel — leitura cancelável, sem setState no corpo do efeito", () => {
  it("⚠️ cada execução do efeito tem AbortController e a limpeza o cancela", () => {
    expect(SRC).toMatch(/const ctl = new AbortController\(\)/);
    expect(SRC).toMatch(/signal: ctl\.signal/);
    expect(SRC).toMatch(/return \(\) => ctl\.abort\(\);/);
  });

  it("⚠️ resposta cancelada não escreve estado (ordem e desmontagem)", () => {
    const aposLeitura = SRC.slice(SRC.indexOf("fetch(`/admin/api/early-access?${p}`"));
    expect(aposLeitura).toMatch(/\.then\(\(j\) => \{\s*if \(ctl\.signal\.aborted\) return;/);
    expect(aposLeitura).toMatch(/\.catch\(\(e\) => \{\s*if \(ctl\.signal\.aborted\) return;/);
  });

  it("⚠️ não existe mais um carregador com setState chamado no corpo de um efeito", () => {
    expect(SRC).not.toMatch(/useEffect\(\(\)\s*=>\s*\{\s*load\(\);/);
    expect(SRC).not.toMatch(/const load = useCallback/);
  });

  it("⚠️ F-07: os eventos da linha usam 'só a última escreve' e são cancelados ao desmontar", () => {
    const corpo = SRC.slice(SRC.indexOf("async function carregarEventos"), SRC.indexOf("async function abrir"));
    expect(corpo).toMatch(/const signal = leituraEventos\.nova\(\);/);
    expect(corpo).toMatch(/fetch\(`\/admin\/api\/early-access\?id=\$\{id\}`, \{ signal \}\)/);
    // o aborted é conferido ANTES de cada escrita de estado
    expect(corpo.indexOf("if (signal.aborted) return;")).toBeLessThan(corpo.indexOf("setEventos("));
    expect(SRC).toMatch(/useEffect\(\(\) => \(\) => leituraEventos\.cancelar\(\), \[leituraEventos\]\);/);
    expect(SRC).toMatch(/leituraEventos\.cancelar\(\); setAberta\(null\)/);
  });

  it("o realtime e a transição pedem releitura pelo contador, e ele está nas dependências", () => {
    expect(SRC).toMatch(/realtime\.subscribe\(\(scope\) => \{ if \(scope === "audit"\) recarregar\(\); \}\)/);
    expect(SRC).toMatch(/\}, \[status, q, recarga, aoVivo\]\);/);
  });
});
