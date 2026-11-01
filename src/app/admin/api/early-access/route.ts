import { NextRequest, NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { listar, detalhe, metricas } from "@/lib/early-access/store";
import { lerGateEarlyAccess } from "@/lib/early-access/gate";
import { lerFiltros } from "@/lib/early-access/filtros";

export const dynamic = "force-dynamic";

/**
 * EARLY ACCESS — lista, detalhe, métricas e estado do gate.
 *
 * ⚠️ NÃO É o módulo `whitelist` (ADMIN_WALLETS). Plano: docs/PLANO-EARLY-ACCESS.md.
 *
 * GET               → { linhas, total, limit, offset, metricas, gate }
 * GET ?id=<uuid>    → { linha, eventos, consentimentos }
 *
 * Filtros: status, country, has_wallet (1|0), verified (1|0), q (prefixo do email), limit
 * (1–200, padrão 50), offset (≥0). Parâmetro inválido = 400, nunca ignorado
 * em silêncio — um filtro que "não pegou" mostraria a lista inteira como se
 * fosse o recorte pedido.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  await autorizarAdmin("users.early_access.read");
  const p = req.nextUrl.searchParams;

  const id = p.get("id");
  if (id !== null) {
    if (!UUID.test(id)) return NextResponse.json({ error: "id_invalido" }, { status: 400 });
    const r = await detalhe(id);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 503 });
    if (!r.linha) return NextResponse.json({ error: "nao_encontrado" }, { status: 404 });
    return NextResponse.json({ linha: r.linha, eventos: r.eventos, consentimentos: r.consentimentos });
  }

  const filtros = lerFiltros(p);
  if ("erro" in filtros) return NextResponse.json({ error: filtros.erro }, { status: 400 });

  const [lista, m, gate] = await Promise.all([listar(filtros), metricas(), lerGateEarlyAccess()]);
  if (!lista.ok) return NextResponse.json({ error: lista.erro }, { status: 503 });
  return NextResponse.json({
    linhas: lista.linhas, total: lista.total, limit: filtros.limit, offset: filtros.offset,
    // métrica que falhou vem como null, nunca como zeros
    metricas: m.ok ? m.m : null,
    gate,
    fetchedAt: new Date().toISOString(),
  });
}
