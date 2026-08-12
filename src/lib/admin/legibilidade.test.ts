/**
 * A LEGIBILIDADE DO PAINEL — travada com a conta, não com o gosto.
 *
 * ⚠️ A CICATRIZ (12/08). O dono mandou o print do painel e disse "a leitura
 * está muito difícil de ler". Medido contra o fundo `#0a0a0c`:
 *
 *   --adm-ink-3: #5a5a70  →  2,94:1   (o mínimo legível é 4,5:1)
 *   --adm-ink-4: #30303a  →  1,51:1   (praticamente invisível)
 *
 * E eram esses dois que pintavam rótulo, legenda e o estado `cinza` — em texto
 * de 8 e 9 pixels. Um painel institucional pode ser discreto; não pode ser
 * ilegível, e "discreto" tinha virado desculpa para os dois se confundirem.
 *
 * ⚠️ POR QUE ISTO É TESTE E NÃO REVISÃO DE PR: contraste é uma CONTA, e conta
 * confere-se sozinha. Deixar para o olho de quem revisa é como o painel chegou
 * a 1,51:1 sem ninguém reclamar por meses.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("src/app/admin/admin.css", "utf8");

/** Luminância relativa (WCAG 2.1). */
function luminancia(hex: string): number {
  const h = hex.replace("#", "");
  const canais = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = canais.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contraste(a: string, b: string): number {
  const [la, lb] = [luminancia(a), luminancia(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
/**
 * Lê o valor DECLARADO de um token.
 *
 * ⚠️ EXIGE O PONTO-E-VÍRGULA, e isso é cicatriz do próprio teste: a primeira
 * versão casava `--adm-ink-3:\s*(#hex)` em qualquer lugar do arquivo, e pegou
 * os valores ANTIGOS citados dentro do comentário que explica a correção. Ele
 * reprovou um CSS que já estava certo, lendo a descrição em vez do fato — a
 * mesma armadilha que este projeto persegue nas medições, agora no teste.
 */
function token(nome: string): string {
  const m = css.match(new RegExp(`^\\s*--${nome}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "m"));
  expect(m, `declaração de --${nome} não encontrada`).toBeTruthy();
  return m![1];
}

describe("a conta do contraste — cada tinta contra o fundo real", () => {
  const FUNDO = () => token("adm-bg");

  it("o fundo é o que o teste pensa que é", () => {
    expect(FUNDO()).toMatch(/^#0a0a0/i);
  });

  /** Texto que alguém precisa LER passa em AA. Sem exceção de tamanho. */
  it("ink, ink-2 e ink-3 passam em 4,5:1", () => {
    for (const t of ["adm-ink", "adm-ink-2", "adm-ink-3"]) {
      const r = contraste(token(t), FUNDO());
      expect(r, `--${t} está em ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * ⚠️ `ink-4` é o "muito discreto" — e discreto tem piso. 3:1 é o limite do
   * que a WCAG aceita até para texto grande; abaixo disso não é discrição, é
   * ausência. Ele estava em 1,51:1.
   */
  it("ink-4 é discreto mas não invisível — mínimo 3:1", () => {
    const r = contraste(token("adm-ink-4"), FUNDO());
    expect(r, `--adm-ink-4 está em ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  /** As cores de estado carregam significado; ilegível não significa nada. */
  it("verde, vermelho e âmbar passam em 4,5:1", () => {
    for (const t of ["adm-green", "adm-red", "adm-amber"]) {
      const r = contraste(token(t), FUNDO());
      expect(r, `--${t} está em ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /** Os quatro tons de tinta precisam ser distinguíveis ENTRE si. */
  it("cada degrau de tinta se separa do vizinho", () => {
    const tons = ["adm-ink", "adm-ink-2", "adm-ink-3", "adm-ink-4"].map(token);
    for (let i = 0; i < tons.length - 1; i++) {
      expect(
        contraste(tons[i], tons[i + 1]),
        `${tons[i]} e ${tons[i + 1]} são quase a mesma cor`,
      ).toBeGreaterThan(1.35);
    }
  });
});

describe("nenhum texto do painel abaixo do piso de tamanho", () => {
  /**
   * ⚠️ 520 TAMANHOS INLINE, a maioria entre 7 e 9 pixels — isso somado ao
   * contraste de 2,94:1 é o que tornava a tela ilegível. O piso é 10px: abaixo
   * disso, num monitor, o traço da fonte some antes da cor.
   */
  const PISO = 10;

  function varrer(dir: string, achados: string[] = []): string[] {
    for (const nome of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, nome.name);
      if (nome.isDirectory()) varrer(p, achados);
      else if (nome.name.endsWith(".tsx")) achados.push(p);
    }
    return achados;
  }

  const arquivos = varrer("src/components/admin");

  it("existem componentes para varrer (o teste não passa por vazio)", () => {
    expect(arquivos.length).toBeGreaterThan(30);
  });

  it(`nenhum fontSize abaixo de ${PISO}px`, () => {
    const pequenos: string[] = [];
    for (const f of arquivos) {
      readFileSync(f, "utf8").split("\n").forEach((l, i) => {
        for (const m of l.matchAll(/fontSize: ([0-9]+(?:\.[0-9]+)?)/g)) {
          if (Number(m[1]) < PISO) pequenos.push(`${f}:${i + 1} → ${m[1]}px`);
        }
      });
    }
    expect(pequenos, "texto abaixo do piso de leitura").toEqual([]);
  });
});

describe("número alinha com número", () => {
  /**
   * ⚠️ NA CASCA, não painel a painel. Era decidido caso a caso e a maioria dos
   * painéis esquecia — então coluna de valor serpenteava, e comparar de cima a
   * baixo (a única coisa que uma tabela financeira existe para permitir)
   * exigia esforço.
   */
  it("a casca inteira usa dígito de largura fixa", () => {
    expect(css).toMatch(/\.admin-shell\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });
});


/**
 * ⚠️ O MURAL TEM PALETA PRÓPRIA, E ELA TAMBÉM É CONTA (12/08).
 *
 * Ao virar terminal de fósforo, o mural deixou de usar os tokens do painel e
 * ganhou os seus. Sem esta trava, a próxima mudança de "visual" derrubaria o
 * contraste sem ninguém medir — que é exatamente como o painel chegou a
 * 1,51:1 e ficou meses assim.
 *
 * E o piso é o MESMO: uma tela vista de três metros não pode ter regra mais
 * frouxa que uma vista de meio metro.
 */
describe("a paleta do mural também passa na conta", () => {
  const mural = readFileSync("src/components/admin/mural/mural.css", "utf8");
  const tk = (nome: string): string => {
    const m = mural.match(new RegExp(`^\\s*--${nome}:\\s*(#[0-9a-fA-F]{6})\\s*;`, "m"));
    expect(m, `declaração de --${nome} não encontrada`).toBeTruthy();
    return m![1];
  };

  it("tinta, fraco e os acentos passam em 4,5:1 contra o fundo do mural", () => {
    const fundo = tk("mural-fundo");
    for (const t of ["mural-tinta", "mural-fraco", "mural-vivo", "mural-ouro", "mural-verde"]) {
      const r = contraste(tk(t), fundo);
      expect(r, `--${t} está em ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * ⚠️ AS CAMADAS DE CRT NÃO PODEM CAPTURAR PONTEIRO. São ópticas; se uma
   * ficar clicável, a tela inteira para de responder — e numa parede isso
   * demora a ser notado, porque o vidro só parece estar sujo.
   */
  it("varredura e vinheta não interceptam ponteiro", () => {
    for (const camada of [/\.mural::before\s*\{[^}]*\}/, /\.mural::after\s*\{[^}]*\}/]) {
      expect(mural.match(camada)?.[0] ?? "").toContain("pointer-events: none");
    }
  });
});

/**
 * ⚠️ A ANIMAÇÃO NÃO PODE APAGAR O DADO (12/08).
 *
 * O pulso do mapa animava o HALO — o próprio brilho do acesso — e levava a
 * opacidade dele a ZERO, ficando assim de 70% a 100% do ciclo. Um terço do
 * tempo o ponto sumia da tela. O dono viu e disse "o pulsar está quebrado".
 *
 * A regra que sai daí: efeito de movimento é ADITIVO. Ele acrescenta um
 * elemento próprio que aparece e some; nunca apaga o elemento que carrega a
 * informação. Quando a animação desliga — por preferência de movimento
 * reduzido, por navegador antigo, por qualquer motivo — o dado tem que
 * continuar inteiro na tela.
 */
describe("o pulso é aditivo — nunca apaga o ponto", () => {
  const css = readFileSync("src/components/admin/mural/mural.css", "utf8");
  const mapa = readFileSync("src/components/admin/mural/MapaMundi.tsx", "utf8");

  it("o halo não tem animação — ele é o brilho, e brilho não pisca", () => {
    const halo = mapa.match(/<circle[^>]*url\(#mural-halo\)[^>]*\/>/)?.[0] ?? "";
    expect(halo, "o halo voltou a ser animado").not.toMatch(/className=/);
  });

  it("quem anima é um elemento separado, e ele é só traço", () => {
    const ping = css.match(/\.mural-ping\s*\{[^}]*\}/)?.[0] ?? "";
    expect(ping).toContain("fill: none");
    expect(ping).toContain("stroke:");
  });

  /**
   * ⚠️ ANIMAR `r` EM VEZ DE `transform: scale` — escala em SVG depende de
   * `transform-box`/`transform-origin`, que foi onde a versão anterior
   * escorregou. Raio não tem origem para errar.
   */
  it("a varredura anima o raio, não uma escala com origem", () => {
    const kf = css.match(/@keyframes mural-radar\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(kf).toMatch(/\br:\s*[\d.]+/);
    expect(kf).not.toContain("transform");
  });

  /** Com movimento reduzido, o ponto continua lá — só para de varrer. */
  it("movimento reduzido desliga o anel, não o ponto", () => {
    const bloco = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\}/g)?.join("") ?? "";
    expect(bloco).toContain("mural-ping");
    expect(bloco).not.toContain("mural-ponto");
  });
});
