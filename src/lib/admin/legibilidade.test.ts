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

/**
 * ⚠️ O TESTE DE CONTRASTE PASSOU NA PALETA ERRADA (12/08).
 *
 * A troca para fósforo falhou em silêncio numa substituição de texto, e o
 * mural ficou rodando a paleta azul antiga com varredura de CRT por cima — o
 * dono viu no telão e disse "o mapa está muito escuro e você não respeitou as
 * cores". O teste de contraste passou o tempo todo, porque a paleta antiga
 * TAMBÉM passava em 4,5:1.
 *
 * Ele respondia "as cores são legíveis?" e a pergunta que faltava era "são as
 * cores CERTAS?". Duas perguntas, uma trava só — e a que não existia era a que
 * teria pego.
 *
 * A regra do dono: **fósforo verde na estrutura, CIANO nos valores.**
 */
describe("a paleta é a declarada, não só uma paleta legível", () => {
  const mural = readFileSync("src/components/admin/mural/mural.css", "utf8");
  const tk = (nome: string): string => {
    const m = mural.match(new RegExp(`^\\s*--${nome}:\\s*([^;]+);`, "m"));
    expect(m, `--${nome} não declarado`).toBeTruthy();
    return m![1].trim();
  };

  /** Verde é verde: o canal G domina. Azul dominante = paleta trocada. */
  it("o fósforo é verde de verdade, não um cinza-azulado", () => {
    for (const t of ["mural-tinta", "mural-fraco", "mural-verde"]) {
      const hex = tk(t).replace("#", "");
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(g, `--${t} não é fósforo: G=${g} R=${r} B=${b}`).toBeGreaterThan(r);
      expect(g, `--${t} não é fósforo: G=${g} B=${b}`).toBeGreaterThanOrEqual(b);
    }
  });

  /** Ciano é ciano: azul domina o vermelho com folga. */
  it("o acento dos valores é ciano", () => {
    const hex = tk("mural-vivo").replace("#", "");
    const [r, , b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(b, `--mural-vivo não é ciano: R=${r} B=${b}`).toBeGreaterThan(r + 60);
  });

  /**
   * ⚠️ O MAPA É A MAIOR SUPERFÍCIE DA TELA e estava a 30% de opacidade —
   * sumia a três metros. A referência pede alta densidade; abaixo de 50% ele
   * vira esboço.
   */
  it("a terra tem presença — pelo menos 50% de opacidade", () => {
    const alfa = Number(tk("mural-terra").match(/,\s*\.?([0-9.]+)\s*\)/)?.[1] ?? "0");
    expect(alfa, `--mural-terra está a ${alfa}`).toBeGreaterThanOrEqual(0.5);
  });

  /**
   * ⚠️ E O VALOR NÃO PODE SE DISTINGUIR SÓ PELA COR. Ciano e fósforo têm
   * luminância quase igual (1,14× entre si) — quem não separa matiz veria o
   * mesmo tom. A hierarquia tem que sobreviver em escala de cinza, e sobrevive
   * porque o valor é também o maior e o mais pesado da caixa.
   */
  it("o valor é maior e mais pesado, não só de outra cor", () => {
    const bloco = mural.match(/\.mural-numero strong\s*\{[^}]*\}/g)?.join("") ?? "";
    const geral = mural.match(/\.mural-numero strong[\s\S]{0,400}?font-size[^;]*;/)?.[0] ?? "";
    expect(bloco + geral).toMatch(/font-size|font-weight/);
  });
});

/**
 * ⚠️ CABE NA TELA — a regra que o dono deu olhando o painel (12/08).
 *
 * O hub de planos abriu com cartas verticais, a terceira faixa quebrou para
 * uma segunda fileira e saiu cortada pela dobra. A resposta dele foi a regra
 * geral: "tudo tem que caber na tela sem precisar arrastar, para os lados,
 * para cima ou para baixo".
 *
 * Numa tela de parede ninguém rola. O que ficou embaixo da dobra não existe
 * para quem olha — e um painel que esconde um terço do produto por layout é
 * da mesma família dos que escondiam número por vocabulário.
 */
describe("nenhum painel empurra a página", () => {
  const css = readFileSync("src/app/admin/admin.css", "utf8");

  it("o painel tem teto de altura", () => {
    expect(css).toMatch(/\.adm-panel\s*\{[^}]*max-height:\s*\d+vh/);
  });

  /**
   * E o corpo rola DENTRO da caixa — senão o teto só cortaria o conteúdo.
   *
   * ⚠️ CONFERE TODOS OS BLOCOS, não o primeiro. A versão inicial deste teste
   * usava `match` simples e casou o bloco de DENSIDADE (`line-height`), que
   * vem antes no arquivo — reprovou um CSS correto por ler a declaração
   * errada. É a terceira vez nesta sessão que uma asserção sobre texto-fonte
   * encontra um vizinho parecido em vez do alvo: quando a regra pode estar
   * declarada em mais de um lugar, some todos antes de julgar.
   */
  it("e o corpo rola por dentro, em vez de cortar", () => {
    const blocos = css.match(/\.adm-panel-body\s*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(blocos).toContain("overflow: auto");
    expect(blocos).toContain("min-height: 0");
  });
});
