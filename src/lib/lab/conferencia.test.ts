/**
 * AS TRAVAS DA CONFERÊNCIA DO LIVRO.
 *
 * ⚠️ ESTE ARQUIVO É A CICATRIZ DE 11/08 VIRADA EM TESTE.
 *
 * A auditoria cruzou `lab_strategies.status` com o veredito da última rodada
 * `ok` e encontrou ONZE de 28 linhas contando histórias diferentes — oito delas
 * na direção favorável, escondendo resultado ruim atrás de "não medida".
 *
 * Cada `it` abaixo é um dos casos reais que ninguém viu, com os números daquela
 * auditoria. Se algum voltar a passar despercebido, é aqui que quebra.
 */

import { describe, it, expect } from "vitest";
import { conferirLivro, resumoDaConferencia, type LivroDaEstrategia } from "@/lib/lab/conferencia";
import { LAB_STRATEGIES, type LabStrategy, type LabStatus } from "@/lib/lab/registry";

const est = (status: LabStatus, extra: Partial<LabStrategy> = {}): LabStrategy => ({
  slug: "x", name: "Mesa X", subtitle: "s", family: "carrego",
  capitalRequiredUsd: 1000, capitalWhy: "motivo com mais de vinte e cinco caracteres aqui",
  status, ...extra,
});
const livro = (p: Partial<LivroDaEstrategia> = {}): LivroDaEstrategia => ({
  slug: "x", rodadasOk: 0, ultimoVeredito: null, penduradas: 0, ...p,
});

describe("o caso `grid_bot` — medida, e a tela dizendo que não", () => {
  /**
   * ⚠️ O PIOR DOS ONZE. A grade perdeu 54,19% do capital numa rodada que rodou,
   * fechou e gravou resultado. O registro dizia CINZA — o estado que não pede
   * nada de ninguém — porque `cinza` também significava "não medida".
   */
  it("cinza com rodada fechada é discordância, e diz qual foi o veredito", () => {
    const [d, ...resto] = conferirLivro(
      [est("cinza", { slug: "grid_bot", name: "Grade" })],
      [livro({ slug: "grid_bot", rodadasOk: 1, ultimoVeredito: "morta" })],
    );
    expect(resto).toEqual([]);
    expect(d.tipo).toBe("medida_mas_cinza");
    expect(d.o_que).toContain("1 rodada");
    expect(d.o_que).toContain("MORTA");
    expect(d.fazer_o_que).toContain("MORTA");
  });

  /** Sem rodada nenhuma, cinza é exatamente o estado certo — e cala a boca. */
  it("cinza SEM rodada é o estado correto e não vira ruído", () => {
    expect(conferirLivro([est("cinza")], [livro()])).toEqual([]);
  });

  /**
   * ⚠️ RODADA QUE FALHOU NÃO É PARCELA. Se ela contasse, "tentei medir e
   * explodiu" viraria prova de medição — a inversão exata que o `lab_runs`
   * existe para evitar. O livro só conta as `ok`, e aqui isso é verificado
   * pelo lado de fora: cinza + zero `ok` não reclama.
   */
  it("rodada que falhou não transforma cinza em discordância", () => {
    expect(conferirLivro([est("cinza")], [livro({ rodadasOk: 0, ultimoVeredito: "morta" })]))
      .toEqual([]);
  });
});

describe("o caso `dex_cex_arb` — o livro decidiu e a tela ignorou", () => {
  it("veredito gravado diferente do registro é discordância", () => {
    const [d] = conferirLivro(
      [est("verde", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 2, ultimoVeredito: "morta" })],
    );
    expect(d.tipo).toBe("livro_discorda");
    expect(d.tela).toBe("verde");
    expect(d.livro).toBe("morta");
    expect(d.o_que).toContain("medida e positiva");
    expect(d.o_que).toContain("medida e negativa");
  });

  /** Concordar é o caso normal — e o caso normal não escreve nada na tela. */
  it("registro e livro de acordo não produzem nada", () => {
    expect(conferirLivro(
      [est("morta", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 3, ultimoVeredito: "morta" })],
    )).toEqual([]);
  });
});

describe("o veredito sem parcela — selo sem nada por baixo", () => {
  /**
   * ⚠️ A INVARIANTE Nº 6 NO SEU CASO MAIS DIRETO. Três mesas estavam VERDE e
   * duas MORTA com ZERO rodadas no livro. O selo afirmava medição e não havia
   * parcela nenhuma para conferir.
   */
  it("verde sem rodada e sem declarar onde mediu é discordância", () => {
    const [d] = conferirLivro([est("verde", { slug: "a" })], [livro({ slug: "a" })]);
    expect(d.tipo).toBe("veredito_sem_parcela");
    expect(d.livro).toBeNull();
  });

  it("morta sem rodada também — o viés não é só para o lado bom", () => {
    const [d] = conferirLivro([est("morta", { slug: "a" })], [livro({ slug: "a" })]);
    expect(d.tipo).toBe("veredito_sem_parcela");
  });

  /**
   * ⚠️ `measuredElsewhere` DISPENSA A PARCELA, e é a alternativa honesta a
   * fabricar uma linha de rodada com números copiados à mão. Mas ele não
   * dispensa em silêncio: exige dizer ONDE a medição vive.
   */
  it("declarar onde a medição vive dispensa a parcela", () => {
    expect(conferirLivro(
      [est("verde", { slug: "a", measuredElsewhere: "Fase 1 — painel 🧭, 04/08" })],
      [livro({ slug: "a" })],
    )).toEqual([]);
  });

  /** String vazia não é declaração. O buraco não pode se fechar sozinho. */
  it("measuredElsewhere em branco não dispensa nada", () => {
    const [d] = conferirLivro(
      [est("verde", { slug: "a", measuredElsewhere: "   " })], [livro({ slug: "a" })],
    );
    expect(d.tipo).toBe("veredito_sem_parcela");
  });

  /**
   * ⚠️ E ELE NÃO É SALVO-CONDUTO PERMANENTE. Se o livro daqui passar a ter
   * veredito e ele discordar, a reclamação volta — senão `measuredElsewhere`
   * viraria a porta dos fundos que `cinza` era.
   */
  it("declarada fora, mas com rodada aqui que discorda, volta a reclamar", () => {
    const [d] = conferirLivro(
      [est("verde", { slug: "a", measuredElsewhere: "Fase 1 — painel 🧭" })],
      [livro({ slug: "a", rodadasOk: 1, ultimoVeredito: "morta" })],
    );
    expect(d.tipo).toBe("livro_discorda");
  });

  /** Estados que NÃO afirmam medição não devem parcela nenhuma. */
  it("cinza e nao_mensuravel não precisam de rodada", () => {
    expect(conferirLivro([est("cinza")], [livro()])).toEqual([]);
    expect(conferirLivro(
      [est("nao_mensuravel", { notMeasurableWhy: "a fonte não publica o dado por endereço" })],
      [livro()],
    )).toEqual([]);
  });
});

describe("`nao_mensuravel` não pode virar o novo cinza", () => {
  it("sem motivo escrito é discordância", () => {
    const [d] = conferirLivro([est("nao_mensuravel", { slug: "a" })], [livro({ slug: "a" })]);
    expect(d.tipo).toBe("sem_motivo");
    expect(d.fazer_o_que).toContain("notMeasurableWhy");
  });

  it("motivo só de espaço em branco não conta como motivo", () => {
    const [d] = conferirLivro(
      [est("nao_mensuravel", { slug: "a", notMeasurableWhy: "  \n " })], [livro({ slug: "a" })],
    );
    expect(d.tipo).toBe("sem_motivo");
  });
});

describe("rodada FECHADA que gravou \"não medida\" — impossível sobre si mesma", () => {
  /**
   * ⚠️ AS SEIS QUE SOBRARAM DEPOIS DA FASE 10, e a razão de terem tipo próprio.
   *
   * `amm_lp`, `grid_bot`, `momentum_rotation`, `covered_call`, `restaking` e
   * `carteira_verde` têm rodada fechada com `verdict = 'cinza'` — gravadas
   * quando `cinza` era o único destino para empate, inconclusivo e "perdeu
   * dinheiro mas bateu o índice". Chamar isso de "a tela discorda do livro"
   * sugeriria que uma das duas está certa; aqui nenhuma está: a linha do livro
   * afirma algo que rodada concluída não pode afirmar.
   */
  it("acusa a linha impossível, e manda remedir em vez de reescrever", () => {
    const [d, ...resto] = conferirLivro(
      [est("empate", { slug: "amm_lp", name: "LP em AMM", killedWhy: "empate medido" })],
      [livro({ slug: "amm_lp", rodadasOk: 6, ultimoVeredito: "cinza" })],
    );
    expect(resto).toEqual([]);
    expect(d.tipo).toBe("livro_incoerente");
    expect(d.o_que).toContain("FECHOU");
    expect(d.fazer_o_que).toContain("remedir");
  });

  /**
   * ⚠️ NÃO É TRAVA DE MUTIRÃO, É TRAVA PERMANENTE. Um defeito futuro que grave
   * `cinza` numa rodada `ok` cai aqui — independentemente do estado do
   * registro, inclusive quando os dois "concordam".
   */
  it("vale mesmo quando o registro também diz cinza — aí são os DOIS errados", () => {
    const achados = conferirLivro(
      [est("cinza", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 1, ultimoVeredito: "cinza" })],
    );
    // Cinza-com-rodada é pego pela regra anterior, que é a mais informativa.
    expect(achados.map((x) => x.tipo)).toEqual(["medida_mas_cinza"]);
  });

  /** Rodada fechada sem veredito nenhum é outra coisa — e não é impossível. */
  it("rodada fechada com veredito NULO não vira linha incoerente", () => {
    expect(conferirLivro(
      [est("empate", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 1, ultimoVeredito: null })],
    )).toEqual([]);
  });
});

describe("rodada pendurada — começou e nunca fechou", () => {
  /**
   * ⚠️ SAI COMO LINHA PRÓPRIA, e não substitui a discordância de estado: são
   * problemas ortogonais. Uma mesa pode estar com o estado errado E com uma
   * rodada travada, e esconder a segunda atrás da primeira perderia a única
   * pista de que uma medição morreu no meio.
   */
  it("acusa a pendurada mesmo quando o estado está certo", () => {
    const [d, ...resto] = conferirLivro(
      [est("morta", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 1, ultimoVeredito: "morta", penduradas: 2 })],
    );
    expect(resto).toEqual([]);
    expect(d.tipo).toBe("rodada_pendurada");
    expect(d.o_que).toContain("2 rodada");
  });

  it("estado errado E pendurada dão DUAS linhas, não uma", () => {
    const achados = conferirLivro(
      [est("cinza", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 1, ultimoVeredito: "morta", penduradas: 1 })],
    );
    expect(achados.map((x) => x.tipo)).toEqual(["medida_mas_cinza", "rodada_pendurada"]);
  });
});

describe("a lista não repete a mesma estratégia por três motivos", () => {
  /**
   * ⚠️ UMA DISCORDÂNCIA DE ESTADO POR ESTRATÉGIA, no máximo. Uma lista que
   * repete é uma lista que ninguém termina de ler — e o detector que ninguém lê
   * é o detector que não existe (invariante nº 14).
   */
  it("cinza com rodada e veredito diferente sai UMA vez", () => {
    const achados = conferirLivro(
      [est("cinza", { slug: "a" })],
      [livro({ slug: "a", rodadasOk: 4, ultimoVeredito: "verde" })],
    );
    expect(achados).toHaveLength(1);
  });
});

describe("estratégia sem nenhuma linha no livro", () => {
  /**
   * ⚠️ AUSENTE DO LIVRO É TRATADO COMO ZERO RODADAS, e não como "não sei". A
   * alternativa — pular quem não aparece — deixaria o detector cego justamente
   * para a estratégia que nunca chegou a ser registrada, que é o pior caso.
   */
  it("verde que não existe no livro ainda é veredito sem parcela", () => {
    const [d] = conferirLivro([est("verde", { slug: "fantasma" })], []);
    expect(d.tipo).toBe("veredito_sem_parcela");
  });
});

describe("o resumo de uma linha", () => {
  it("vazio quando não há nada — e a tela não inventa um selo verde", () => {
    expect(resumoDaConferencia([])).toBe("");
  });

  it("concorda em número e em plural", () => {
    const uma = conferirLivro([est("verde", { slug: "a" })], [livro({ slug: "a" })]);
    expect(resumoDaConferencia(uma)).toBe("1 discordância entre a tela e o livro");
    const duas = conferirLivro(
      [est("verde", { slug: "a" }), est("morta", { slug: "b" })],
      [livro({ slug: "a" }), livro({ slug: "b" })],
    );
    expect(resumoDaConferencia(duas)).toBe("2 discordâncias entre a tela e o livro");
  });
});

describe("o registro de verdade, conferido contra si mesmo", () => {
  /**
   * ⚠️ ESTE É O ÚNICO TESTE AQUI QUE OLHA O REGISTRO REAL, e ele NÃO consegue
   * conferir o que importa: o livro só existe em tempo de execução. O que ele
   * prova é a metade que não depende do banco — que nenhum estado do registro
   * está mal-formado por si só.
   *
   * A outra metade roda na rota, contra o `lab_results` de verdade, e aparece
   * no topo do painel. Um teste que conferisse o registro contra um livro
   * inventado por ele mesmo passaria sempre — foi por isso que a drenagem de
   * onze linhas atravessou uma suíte de mil testes sem tocar em nada.
   */
  it("nenhuma estratégia real está mal-formada por si só", () => {
    const semLivro = LAB_STRATEGIES.map((s) => livro({ slug: s.slug }));
    const achados = conferirLivro(LAB_STRATEGIES, semLivro);
    const semMotivo = achados.filter((a) => a.tipo === "sem_motivo");
    expect(semMotivo.map((a) => a.slug), "nao_mensuravel sem porquê escrito").toEqual([]);
  });

  /**
   * Toda estratégia que afirma medição tem que ter ONDE conferir: ou rodada
   * neste livro (que o teste não alcança), ou `measuredElsewhere` escrito.
   * Aqui só dá para exigir o segundo das que sabidamente não têm rodada — e é
   * por isso que a regra de verdade mora na rota.
   */
  it("as que declaram medir fora dizem onde, com texto de verdade", () => {
    const fora = LAB_STRATEGIES.filter((s) => s.measuredElsewhere !== undefined);
    expect(fora.length).toBeGreaterThan(0);
    for (const s of fora) {
      expect((s.measuredElsewhere ?? "").trim().length, `${s.slug}`).toBeGreaterThan(10);
    }
  });
});
