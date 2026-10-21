import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { transmitir, validarTransacaoAssinada } from "@/lib/solana/transmissao";

export const runtime = "nodejs";

/**
 * POST /api/solana/transmitir `{ tx: base64 (assinada pela carteira), owner }` (W3).
 *
 * Transmite pelo RPC do SERVIDOR uma transação que a carteira do usuário JÁ assinou — o RPC público
 * recusa (403) qualquer envio vindo de navegador. Nada é assinado aqui; ver `lib/solana/transmissao.ts`.
 *
 *   200 `{ estado: "enviada" | "nao_enviada" | "incerta", assinatura, motivo? }` — a assinatura vai
 *       SEMPRE junto (derivada da própria transação), para reconciliar mesmo se o envio falhar.
 *   400 transação inválida (não chegou ao RPC) · 413 grande demais · 429/503 limites.
 */
const RL_IP     = { windowMs: 60_000, max: 20 };
const RL_GLOBAL = { windowMs: 60_000, max: Number(process.env.TRANSMISSAO_SOLANA_GLOBAL_MAX ?? 600) };
const SEM_CACHE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tamanho = Number(req.headers.get("content-length") ?? "0");
  if (tamanho > 4096) return NextResponse.json({ ok: false, erro: "grande_demais" }, { status: 413, headers: SEM_CACHE });
  let corpo: { tx?: unknown; owner?: unknown };
  try {
    const texto = await req.text();
    if (texto.length > 4096) return NextResponse.json({ ok: false, erro: "grande_demais" }, { status: 413, headers: SEM_CACHE });
    corpo = JSON.parse(texto);
  } catch { return NextResponse.json({ ok: false, erro: "json" }, { status: 400, headers: SEM_CACHE }); }

  const rl = await rateLimitDurable(`sol-tx:${getClientId(req.headers)}`, RL_IP);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, erro: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { ...SEM_CACHE, "Retry-After": String(rl.retryAfter) } });
  }
  const gb = await rateLimitDurable("sol-tx:global", RL_GLOBAL);
  if (!gb.ok) return NextResponse.json({ ok: false, erro: "ocupado" }, { status: 503, headers: SEM_CACHE });

  const v = validarTransacaoAssinada(corpo.tx, corpo.owner);
  if (!v.ok) {
    console.warn("[sol-tx]", JSON.stringify({ recusada: v.motivo }));
    return NextResponse.json({ ok: false, erro: v.motivo }, { status: 400, headers: SEM_CACHE });
  }
  const r = await transmitir(v);
  // Só estado/motivo/assinatura pública — nunca a transação, nunca a URL do RPC.
  console.info("[sol-tx]", JSON.stringify({ estado: r.estado, motivo: "motivo" in r ? r.motivo : null, assinatura: r.assinatura.slice(0, 12) }));
  return NextResponse.json({ ok: true, ...r }, { headers: SEM_CACHE });
}
