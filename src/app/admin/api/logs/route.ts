import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = { event_type: string; metadata: Record<string, unknown> | null; created_at: string };

/** Errors + security events for the admin Logs & Security panel — so bugs and
 *  intrusion/abuse attempts are visible without reading server logs. */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("security.logs.read");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const ago24h = new Date(Date.now() - 86_400_000).toISOString();

  /**
   * ⚠⚠ AS QUATRO CONSULTAS ERAM DUAS, DUPLICADAS — achado A28 da auditoria
   * externa.
   *
   * O `Promise.all` carregava QUATRO consultas e a desestruturação pegava DUAS.
   * Os elementos 0 e 1 eram a MESMA consulta (`limit(60)`), e os de 24h, nos
   * índices 2 e 3, rodavam e eram DESCARTADOS.
   *
   * Resultado: `errors24h`, `security24h`, `high24h` e `topKinds` saíam dos 60
   * eventos mais recentes DE TODOS OS TEMPOS. Num dia calmo o painel INFLAVA,
   * contando erros de semanas atrás como se fossem de hoje; num dia movimentado
   * ele TRAVAVA em 60, escondendo o volume real bem quando ele importa.
   *
   * O rótulo dizia "24h" e o número vinha de outro lugar — a família de defeito
   * que esta auditoria mais encontrou, agora no painel que existe para ver
   * abuso e tentativa de invasão.
   */
  const [{ data: recent, error: erroRecentes }, { data: rows24h, error: erro24h }] = await Promise.all([
    // leitura-limitada: os 60 eventos mais recentes, que é o que a tela mostra.
    // A CONTAGEM de 24h vem da consulta seguinte, que não depende deste recorte.
    db.from("platform_events")
      .select("event_type, metadata, created_at")
      .in("event_type", ["error", "security"])
      .order("created_at", { ascending: false })
      .limit(60),
    // leitura-limitada: contagem de 24h para o cabeçalho. Se passar de 1.000
    // erros num dia, o número exato deixou de ser a informação relevante.
    db.from("platform_events")
      .select("event_type, metadata, created_at")
      .in("event_type", ["error", "security"])
      .gte("created_at", ago24h)
      .limit(1000),
  ]);

  /**
   * ⚠️ R3/P1-6: as duas leituras descartavam `{ error }` e o painel dizia
   * "No errors or security events in 24h. ✓" com o banco fora — no painel que
   * existe para ver tentativa de invasão. Falhou → 503, sem contagem.
   */
  if (erroRecentes || erro24h) {
    return NextResponse.json({
      state: "unavailable", errorCode: "leitura_falhou", error: "logs_ilegiveis",
      falhou: [erroRecentes ? "recentes" : "", erro24h ? "24h" : ""].filter(Boolean),
    }, { status: 503 });
  }
  const truncado24h = (rows24h ?? []).length >= 1000;

  let errors24h = 0, security24h = 0, high24h = 0;
  const byKind: Record<string, number> = {};
  for (const r of (rows24h ?? []) as Row[]) {
    if (r.event_type === "error") errors24h++;
    else security24h++;
    const m = r.metadata ?? {};
    if (m.severity === "high") high24h++;
    const kind = String(m.kind ?? m.where ?? r.event_type);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  const topKinds = Object.entries(byKind).map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count).slice(0, 8);

  return NextResponse.json({
    errors24h, security24h, high24h, topKinds,
    // Bateu no recorte de 1.000: as contagens são PISO, não total.
    truncado24h,
    recent: (recent ?? []) as Row[],
    fetchedAt: new Date().toISOString(),
  });
}
