import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 30 };

/**
 * ⚠️⚠️⚠️ ESTA ROTA NÃO CONTA MAIS NADA — e o motivo é conta DOBRADA (A130-B).
 *
 * Ela nasceu como o write-back do A1: o piloto do navegador disparava a ordem
 * e DEPOIS publicava aqui, para `bumpSessionTrades` somar o disparo ao
 * `trades_today` que o cron também usa. Enquanto o servidor não contava nada,
 * era o único jeito de o teto diário enxergar o canal do navegador.
 *
 * Com o A130-B, `/api/cex/order` RESERVA a vaga no momento em que age —
 * compare-and-swap em `reservarTradeDaSessao`, antes do envio, na costura que o
 * executor já tinha. Manter o write-back passou a somar a MESMA perna duas
 * vezes: cada disparo consumia duas vagas e o teto de 5/dia virava 2,5.
 *
 * ⚠️ E O DEFEITO ORIGINAL DESTA ROTA (A12) CONTINUA REGISTRADO, porque ele
 * explica por que ela não voltou a contar "só por garantia": o retorno de
 * `bumpSessionTrades` era descartado dentro de um `try/catch` que nunca pegava
 * nada — a função RESOLVE com `false`, não lança —, e toda falha de banco
 * devolvia `{ ok: true }` enquanto o limite diário parava de contar este canal
 * em silêncio pelo resto do dia.
 *
 * ⚠️ POR QUE NÃO APAGAR O ARQUIVO: abas antigas, com o JS anterior em cache,
 * ainda fazem este POST depois de disparar. Elas precisam encontrar uma recusa
 * explícita — não um 404 de HTML e não um `{ ok: true }` que mentiria dizendo
 * que contou. O cliente atual só relê o contador do servidor.
 *
 * Quem conta é quem age. Esta rota não age.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`autopilot_record_fire:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "rate_limited", retryAfter: rl.retryAfter }, { status: 429 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }
  return NextResponse.json(
    { ok: false, error: "contagem_no_servidor",
      porque: "o teto diario passou a ser RESERVADO por /api/cex/order no momento "
        + "da ordem; contar aqui somaria o mesmo disparo duas vezes. "
        + "Nada foi gravado." },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}
