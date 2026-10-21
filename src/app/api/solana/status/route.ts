import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { assinaturaValidaFormato, consultarStatus } from "@/lib/solana/transmissao";
import { marcarTentativa } from "@/lib/solana/em-voo";

export const runtime = "nodejs";

/**
 * GET /api/solana/status?sig=<assinatura>&lvbh=<lastValidBlockHeight> (W3) — onde está a transação.
 * `confirmada` só com `err` nulo; `falhou_na_rede` quando pousou e reverteu; `expirada` quando o
 * blockhash venceu sem pousar (seguro tentar de novo); `pendente`; `desconhecido` se o RPC falhou.
 */
const RL_IP = { windowMs: 60_000, max: 90 };
const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sig = req.nextUrl.searchParams.get("sig");
  const lvbhTxt = req.nextUrl.searchParams.get("lvbh");
  if (!assinaturaValidaFormato(sig)) return NextResponse.json({ ok: false, erro: "assinatura_invalida" }, { status: 400, headers: SEM_CACHE });
  const lvbh = lvbhTxt === null || lvbhTxt === "" ? null : Number(lvbhTxt);
  if (lvbh !== null && (!Number.isSafeInteger(lvbh) || lvbh < 0)) return NextResponse.json({ ok: false, erro: "lvbh_invalido" }, { status: 400, headers: SEM_CACHE });
  const rl = await rateLimitDurable(`sol-status:${getClientId(req.headers)}`, RL_IP);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, erro: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { ...SEM_CACHE, "Retry-After": String(rl.retryAfter) } });
  }
  const r = await consultarStatus(sig, lvbh);
  /**
   * W3-C: fato on-chain encerra a trava da carteira. ⚠️ Só confirmada / falhou_na_rede — que não
   * dependem do `lvbh` desta URL (declarado pelo navegador). `expirada` só encerra a trava no
   * `/transmitir`, com a altura GRAVADA a partir do vínculo assinado pelo servidor.
   */
  if (r.estado === "confirmada" || r.estado === "falhou_na_rede") {
    await marcarTentativa(sig, { estado: "resolvida", desfecho: r.estado });
  }
  return NextResponse.json({ ok: true, assinatura: sig, ...r }, { headers: SEM_CACHE });
}
