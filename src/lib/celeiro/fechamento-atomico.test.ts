/**
 * ⚠️⚠️ FECHAR UMA MUTAÇÃO PODIA DEIXAR O AGENTE SEM GENOMA NENHUM — achado A06.
 *
 * `fecharMutacao` fazia QUATRO escritas soltas, todo `error` descartado, e
 * devolvia `void`. A reversão eram duas delas: desativar a versão atual e
 * ativar a anterior.
 *
 * Falhar entre uma e outra não deixa o agente num estado degradado — deixa o
 * agente SEM OS PARÂMETROS COM QUE OPERA. E nada denunciava: quem chamava
 * recebia `undefined` tanto no sucesso quanto na falha.
 *
 * ⚠️ INVERTER A ORDEM NÃO ERA SAÍDA. O índice parcial
 * `celeiro_genoma_um_ativo on (agente) where ativo` recusa dois ativos — medido
 * contra o banco de produção, que devolve 23505. Fora de uma transação não
 * existe ordem segura, e por isso a reversão virou RPC (migration 0048).
 *
 * ⚠️ POR QUE O BANCO FALSO GUARDA LINHAS DE VERDADE. Um espião de chamadas
 * provaria que `.rpc("celeiro_reverter_genoma")` foi chamado — e um `.rpc` que
 * não fizesse nada passaria igual. O que interessa é o INVARIANTE: depois de
 * qualquer caminho, com falha ou sem, o agente tem EXATAMENTE UM genoma ativo.
 * É sobre isso que este arquivo pergunta.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fecharMutacao } from "@/lib/celeiro/store";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

// ── O BANCO FALSO ───────────────────────────────────────────────────────────
// Guarda genomas e mutações de verdade. A RPC é atômica de verdade (só grava
// se chegar ao fim) e o índice parcial é aplicado de verdade.

type Genoma = { agente: string; versao: number; ativo: boolean };
type Mutacao = Record<string, unknown>;

function banco(opts: {
  genomas: Genoma[];
  falharRpc?: string;
  falharCarimbo?: string;
  rpcDevolve?: unknown;
}) {
  const genomas = opts.genomas.map((g) => ({ ...g }));
  const mutacoes: Mutacao[] = [{ id: "m1" }];

  function checarIndiceUnico(linhas: Genoma[]) {
    const porAgente = new Map<string, number>();
    for (const g of linhas) {
      if (!g.ativo) continue;
      const n = (porAgente.get(g.agente) ?? 0) + 1;
      if (n > 1) throw new Error("23505: celeiro_genoma_um_ativo");
      porAgente.set(g.agente, n);
    }
  }

  const db = {
    rpc(nome: string, args: Record<string, unknown>) {
      if (nome !== "celeiro_reverter_genoma") throw new Error(`rpc inesperada: ${nome}`);
      if (opts.falharRpc) {
        return Promise.resolve({ data: null, error: { message: opts.falharRpc } });
      }
      if ("rpcDevolve" in opts) {
        return Promise.resolve({ data: opts.rpcDevolve, error: null });
      }
      const agente = String(args.p_agente);
      // Uma cópia: nada entra na tabela se a transação não chegar ao fim.
      const copia = genomas.map((g) => ({ ...g }));
      const doAgente = copia.filter((g) => g.agente === agente)
        .sort((a, b) => b.versao - a.versao);
      const anterior = doAgente[1]?.versao;
      if (anterior == null) return Promise.resolve({ data: null, error: null });

      for (const g of copia) if (g.agente === agente && g.ativo) g.ativo = false;
      for (const g of copia) if (g.agente === agente && g.versao === anterior) g.ativo = true;
      checarIndiceUnico(copia);
      genomas.splice(0, genomas.length, ...copia);
      return Promise.resolve({ data: anterior, error: null });
    },
    from(tabela: string) {
      if (tabela !== "celeiro_mutacoes") throw new Error(`tabela inesperada: ${tabela}`);
      return {
        update(patch: Record<string, unknown>) {
          const filtros: Array<[string, unknown]> = [];
          const alvo = {
            eq(col: string, val: unknown) {
              filtros.push([col, val]);
              return alvo;
            },
            then(resolver: (r: { error: { message: string } | null }) => void) {
              if (opts.falharCarimbo) {
                return Promise.resolve({ error: { message: opts.falharCarimbo } }).then(resolver);
              }
              for (const m of mutacoes) {
                if (filtros.every(([c, v]) => m[c] === v)) Object.assign(m, patch);
              }
              return Promise.resolve({ error: null }).then(resolver);
            },
          };
          return alvo;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, genomas, mutacoes };
}

const ativos = (gs: Genoma[], agente: string) =>
  gs.filter((g) => g.agente === agente && g.ativo).map((g) => g.versao);

const CINCO: Genoma[] = [
  { agente: "alav", versao: 1, ativo: false },
  { agente: "alav", versao: 2, ativo: false },
  { agente: "alav", versao: 3, ativo: false },
  { agente: "alav", versao: 4, ativo: false },
  { agente: "alav", versao: 5, ativo: true },
];

describe("① a premissa: a reversão em dois passos soltos É o defeito", () => {
  it("⚠️⚠️ falhar entre desativar e ativar deixa o agente com ZERO genoma ativo", () => {
    const gs = CINCO.map((g) => ({ ...g }));
    // Exatamente o que o código antigo fazia, com a segunda escrita falhando.
    for (const g of gs) if (g.agente === "alav" && g.ativo) g.ativo = false;
    /* a segunda escrita não acontece */
    expect(ativos(gs, "alav")).toEqual([]);   // o agente sem os parâmetros dele
  });

  it("⚠️ e a ordem inversa não é saída: o índice parcial recusa dois ativos", () => {
    const copia = CINCO.map((g) => ({ ...g }));
    for (const g of copia) if (g.agente === "alav" && g.versao === 4) g.ativo = true;
    const ativosAgora = copia.filter((g) => g.agente === "alav" && g.ativo).length;
    expect(ativosAgora).toBe(2);   // e o Postgres devolve 23505 aqui
  });
});

describe("② a reversão atômica mantém o invariante em todo caminho", () => {
  it("reverte: sobra EXATAMENTE UM ativo, e é a versão anterior", async () => {
    const { db, genomas, mutacoes } = banco({ genomas: CINCO });
    const r = await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    expect(r).toEqual({ ok: true, reversao: "reativou", versao: 4 });
    expect(ativos(genomas, "alav")).toEqual([4]);
    expect(mutacoes[0].veredito).toBe("nao_pagou");
    expect(mutacoes[0].revertida_em).toBeTruthy();
  });

  it("⚠️ a RPC falha: o genoma fica INTACTO — um ativo, ainda o 5", async () => {
    const { db, genomas } = banco({ genomas: CINCO, falharRpc: "sem conexao" });
    const r = await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    expect(r).toEqual({ ok: false, onde: "reversao", porque: "sem conexao" });
    expect(ativos(genomas, "alav")).toEqual([5]);
  });

  it("⚠️⚠️ e a mutação NÃO é carimbada quando a reversão falha", async () => {
    // A ordem antiga carimbava `revertida_em` PRIMEIRO: o registro dizia
    // "revertida" sobre um genoma intacto. Um registro que mente sobre o mundo
    // é pior que uma falha, porque some do relatório.
    const { db, mutacoes } = banco({ genomas: CINCO, falharRpc: "sem conexao" });
    await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    expect(mutacoes[0].revertida_em).toBeUndefined();
    expect(mutacoes[0].avaliada_em).toBeUndefined();   // segue por julgar
  });

  it("⚠️ o carimbo falha DEPOIS da reversão: o genoma já está certo", async () => {
    const { db, genomas } = banco({ genomas: CINCO, falharCarimbo: "timeout" });
    const r = await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    expect(r).toEqual({ ok: false, onde: "julgamento", porque: "timeout" });
    expect(ativos(genomas, "alav")).toEqual([4]);   // e o próximo ciclo refaz
  });

  it("⚠️ refazer é idempotente: a segunda passada não move mais nada", async () => {
    const { db, genomas } = banco({ genomas: CINCO });
    await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    const r = await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    expect(r).toEqual({ ok: true, reversao: "reativou", versao: 4 });
    expect(ativos(genomas, "alav")).toEqual([4]);
  });
});

describe("③ as três respostas boas são distintas — e nenhuma é 'falhou'", () => {
  it("genoma de versão única: `sem_anterior`, e o ativo continua lá", async () => {
    const { db, genomas, mutacoes } = banco({
      genomas: [{ agente: "pool", versao: 1, ativo: true }],
    });
    const r = await fecharMutacao(db, "m1", "pool", "nao_pagou", 10, 5, "reverter");
    expect(r).toEqual({ ok: true, reversao: "sem_anterior" });
    expect(ativos(genomas, "pool")).toEqual([1]);
    expect(mutacoes[0].avaliada_em).toBeTruthy();   // julgada mesmo sem reverter
  });

  it("`manter`: `nao_pedida`, sem tocar no genoma e sem `revertida_em`", async () => {
    const { db, genomas, mutacoes } = banco({ genomas: CINCO });
    const r = await fecharMutacao(db, "m1", "alav", "pagou", 5, 10, "manter");
    expect(r).toEqual({ ok: true, reversao: "nao_pedida" });
    expect(ativos(genomas, "alav")).toEqual([5]);
    expect(mutacoes[0].veredito).toBe("pagou");
    expect(mutacoes[0].revertida_em).toBeUndefined();
  });

  it("⚠️ `sem_anterior` NÃO é o balde do que não sabemos ler", async () => {
    // `Number(null)` é 0 e passa em `isFinite`. Uma resposta que não é versão
    // nem NULL é falha, não ausência — não medimos ≠ medimos zero.
    const { db } = banco({ genomas: CINCO, rpcDevolve: "vixe" });
    const r = await fecharMutacao(db, "m1", "alav", "nao_pagou", 10, 5, "reverter");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.onde).toBe("reversao");
  });
});

describe("④ a ligação: quem chama CONFERE o retorno", () => {
  const STORE = semComentarios(readFileSync("src/lib/celeiro/store.ts", "utf8"));
  const INVESTIGAR = semComentarios(readFileSync("src/lib/celeiro/investigar.ts", "utf8"));
  const SQL = readFileSync("supabase/migrations/0048_celeiro_reverter_atomico.sql", "utf8");

  it("⚠️ a reversão passa pela RPC — nenhum `update ativo` solto sobrou", () => {
    const i = STORE.indexOf("export async function fecharMutacao");
    const corpo = STORE.slice(i, STORE.indexOf("\nexport ", i + 10));
    expect(corpo).toMatch(/db\.rpc\("celeiro_reverter_genoma", \{ p_agente: agente \}\)/);
    expect(corpo).not.toMatch(/celeiro_genoma/);
  });

  it("⚠️ e os DOIS erros são lidos — `supabase-js` resolve, não lança", () => {
    const i = STORE.indexOf("export async function fecharMutacao");
    const corpo = STORE.slice(i, STORE.indexOf("\nexport ", i + 10));
    expect(corpo).toMatch(/if \(error\) return \{ ok: false, onde: "reversao"/);
    expect(corpo).toMatch(/if \(erroDoCarimbo\)/);
  });

  it("⚠️⚠️ `investigar` confere o fechamento e alarma com dedup por agente", () => {
    expect(INVESTIGAR).toMatch(/const fechamento = await fecharMutacao\(/);
    expect(INVESTIGAR).toMatch(/if \(!fechamento\.ok\)/);
    expect(INVESTIGAR).toMatch(/relato\.naoFechou = \{ onde: fechamento\.onde/);
    expect(INVESTIGAR).toMatch(/dedupKey: `celeiro:naofechou:\$\{ag\.id\}`/);
  });

  it("⚠️ a migration desativa ANTES de ativar, e devolve NULL sem anterior", () => {
    /**
     * ⚠️ O CABEÇALHO CITA AS DUAS ESCRITAS PARA CONTAR A CICATRIZ — e a primeira
     * versão desta trava achava `set ativo = false` NO COMENTÁRIO. Ela passou
     * verde com a migration invertida de propósito. Âncora textual pega o texto,
     * não o código: os comentários saem antes de medir.
     */
    const CORPO = SQL.replace(/^\s*--.*$/gm, " ");
    const desativa = CORPO.indexOf("set ativo = false");
    const ativa = CORPO.indexOf("set ativo = true");
    expect(desativa).toBeGreaterThan(-1);
    expect(ativa).toBeGreaterThan(desativa);
    expect(CORPO).toMatch(/offset 1 limit 1/);
    expect(CORPO).toMatch(/if v_anterior is null then\s+return null;/);
  });
});
