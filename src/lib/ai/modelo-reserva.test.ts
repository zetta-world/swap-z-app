import { describe, it, expect } from "vitest";
import {
  chamarComReserva, modelosDoProvedor, proximoModelo, vetosVivos,
  deveTrocarDeModelo, CLASSES_TROCA_MODELO,
  type ProvedorChamavel, type Vetos, type MemoriaDeVeto,
} from "@/lib/ai/modelo-reserva";
import { allProviders } from "@/lib/ai/registry";
import type { ChatRequest, ChatResult } from "@/lib/ai/provider";

/**
 * ⚠️⚠️ O DIA EM QUE UM NOME DE MODELO APAGOU QUATRO MESAS (29/08).
 *
 * A Mistral recusou `mistral-large-latest` com 403 `tier_not_allowed` — chave
 * boa, plano sem o modelo. Três falhas abriram o disjuntor e a Mistral INTEIRA
 * saiu: ela ocupa o assento `brain` e o `sentiment`, então caíram junto o
 * flywheel, o radar, o oráculo e o sniper.
 *
 * Havia reserva de PROVEDOR (03/08) e reserva de modelo da PLATAFORMA (N1). Não
 * havia a de modelo DENTRO de um provedor do registro. É esta.
 */
const MISTRAL_403 = 'upstream 403: {"object":"error","message":"This model is '
  + 'not available in your subscription tier","type":"tier_not_allowed",'
  + '"param":null,"code":"1910","raw_status_code":403}';

const P: ProvedorChamavel = {
  id: "mistral", label: "Mistral", apiKey: "k", baseUrl: "https://x/v1",
  model: "mistral-large-latest",
  models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
};

/** Memória de mentira — o teste não toca no banco. */
function memoriaFalsa(inicial: Vetos = {}): MemoriaDeVeto & { estado: Vetos } {
  const caixa = { estado: { ...inicial } };
  return {
    estado: caixa.estado,
    ler: async () => ({ ...caixa.estado }),
    gravar: async (_id, v) => { Object.assign(caixa.estado, v); },
  };
}

/** Falso upstream: recusa os modelos listados, atende o resto. */
function upstream(recusa: Record<string, string>, chamados: string[] = []) {
  return async (req: ChatRequest): Promise<ChatResult> => {
    chamados.push(req.model);
    const erro = recusa[req.model];
    if (erro) throw new Error(erro);
    return { text: "ok", model: req.model, usage: { inTokens: 1, outTokens: 1, cachedTokens: 0, cacheWriteTokens: 0 } };
  };
}

describe("o caso real: 403 de plano cai para a reserva em vez de matar a mesa", () => {
  it("⚠️ a chamada RESPONDE, e responde pelo modelo de reserva", async () => {
    const chamados: string[] = [];
    const r = await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
      chamar: upstream({ "mistral-large-latest": MISTRAL_403 }, chamados),
      memoria: memoriaFalsa(), avisar: () => {},
    });
    expect(r.text).toBe("ok");
    expect(chamados).toEqual(["mistral-large-latest", "mistral-medium-latest"]);
  });

  it("⚠️⚠️ `model` do resultado é o modelo que REALMENTE respondeu", async () => {
    // Sem isto o flywheel mede um modelo e credita outro — e um número errado
    // tem exatamente a mesma cara de um número certo. Todo chamador grava
    // `model: r.model` no `recordEvent`, então a honestidade nasce daqui.
    const r = await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
      chamar: upstream({ "mistral-large-latest": MISTRAL_403 }),
      memoria: memoriaFalsa(), avisar: () => {},
    });
    expect(r.model).toBe("mistral-medium-latest");
    expect(r.model).not.toBe(P.model);
  });

  it("desce a fila inteira quando a recusa se repete", async () => {
    const chamados: string[] = [];
    const r = await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
      chamar: upstream({ "mistral-large-latest": MISTRAL_403, "mistral-medium-latest": MISTRAL_403 }, chamados),
      memoria: memoriaFalsa(), avisar: () => {},
    });
    expect(r.model).toBe("mistral-small-latest");
    expect(chamados).toHaveLength(3);
  });

  it("com TODOS recusados, lança — e a mensagem é a da CAUSA RAIZ", async () => {
    // Quem pega isto é o `recordResult`, que classifica o texto para dizer ao
    // dono o que fazer. O erro do PRIMEIRO modelo é o da causa; o do último
    // mandaria investigar uma reserva que ninguém escolheu.
    const erro = await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
      chamar: upstream(Object.fromEntries(P.models!.map((m) => [m, `${MISTRAL_403} (${m})`]))),
      memoria: memoriaFalsa(), avisar: () => {},
    }).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toContain("mistral-large-latest");
    expect((erro as Error).message).toContain("tier_not_allowed");
    expect((erro as Error).message).toContain("reservas esgotadas");
  });
});

describe("⚠️ a troca é SÓ para recusa do NOME — e essa metade é a que segura o resto", () => {
  it("classe de troca é `plano` e `modelo`, mais nenhuma", () => {
    expect([...CLASSES_TROCA_MODELO].sort()).toEqual(["modelo", "plano"]);
  });

  it("⚠️ chave revogada NÃO desce a fila — seria o mesmo 401 três vezes", async () => {
    const chamados: string[] = [];
    await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
      chamar: upstream(Object.fromEntries(P.models!.map((m) => [m, "upstream 401: unauthorized"])), chamados),
      memoria: memoriaFalsa(), avisar: () => {},
    }).catch(() => {});
    expect(chamados).toEqual(["mistral-large-latest"]);
  });

  it("⚠️ sem crédito e upstream instável também PARAM na primeira", async () => {
    // Ali a ação é recarregar / esperar. Descer a fila esconderia a causa atrás
    // de um "caiu para a reserva" e ainda gastaria três chamadas por tick.
    for (const erro of ["upstream 429: rate limit exceeded", "Insufficient Balance", "upstream 503: service unavailable"]) {
      const chamados: string[] = [];
      await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
        chamar: upstream(Object.fromEntries(P.models!.map((m) => [m, erro])), chamados),
        memoria: memoriaFalsa(), avisar: () => {},
      }).catch(() => {});
      expect(chamados, erro).toHaveLength(1);
    }
  });

  it("o modelo APOSENTADO da DeepSeek desce (é recusa do nome)", () => {
    expect(deveTrocarDeModelo("The supported API model names are deepseek-v4-pro, but you passed deepseek-chat")).toBe(true);
    expect(deveTrocarDeModelo(MISTRAL_403)).toBe(true);
    expect(deveTrocarDeModelo("upstream 401: unauthorized")).toBe(false);
    expect(deveTrocarDeModelo(undefined)).toBe(false);
  });
});

describe("a memória do veto — e o motivo de ela EXPIRAR", () => {
  it("⚠️ o modelo recusado é pulado na chamada seguinte, sem pagar o 403 de novo", async () => {
    const mem = memoriaFalsa();
    const opts = { memoria: mem, avisar: () => {} };
    await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 },
      { ...opts, chamar: upstream({ "mistral-large-latest": MISTRAL_403 }) });

    const chamados: string[] = [];
    const r = await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 },
      { ...opts, chamar: upstream({ "mistral-large-latest": MISTRAL_403 }, chamados) });
    expect(chamados).toEqual(["mistral-medium-latest"]);  // o large nem foi tentado
    expect(r.model).toBe("mistral-medium-latest");
  });

  it("⚠️⚠️ o veto VENCE — subiu o plano, o preferido volta sozinho", async () => {
    // Um veto eterno exigiria alguém lembrar de rearmar. Provedor que só
    // ressuscita por intervenção manual é a morte silenciosa que este repo se
    // recusa a causar — a mesma razão do disjuntor voltar a sondar.
    const vencido: Vetos = { "mistral-large-latest": { ate: 1_000, causa: "plano" } };
    const chamados: string[] = [];
    const r = await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 }, {
      chamar: upstream({}, chamados), memoria: memoriaFalsa(vencido), avisar: () => {}, agora: 2_000,
    });
    expect(chamados).toEqual(["mistral-large-latest"]);
    expect(r.model).toBe("mistral-large-latest");
  });

  it("⚠️ com a fila INTEIRA vetada, tenta o preferido — veto não é desligamento", async () => {
    const todos: Vetos = Object.fromEntries(P.models!.map((m) => [m, { ate: 9_999, causa: "plano" as const }]));
    expect(proximoModelo(P.models!, todos, 1_000)).toBe("mistral-large-latest");
  });

  it("`vetosVivos` esquece o que venceu", () => {
    const v: Vetos = { a: { ate: 10, causa: "plano" }, b: { ate: 100, causa: "modelo" } };
    expect(Object.keys(vetosVivos(v, 50))).toEqual(["b"]);
  });

  it("⚠️ o aviso sai UMA vez por veto novo, não a cada tick", async () => {
    // Alerta que se repete sem novidade treina o operador a ignorar — foi o que
    // a Mistral fez com nove mensagens idênticas em um dia.
    const mem = memoriaFalsa();
    const avisos: string[] = [];
    const opts = { memoria: mem, avisar: (m: string) => avisos.push(m) };
    for (let i = 0; i < 5; i++) {
      await chamarComReserva(P, { system: "s", user: "u", maxTokens: 10 },
        { ...opts, chamar: upstream({ "mistral-large-latest": MISTRAL_403 }) });
    }
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain("mistral-medium-latest");
  });
});

describe("a fila do registro", () => {
  it("⚠️ a Mistral tem reserva — era o buraco de 29/08", () => {
    const m = allProviders().mistral;
    expect(m.models.length).toBeGreaterThan(1);
    expect(m.models[0]).toBe(m.model);
  });

  it("a DeepSeek tem o -flash que a própria mensagem de erro nomeou em 25/07", () => {
    expect(allProviders().deepseek.models).toContain("deepseek-v4-flash");
  });

  it("⚠️ o env manda sozinho: um nome só significa SEM reserva", async () => {
    // Se o dono escreve um modelo, ele está dizendo "este e mais nenhum".
    // Costurar a nossa reserva por baixo chamaria — e cobraria — um modelo que
    // ele não escolheu.
    const antes = process.env.MISTRAL_MODEL;
    process.env.MISTRAL_MODEL = "mistral-small-latest";
    try {
      expect(allProviders().mistral.models).toEqual(["mistral-small-latest"]);
      process.env.MISTRAL_MODEL = "a, b ,a";
      expect(allProviders().mistral.models).toEqual(["a", "b"]);  // apara e não repete
    } finally {
      if (antes === undefined) delete process.env.MISTRAL_MODEL;
      else process.env.MISTRAL_MODEL = antes;
    }
  });

  it("todo provedor tem `model` igual ao primeiro da fila", () => {
    for (const [id, p] of Object.entries(allProviders())) {
      expect(p.models.length, id).toBeGreaterThan(0);
      expect(p.model, id).toBe(p.models[0]);
    }
  });

  it("sem `models`, a fila é o `model` sozinho — provedor antigo não quebra", () => {
    expect(modelosDoProvedor({ id: "x", label: "X", baseUrl: "b", model: "só-esse" })).toEqual(["só-esse"]);
  });
});

describe("sem chave, a mensagem não manda caçar credencial errada", () => {
  it("⚠️ diz QUAL variável falta, em vez de virar 401 → “gere outra chave”", async () => {
    const erro = await chamarComReserva({ ...P, apiKey: undefined }, { system: "s", user: "u", maxTokens: 10 },
      { chamar: upstream({}), memoria: memoriaFalsa(), avisar: () => {} }).catch((e: Error) => e);
    expect((erro as Error).message).toContain("MISTRAL_API_KEY");
  });
});
