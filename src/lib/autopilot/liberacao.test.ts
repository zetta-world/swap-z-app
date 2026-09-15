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
/**
 * ⚠️ SEPARADA da `resposta` de propósito. `lerLiberacao` usa `.in()` e
 * `lerPilotos` usa `.eq().maybeSingle()`; com um mock só, o teste "lista de
 * pilotos ilegível" passava porque o método NEM EXISTIA e caía no `catch` — o
 * resultado certo pelo motivo errado, que é o tipo de teste que continua verde
 * depois de a proteção sumir.
 */
let respostaPilotos: { data: unknown; error: unknown } = { data: null, error: null };
let dbNulo = false;
const upserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => dbNulo ? null : ({
    from: () => ({
      select: () => ({
        in: async () => resposta,
        eq: () => ({ maybeSingle: async () => respostaPilotos }),
      }),
      upsert: async (linha: Record<string, unknown>) => { upserts.push(linha); return { error: null }; },
    }),
  }),
}));

const {
  lerLiberacao, registrarLiberacao, CHAVE_LIBERACAO, CHAVE_MOTIVO, MIN_MOTIVO,
  lerPilotos, decidirAutomacao,
} = await import("@/lib/autopilot/liberacao");

beforeEach(() => {
  resposta = { data: [], error: null };
  respostaPilotos = { data: null, error: null };
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
      // Cada porta julga POR CARTEIRA — `podeAutomatizar` nas rotas de request,
      // `decidirAutomacao` no cron (que julga N sessões com uma leitura só).
      expect(src, caminho).toMatch(/podeAutomatizar\(|decidirAutomacao\(/);
    });
  }

  /**
   * ⚠️ ESTE TESTE EXISTE POR UM DEFEITO QUE EU QUASE ENVIEI.
   *
   * `runAlertWatchdog()` é chamado de UM lugar só em todo o código: o fim deste
   * cron. Na primeira versão eu fechei a automação com um `return` cedo, que
   * teria desligado TODO o alerta da plataforma — pico de erro, cron parado,
   * orçamento de IA, saúde de dependência, digest diário — como efeito
   * colateral de fechar uma feature de CEX (invariante nº 15).
   *
   * A versão atual FILTRA em vez de retornar (os pilotos seguem rodando), então
   * o risco mudou de forma mas não sumiu: a trava aqui é que não exista saída
   * antecipada entre a decisão da trava e o watchdog.
   */
  it("fechar a automação NÃO desliga o watchdog da plataforma", () => {
    const src = semComentarios(readFileSync(arquivos.cron, "utf8"));
    const iDecide  = src.indexOf("decidirAutomacao(");
    const iVigia   = src.indexOf("runAlertWatchdog()");
    expect(iDecide, "o cron não julga a trava").toBeGreaterThan(-1);
    expect(iVigia,  "o watchdog sumiu do cron").toBeGreaterThan(iDecide);
    const meio = src.slice(iDecide, iVigia);
    expect(meio, "há um return entre a trava e o watchdog").not.toMatch(/\breturn NextResponse\.json\(\{\s*ok: true/);
  });

  /**
   * ⚠️ E as sessões BARRADAS têm que deixar rastro (invariante nº 7). Sem isso
   * o cliente vê "ativo" na tela e nada acontecendo, sem explicação.
   */
  it("o cron grava o motivo em cada sessão barrada", () => {
    const src = semComentarios(readFileSync(arquivos.cron, "utf8"));
    const iDecide = src.indexOf("decidirAutomacao(");
    const trecho = src.slice(iDecide, iDecide + 1200);
    expect(trecho).toContain("recordRuns(");
    expect(trecho).toContain("skipped");
  });

  /**
   * ⚠️ Só a ordem de AUTOPILOT é barrada. Ordem manual segue aberta de
   * propósito: a trava fecha a automação, não o negociar.
   */
  it("na rota de ordem, a trava fica DENTRO do ramo de autopilot", () => {
    const src = semComentarios(readFileSync(arquivos.ordem, "utf8"));
    // ⚠️ O ramo passou a ter nome (`ehAutopilot`) para a ORIGEM do intent
    // poder distinguir os dois canais desta mesma rota. A trava segue a lógica.
    const iRamo = src.indexOf("const ehAutopilot = body.autopilot === true;");
    const iTrava = src.indexOf("podeAutomatizar(");
    expect(iRamo).toBeGreaterThan(-1);
    expect(iTrava).toBeGreaterThan(iRamo);
  });
});

/**
 * ⚠️ O FURO DELIBERADO — as carteiras piloto.
 *
 * O dono pediu que a carteira admin, ou uma autorizada no painel, rode a
 * automação com ela fechada, para teste com dinheiro real. Isso é um furo na
 * trava, e o que estes testes protegem é que ele seja EXATAMENTE do tamanho
 * pedido: nem menor (o piloto tem que passar), nem maior (mais ninguém passa).
 */
describe("os pilotos — o furo é do tamanho declarado", () => {
  const fechada: Awaited<ReturnType<typeof lerLiberacao>> =
    { liberado: false, causa: "sem_registro", motivo: null, desde: null };
  const aberta: Awaited<ReturnType<typeof lerLiberacao>> =
    { liberado: true, causa: "aberto", motivo: "medida", desde: "t" };
  const piloto = (w: string) => ({ wallet: w.toLowerCase(), nota: "teste real", at: "t" });

  it("fechada: quem não é piloto continua barrado, com a causa do fechamento", () => {
    const v = decidirAutomacao("0xqualquer", fechada, []);
    expect(v.permitido).toBe(false);
    expect(v.causa).toBe("sem_registro");
  });

  it("fechada: o piloto passa, e a causa NÃO vira 'aberto'", () => {
    const v = decidirAutomacao("0xAbC", fechada, [piloto("0xabc")]);
    expect(v.permitido).toBe(true);
    // ⚠️ Colapsar em "aberto" faria a tela dizer ao piloto que a feature está
    // liberada ao público. Ele precisa saber que está pilotando.
    expect(v.causa).toBe("piloto_autorizado");
  });

  it("a comparação de carteira ignora maiúsculas dos dois lados", () => {
    expect(decidirAutomacao("0xABC", fechada, [piloto("0xabc")]).permitido).toBe(true);
    expect(decidirAutomacao("0xabc", fechada, [piloto("0xABC")]).permitido).toBe(true);
  });

  /** Carteira vazia não pode casar com lixo na lista. */
  it("carteira vazia nunca passa", () => {
    expect(decidirAutomacao("", fechada, [{ wallet: "", nota: "", at: "" }]).permitido).toBe(false);
  });

  it("aberta ao público: passa por 'aberto', sem precisar de piloto", () => {
    const v = decidirAutomacao("0xqualquer", aberta, []);
    expect(v.permitido).toBe(true);
    expect(v.causa).toBe("aberto");
  });

  /**
   * ⚠️ `platform_admins` NÃO qualifica — e a trava disso é que o módulo não
   * consulte a tabela. Quem recebeu admin para olhar métricas não pode virar,
   * em silêncio, autorizado a rodar o robô de dinheiro (invariante nº 14).
   */
  it("não consulta platform_admins para decidir quem pilota", () => {
    const src = semComentarios(readFileSync("src/lib/autopilot/liberacao.ts", "utf8"));
    expect(src).not.toContain("platform_admins");
  });

  it("lista de pilotos ilegível não abre nada", async () => {
    respostaPilotos = { data: null, error: { message: "boom" } };
    expect(await lerPilotos()).toEqual([]);
  });

  it("JSON corrompido na lista não abre nada", async () => {
    respostaPilotos = { data: { value: "{isto não é json" }, error: null };
    expect(await lerPilotos()).toEqual([]);
  });

  /** E o caminho FELIZ, para o teste acima não ser verde por não achar nada. */
  it("lê a lista quando ela está lá", async () => {
    respostaPilotos = { data: { value: JSON.stringify([{ wallet: "0xABC", nota: "n", at: "t" }]) }, error: null };
    const lista = await lerPilotos();
    expect(lista).toHaveLength(1);
    expect(lista[0].wallet).toBe("0xabc");   // normalizada para minúsculas
  });
});
