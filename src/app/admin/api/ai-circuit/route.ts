import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { comandoAuditado, avisoDeAuditoria, PORQUE_AUDITORIA_INDISPONIVEL } from "@/lib/admin/auditoria-duravel";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { allProviders } from "@/lib/ai/registry";

export const dynamic = "force-dynamic";

/**
 * Circuit-breaker visibility (M4). The breaker (src/lib/ai/circuit.ts) trips
 * silently and only pages Telegram once — this route lets the AI Controls
 * panel SHOW each provider's breaker state and reset one manually after the
 * operator fixes the key / tops up credits (instead of waiting out the
 * cooldown).
 *
 * GET  — every provider (configured or not) with { fails, trippedUntil }.
 * POST — { id } resets that provider's breaker (deletes cb:<id>).
 */

interface CBState { fails: number; trippedUntil: number | null }

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const providers = Object.values(allProviders());
  const keys = providers.map((p) => `cb:${p.id}`);
  /**
   * ⚠️ O `error` NÃO ERA LIDO: leitura falha → nenhum disjuntor → todos "● ok,
   * 0 falhas" no painel. "Não consegui ler" e "está tudo saudável" eram a mesma
   * tela. Agora a falha é 503 `unavailable`, e JSON ilegível é `invalido` por
   * provedor em vez do padrão silencioso.
   */
  const { data, error } = await db.from("admin_kv").select("key, value").in("key", keys);
  if (error) {
    return NextResponse.json({
      state: "unavailable", error: "leitura_falhou", source: "admin_kv",
      porque: "não consegui ler os disjuntores — isto NÃO quer dizer que estão ok",
    }, { status: 503 });
  }
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));

  const now = Date.now();
  const breakers = providers.map((p) => {
    let state: CBState = { fails: 0, trippedUntil: null };
    let invalido = false;
    const raw = byKey.get(`cb:${p.id}`);
    if (raw) {
      try { state = { fails: 0, trippedUntil: null, ...JSON.parse(raw) }; } catch { invalido = true; }
    }
    const tripped = state.trippedUntil != null && now < state.trippedUntil;
    return {
      id: p.id, label: p.label, configured: !!p.apiKey,
      fails: state.fails, tripped, invalido,
      cooldownEndsAt: tripped ? new Date(state.trippedUntil!).toISOString() : null,
    };
  });

  return NextResponse.json({ state: "ok", breakers, fetchedAt: new Date().toISOString() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const { wallet: actor } = await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const body = await req.json().catch(() => null) as { id?: string } | null;
  const id = body?.id;
  if (!id || !allProviders()[id]) return NextResponse.json({ error: "invalid provider id" }, { status: 400 });

  /**
   * ⚠️ O DELETE NÃO ERA CONFERIDO: recusado, ele respondia `ok: true` e o log
   * dizia "resetou" — o operador voltava a confiar num provedor que o
   * disjuntor continuava pulando. Resetar é a direção PERMISSIVA (religa o
   * provedor), então passa por `comandoAuditado`: sem intenção gravada, não roda.
   */
  const r = await comandoAuditado<{ removidas: number }>({
    acao: "ai_circuit.reset", ator: actor, alvo: id,
    executar: async () => {
      const { data, error } = await db.from("admin_kv").delete().eq("key", `cb:${id}`).select("key");
      if (error) return { ok: false, codigo: "nao_resetou", detalhe: error.message.slice(0, 160) };
      return { ok: true, valor: { removidas: (data ?? []).length } };
    },
  });
  if (r.estado === "recusado") {
    return NextResponse.json({ error: "auditoria_indisponivel", id, porque: PORQUE_AUDITORIA_INDISPONIVEL }, { status: 503 });
  }
  if (r.estado !== "executado") {
    return NextResponse.json({
      error: "nao_resetou", id,
      porque: `o disjuntor NÃO foi resetado: ${r.estado === "falhou" ? r.detalhe ?? r.codigo : "?"}`,
      ...(r.estado === "falhou" ? avisoDeAuditoria(r.auditoria) : {}),
    }, { status: 500 });
  }
  return NextResponse.json({
    ok: true, id, removidas: r.valor.removidas,
    ...(r.valor.removidas === 0 ? { nota: "não havia estado gravado — o disjuntor já estava zerado" } : {}),
    ...avisoDeAuditoria(r.auditoria),
  });
}
