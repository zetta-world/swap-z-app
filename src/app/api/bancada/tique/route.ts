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
 * cron do backtest deixa de rodar o tique por 40 minutos.
 *
 * ⚠️⚠️ A EXCLUSÃO NÃO É ESTA MARCA (RM-01, auditoria do round de custo). Havia
 * aqui uma "trava" SELECT → decide → UPSERT em `admin_kv` — duas invocações
 * liam "livre" e rodavam juntas. A exclusão agora é o LEASE do banco (0076),
 * tomado dentro de `tiqueDoPapelAdiante` com o MESMO escopo que o cron do
 * backtest usa; e a abertura é idempotente no banco (chave canônica + UNIQUE).
 * Sem a 0076 o tique não roda: 503 aqui, falha fechada.
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

  const r = await tiqueDoPapelAdiante(db, Date.now(), { prazoMs: PRAZO_DEDICADO_MS });

  if (r.exclusividade === "tomada") {
    /**
     * ⚠️ A MARCA "a rota dedicada está viva" (o cron do backtest cede o tique
     * por 40 min). Só depois de uma passagem que RODOU — marcar antes faria o
     * cron ceder para uma rota que não conseguiu rodar. O erro é declarado.
     */
    const agora = new Date().toISOString();
    try {
      const { error } = await db.from("admin_kv").upsert(
        { key: CHAVE_DEDICADO, value: agora, updated_at: agora }, { onConflict: "key" });
      if (error) r.problemas.push(`marca da rota dedicada não gravada: ${error.message}`);
    } catch (e) {
      r.problemas.push(`marca da rota dedicada não gravada: ${e instanceof Error ? e.message : "exceção"}`);
    }
  }

  await recordEvent("bancada_papel_tique", {
    meta: { mesas: r.mesas, abertas: r.abertas, fechadas: r.fechadas, cortadasPorPlano: r.cortadasPorPlano,
            adiadas: r.adiadas, leituras: r.leituras, cicloCompleto: r.cicloCompleto, dedicado: true,
            exclusividade: r.exclusividade, jaRegistradas: r.jaRegistradas,
            problemas: r.problemas.slice(0, 5) },
  }).catch(() => {});

  if (r.exclusividade === "ocupado") return NextResponse.json({ ok: true, skipped: "duplicate_tick" });
  if (r.exclusividade === "indisponivel") {
    return NextResponse.json({ ok: false, error: "exclusao_indisponivel", problemas: r.problemas.slice(0, 3) }, { status: 503 });
  }
  return NextResponse.json({ ok: true, mesas: r.mesas, adiadas: r.adiadas, cicloCompleto: r.cicloCompleto });
}
