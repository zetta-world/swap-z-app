import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, logAdminAction } from "@/lib/admin/require";
import { broadcastAdminRefresh } from "@/lib/admin/realtime";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  lerLiberacao, registrarLiberacao, MIN_MOTIVO,
  lerPilotos, gravarPilotos, type Piloto,
} from "@/lib/autopilot/liberacao";

export const dynamic = "force-dynamic";

/**
 * A LIBERAÇÃO DA AUTOMAÇÃO DE CEX — o interruptor da Fase 7.2.
 *
 * ⚠️ NÃO ENTROU NA ROTA DE KILL-SWITCH de propósito. Lá o default é
 * "ausência = ligado", que é certo para as mesas internas e ERRADO para uma
 * trava de liberação: ali um `admin_kv` vazio deixaria a automação aberta.
 * Semânticas opostas na mesma rota viram, três meses depois, alguém copiando o
 * padrão errado.
 *
 * E abrir exige justificativa ESCRITA — a decisão vale mais que o clique. A
 * pergunta daqui a um mês é *"o que justificava isto?"*, e a resposta tem que
 * estar no banco.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json({
    ...(await lerLiberacao()),
    minMotivo: MIN_MOTIVO,
    verdes: await verdesDoLaboratorio(),
    pilotos: await lerPilotos(),
  });
}

/**
 * As estratégias que o laboratório aprovou, ao lado do interruptor.
 *
 * ⚠️ POR QUE A EVIDÊNCIA VEM JUNTO: o dono pediu para liberar *"quando tiver
 * algo que realmente seja justificável"*. Um interruptor sozinho depende da
 * memória de quem aperta; com as verdes na tela, a decisão é tomada na frente
 * do que foi medido.
 *
 * ⚠️ E NÃO FILTRO POR "É DE CORRETORA": `lab_strategies.family` é
 * carrego/direcional/estrutura — não existe campo de venue. Inventar a
 * classificação aqui por adivinhação de nome seria pior que mostrar tudo e
 * dizer a ressalva na tela.
 */
async function verdesDoLaboratorio(): Promise<Array<{
  name: string; family: string; capitalUsd: number;
}>> {
  const db = getSupabaseAdmin();
  if (!db) return [];
  try {
    const { data } = await db
      .from("lab_strategies")
      .select("name, family, capital_required_usd")
      .eq("status", "verde")
      .order("name");
    return (data ?? []).map((r) => ({
      name: r.name, family: r.family, capitalUsd: Number(r.capital_required_usd),
    }));
  } catch { return []; }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();

  const body = await req.json().catch(() => null) as
    { liberar?: unknown; motivo?: unknown; piloto?: unknown; remover?: unknown } | null;
  if (!body) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  /**
   * ⚠️ AUTORIZAR UMA CARTEIRA PILOTO É ABRIR UM FURO NA TRAVA: ela vai negociar
   * com DINHEIRO REAL numa feature fechada para todo o resto. Por isso custa
   * nota escrita, igual a abrir a trava — e sai no log de auditoria com a nota.
   */
  if (typeof body.piloto === "string" || typeof body.remover === "string") {
    const lista = await lerPilotos();
    if (typeof body.remover === "string") {
      const alvo = body.remover.toLowerCase();
      const nova = lista.filter((p) => p.wallet !== alvo);
      if (!await gravarPilotos(nova)) {
        return NextResponse.json({ error: "db_indisponivel" }, { status: 503 });
      }
      await logAdminAction(actor, "autopilot.piloto.remover", alvo, {});
      broadcastAdminRefresh("audit");
      return NextResponse.json({ ok: true, pilotos: nova });
    }
    const wallet = (body.piloto as string).trim().toLowerCase();
    const nota   = typeof body.motivo === "string" ? body.motivo.trim() : "";
    if (wallet.length < 8) return NextResponse.json({ error: "carteira_invalida" }, { status: 400 });
    if (nota.length < MIN_MOTIVO) {
      return NextResponse.json({ error: "motivo_curto", minMotivo: MIN_MOTIVO }, { status: 400 });
    }
    // Reautorizar a mesma carteira ATUALIZA a nota em vez de duplicar a linha:
    // duas entradas para a mesma carteira com notas diferentes seriam dois
    // registros contando histórias diferentes sobre o mesmo poder.
    const nova: Piloto[] = [
      ...lista.filter((p) => p.wallet !== wallet),
      { wallet, nota: nota.slice(0, 300), at: new Date().toISOString() },
    ];
    if (!await gravarPilotos(nova)) {
      return NextResponse.json({ error: "db_indisponivel" }, { status: 503 });
    }
    await logAdminAction(actor, "autopilot.piloto.autorizar", wallet, { nota: nota.slice(0, 300) });
    broadcastAdminRefresh("audit");
    return NextResponse.json({ ok: true, pilotos: nova });
  }

  if (typeof body.liberar !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const motivo = typeof body.motivo === "string" ? body.motivo : "";

  const r = await registrarLiberacao(body.liberar, motivo);
  if (!r.ok) {
    return NextResponse.json(
      { error: r.erro, minMotivo: MIN_MOTIVO },
      { status: r.erro === "db_indisponivel" ? 503 : 400 },
    );
  }

  // O log de auditoria carrega a justificativa junto — um registro de "abriu"
  // sem o porquê é a metade que não serve para nada depois.
  await logAdminAction(actor, "autopilot.liberacao", undefined, {
    liberar: body.liberar, motivo: motivo.slice(0, 500),
  });
  broadcastAdminRefresh("audit");

  return NextResponse.json({ ok: true, ...(await lerLiberacao()) });
}
