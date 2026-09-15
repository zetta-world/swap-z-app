import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { bumpSessionTrades } from "@/lib/autopilot/sessions";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { SUPPORTED_CEX_IDS, type CexId } from "@/lib/cex/types";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 30 };
const VALID_EXCHANGES = new Set<CexId>(SUPPORTED_CEX_IDS);

/**
 * POST /api/autopilot/session/record-fire — the in-browser pilot publishes a
 * fire to its background session so the server's trades_today reflects BOTH
 * channels (A1). No-op if the signed-in wallet has no session on that
 * exchange. This does NOT place any order — it only increments the counter.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`autopilot_record_fire:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter }, { status: 429 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "supabase_not_configured" }, { status: 503 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  let body: { exchangeId?: string; count?: number };
  try { body = await req.json() as { exchangeId?: string; count?: number }; }
  catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }

  const exchangeId = (body.exchangeId || "").toLowerCase() as CexId;
  if (!VALID_EXCHANGES.has(exchangeId)) {
    return NextResponse.json({ ok: false, error: "invalid_exchange" }, { status: 400 });
  }
  // Clamp the count hard — a single browser fire is 1-3 legs.
  const count = Math.max(1, Math.min(3, Math.round(Number(body.count) || 1)));

  /**
   * ⚠⚠ O RETORNO ERA DESCARTADO, E O `try/catch` NÃO PEGAVA NADA
   * (achado A12 da auditoria externa).
   *
   * `bumpSessionTrades` devolve `boolean` — e foi MUDADA de propósito para
   * isso, com a cicatriz escrita no cabeçalho dela:
   *
   *     ⚠⚠ DEVOLVE SE CONTOU — e antes engolia a falha (auditoria 23/08).
   *     Se ele falhasse, o contador nao subia e o limite diario simplesmente
   *     DEIXAVA DE EXISTIR, em silencio, pelo resto do dia.
   *
   * O cron confere nos DOIS pontos onde chama. Esta rota, não. É a peça certa,
   * com a cicatriz escrita, conferida num caminho e ignorada no outro — o
   * padrão que esta auditoria mais encontrou.
   *
   * ⚠️ E o `try/catch` era engano de cima a baixo: a função RESOLVE com
   * `false`, ela não lança. O `catch` nunca rodou uma vez, e a rota devolvia
   * `{ ok: true }` para toda falha de banco.
   *
   * O navegador dispara a ordem PRIMEIRO e publica depois: não dá para desfazer
   * nada aqui. O objetivo é NUNCA PERDER O FATO — quem chama precisa saber que
   * o limite diário dele parou de contar este canal.
   */
  const contou = await bumpSessionTrades(session.sub, exchangeId, count);
  if (!contou) {
    await recordEvent("autopilot_disparo_nao_contado", { wallet: session.sub, meta: {
      exchangeId, count, severity: "high",
      why: "a ordem do navegador JÁ FOI COLOCADA e o contador diario nao subiu. "
        + "O limite de trades por dia que o usuario configurou parou de contar "
        + "este canal, em silencio, pelo resto do dia.",
    } });
    return NextResponse.json(
      { ok: false, error: "nao_contou", exchangeId, count,
        porque: "a ordem foi colocada, mas o contador diário NÃO subiu — o seu "
          + "limite de trades por dia deixou de contar este canal hoje." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
