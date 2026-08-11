import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readLab, syncRegistry, lerLivro } from "@/lib/lab/store";
import { FAMILIES, LAB_STRATEGIES } from "@/lib/lab/registry";
import { conferirLivro } from "@/lib/lab/conferencia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * O LABORATÓRIO — as 26 estratégias, o capital de cada uma e a última medição.
 *
 * ⚠️ UMA FONTE DE VERDADE, e é por isso que esta rota existe (05/08).
 *
 * A auditoria visual encontrou a mesma carteira exibida como $995 num painel e
 * $997 em outro, e um total de $20.842 onde o caixa somava $11.491 — porque
 * cada tela derivava o próprio número da própria fonte.
 *
 * Daqui para a frente: se dois painéis mostram a mesma estratégia, eles leem
 * DESTA rota. Divergência entre telas passa a ser impossível por construção, e
 * não por disciplina de quem escreve.
 *
 * GET  devolve o laboratório inteiro, agrupado por família.
 * POST espelha o registro do código para a tabela (código → banco, nunca o
 *      contrário: registro em arquivo passa por revisão de PR, linha em tabela
 *      é alterada por quem tiver a chave).
 */

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "sem banco" }, { status: 503 });

  try {
    /**
     * ⚠️⚠️ ESPELHA SEMPRE, E ISTO É CORREÇÃO DE DEFEITO SISTÊMICO (09/08).
     *
     * A versão anterior sincronizava só quando a tabela estava VAZIA:
     *
     *     const rows = await readLab(db);
     *     if (rows.length === 0) { await syncRegistry(db); … }
     *
     * Parecia otimização e era uma quebra da invariante que o cabeçalho deste
     * arquivo declara: "código → banco, NUNCA o contrário". Com o guarda de
     * lista vazia, o espelho travava na primeira vez e **mudança em estratégia
     * existente nunca mais propagava**.
     *
     * O estrago, medido em 09/08: todas as 28 linhas de `lab_strategies` com o
     * MESMO `updated_at` (08/08 20:36:27) — o instante em que `carteira_verde`
     * nasceu e o `strategyId` disparou um sync de carona. Depois disso:
     *
     *  · `carteira_verde` seguiu CINZA no painel, com o registro dizendo MORTA;
     *  · o `killedWhy` dela chegou ao banco com length ZERO — todo o texto da
     *    refutação, invisível;
     *  · e as três verdes da Fase 4 só apareceram porque pegaram carona nesse
     *    sync acidental. Eu tinha diagnosticado aquilo como "esqueci de
     *    promover", consertei o sintoma e deixei a causa de pé.
     *
     * É a família de sempre — dois estados com a mesma aparência — na sua forma
     * mais cara: "reprovada com motivo escrito" e "nunca medida" ficam
     * idênticas na tela, e o motivo escrito não existe para quem olha.
     *
     * Sincronizar é um upsert de ~28 linhas. O custo disso é menor que o de uma
     * tela mentindo sobre o que foi decidido.
     */
    const { synced } = await syncRegistry(db);
    const rows = await readLab(db);

    /**
     * ⚠️ A CONFERÊNCIA RODA AQUI, CONTRA O LIVRO DE VERDADE (Fase 10).
     *
     * Ela poderia viver só no teste — e não pegaria nada do que aconteceu em
     * 11/08. O código estava certo; o DADO é que tinha apodrecido, com onze
     * estratégias contando na tela uma história diferente da do `lab_results`.
     * Teste confere o código de ontem contra um livro inventado pelo próprio
     * teste. Só a rota confere o dado de hoje.
     *
     * ⚠️ E ELA NÃO DERRUBA O PAINEL. A conferência é diagnóstico, não caminho
     * de dinheiro: se `lerLivro` falhar, o laboratório continua abrindo com a
     * lista vazia. Um detector que tira a tela do ar quando quebra é pior que
     * detector nenhum — vira motivo para alguém desligá-lo.
     */
    let discordancias: ReturnType<typeof conferirLivro> = [];
    try {
      discordancias = conferirLivro(LAB_STRATEGIES, await lerLivro(db));
    } catch {
      discordancias = [];
    }

    return NextResponse.json({
      familias: FAMILIES, estrategias: rows, sincronizadoAgora: true, sincronizadas: synced,
      discordancias,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "sem banco" }, { status: 503 });
  try {
    const { synced } = await syncRegistry(db);
    return NextResponse.json({ synced, estrategias: await readLab(db) });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
  }
}
