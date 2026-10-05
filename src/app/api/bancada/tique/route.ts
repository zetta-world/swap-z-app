/**
 * O TIQUE DO PAPEL ADIANTE NUMA INVOCAÇÃO PRÓPRIA (CE-09).
 *
 * ⚠️⚠️ POR QUE UMA ROTA SÓ PARA ELE. O tique roda pendurado no cron de
 * `/api/zion/backtest`, DEPOIS das varreduras do flywheel e do LLM — que levam
 * 30–45 s de uma função com `maxDuration` de 60 s. Os desks dos clientes
 * ficavam com o resto. Aqui ele tem a função inteira: prazo de 45 s, com folga
 * para a escrita em lote e o carimbo do que não coube.
 *
 * ⚠️ AGENDAR É PASSO DO DONO (cron-job.org, como os outros crons — ver
 * CLAUDE.md). Enquanto esta rota não for agendada, nada muda: o tique segue no
 * cron do backtest. Quando ela rodar, grava `bancada:tique:dedicado_em`, e o
 * cron do backtest deixa de rodar o tique por 40 minutos — os dois nunca
 * disputam a mesma passagem por muito tempo (e a guarda `vela_ja_avaliada`
 * impede abertura dobrada mesmo se disputarem).
 *
 * Auth: CRON_SECRET, comparação de tempo constante. Gate: `pause_bancada`.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getFlywheelGates } from "@/lib/admin/gates";
import { recordEvent } from "@/lib/admin/track";
import { tiqueDoPapelAdiante } from "@/lib/bancada/tique";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Prazo do tique nesta rota: a função inteira, menos folga para gravar e responder. */
const PRAZO_DEDICADO_MS = Number(process.env.BANCADA_TIQUE_DEDICADO_PRAZO_MS ?? 45_000);
const LOCK_MS = 3 * 60_000;
export const CHAVE_DEDICADO = "bancada:tique:dedicado_em";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ ok: false, error: "sem_banco" }, { status: 503 });

  const gates = await getFlywheelGates();
  if (gates.pause_bancada) return NextResponse.json({ ok: true, paused: true });

  // Lock de passagem (mesmo padrão do cron do backtest): melhor-esforço — o
  // pior caso de duas passagens juntas é avaliar a mesma vela duas vezes, e a
  // guarda `vela_ja_avaliada` impede a segunda abertura.
  const chaveLock = "lock:bancada_tique";
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", chaveLock).maybeSingle();
    const ultimo = data?.value ? Date.parse(data.value) : NaN;
    if (Number.isFinite(ultimo) && Date.now() - ultimo < LOCK_MS) {
      return NextResponse.json({ ok: true, skipped: "duplicate_tick" });
    }
    const agora = new Date().toISOString();
    await db.from("admin_kv").upsert([
      { key: chaveLock, value: agora, updated_at: agora },
      { key: CHAVE_DEDICADO, value: agora, updated_at: agora },
    ], { onConflict: "key" });
  } catch { /* melhor-esforço */ }

  const r = await tiqueDoPapelAdiante(db, Date.now(), { prazoMs: PRAZO_DEDICADO_MS });
  await recordEvent("bancada_papel_tique", {
    meta: { mesas: r.mesas, abertas: r.abertas, fechadas: r.fechadas, cortadasPorPlano: r.cortadasPorPlano,
            adiadas: r.adiadas, leituras: r.leituras, cicloCompleto: r.cicloCompleto, dedicado: true,
            problemas: r.problemas.slice(0, 5) },
  }).catch(() => {});
  return NextResponse.json({ ok: true, mesas: r.mesas, adiadas: r.adiadas, cicloCompleto: r.cicloCompleto });
}
