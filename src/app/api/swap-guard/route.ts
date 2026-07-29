import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/admin/track";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/swap-guard — telemetria do guard de assinatura em Solana.
 *
 * O guard roda no CLIENTE (tem que rodar: a decisão é "assinar ou não", e a
 * assinatura acontece no navegador). Sem este endpoint, uma onda de recusas
 * seria invisível pra operação — o dono só descobriria por reclamação de
 * usuário, o que transforma um incidente de minutos num incidente de horas.
 *
 * Registra os DOIS lados de propósito:
 *   · recusa  → alerta ("a Jupiter mudou algo?" / "alguém tentou algo?")
 *   · sucesso → a linha de base que permite ler a recusa. Sem denominador,
 *               "12 recusas" não diz se é 12 de 12 (guard quebrado) ou 12 de
 *               50.000 (ataque isolado). Só o par dá sentido ao número.
 *
 * Fire-and-forget: nunca responde erro pro cliente e nunca atrasa o swap.
 * Telemetria que quebra o fluxo que observa não presta.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return new NextResponse(null, { status: 204 });

    const ok = body.ok === true;
    const mode = ["off", "shadow", "enforce"].includes(body.mode) ? body.mode : "shadow";
    const blocked = body.blocked === true;

    // Sanitiza: só base58 com cara de endereço, teto de itens e de tamanho.
    // O corpo vem do cliente, então nada aqui pode confiar no formato.
    const addrs = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x)).slice(0, 12)
        : [];

    recordEvent("swap_guard", {
      meta: {
        ok, mode, blocked,
        unknownPrograms: addrs(body.unknownPrograms),
        programs: addrs(body.programs),
        symbol: typeof body.symbol === "string" ? body.symbol.slice(0, 20) : null,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
