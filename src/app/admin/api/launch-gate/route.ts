import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { measureLaunchGate } from "@/lib/admin/launch-gate";

export const dynamic = "force-dynamic";

/**
 * GET /admin/api/launch-gate — mede o critério PRÉ-REGISTRADO de lançamento
 * (docs/PLANO-BARRA-DE-LANCAMENTO.md).
 *
 * Só leitura. A barra foi escrita antes dos dados chegarem justamente para que
 * esta rota não tenha nada a decidir: ela apenas confere e reporta.
 */
export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  return NextResponse.json(await measureLaunchGate());
}
