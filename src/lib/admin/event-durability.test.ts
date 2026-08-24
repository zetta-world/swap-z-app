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

/**
 * ⚠️⚠️ A TRAVA SÓ OLHAVA PARA O ADMIN — e a mesma classe estava solta nas
 * rotas de DINHEIRO (24/08).
 *
 * Ao escrever o cron do DCA reparei que meu `recordEvent` sem `await` passou
 * verde: esta trava varria apenas `src/app/admin/api`. Varrendo `src/app/api`
 * apareceram ONZE pontos, incluindo `cex/order`, `quote` e os dois crons —
 * exatamente onde perder o registro dói mais.
 *
 * ⚠️ CATRACA, não conserto. Consertar os dez pré-existentes é trabalho de
 * outro PR; o que esta lista faz é impedir que a dívida CRESÇA. Ela só pode
 * encolher: cada linha que sair daqui é uma a menos, e quando esvaziar, some.
 *
 * ⚠️ E A LISTA É DE LINHA, não de arquivo. Um arquivo isento inteiro deixaria
 * um `recordEvent` NOVO entrar de carona no mesmo arquivo, calado.
 */
const RAIZ_PUBLICA = join(process.cwd(), "src/app/api");

/**
 * ⚠️ A LISTA ESTÁ VAZIA — e ficou vazia no mesmo dia em que nasceu (24/08).
 *
 * Ela abrigou dez linhas: `cex/order`, `celeiro/cron`, `beacon` (×2),
 * `quote` (×3), `radar`, `swap-guard` e `autopilot/cron`. Todas fechadas,
 * cada uma pelo seu motivo:
 *
 *   · oito ganharam `await` — ordem real colocada, órfão do celeiro, gatilho
 *     do radar, registro de segurança, aviso de P&L otimista e as três
 *     trilhas de `swap_intent` que respondem "cobramos o que dissemos?"
 *   · duas ficaram sem, COM MOTIVO DECLARADO: `page_view` e `dwell` são
 *     telemetria de altíssimo volume, e perder uma amostra não muda decisão
 *     nenhuma. É para isto que a saída `// telemetria:` existe.
 *
 * ⚠️ MANTER VAZIA. Se alguém precisar reabrir esta lista, o teste de baixo
 * obriga a linha a existir de verdade — mas a pergunta certa é por que a
 * durabilidade não coube, não como isentar.
 */
const DIVIDA_CONHECIDA = new Set<string>([]);

/**
 * ⚠️⚠️ COMENTÁRIO NÃO É CÓDIGO — e esta trava não sabia (24/08).
 *
 * A varredura casava `recordEvent(` em qualquer linha, inclusive dentro de um
 * bloco `/** ... *\/` que EXPLICA a regra. Foi exatamente o que aconteceu: o
 * comentário do cron do DCA cita `void recordEvent(...)` ao descrever o
 * defeito, e a trava acusou o arquivo que estava certo.
 *
 * É a segunda vez no mesmo dia que escrevo um instrumento que confunde texto
 * com código (a outra foi `nao-vaza-para-o-cliente`). O padrão que as
 * auditorias acharam dez vezes no produto vale para as ferramentas também:
 * elas afirmam com confiança o que não conferiram.
 */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
            .replace(/^(\s*)\/\/.*$/gm, "$1");
}

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
      /**
       * ⚠️ DOIS ARRAYS, E NÃO UM. A CHAMADA é detectada na versão SEM
       * comentários (senão a frase `recordEvent(` dentro de um bloco que
       * EXPLICA a regra vira acusação). A ISENÇÃO é lida na versão ORIGINAL,
       * porque a saída de emergência É um comentário — limpar os dois com a
       * mesma régua desligaria o escape em silêncio. Eu fiz exatamente isso ao
       * alargar a trava, e só apareceu quando fui usar a isenção.
       */
      const bruto  = readFileSync(arquivo, "utf8").split("\n");
      const linhas = semComentarios(bruto.join("\n")).split("\n");
      linhas.forEach((linha, i) => {
        if (!linha.includes("recordEvent(")) return;
        // A importação não é chamada.
        if (/^\s*import\b/.test(linha)) return;
        if (linha.includes("await recordEvent(")) return;
        // Abrir mão da durabilidade exige dizer por quê, na linha de cima.
        if ((bruto[i - 1] ?? "").includes("telemetria:")) return;
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

describe("durabilidade de evento nas rotas PÚBLICAS — a catraca", () => {
  const arquivos = rotas(RAIZ_PUBLICA);

  it("existem rotas públicas para varrer", () => {
    expect(arquivos.length).toBeGreaterThan(10);
  });

  it("nenhum recordEvent sem await FORA da dívida já conhecida", () => {
    const novos: string[] = [];
    for (const arquivo of arquivos) {
      const rel = arquivo.replace(process.cwd() + "/", "");
      const bruto = readFileSync(arquivo, "utf8").split("\n");
      semComentarios(bruto.join("\n")).split("\n").forEach((linha, i) => {
        if (!linha.includes("recordEvent(")) return;
        if (/^\s*import\b/.test(linha)) return;
        if (linha.includes("await recordEvent(")) return;
        // ⚠️ A mesma saída de emergência do bloco admin: telemetria de alto
        // volume pode abrir mão da durabilidade, DESDE QUE diga por quê.
        if ((bruto[i - 1] ?? "").includes("telemetria:")) return;
        const ref = `${rel}:${i + 1}`;
        if (!DIVIDA_CONHECIDA.has(ref)) novos.push(ref);
      });
    }
    expect(novos,
      "recordEvent sem await numa rota pública, fora da dívida conhecida. Na "
      + "Vercel a função congela depois da resposta e o insert se perde — e "
      + "estas são as rotas de DINHEIRO. Use `await recordEvent(...)`.",
    ).toEqual([]);
  });

  it("⚠️ a dívida só pode ENCOLHER — linha consertada tem de sair da lista", () => {
    // Sem isto a lista viraria cemitério: um `recordEvent` consertado deixaria
    // a isenção para trás, e a próxima linha que caísse naquele número entraria
    // de carona. É a mesma disciplina do "nenhum id de MESAS é fantasma".
    const vivos = new Set<string>();
    for (const arquivo of arquivos) {
      const rel = arquivo.replace(process.cwd() + "/", "");
      const bruto = readFileSync(arquivo, "utf8").split("\n");
      semComentarios(bruto.join("\n")).split("\n").forEach((linha, i) => {
        if (linha.includes("recordEvent(") && !/^\s*import\b/.test(linha)
            && !linha.includes("await recordEvent(")
            && !(bruto[i - 1] ?? "").includes("telemetria:")) vivos.add(`${rel}:${i + 1}`);
      });
    }
    const fantasmas = [...DIVIDA_CONHECIDA].filter((d) => !vivos.has(d));
    expect(fantasmas,
      "estas linhas foram consertadas ou moveram — tire-as de DIVIDA_CONHECIDA",
    ).toEqual([]);
  });
});
