/**
 * AS TRAVAS DA TRAVA DE LIBERAÇÃO.
 *
 * ⚠️ O que estes testes existem para impedir é UMA coisa: a automação de CEX
 * ficar aberta ao público por OMISSÃO. Linha ausente, banco fora do ar, valor
 * estranho gravado — nenhum desses pode virar "liberado".
 *
 * É a invariante nº 6 (*não medimos ≠ medimos zero*) aplicada a uma decisão:
 * ausência de registro não é autorização.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/** Ver a nota em `espelho.test.ts`: teste que lê comentário como código também
 *  APROVA por comentário. Por isso os comentários saem antes. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

/**
 * ⚠️ Mock em escopo de MÓDULO (já escorreguei duas vezes definindo helper
 * dentro de `describe`). `resposta` é trocada por teste; o mock lê a variável
 * na hora da chamada, então não precisa ser recriado.
 */
let resposta: { data: unknown; error: unknown } = { data: [], error: null };
let dbNulo = false;
const upserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => dbNulo ? null : ({
    from: () => ({
      select: () => ({ in: async () => resposta }),
      upsert: async (linha: Record<string, unknown>) => { upserts.push(linha); return { error: null }; },
    }),
  }),
}));

const { lerLiberacao, registrarLiberacao, CHAVE_LIBERACAO, CHAVE_MOTIVO, MIN_MOTIVO } =
  await import("@/lib/autopilot/liberacao");

beforeEach(() => {
  resposta = { data: [], error: null };
  dbNulo = false;
  upserts.length = 0;
});

describe("ler a liberação — fechado é o default, sempre", () => {
  it("sem linha nenhuma: FECHADO, e a causa diz que é ausência de registro", async () => {
    resposta = { data: [], error: null };
    const l = await lerLiberacao();
    expect(l.liberado).toBe(false);
    expect(l.causa).toBe("sem_registro");
  });

  /**
   * ⚠️ Banco fora do ar NÃO é "o dono não liberou". As duas causas pedem ações
   * diferentes — uma é olhar a infraestrutura, a outra é apertar um botão.
   */
  it("banco indisponível: FECHADO, e distinguível da decisão", async () => {
    dbNulo = true;
    const semDb = await lerLiberacao();
    expect(semDb.liberado).toBe(false);
    expect(semDb.causa).toBe("indisponivel");

    dbNulo = false;
    resposta = { data: null, error: { message: "boom" } };
    const comErro = await lerLiberacao();
    expect(comErro.liberado).toBe(false);
    expect(comErro.causa).toBe("indisponivel");
    expect(comErro.causa).not.toBe("fechado_por_decisao");
  });

  it("valor que não é exatamente 'true' fica FECHADO", async () => {
    for (const valor of ["TRUE", "1", "sim", "", "yes", "true "]) {
      resposta = { data: [{ key: CHAVE_LIBERACAO, value: valor, updated_at: "t" }], error: null };
      const l = await lerLiberacao();
      expect(l.liberado, `valor ${JSON.stringify(valor)}`).toBe(false);
      expect(l.causa).toBe("fechado_por_decisao");
    }
  });

  it("'true' abre, e traz a justificativa junto", async () => {
    resposta = { data: [
      { key: CHAVE_LIBERACAO, value: "true", updated_at: "2026-08-09T00:00:00Z" },
      { key: CHAVE_MOTIVO, value: "funding validada a +3,0% na cesta", updated_at: "x" },
    ], error: null };
    const l = await lerLiberacao();
    expect(l.liberado).toBe(true);
    expect(l.causa).toBe("aberto");
    expect(l.motivo).toBe("funding validada a +3,0% na cesta");
    expect(l.desde).toBe("2026-08-09T00:00:00Z");
  });

  /** Aberto sem justificativa gravada não deve mentir um motivo. */
  it("aberto sem motivo gravado devolve motivo null, não texto inventado", async () => {
    resposta = { data: [{ key: CHAVE_LIBERACAO, value: "true", updated_at: "t" }], error: null };
    expect((await lerLiberacao()).motivo).toBeNull();
  });

  /** Nenhum caminho pode lançar — os dois consumidores são caminho de dinheiro. */
  it("nunca lança", async () => {
    resposta = { data: undefined as unknown as [], error: null };
    await expect(lerLiberacao()).resolves.toBeDefined();
  });
});

describe("registrar a liberação — abrir custa justificativa, fechar não", () => {
  it("abrir sem justificativa é recusado", async () => {
    const r = await registrarLiberacao(true, "ok");
    expect(r.ok).toBe(false);
    expect(r.erro).toBe("motivo_curto");
    expect(upserts).toHaveLength(0);   // e nada foi gravado
  });

  it("abrir com justificativa grava o estado E o texto", async () => {
    const texto = "cesta de funding medida a +3,0%/ano com 42 produtos";
    expect(texto.length).toBeGreaterThanOrEqual(MIN_MOTIVO);
    const r = await registrarLiberacao(true, texto);
    expect(r.ok).toBe(true);
    expect(upserts.find((u) => u.key === CHAVE_LIBERACAO)?.value).toBe("true");
    expect(upserts.find((u) => u.key === CHAVE_MOTIVO)?.value).toBe(texto);
  });

  /**
   * ⚠️ A ASSIMETRIA. Campo obrigatório na hora de DESLIGAR seria atrito no
   * lugar errado — exatamente quando se quer desligar rápido.
   */
  it("fechar não exige justificativa", async () => {
    const r = await registrarLiberacao(false, "");
    expect(r.ok).toBe(true);
    expect(upserts.find((u) => u.key === CHAVE_LIBERACAO)?.value).toBe("false");
  });

  /**
   * ⚠️ A justificativa VELHA ao lado de um estado NOVO seria a pior leitura
   * possível: texto convincente descrevendo o que já não vale.
   */
  it("fechar sem texto não deixa a justificativa antiga no lugar", async () => {
    await registrarLiberacao(false, "");
    const motivo = upserts.find((u) => u.key === CHAVE_MOTIVO)?.value;
    expect(motivo).toBe("(sem motivo declarado)");
  });
});

/**
 * ⚠️ OS TRÊS CANAIS, e por que são três.
 *
 * A automação de CEX sai por três portas: armar sessão de fundo, o cron que
 * roda com o navegador fechado, e a rota de ordem usada pelo piloto DO
 * NAVEGADOR. Fechar duas e esquecer a terceira seria "fechado" pela metade —
 * a forma exata do defeito que a Fase 6 apanhou como *o mesmo defeito com
 * outro nome*.
 */
describe("a trava está nas TRÊS portas", () => {
  const arquivos = {
    armar: "src/app/api/autopilot/session/route.ts",
    cron:  "src/app/api/autopilot/cron/route.ts",
    ordem: "src/app/api/cex/order/route.ts",
  };

  for (const [nome, caminho] of Object.entries(arquivos)) {
    it(`${nome} lê a liberação`, () => {
      const src = semComentarios(readFileSync(caminho, "utf8"));
      expect(src, caminho).toContain("lerLiberacao(");
      expect(src, caminho).toContain("liberado");
    });
  }

  /**
   * ⚠️ ESTE TESTE EXISTE POR UM DEFEITO QUE EU QUASE ENVIEI.
   *
   * `runAlertWatchdog()` é chamado de UM lugar só em todo o código: este cron.
   * O `return` cedo da automação fechada, escrito sem cuidado, desligaria TODO
   * o alerta da plataforma — pico de erro, cron parado, orçamento de IA, saúde
   * de dependência, digest diário — como efeito colateral de fechar uma
   * feature que não tem relação nenhuma com isso.
   */
  it("fechar a automação NÃO desliga o watchdog da plataforma", () => {
    const src = semComentarios(readFileSync(arquivos.cron, "utf8"));
    const iFecha = src.indexOf("if (!liberacao.liberado)");
    const iRetorno = src.indexOf("return NextResponse.json({", iFecha);
    const trecho = src.slice(iFecha, iRetorno);
    expect(iFecha, "o cron não tem o caminho de fechado").toBeGreaterThan(-1);
    expect(trecho, "o watchdog não roda no caminho fechado").toContain("runAlertWatchdog()");
  });

  /**
   * ⚠️ E o cron fechado tem que DEIXAR RASTRO (invariante nº 7). Sem isso o
   * cliente vê "ativo" na tela e nada acontecendo, sem explicação.
   */
  it("o cron fechado grava o motivo em cada sessão armada", () => {
    const src = semComentarios(readFileSync(arquivos.cron, "utf8"));
    const iFecha = src.indexOf("if (!liberacao.liberado)");
    const trecho = src.slice(iFecha, iFecha + 1200);
    expect(trecho).toContain("recordRuns(");
    expect(trecho).toContain("skipped");
  });

  /**
   * ⚠️ Só a ordem de AUTOPILOT é barrada. Ordem manual segue aberta de
   * propósito: a trava fecha a automação, não o negociar.
   */
  it("na rota de ordem, a trava fica DENTRO do ramo de autopilot", () => {
    const src = semComentarios(readFileSync(arquivos.ordem, "utf8"));
    const iRamo = src.indexOf("if (body.autopilot === true)");
    const iTrava = src.indexOf("lerLiberacao(");
    expect(iRamo).toBeGreaterThan(-1);
    expect(iTrava).toBeGreaterThan(iRamo);
  });
});
