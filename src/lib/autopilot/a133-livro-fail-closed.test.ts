/**
 * ⚠️⚠️⚠️ A133 — "ZERO POSIÇÕES" NÃO É "NÃO CONSEGUI LER".
 *
 * O livro `autopilot_positions` é a resposta à pergunta que autoriza dinheiro
 * autônomo: "o que o bot possui?". Ele respondia `[]` para as duas coisas —
 * leitura vazia legítima e erro de banco — e quem chama opera sobre `[]`:
 * exposição zero, nenhuma base possuída, teto de exposição liberado inteiro.
 *
 * Um Postgres intermitente virava licença para comprar mais.
 *
 * ⚠️ E O CONSERTO JÁ ESTAVA ESCRITO UMA CAMADA ACIMA: `reconciliar-conta.ts`
 * documenta que falha de leitura é `leitura_falhou` e bloqueia entradas. Quem
 * engolia o erro era a função abaixo dela. Família do A113.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

/** Banco falso mínimo: só `autopilot_positions`, com erro ligável por teste. */
const estado = vi.hoisted(() => ({
  erroNaLeitura: null as { message: string } | null,
  linhas: [] as Record<string, unknown>[],
  escritas: [] as { tipo: string; payload: unknown }[],
  temBanco: true,
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    if (!estado.temBanco) return null;
    const resultado = () => estado.erroNaLeitura
      ? { data: null, error: estado.erroNaLeitura }
      : { data: estado.linhas, error: null };
    const um = () => estado.erroNaLeitura
      ? { data: null, error: estado.erroNaLeitura }
      : { data: estado.linhas[0] ?? null, error: null };
    const cadeia = (final: () => unknown) => {
      const o: Record<string, unknown> = {};
      for (const m of ["eq", "neq", "select", "order", "limit"]) {
        o[m] = () => cadeia(final);
      }
      o.maybeSingle = () => Promise.resolve(um());
      o.then = (res: (v: unknown) => unknown) => Promise.resolve(final()).then(res);
      return o;
    };
    return {
      from: (t: string) => {
        if (t !== "autopilot_positions") throw new Error(`tabela inesperada: ${t}`);
        return {
          select: () => cadeia(resultado),
          update: (payload: unknown) => {
            estado.escritas.push({ tipo: "update", payload });
            return cadeia(() => ({ error: null }));
          },
          upsert: (payload: unknown) => {
            estado.escritas.push({ tipo: "upsert", payload });
            return Promise.resolve({ error: null });
          },
          delete: () => {
            estado.escritas.push({ tipo: "delete", payload: null });
            return cadeia(() => ({ error: null }));
          },
        };
      },
    };
  },
}));

import { getOpenServerPositions, lerPosicaoDoBot } from "@/lib/autopilot/positions-server";

beforeEach(() => {
  estado.erroNaLeitura = null;
  estado.linhas = [];
  estado.escritas = [];
  estado.temBanco = true;
});

describe("A133.1 — erro de banco NÃO vira lista vazia", () => {
  it("⚠️⚠️ erro na leitura: `ok: false`, e nunca `[]` como sucesso", async () => {
    estado.erroNaLeitura = { message: "connection reset by peer" };
    const r = await getOpenServerPositions("S1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.porque).toContain("connection reset");
    // ⚠️ O ponto do achado: o tipo não permite mais confundir os dois.
    expect(r).not.toHaveProperty("length");
  });

  it("⚠️⚠️ sem banco configurado também é falha, não 'não há posições'", async () => {
    estado.temBanco = false;
    const r = await getOpenServerPositions("S1");
    expect(r.ok).toBe(false);
  });

  it("⚠️⚠️ a posição de UMA base tem as TRÊS respostas", async () => {
    estado.erroNaLeitura = { message: "db fora" };
    const falhou = await lerPosicaoDoBot("S1", "btc");
    expect(falhou.ok).toBe(false);

    estado.erroNaLeitura = null;
    const ausente = await lerPosicaoDoBot("S1", "btc");
    expect(ausente).toEqual({ ok: true, posicao: null });

    estado.linhas = [{ id: "P1", base: "BTC", base_amount: 0.01 }];
    const existe = await lerPosicaoDoBot("S1", "btc");
    expect(existe.ok).toBe(true);
    if (existe.ok) expect(existe.posicao).toMatchObject({ id: "P1" });
  });
});

describe("A133.2 — sucesso com data vazio CONTINUA sendo zero posições", () => {
  it("⚠️ leitura boa e vazia não bloqueia nada", async () => {
    const r = await getOpenServerPositions("S1");
    expect(r).toEqual({ ok: true, posicoes: [] });
  });

  it("⚠️ e leitura boa com linhas devolve as linhas", async () => {
    estado.linhas = [{ id: "P1", base: "BTC" }, { id: "P2", base: "ETH" }];
    const r = await getOpenServerPositions("S1");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.posicoes).toHaveLength(2);
  });
});

describe("A133.5 — nenhum read-before-write do livro conclui de leitura falha", () => {
  /**
   * ⚠️ ESTE BLOCO MUDOU DE ALVO NO A131-C, e a razão está escrita para a troca
   * ser auditável.
   *
   * Ele media `recordServerEntry`: a função lia a posição anterior com
   * `const { data: prev } = await ...`, descartando `error`, e concluía "não
   * existe posição" de uma leitura que não aconteceu — o ramo de baixo então
   * UPSERTAVA por `(session_id, base)`, sobrescrevendo o acumulado do dia pelo
   * tamanho da última compra.
   *
   * O A133 consertou a leitura. O A131-C foi além e APAGOU a função: abrir
   * posição passou a ser uma coisa só, `projetarEfeitoDoIntent`, que lê o
   * intent e a posição DENTRO de uma transação, sob `for update`. Não existe
   * mais janela entre ler e escrever — nem um segundo escritor para divergir.
   */
  const FONTE = readFileSync("src/lib/autopilot/positions-server.ts", "utf8");
  const SQL = readFileSync("supabase/migrations/0064_autopilot_projecao_de_posicao.sql", "utf8");

  it("⚠️⚠️ `recordServerEntry` não existe mais — era o segundo escritor", () => {
    expect(FONTE).not.toMatch(/export async function recordServerEntry/);
    expect(FONTE).toMatch(/NÃO RESSUSCITAR/);
  });

  it("⚠️⚠️ e o escritor que restou lê sob `for update`, na mesma transação", () => {
    // A leitura-antes-da-escrita continua existindo; ela só deixou de ter
    // janela e deixou de poder confundir erro com ausência.
    expect(SQL).toMatch(/from public\.cex_execution_intents where id = p_intent_id for update/);
    expect(SQL).toMatch(/where intent_id = p_intent_id for update/);
    expect(SQL).toMatch(/where session_id = v_i\.session_id and base = v_base for update/);
  });

  it("⚠️ nenhuma escritora do livro descarta `error` de um select", () => {
    // `const { data: x } = await db...` sem `error` é o padrão que causou o
    // achado. Ele não pode voltar neste arquivo.
    expect(FONTE).not.toMatch(/const \{ data: \w+ \} = await db/);
  });
});

describe("A133.3/A133.4 — os callers distinguem os dois estados", () => {
  const CRON = readFileSync("src/app/api/autopilot/cron/route.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const CONTA = readFileSync("src/lib/cex/execucao/reconciliar-conta.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  it("⚠️⚠️ nenhum caller usa mais o retorno como array direto", () => {
    // `(await getOpenServerPositions(x)).filter(...)` era o padrão perigoso.
    expect(CRON).not.toMatch(/\(await getOpenServerPositions\([^)]*\)\)\s*\./);
    expect(CONTA).not.toMatch(/\(await getOpenServerPositions\([^)]*\)\)\s*\./);
  });

  it("⚠️⚠️ o cron PARA a passada quando o livro não pode ser lido", () => {
    /**
     * ⚠️ A143 acrescentou a TERCEIRA condição ao mesmo portão: fato da venue
     * que não entrou no livro de execuções. O `pnl_today` fica incompleto, e
     * o stop de perda com ele — a resposta é a mesma, zero entrada nova.
     */
    expect(CRON).toMatch(
      /if \(!leituraDoLivro\.ok \|\| !livroLegivelNoSettle \|\| fatosNaoAssentados\)/);
    expect(CRON).toMatch(/position book unreadable — zero new entries/);
    expect(CRON).toMatch(/autopilot_livro_ilegivel/);
    // A parada vem ANTES do scan e de qualquer ordem.
    const iParada = CRON.indexOf("position book unreadable");
    expect(iParada).toBeLessThan(CRON.indexOf("runAutopilotCexScan("));
    expect(iParada).toBeLessThan(CRON.indexOf("executarOrdemCex("));
  });

  it("⚠️⚠️ e `reconciliarConta` devolve `undefined` — que ela já trata como leitura_falhou", () => {
    expect(CONTA).toMatch(/if \(!leitura\.ok\) return undefined;/);
    expect(CONTA).toMatch(/resultado: "leitura_falhou", etapa: "posicoes"/);
  });
});
