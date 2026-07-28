import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { checkSwapTarget, checkSwapSpender } from "@/lib/swap/trusted-targets";

export const dynamic = "force-dynamic";

/**
 * OBSERVE MODE (pentest 28/07). Aggregates the router `to` + approval `spender`
 * addresses that 0x/LiFi ACTUALLY returned on real firm quotes (logged in
 * swap_intent events), so the owner can review the canonical set and pin it
 * into NEXT_PUBLIC_ALLOWED_SWAP_TARGETS / _SPENDERS without hand-typing.
 *
 * Read-only. The addresses here are what ExecuteSwap signs, so an entry that
 * appears MANY times over MANY days is almost certainly canonical — but the
 * owner still verifies each on a block explorer before enforcing.
 */
const CHAIN_NAME: Record<number, string> = {
  1: "ethereum", 137: "polygon", 8453: "base", 42161: "arbitrum",
  10: "optimism", 43114: "avalanche", 56: "bsc",
};

type EvtRow = { metadata: { meta?: { chainId?: number; source?: string; target?: string; spender?: string } } | null; created_at: string };

interface Obs { chainId: number; role: "target" | "spender"; address: string; source: string; count: number; first: string; last: string; enforced: boolean }

export async function GET(): Promise<NextResponse> {
  await requireAdmin();
  const db = getSupabaseAdmin();
  if (!db) return NextResponse.json({ error: "db_unavailable" }, { status: 503 });

  const rows = await selectAllRows<EvtRow>((from, to) =>
    db.from("platform_events")
      .select("metadata, created_at")
      .eq("event_type", "swap_intent")
      .order("created_at", { ascending: false })
      .range(from, to),
  );

  // Aggregate unique (chainId, role, address).
  const key = (c: number, r: string, a: string) => `${c}|${r}|${a}`;
  const agg = new Map<string, Obs>();
  const addr = (v: unknown) => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : null);
  for (const r of rows) {
    const m = r.metadata?.meta;
    if (!m || typeof m.chainId !== "number") continue;
    for (const role of ["target", "spender"] as const) {
      const a = addr(m[role]);
      if (!a) continue;
      const k = key(m.chainId, role, a);
      const cur = agg.get(k);
      if (cur) { cur.count++; if (r.created_at < cur.first) cur.first = r.created_at; }
      else agg.set(k, {
        chainId: m.chainId, role, address: a, source: m.source ?? "?", count: 1,
        first: r.created_at, last: r.created_at,
        enforced: role === "target" ? checkSwapTarget(m.chainId, a).configured : checkSwapSpender(m.chainId, a).configured,
      });
    }
  }
  const observed = [...agg.values()].sort((x, y) => x.chainId - y.chainId || x.role.localeCompare(y.role) || y.count - x.count)
    .map((o) => ({ ...o, chain: CHAIN_NAME[o.chainId] ?? String(o.chainId) }));

  // Ready-to-paste env strings (chainId:addr,addr;chainId:addr).
  const build = (role: "target" | "spender") => {
    const byChain = new Map<number, Set<string>>();
    for (const o of observed) if (o.role === role) (byChain.get(o.chainId) ?? byChain.set(o.chainId, new Set()).get(o.chainId)!).add(o.address);
    return [...byChain.entries()].sort((a, b) => a[0] - b[0]).map(([c, s]) => `${c}:${[...s].join(",")}`).join(";");
  };

  return NextResponse.json({
    observed,
    envTargets:  build("target"),
    envSpenders: build("spender"),
    enforcing: {
      targets:  !!process.env.NEXT_PUBLIC_ALLOWED_SWAP_TARGETS,
      spenders: !!process.env.NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS,
    },
    note: "Verifique cada endereço no explorer antes de fixar. Cole envTargets/envSpenders na Vercel e faça redeploy.",
    fetchedAt: new Date().toISOString(),
  });
}
