import { NextResponse } from "next/server";
import { autorizarAdmin } from "@/lib/admin/authz";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { lerTodasPorChave } from "@/lib/supabase/paginar";
import { comTeto, deLeitura, indisponivel, type OperationalMetric } from "@/lib/admin/metrica";

export const dynamic = "force-dynamic";

const TETO_MS = 5_000;
const MOSTRAR_POSICOES = 50;
const MOSTRAR_RUNS = 40;

type Posicao = {
  id: string; base: string; pair: string; base_amount: number; cost_usd: number; entry_price: number;
  status: string; exit_order_id: string | null; entry_ts: string; exchange_id: string;
};

/**
 * Live autopilot operations for the admin panel: open positions (the bag the bot holds right now)
 * + the most recent fired/rejected runs.
 *
 * ⚠️ R3/P1-10 (Admin CC 2.0): a exposição somava só as 50 posições da LISTA, e uma leitura que
 * falhava (sem `error` conferido) virava "No open autopilot positions." + exposure $0 — dinheiro
 * em risco mostrado como nada. Agora: TODAS as posições abertas lidas por chave (a exposição é a
 * soma de todas; a lista mostra as 50 mais recentes); posições ilegíveis = 503 (a fonte principal);
 * o feed de runs ilegível vira `runsMetrica` indisponível, sem derrubar as posições.
 */
export async function GET(): Promise<NextResponse> {
  await autorizarAdmin("trading.positions.read");
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable", state: "unavailable" }, { status: 503 });
  const asOf = new Date().toISOString();

  const [rPos, rRuns] = await Promise.all([
    comTeto(() => lerTodasPorChave<Posicao>((d, n) => {
      let q = db.from("autopilot_positions")
        .select("id, base, pair, base_amount, cost_usd, entry_price, status, exit_order_id, entry_ts, exchange_id")
        .neq("status", "closed");
      if (d) q = q.gt("id", d);
      return q.order("id", { ascending: true }).limit(n);
    }, "id"), TETO_MS),
    comTeto(() => Promise.resolve(
      // leitura-limitada: o feed mostra as execuções mais recentes; nenhum total sai daqui.
      db.from("autopilot_runs")
        .select("ran_at, symbol, side, order_type, notional_usd, status, reason, exchange_id")
        .order("ran_at", { ascending: false })
        .limit(MOSTRAR_RUNS),
    ), TETO_MS),
  ]);

  const leituraPos = rPos.ok ? rPos.valor : { linhas: [] as Posicao[], erro: rPos.errorCode, truncado: false, paginas: 0 };
  const exposicao = deLeitura(leituraPos, "autopilot_positions(aberta).cost_usd",
    (ls) => ls.reduce((s, p) => s + (Number(p.cost_usd) || 0), 0), { asOf });
  if (exposicao.state === "unavailable") {
    return NextResponse.json({
      state: "unavailable", errorCode: exposicao.errorCode, error: "posicoes_ilegiveis", openExposureMetrica: exposicao,
      porque: "não consegui ler as posições abertas — isto NÃO é 'nenhuma posição'",
    }, { status: 503 });
  }

  const runsOk = rRuns.ok && !rRuns.valor.error;
  const runsMetrica: OperationalMetric<number> = runsOk
    ? { state: (rRuns.valor.data ?? []).length === 0 ? "empty" : "ok", value: (rRuns.valor.data ?? []).length, quality: "measured", source: "autopilot_runs(recentes)", asOf }
    : indisponivel("autopilot_runs(recentes)", "measured", rRuns.ok ? "leitura_falhou" : rRuns.errorCode, asOf);

  const positions = [...leituraPos.linhas]
    .sort((a, b) => String(b.entry_ts).localeCompare(String(a.entry_ts)))
    .slice(0, MOSTRAR_POSICOES);

  return NextResponse.json({
    state: exposicao.state === "partial" || !runsOk ? "partial" : "ok",
    positions,
    positionsTotal: leituraPos.linhas.length,
    runs: runsOk ? (rRuns.ok ? rRuns.valor.data ?? [] : []) : null,
    runsMetrica,
    openExposure: exposicao.value,
    openExposureMetrica: exposicao,
    fetchedAt: asOf,
  });
}
