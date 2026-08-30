import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { julgarMutacao, operacoesDistintas, MINIMO_POR_BRACO, type Fluxo } from "@/lib/celeiro/fluxo";
import { bracoDoTick, PERIODO_DO_BRACO_MS } from "@/lib/celeiro/store";

/**
 * ⚠️⚠️ O A/B DO CELEIRO TINHA UM BRAÇO SÓ (auditoria de 29/08).
 *
 * O esquema declara em texto que `controle` roda SEM a mutação. O cron lia
 * `genomaAtivo` para os dois braços e calculava `braco` DEPOIS da geometria —
 * então controle e mutação abriam idênticos, e o rótulo era decoração.
 *
 * O banco provou: na v3/SOL o controle abriu com stop 2,022% e a mutação com
 * 1,991%, quando o controle deveria estar usando o 1,2% da versão anterior.
 *
 * Duas mutações foram julgadas nesse regime e as DUAS saíram "pagou" — com os
 * dois braços negativos. O `stopPct` do Alavancado andou 1,2 → 0,8 → 1,6 em
 * cinco dias, cada passo apoiado no carimbo do anterior.
 *
 * Este arquivo segura as três metades do conserto: o braço decide a geometria,
 * o veredito tem três estados, e o piso conta operações.
 */

const CRON = "src/app/api/celeiro/cron/route.ts";

function f(braco: "controle" | "mutacao", usdt: number, ref: string): Fluxo {
  return { agente: "x", causa: "preco", usdt, ocorreuEmMs: 0, braco, ref };
}

/** Uma OPERAÇÃO real: abertura e fechamento escrevem linhas separadas. */
function operacao(braco: "controle" | "mutacao", id: string, usdt: number): Fluxo[] {
  return [
    { agente: "x", causa: "taxa",  usdt: -0.5,       ocorreuEmMs: 0, braco, ref: `abertura:${id}` },
    { agente: "x", causa: "taxa",  usdt: -0.5,       ocorreuEmMs: 0, braco, ref: `fechamento:${id}` },
    { agente: "x", causa: "preco", usdt: usdt + 1.0, ocorreuEmMs: 0, braco, ref: `fechamento:${id}` },
  ];
}

function nOperacoes(braco: "controle" | "mutacao", n: number, cada: number): Fluxo[] {
  return Array.from({ length: n }, (_, i) => operacao(braco, `${braco}-${i}`, cada)).flat();
}

describe("⚠️ o piso conta OPERAÇÕES, não linhas de extrato", () => {
  it("três lançamentos da mesma operação valem UM", () => {
    expect(operacoesDistintas(operacao("controle", "abc", 1))).toBe(1);
  });

  it("⚠️⚠️ os números REAIS de 29/08: 20 lançamentos eram 6 operações", () => {
    // A mutação de 24/08 passou no piso de 20 com 20 lançamentos no braço fraco.
    // Contando o que o piso dizia contar, eram SEIS operações.
    const seisOperacoes = nOperacoes("mutacao", 6, -1);      // 18 linhas
    expect(seisOperacoes.length).toBeGreaterThanOrEqual(18);
    expect(operacoesDistintas(seisOperacoes)).toBe(6);

    const j = julgarMutacao([...nOperacoes("controle", 30, -2), ...seisOperacoes]);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.acao).toBe("aguardar");
    expect(j.porque).toContain("6 operações");
  });

  it("⚠️ lançamento SEM `ref` não vira palpite — não dá para contar, não julga", () => {
    const semRef: Fluxo = { agente: "x", causa: "preco", usdt: 1, ocorreuEmMs: 0, braco: "mutacao" };
    expect(operacoesDistintas([semRef])).toBe(null);
    const j = julgarMutacao([...nOperacoes("controle", 30, 2), ...nOperacoes("mutacao", 30, 3), semRef]);
    expect(j.veredito).toBe("inconclusiva");
    expect(j.porque).toContain("não dá para contar");
  });

  it("com amostra de verdade nos dois braços, o veredito sai", () => {
    const j = julgarMutacao([
      ...nOperacoes("controle", MINIMO_POR_BRACO, +1),
      ...nOperacoes("mutacao", MINIMO_POR_BRACO, +3),
    ]);
    expect(j.operacoesControle).toBe(MINIMO_POR_BRACO);
    expect(j.veredito).toBe("pagou");
  });
});

describe("⚠️⚠️ o terceiro estado: sangrar menos NÃO é pagar", () => {
  /** Os valores reais das duas mutações que o Celeiro carimbou "pagou". */
  const REAIS: Array<[string, number, number]> = [
    ["24/08 · horasLimite 48→12", -34.76, -14.10],
    ["27/08 · stopPct 1,2→0,8",   -68.19, -40.43],
  ];

  it("⚠️ as DUAS mutações reais deixam de ser `pagou`", () => {
    for (const [nome, ctrl, mut] of REAIS) {
      const j = julgarMutacao([
        ...nOperacoes("controle", MINIMO_POR_BRACO, ctrl / MINIMO_POR_BRACO),
        ...nOperacoes("mutacao", MINIMO_POR_BRACO, mut / MINIMO_POR_BRACO),
      ]);
      expect(j.usdtMutacao, nome).toBeLessThan(0);
      expect(j.diferenca, nome).toBeGreaterThan(0);     // a mutação sangrou MENOS
      expect(j.veredito, nome).not.toBe("pagou");       // e mesmo assim não pagou
      expect(j.veredito, nome).toBe("inconclusiva");
      expect(j.porque, nome).toContain("sangrar menos não é pagar");
    }
  });

  it("⚠️ e ela REVERTE — inconclusiva sobre o parâmetro não deixa a mudança de pé", () => {
    // Sem isto, o genoma continuaria andando em cima de comparações que não
    // decidiram nada, que é como o stopPct fez 1,2 → 0,8 → 1,6 em cinco dias.
    const j = julgarMutacao([
      ...nOperacoes("controle", MINIMO_POR_BRACO, -2),
      ...nOperacoes("mutacao", MINIMO_POR_BRACO, -1),
    ]);
    expect(j.acao).toBe("reverter");
  });

  it("mutação que GANHA dinheiro e bate o controle segue pagando", () => {
    const j = julgarMutacao([
      ...nOperacoes("controle", MINIMO_POR_BRACO, +1),
      ...nOperacoes("mutacao", MINIMO_POR_BRACO, +2),
    ]);
    expect(j.veredito).toBe("pagou");
    expect(j.acao).toBe("manter");
  });

  it("⚠️ mutação que ganha MENOS que o controle continua revertendo", () => {
    // Este NÃO é o caso âmbar: os dois produziram valor, e o melhor é o antigo.
    const j = julgarMutacao([
      ...nOperacoes("controle", MINIMO_POR_BRACO, +2),
      ...nOperacoes("mutacao", MINIMO_POR_BRACO, +1),
    ]);
    expect(j.veredito).toBe("nao_pagou");
    expect(j.acao).toBe("reverter");
  });

  it("⚠️ mutação negativa contra controle positivo reverte, e a frase diz por quê", () => {
    const j = julgarMutacao([
      ...nOperacoes("controle", MINIMO_POR_BRACO, +1),
      ...nOperacoes("mutacao", MINIMO_POR_BRACO, -1),
    ]);
    expect(j.veredito).toBe("nao_pagou");
    expect(j.porque).toContain("destruiu");
  });

  it("zero não é ganho — empatar depois de pagar pedágio é perder", () => {
    const j = julgarMutacao([
      ...nOperacoes("controle", MINIMO_POR_BRACO, -1),
      ...nOperacoes("mutacao", MINIMO_POR_BRACO, -1 + 1 / MINIMO_POR_BRACO * 0),
    ]);
    expect(j.veredito).not.toBe("pagou");
  });
});

describe("⚠️ o braço alterna por TICK — e nunca trava", () => {
  const T0 = 1_700_000_000_000;

  it("alterna a cada período", () => {
    expect(bracoDoTick(T0, T0)).toBe("controle");
    expect(bracoDoTick(T0, T0 + PERIODO_DO_BRACO_MS)).toBe("mutacao");
    expect(bracoDoTick(T0, T0 + 2 * PERIODO_DO_BRACO_MS)).toBe("controle");
  });

  it("dentro do mesmo tick, todo símbolo vai para o MESMO braço", () => {
    // ⚠️ Não é corte por símbolo: o tick seguinte leva todos para o outro lado,
    // então os dois braços veem BTC, ETH e SOL. Cortar por ativo mediria
    // "BTC contra ETH" em vez de "genoma antigo contra novo".
    const meio = T0 + PERIODO_DO_BRACO_MS / 2;
    expect(bracoDoTick(T0, meio)).toBe(bracoDoTick(T0, T0 + 1));
  });

  it("⚠️⚠️ o relógio anda mesmo quando NENHUMA posição abre", () => {
    /**
     * A alternância antiga saía de `posicoesDesde` — um contador que só anda
     * quando uma posição ABRE. Com os braços tendo parâmetros DIFERENTES (o
     * conserto desta entrega), um deles pode ser recusado no portão do pedágio,
     * que lê `alvoPct` e `multiploDoPedagio` — e DUAS das cinco mutações já
     * propostas mexem exatamente nesses campos. O contador congelaria no braço
     * recusado e o outro nunca seria sorteado.
     */
    const vistos = new Set<string>();
    for (let i = 0; i < 8; i++) vistos.add(String(bracoDoTick(T0, T0 + i * PERIODO_DO_BRACO_MS)));
    expect(vistos).toEqual(new Set(["controle", "mutacao"]));
  });

  it("sem mutação aplicada não há braço — rotular o que não é testado envenena o julgamento", () => {
    expect(bracoDoTick(null, T0)).toBe(null);
    expect(bracoDoTick(undefined, T0)).toBe(null);
  });

  it("relógio para trás não inventa braço", () => {
    expect(bracoDoTick(T0, T0 - 1)).toBe(null);
    expect(bracoDoTick(Number.NaN, T0)).toBe(null);
  });
});

/**
 * ⚠️ TRAVA TEXTUAL sobre o cron, e ela é deliberada.
 *
 * O defeito não era uma função errada — era a ORDEM: `braco` calculado depois
 * da geometria não podia influenciá-la nem se quisesse. Nenhum teste de unidade
 * pega ordem de linhas dentro de uma rota que fala com o banco; esta varredura
 * pega. É frágil a renomeação, e ainda assim vale mais que nenhuma guarda sobre
 * o defeito que invalidou duas semanas de aprendizado.
 */
describe("o cron decide o braço ANTES da geometria", () => {
  const fonte = readFileSync(CRON, "utf8");

  it("⚠️ o braço é escolhido antes de alvo, stop e horasLimite", () => {
    const braco = fonte.indexOf("const bracoDoCiclo");
    expect(braco).toBeGreaterThan(0);
    for (const depois of ["const alvoPct = Number(params", "stopPorVolatilidade(", "horasLimite: Number(params"]) {
      expect(fonte.indexOf(depois), depois).toBeGreaterThan(braco);
    }
  });

  it("⚠️⚠️ a geometria NÃO lê mais `gen?.params` — o braço é que escolhe o genoma", () => {
    // Era exatamente isto que fazia os dois braços abrirem idênticos.
    expect(fonte).not.toMatch(/gen\?\.params\.(alvoPct|stopPct|horasLimite|multiploDoPedagio|margemPp)/);
    expect(fonte).toMatch(/const params = \(braco === "controle" \? genControle\?\.params : gen\?\.params\)/);
  });

  it("⚠️ sem versão anterior, o A/B PARA em vez de cair no genoma ativo", () => {
    // Cair no ativo reproduz o defeito de origem com outro nome.
    expect(fonte).toMatch(/genControle === null \? null : bracoDoCiclo/);
  });

  it("⚠️ a versão gravada na posição é a DO BRAÇO, não a ativa", () => {
    // Gravar a ativa nos dois faria o extrato jurar que os dois rodaram o novo.
    expect(fonte).toMatch(/versaoDoBraco/);
    expect(fonte).not.toMatch(/\}, gen\?\.versao \?\? null,/);
  });

  it("o contador antigo por posição não voltou", () => {
    expect(fonte).not.toMatch(/bracoDaPosicao|abertasDesde/);
  });
});
