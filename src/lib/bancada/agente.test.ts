import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VelaComTempo } from "@/lib/mercado/velas";

/**
 * ⚠️⚠️ O QUE ESTE ARQUIVO TESTA — e o que ele DELIBERADAMENTE não testa.
 *
 * `candidateAttempts` e `computeIndicators` têm testes próprios e são o cérebro
 * da casa; re-testá-los aqui seria duplicar a verdade em dois lugares. O que é
 * MEU neste módulo, e o que abre posição com o dinheiro do investidor, são as
 * guardas em volta: só vela fechada, só uma vez por vela, aquecimento, e a
 * conversão do bracket em percentual da ENTRADA.
 *
 * ⚠️ Por isso o seletor é dublado na maioria dos casos — mas há um teste SEM
 * dublê no fim, para provar que a fiação real existe. Um arquivo só de dublês
 * passa mesmo que o módulo não esteja ligado a nada.
 */

const plano = vi.hoisted(() => ({ atual: null as unknown }));

vi.mock("@/lib/zion/playbooks", async (original) => {
  const real = await original<typeof import("@/lib/zion/playbooks")>();
  return {
    ...real,
    candidateAttempts: vi.fn(() => plano.atual as never),
  };
});

const { decidirAberturaDoAgente, BARRAS_DE_AQUECIMENTO } = await import("@/lib/bancada/agente");
const { candidateAttempts } = await import("@/lib/zion/playbooks");

const H = 3_600_000;

/** `n` velas horárias terminando em `t = (n-1)·H`. */
function serie(n: number, close = 100): VelaComTempo[] {
  const v: VelaComTempo[] = [];
  for (let i = 0; i < n; i++) v.push({ t: i * H, close, high: close, low: close, volume: 1 });
  return v;
}

/** "Agora" logo depois de a vela `t` fechar — ela é a última FECHADA. */
const depoisDe = (t: number) => t + H + 1;

function comPlano(p: Partial<{ entry: number; target: number; stop: number; horizonHours: number; playbook: string }> = {}) {
  plano.atual = [{
    def: { label: "teste" },
    plan: {
      symbol: "BTC", playbook: "pullback_ema", entry: 100, target: 106, stop: 97,
      horizonHours: 48, ...p,
    },
    reason: null,
  }];
}

function semPlano(motivo = "suporte não testado") {
  plano.atual = [{ def: { label: "teste" }, plan: null, reason: motivo }];
}

const VELAS = (n: number) => ({ h1: serie(n), h4: serie(n), d1: serie(n), w1: serie(n) });
const PARADO = { temPosicaoAberta: false, ultimaAberturaMs: null };

beforeEach(() => {
  vi.mocked(candidateAttempts).mockClear();
  comPlano();
});

describe("as guardas que protegem a posição do investidor", () => {
  it("com posição aberta não abre outra — repetição não é evidência", () => {
    const d = decidirAberturaDoAgente(
      { temPosicaoAberta: true, ultimaAberturaMs: null }, "BTC", VELAS(400), depoisDe(399 * H),
    );
    expect(d).toEqual({ abre: false, porque: "ja_tem_posicao", regime: null });
    // ⚠️ E o seletor NEM É CHAMADO: a guarda vem antes do custo.
    expect(candidateAttempts).not.toHaveBeenCalled();
  });

  /**
   * ⚠️⚠️ O CRON TICKA A CADA 30 MIN E A VELA DE 1h FECHA A CADA 60. Sem esta
   * guarda o MESMO sinal abriria duas posições do mesmo movimento, e o `n`
   * contaria repetição como evidência.
   */
  it("a vela já avaliada num tick anterior não abre de novo", () => {
    const velas = VELAS(400);
    const ultima = velas.h1[399].t;
    const d = decidirAberturaDoAgente(
      { temPosicaoAberta: false, ultimaAberturaMs: ultima }, "BTC", velas, depoisDe(ultima),
    );
    expect(d).toEqual({ abre: false, porque: "vela_ja_avaliada", regime: null });
  });

  /**
   * ⚠️⚠️ O NÚMERO É FIXADO, não derivado da constante — e a diferença não é
   * estilo. A primeira versão deste teste escrevia `BARRAS_DE_AQUECIMENTO - 1`,
   * e eu a quebrei baixando o aquecimento de 200 para 52: **passou**. Um teste
   * que lê a constante que deveria julgar afirma só que a constante é igual a
   * si mesma.
   *
   * E 200 tem motivo: `computeIndicators` devolve vazio abaixo de 52 velas de
   * 1h, mas o EMA50 e o ADX só assentam bem depois de ~200. Decidir com 60
   * barras não é "ser mais ágil" — é ler indicador recém-nascido, e o
   * investidor paga por isso quando esta bancada virar execução.
   */
  it("o aquecimento é de 200 barras — o EMA50 e o ADX precisam disso", () => {
    expect(BARRAS_DE_AQUECIMENTO).toBe(200);
  });

  it("abaixo de 200 barras não decide — indicador que ainda não nasceu não é sinal fraco", () => {
    const d = decidirAberturaDoAgente(PARADO, "BTC", VELAS(199), depoisDe(198 * H));
    // ⚠️ `regime: null` porque a recusa acontece ANTES de `computeIndicators`:
    // não há leitura de mercado a declarar, e inventar uma seria pior.
    expect(d).toEqual({ abre: false, porque: "aquecendo", regime: null });
    expect(candidateAttempts).not.toHaveBeenCalled();
  });

  it("com 200 barras exatas, ela já decide", () => {
    const d = decidirAberturaDoAgente(PARADO, "BTC", VELAS(200), depoisDe(199 * H));
    expect(d.abre).toBe(true);
  });

  /**
   * ⚠️⚠️ A VELA CORRENTE NÃO DECIDE. Ela muda a cada negócio: um sinal lido
   * nela pode desaparecer antes de ela fechar. No backtest esse erro dá um
   * número errado; aqui ele ABRE UMA POSIÇÃO.
   */
  it("a vela ainda aberta é ignorada — a decisão é da última FECHADA", () => {
    const velas = VELAS(400);
    // A vela 399 ainda está aberta: "agora" é 1ms depois de ela começar.
    const d = decidirAberturaDoAgente(PARADO, "BTC", velas, velas.h1[399].t + 1);
    expect(d).toMatchObject({ abre: true, velaMs: velas.h1[398].t });
  });
});

describe("o bracket vira percentual DA ENTRADA", () => {
  it("alvo e stop saem do plano, em % do preço de entrada", () => {
    comPlano({ entry: 100, target: 106, stop: 97 });
    const velas = VELAS(400);
    const d = decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t));
    expect(d.abre).toBe(true);
    if (!d.abre) return;
    expect(d.alvoPct).toBeCloseTo(6, 10);
    expect(d.stopPct).toBeCloseTo(3, 10);
    expect(d.horasLimite).toBe(48);
    expect(d.playbook).toBe("pullback_ema");
  });

  /**
   * ⚠️⚠️ A ENTRADA É O FECHAMENTO DA VELA DO SINAL, não `plano.entry`.
   *
   * Preencher no preço que a REGRA desejava, e não no que EXISTIA, é a forma
   * mais educada de inventar borda — e ela não aparece em nenhum extrato,
   * porque o número sai bonito.
   */
  it("preenche ao preço que existia, nunca ao preço que a regra desejava", () => {
    comPlano({ entry: 90, target: 99, stop: 85 });
    const velas = { h1: serie(400, 100), h4: serie(400, 100), d1: serie(400, 100), w1: serie(400, 100) };
    const d = decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t));
    expect(d.abre).toBe(true);
    if (!d.abre) return;
    expect(d.entrada).toBe(100);
  });

  it("bracket degenerado é recusado — alvo igual à entrada nunca dispara", () => {
    comPlano({ entry: 100, target: 100, stop: 97 });
    const velas = VELAS(400);
    expect(decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t)))
      .toMatchObject({ abre: false, porque: "bracket degenerado" });
  });
});

describe("ficar de fora é uma decisão, e ela vem com motivo", () => {
  /**
   * ⚠️ Uma instância PARADA e uma instância QUEBRADA produzem a mesma tela se
   * só o que operou for registrado. Foi assim que o Maker de Faixa ficou dois
   * dias sem abrir posição — e ali éramos NÓS, com acesso ao banco.
   */
  it("o motivo do seletor é repassado, nunca engolido", () => {
    semPlano("EMA50 acima do preço");
    const velas = VELAS(400);
    expect(decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t)))
      .toMatchObject({ abre: false, porque: "EMA50 acima do preço" });
  });

  it("sem candidato nenhum, o regime é a resposta", () => {
    plano.atual = [];
    const velas = VELAS(400);
    expect(decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t)))
      .toMatchObject({ abre: false, porque: "sem candidato no regime" });
  });
});

/**
 * ⚠️⚠️ O REGIME VIAJA NA RECUSA (08/09) — e é o pedido literal do dono diante
 * do card: *"não dá pra saber o que o agente está fazendo"*.
 *
 * Antes ele só saía quando a mesa ABRIA — justamente o caso em que o investidor
 * não precisa perguntar. Ficar de fora é a decisão na maior parte do tempo, e é
 * aí que "em que mercado ele acha que está" responde a pergunta.
 */
describe("a recusa diz em que mercado o agente acha que está", () => {
  it("depois de ler os indicadores, o regime acompanha a recusa", () => {
    semPlano("suporte não testado");
    const velas = VELAS(400);
    const d = decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t));
    expect(d.abre).toBe(false);
    if (d.abre) return;
    // ⚠️ A asserção é sobre EXISTIR e ser do vocabulário fechado — não sobre
    // QUAL valor: o regime é o que os indicadores leram da série, e fixá-lo
    // aqui testaria `computeIndicators`, que tem os testes dele.
    expect(["TRENDING_UP", "TRENDING_DOWN", "RANGING", "TRANSITIONING"]).toContain(d.regime);
  });

  it("antes de ler os indicadores, o regime é `null` — nunca um chute", () => {
    const d = decidirAberturaDoAgente(PARADO, "BTC", VELAS(199), depoisDe(198 * H));
    expect(d).toEqual({ abre: false, porque: "aquecendo", regime: null });
  });
});

describe("⚠️ a fiação REAL existe — sem dublê", () => {
  /**
   * Um arquivo só de dublês passa mesmo que o módulo não esteja ligado a nada.
   * Aqui o seletor de verdade roda: 400 velas rigorosamente planas não têm
   * setup, e o que se prova é que a chamada chega lá e volta com um motivo —
   * não que o motivo seja este ou aquele.
   */
  it("com o seletor de verdade, uma série plana não opera e diz por quê", async () => {
    vi.doUnmock("@/lib/zion/playbooks");
    vi.resetModules();
    const mod = await import("@/lib/bancada/agente");
    const velas = VELAS(400);
    const d = mod.decidirAberturaDoAgente(PARADO, "BTC", velas, depoisDe(velas.h1[399].t));
    expect(d.abre).toBe(false);
    if (d.abre) return;
    expect(typeof d.porque).toBe("string");
    expect(d.porque.length).toBeGreaterThan(0);
    // ⚠️ E não é uma das guardas locais: o caminho passou PELO SELETOR.
    expect(["ja_tem_posicao", "aquecendo", "vela_ja_avaliada", "sem_velas"]).not.toContain(d.porque);
  });
});
