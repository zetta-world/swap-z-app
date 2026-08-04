import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { selectAllRows } from "@/lib/supabase/paginate";
import { checkSwapTarget, checkSwapSpender } from "@/lib/swap/trusted-targets";
import { recordEvent } from "@/lib/admin/track";
import { fetchZeroXPrice, ZEROX_CHAIN_IDS, ZEROX_NATIVE, isZeroXSupported } from "@/lib/api/zerox";
import { fetchLiFiQuote, LIFI_CHAIN_IDS, LIFI_NATIVE, isLiFiSupported } from "@/lib/api/lifi";
import { findToken } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";

export const runtime = "nodejs";
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

// recordEvent stores the `meta` object FLAT in `metadata` (not nested under
// metadata.meta) — confirmed against the live rows.
type EvtRow = { metadata: { chainId?: number; source?: string; target?: string; spender?: string; probe?: boolean } | null; created_at: string };

interface Obs {
  chainId: number; role: "target" | "spender"; address: string; source: string;
  /** Total observado (sondas + tráfego real). */
  count: number;
  /** Só as observações vindas de SWAP REAL de usuário.
   *
   *  Separado porque o painel apresenta "visto N×" como evidência de que o
   *  endereço é canônico — e uma contagem inflada pelas próprias sondas do
   *  auto-populate seria evidência circular: o sistema confirmando a si mesmo. */
  realCount: number;
  first: string; last: string; enforced: boolean;
}

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
    const m = r.metadata;
    if (!m || typeof m.chainId !== "number") continue;
    for (const role of ["target", "spender"] as const) {
      const a = addr(m[role]);
      if (!a) continue;
      const k = key(m.chainId, role, a);
      const isProbe = m.probe === true;
      const cur = agg.get(k);
      if (cur) { cur.count++; if (!isProbe) cur.realCount++; if (r.created_at < cur.first) cur.first = r.created_at; }
      else agg.set(k, {
        chainId: m.chainId, role, address: a, source: m.source ?? "?",
        count: 1, realCount: isProbe ? 0 : 1,
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
    note: "Verifique cada endereço no explorer antes de fixar. Cole envTargets/envSpenders na Vercel e faça redeploy. "
      + "ATENÇÃO: 'visto N×' conta TAMBÉM as sondas do auto-populate — confirmação vinda da própria ferramenta é circular. "
      + "Use a coluna REAL (swaps de usuário) como evidência independente.",
    fetchedAt: new Date().toISOString(),
  });
}

/**
 * POST — AUTO-POPULATE. A firm quote is just an API call: no funds, no gas, no
 * signature. So instead of the owner manually swapping on every chain, this
 * fires one firm USDC→native quote per supported chain with a burner taker
 * (an ERC-20 sell forces an allowance so 0x returns the spender), records the
 * real target/spender via the same swap_intent event, and the GET above then
 * shows them. One admin tap replaces N manual swaps and costs $0.
 */
// 0x v2 validates the taker's EIP-55 checksum and rejects the 0x…dEaD burn
// address ("Invalid ethereum user address"). Use a real, valid checksummed EOA
// — vitalik.eth, the canonical read-only test taker in 0x's own examples. No
// funds move and nothing is signed; it's only used to fetch an indicative
// quote. (LiFi accepted the burn address; 0x is stricter.)
const BURNER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const PROBE_CHAINS: ChainId[] = ["ethereum", "bsc", "polygon", "base", "arbitrum", "optimism", "avalanche"];

export async function POST(): Promise<NextResponse> {
  await requireAdmin();
  const zeroXKey = process.env.ZEROX_API_KEY;
  const lifiKey  = process.env.LIFI_API_KEY;
  const probed: string[] = [];
  const errors: string[] = [];

  for (const chain of PROBE_CHAINS) {
    const usdc = findToken(chain, "USDC");
    if (!usdc || usdc.address === "native") { errors.push(`${chain}: sem USDC no registro`); continue; }
    const sellAmount = (100n * 10n ** BigInt(usdc.decimals)).toString(); // 100 USDC

    // 0x — use /price (indicative): it returns the AllowanceHolder spender
    // WITHOUT the balance validation that /quote does (a burner has no USDC, so
    // /quote 400s — that was the "7 falharam"). In the AllowanceHolder flow the
    // swap tx `to` and the approval spender are the SAME contract, so we record
    // the spender as both (the owner still verifies on the explorer before
    // pinning). Selling an ERC-20 (USDC) forces issues.allowance to be present.
    if (zeroXKey && isZeroXSupported(chain) && ZEROX_CHAIN_IDS[chain]) {
      // Space out 0x calls — the free tier 429s on a tight 7-chain burst.
      await new Promise((r) => setTimeout(r, 350));
      try {
        const p = await fetchZeroXPrice(
          { chainId: ZEROX_CHAIN_IDS[chain]!, sellToken: usdc.address, buyToken: ZEROX_NATIVE, sellAmount, taker: BURNER, slippageBps: 50 },
          zeroXKey,
        );
        const spender = p.issues?.allowance?.spender;
        await recordEvent("swap_intent", { wallet: BURNER, meta: {
          source: "0x", fromChain: chain, toChain: chain, probe: true,
          chainId: ZEROX_CHAIN_IDS[chain], target: spender, spender,
        } });
        probed.push(`0x:${chain}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "erro";
        errors.push(`0x:${chain}: ${msg.slice(0, 80)}`);
        // Log the exact 0x failure so it's diagnosable without another tap.
        await recordEvent("swap_probe_error", { meta: { source: "0x", chain, msg: msg.slice(0, 200) } });
      }
    }

    // LiFi — same-chain USDC → native.
    if (isLiFiSupported(chain) && LIFI_CHAIN_IDS[chain]) {
      try {
        const q = await fetchLiFiQuote(
          { fromChainId: LIFI_CHAIN_IDS[chain]!, toChainId: LIFI_CHAIN_IDS[chain]!, fromToken: usdc.address, toToken: LIFI_NATIVE, fromAmount: sellAmount, fromAddress: BURNER, toAddress: BURNER, slippageBps: 50 },
          lifiKey,
        );
        await recordEvent("swap_intent", { wallet: BURNER, meta: {
          source: "lifi", fromChain: chain, toChain: chain, probe: true,
          chainId: LIFI_CHAIN_IDS[chain], target: q.transactionRequest?.to, spender: q.estimate?.approvalAddress,
        } });
        probed.push(`lifi:${chain}`);
      } catch (e) { errors.push(`lifi:${chain}: ${e instanceof Error ? e.message.slice(0, 60) : "erro"}`); }
    }
  }
  return NextResponse.json({ ok: true, probed, errors, note: "Recarregue o painel — os endereços observados aparecem na tabela." });
}
