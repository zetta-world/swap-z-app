/**
 * O EVENTO QUE NÃO É ESPERADO NÃO É GRAVADO — guarda de fonte.
 *
 * ⚠️ DE ONDE ISTO VEIO (04/08).
 *
 * O dono rodou a janela de 12 meses do "O QUE FUNCIONOU" duas vezes e mandou o
 * print da segunda: a tela mostrou tudo — correlação de 75%, cinco estratégias,
 * 0.8s. O banco não tinha uma linha. Nem o evento de sucesso, nem o de FALHA
 * que eu tinha adicionado horas antes exatamente para esse caso.
 *
 * A rodada não falhou. Ela gravou no vazio.
 *
 * `recordEvent` é fire-and-forget por padrão, e o comentário dentro dele avisa
 * com todas as letras que num contexto serverless o chamador precisa AWAITAR
 * antes de a resposta fechar, "otherwise the function freezes and the write is
 * lost (this is why manual ZION analyses weren't being logged)".
 *
 * Ou seja: o projeto já tinha perdido dados assim uma vez, alguém escreveu o
 * aviso no lugar certo, e as rotas novas nasceram sem ele.
 *
 * Por que ninguém percebeu: é uma CORRIDA. Às vezes o insert ganha. As três
 * rodadas de 00:16 gravaram; as duas de 360 não. Não havia nada de especial na
 * janela de 12 meses — ela só perdeu a corrida duas vezes seguidas, e eu passei
 * duas respostas procurando uma causa na janela que não existia.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * A REGRA, e por que ela é de fonte e não de runtime:
 *
 * Um teste de runtime não pega isto. A promessa é criada, o insert até sai — o
 * que mata é o congelamento da função DEPOIS da resposta, que só acontece na
 * Vercel. O único lugar onde dá para exigir o `await` é no código.
 *
 * Toda chamada a `recordEvent` numa rota de `/admin/api` precisa ser aguardada.
 * Essas rotas existem para MEDIR, e todos os painéis leem os eventos de volta:
 * um evento perdido não é telemetria a menos, é a medição inteira.
 *
 * Para a exceção legítima existe uma declaração explícita — `// telemetria:` —
 * que obriga quem abre mão da durabilidade a dizer por quê, na linha.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(process.cwd(), "src/app/admin/api");

function rotas(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...rotas(p));
    else if (nome === "route.ts") out.push(p);
  }
  return out;
}

describe("durabilidade de evento nas rotas admin", () => {
  const arquivos = rotas(RAIZ);

  // Auto-proteção: se o scanner parar de achar rotas, ele passa vazio e a
  // guarda vira decoração. Já aconteceu antes neste repo com outro teste de
  // fonte, e por isso todo scanner daqui em diante afirma que achou alguma coisa.
  it("acha as rotas admin (senão a guarda não está guardando nada)", () => {
    expect(arquivos.length).toBeGreaterThan(10);
  });

  it("acha rotas que de fato chamam recordEvent", () => {
    const comEvento = arquivos.filter((f) => readFileSync(f, "utf8").includes("recordEvent("));
    expect(comEvento.length).toBeGreaterThanOrEqual(4);
  });

  it("toda chamada a recordEvent é aguardada (ou declarada como telemetria)", () => {
    const faltando: string[] = [];

    for (const arquivo of arquivos) {
      const linhas = readFileSync(arquivo, "utf8").split("\n");
      linhas.forEach((linha, i) => {
        if (!linha.includes("recordEvent(")) return;
        // A importação não é chamada.
        if (/^\s*import\b/.test(linha)) return;
        if (linha.includes("await recordEvent(")) return;
        // Abrir mão da durabilidade exige dizer por quê, na linha de cima.
        if ((linhas[i - 1] ?? "").includes("telemetria:")) return;
        faltando.push(`${arquivo.replace(process.cwd() + "/", "")}:${i + 1}`);
      });
    }

    expect(faltando,
      "recordEvent sem await numa rota admin — na Vercel a função congela depois "
      + "da resposta e o insert se perde. Use `await recordEvent(...)`, ou "
      + "declare `// telemetria: <motivo>` na linha de cima se a perda for aceitável.",
    ).toEqual([]);
  });
});
