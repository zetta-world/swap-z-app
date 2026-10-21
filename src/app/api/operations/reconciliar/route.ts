import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { colunasDaVerificacao, verificarOperacaoSolana } from "@/lib/solana/reconciliacao";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/operations/reconciliar — W3-D. Reconcilia na rede as operações Solana `aguardando`
 * (as que o registro não conseguiu fechar na hora). `Authorization: Bearer <CRON_SECRET>`.
 *
 * Só ESCREVE colunas de verificação, e só em linha ainda `aguardando` (nunca reescreve um veredito).
 * Falha de RPC deixa a linha como está. Nada de histórico é apagado.
 */
const LOTE = 25;

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export async function POST(req: NextRequest): Promise<Response> {
  if (!autorizado(req)) return json({ ok: false, error: "unauthorized" }, 401);
  const db = getSupabaseAdmin();
  if (!db) return json({ ok: false, error: "db_unavailable" }, 503);

  const { data, error } = await db.from("operations")
    .select("id, tx_signature, carteira_origem, platform_fee_usd, platform_fee_bps, created_at")
    .eq("verificacao", "aguardando").not("tx_signature", "is", null)
    .order("created_at", { ascending: true }).limit(LOTE);
  if (error) return json({ ok: false, error: "leitura_falhou" }, 503);

  const contagem = { verificada_onchain: 0, divergente: 0, aguardando: 0, falhas_de_gravacao: 0 };
  for (const r of data ?? []) {
    const fee = r.platform_fee_usd == null ? null : Number(r.platform_fee_usd);
    const bps = r.platform_fee_bps == null ? null : Number(r.platform_fee_bps);
    const v = await verificarOperacaoSolana(String(r.tx_signature), {
      carteira: r.carteira_origem ?? null,
      taxaDeclarada: (fee !== null && fee > 0) || (bps !== null && bps > 0),
      criadaEm: Date.parse(String(r.created_at)),
    });
    contagem[v.verificacao] += 1;
    if (v.verificacao === "aguardando") continue;
    const { error: e } = await db.from("operations").update(colunasDaVerificacao(v))
      .eq("id", r.id).eq("verificacao", "aguardando");
    if (e) contagem.falhas_de_gravacao += 1;
  }
  return json({ ok: contagem.falhas_de_gravacao === 0, lidas: data?.length ?? 0, ...contagem },
    contagem.falhas_de_gravacao === 0 ? 200 : 503);
}
