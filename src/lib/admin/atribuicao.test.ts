/**
 * ⚠️⚠️ DECLARAÇÃO ANÔNIMA ENTRAVA NO PAINEL COMO ARRECADAÇÃO CONFIRMADA —
 * achado A07 da auditoria externa.
 *
 * `/api/operations/record` aceita `status: "confirmed"` e `platformFeeUsd` de
 * um chamador SEM sessão assinada. A carteira não vem do corpo (corrigido em
 * 30/07) — mas o comentário que ficou dizia "perde-se atribuição, não
 * integridade", e essa frase era falsa: os dois painéis que somam dinheiro
 * somavam TUDO que estava confirmado.
 *
 * Medido em produção em 15/09:
 *
 *     confirmadas COM carteira   14 linhas   $0,000000 de taxa
 *     confirmadas ANÔNIMAS        4 linhas   $0,091875 de taxa
 *
 * Ou seja: 100% da arrecadação que a plataforma exibia vinha de linha que
 * ninguém pode atribuir a ninguém.
 *
 * ⚠️ E O TESTE É SOBRE A FUNÇÃO, NÃO SOBRE O TEXTO DA ROTA. Guarda textual em
 * fonte de rota já foi marcada como armadilha nesta base (`bancada/store.test`).
 * A separação virou módulo puro justamente para poder ser perguntada de verdade.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  separarPorAtribuicao, temIdentidadeAssinada, type LinhaDeOperacao,
} from "@/lib/admin/atribuicao";

const semComentarios = (c: string) =>
  c.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** O retrato medido em produção em 15/09, com os números reais. */
const PRODUCAO_15_09: LinhaDeOperacao[] = [
  ...Array.from({ length: 14 }, () => ({
    wallet_address: "0xdono", platform_fee_usd: null, volume_usd: 4.48,
  })),
  { wallet_address: null, platform_fee_usd: 0.0918750870085616, volume_usd: 9.187000011403704 },
  { wallet_address: null, platform_fee_usd: null, volume_usd: 9.189012834884464 },
  { wallet_address: null, platform_fee_usd: null, volume_usd: 18.155580061742636 },
  { wallet_address: null, platform_fee_usd: null, volume_usd: 37.034612181738126 },
];

describe("① o caso que a auditoria achou, com os números de produção", () => {
  it("⚠️⚠️ a taxa anônima NÃO entra no arrecadado", () => {
    const r = separarPorAtribuicao(PRODUCAO_15_09);
    expect(r.arrecadado).toEqual({ usd: 0, operacoes: 0 });
    expect(r.naoAtribuido.usd).toBeCloseTo(0.091875, 6);
    expect(r.naoAtribuido.operacoes).toBe(1);
    expect(r.naoAtribuido.linhas).toBe(4);
  });

  it("⚠️ mas o VOLUME anônimo continua medido — a troca aconteceu na cadeia", () => {
    // Descartar a linha seria tapar o buraco do painel abrindo um no livro.
    const r = separarPorAtribuicao(PRODUCAO_15_09);
    expect(r.naoAtribuido.volumeUsd).toBeCloseTo(73.57, 2);
  });
});

describe("② o gêmeo positivo: o que TEM dono é contado", () => {
  /**
   * ⚠️ Uma função que devolvesse zero para sempre passaria em todo teste de
   * "anônimo não conta". Cada negação aqui tem a gêmea que exige o contrário.
   */
  it("carteira assinada com taxa entra no arrecadado, e a contagem vai junto", () => {
    const r = separarPorAtribuicao([
      { wallet_address: "0xa", platform_fee_usd: 1.5, volume_usd: 100 },
      { wallet_address: "0xb", platform_fee_usd: 2.25, volume_usd: 200 },
    ]);
    expect(r.arrecadado).toEqual({ usd: 3.75, operacoes: 2 });
    expect(r.naoAtribuido).toEqual({ usd: 0, operacoes: 0, linhas: 0, volumeUsd: 0 });
  });

  it("as duas metades convivem sem se misturar", () => {
    const r = separarPorAtribuicao([
      { wallet_address: "0xa", platform_fee_usd: 1, volume_usd: 10 },
      { wallet_address: null,  platform_fee_usd: 99, volume_usd: 1_000_000 },
    ]);
    expect(r.arrecadado).toEqual({ usd: 1, operacoes: 1 });
    expect(r.naoAtribuido.usd).toBe(99);
    expect(r.naoAtribuido.volumeUsd).toBe(1_000_000);
  });
});

describe("③ ausência não é zero, e dono em branco não é dono", () => {
  it("⚠️ taxa NULL não conta como operação que reteve zero", () => {
    // `Number(null)` é 0 e passa em `isFinite`. Somar o mesmo total com uma
    // contagem diferente é a única forma de distinguir as duas.
    const r = separarPorAtribuicao([
      { wallet_address: "0xa", platform_fee_usd: null, volume_usd: 10 },
      { wallet_address: "0xb", platform_fee_usd: 0, volume_usd: 10 },
    ]);
    expect(r.arrecadado.usd).toBe(0);
    expect(r.arrecadado.operacoes).toBe(1);   // só a que DECLAROU zero
  });

  it("⚠️ carteira vazia ou só espaço é ausência de dono, não dono", () => {
    expect(temIdentidadeAssinada({ wallet_address: "" })).toBe(false);
    expect(temIdentidadeAssinada({ wallet_address: "   " })).toBe(false);
    expect(temIdentidadeAssinada({ wallet_address: null })).toBe(false);
    expect(temIdentidadeAssinada({})).toBe(false);
    expect(temIdentidadeAssinada({ wallet_address: "0xa" })).toBe(true);
  });

  it("taxa ilegível não vira zero silencioso no arrecadado", () => {
    const r = separarPorAtribuicao([
      { wallet_address: "0xa", platform_fee_usd: "vixe", volume_usd: 10 },
    ]);
    expect(r.arrecadado).toEqual({ usd: 0, operacoes: 0 });
  });

  it("número em texto, que é como o PostgREST manda numeric, é lido", () => {
    const r = separarPorAtribuicao([
      { wallet_address: "0xa", platform_fee_usd: "0.25", volume_usd: "10" },
    ]);
    expect(r.arrecadado).toEqual({ usd: 0.25, operacoes: 1 });
  });
});

describe("④ a ligação: os dois painéis usam a MESMA régua", () => {
  const RECEITA = semComentarios(readFileSync("src/app/admin/api/receita/route.ts", "utf8"));
  const MURAL   = semComentarios(readFileSync("src/app/admin/api/mural/route.ts", "utf8"));
  const PAINEL  = semComentarios(readFileSync("src/components/admin/panels/ReceitaPanel.tsx", "utf8"));
  const TELAO   = semComentarios(readFileSync("src/components/admin/mural/MuralView.tsx", "utf8"));

  it("⚠️ nenhuma das duas rotas tem régua própria", () => {
    for (const [nome, fonte] of [["receita", RECEITA], ["mural", MURAL]] as const) {
      expect(fonte, nome).toMatch(/separarPorAtribuicao\(/);
      // Duas cópias da mesma régua divergem na primeira correção.
      expect(fonte, nome).not.toMatch(/wallet_address\s*[!=]=\s*null/);
    }
  });

  it("⚠️ e as duas LEEM wallet_address — sem a coluna a separação é cega", () => {
    expect(RECEITA).toMatch(/\.select\([^)]*wallet_address/);
    expect(MURAL).toMatch(/\.select\([^)]*wallet_address/);
  });

  it("⚠️⚠️ o número não some: as duas telas mostram o não atribuído", () => {
    // Esconder seria trocar um erro por outro — o dinheiro alegado existe no
    // livro e o dono precisa vê-lo, com o nome do que ele é.
    expect(PAINEL).toMatch(/naoAtribuido\.usd/);
    expect(PAINEL).toMatch(/naoAtribuido\.linhas/);
    expect(TELAO).toMatch(/naoAtribuidoUsd/);
  });

  it("⚠️ a quebra por origem soma na mesma régua do topo", () => {
    // Se a coluna somasse anônimo e o topo não, a tabela não fecharia com o
    // total e o leitor concluiria que falta dinheiro em algum lugar.
    expect(RECEITA).toMatch(/temIdentidadeAssinada\(r\)/);
    expect(RECEITA).toMatch(/naoAtribuidoUsd/);
  });
});

describe("⑤ a rota de registro para de mentir ok em falha de banco", () => {
  const REGISTRO = semComentarios(
    readFileSync("src/app/api/operations/record/route.ts", "utf8"));

  it("⚠️⚠️ o erro do upsert é LIDO — `supabase-js` resolve, não lança", () => {
    // O `try/catch` daqui nunca rodou uma vez: a rota devolvia `{ ok: true }`
    // para toda falha de banco, e `useOperationSync` só repete o que falhou —
    // `if (ok) synced.add(e.id)`. Um ok mentiroso perdia a operação PARA SEMPRE.
    expect(REGISTRO).toMatch(/const \{ error \} = await db\.from\("operations"\)\.upsert\(/);
    expect(REGISTRO).toMatch(/if \(error\)[\s\S]{0,140}status: 500/);
  });

  it("⚠️ e nenhum catch finge tratar o que nunca é lançado", () => {
    const i = REGISTRO.indexOf("export async function POST");
    const corpo = REGISTRO.slice(i);
    expect(corpo).not.toMatch(/catch \(e\)/);
  });
});
