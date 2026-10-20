import { NextResponse, type NextRequest } from "next/server";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { chaveValida, lerSaldoSolana, MINT_NATIVO } from "@/lib/solana/saldos";

export const runtime = "nodejs";

/**
 * GET /api/solana/saldo?owner=<base58>&mint=<base58|native> — saldo Solana lido no SERVIDOR (W1).
 *
 * Existe porque o RPC público recusa (403) qualquer chamada vinda de navegador — ver
 * `lib/solana/saldos.ts`. NÃO é proxy JSON-RPC: um endereço, um mint, um número. A URL/credencial
 * do RPC nunca aparece na resposta.
 *
 * Respostas:
 *   200 `{ ok: true, owner, mint, raw, decimals, contas }` — `raw` é inteiro em string (precisão).
 *   502 `{ ok: false, owner, mint, erro, transitorio }` — o fornecedor falhou; NUNCA "0".
 *   400 entrada inválida · 429 limite por IP · 503 teto global.
 */
const RL_IP     = { windowMs: 60_000, max: 120 };
const RL_GLOBAL = { windowMs: 60_000, max: Number(process.env.SALDO_SOLANA_GLOBAL_MAX ?? 6000) };
const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest): Promise<NextResponse> {
  const owner = req.nextUrl.searchParams.get("owner");
  const mint  = req.nextUrl.searchParams.get("mint") ?? MINT_NATIVO;
  if (!chaveValida(owner)) return NextResponse.json({ ok: false, erro: "owner_invalido" }, { status: 400, headers: SEM_CACHE });
  if (mint !== MINT_NATIVO && !chaveValida(mint)) return NextResponse.json({ ok: false, erro: "mint_invalido" }, { status: 400, headers: SEM_CACHE });

  const rl = await rateLimitDurable(`sol-saldo:${getClientId(req.headers)}`, RL_IP);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, erro: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { ...SEM_CACHE, "Retry-After": String(rl.retryAfter) } });
  }
  // Teto global: protege a conta do RPC contra enchente distribuída (muitos IPs).
  const gb = await rateLimitDurable("sol-saldo:global", RL_GLOBAL);
  if (!gb.ok) {
    console.warn("[sol-saldo] teto global atingido");
    return NextResponse.json({ ok: false, erro: "ocupado", transitorio: true }, { status: 503, headers: SEM_CACHE });
  }

  const l = await lerSaldoSolana(owner, mint);
  if (l.ok) {
    return NextResponse.json({ ok: true, owner: l.owner, mint: l.mint, raw: l.raw, decimals: l.decimals, contas: l.contas },
      { headers: SEM_CACHE });
  }
  // Só o tipo — nunca a URL do RPC nem a mensagem crua do fornecedor.
  console.warn("[sol-saldo]", JSON.stringify({ tipo: l.tipo, mint: l.mint === MINT_NATIVO ? "native" : l.mint.slice(0, 6) }));
  return NextResponse.json({ ok: false, owner: l.owner, mint: l.mint, erro: l.tipo, transitorio: l.transitorio },
    { status: 502, headers: SEM_CACHE });
}
