/**
 * AS POSIÇÕES DO CLIENTE — o que está aberto AGORA, e o que já fechou.
 *
 * ⚠️⚠️ POR QUE ESTA ROTA EXISTE (06/09). O dono: *"o cliente tem que acompanhar
 * em tempo real a estratégia que ele rodou, porém não aparece em lugar nenhum
 * o que ele está rodando"*.
 *
 * Estava certo. `bancada_posicao` era escrita pelo cron do papel adiante desde
 * a fase 6 e **nenhuma tela a lia**. A mesa tickava, abria, fechava — e o dono
 * dela não tinha como ver. É a mesma família de "a peça existe, é testada, e
 * está desligada do caminho que decide" que esta base perseguiu a sessão
 * inteira, agora do lado do cliente.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { donoDaSessao } from "@/lib/bancada/dono";
import { denialResponse } from "@/lib/tier/enforce";
import { posicoesAbertas, listarEstrategias } from "@/lib/bancada/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return denialResponse({ kind: "unauthenticated" });
  const v = donoDaSessao(session);
  if (!v) return denialResponse({ kind: "unauthenticated" });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "sem_banco" }, { status: 503 });

  const [abertas, estrategias] = await Promise.all([
    posicoesAbertas(v.dono, db),
    listarEstrategias(v.dono, db),
  ]);

  /**
   * ⚠️ AS MESAS LIGADAS VÊM JUNTO, mesmo as que não têm posição aberta — e a
   * distinção importa: "a mesa está ligada e ainda não achou setup" e "a mesa
   * não está ligada" são estados diferentes, e sem os dois na resposta a tela
   * mostraria vazio para os dois casos.
   */
  const mesasLigadas = estrategias
    .filter((e) => e.papelAdiante && !e.arquivada)
    .map((e) => ({
      id: e.id, nome: e.nome, desde: e.papelDesde,
      simbolos: e.simbolos ?? [], intervalo: e.intervalo ?? "1h",
      abertas: abertas.filter((p) => p.estrategiaId === e.id).length,
    }));

  return NextResponse.json({
    ok: true,
    mesasLigadas,
    abertas: abertas.map((p) => ({
      id: p.id, estrategiaId: p.estrategiaId, simbolo: p.simbolo, lado: p.lado,
      entrada: p.entrada, tamanhoUsd: p.tamanhoUsd,
      alvoPct: p.alvoPct, stopPct: p.stopPct,
      expiraEm: p.expiraEm, abertaEm: p.abertaEm,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
