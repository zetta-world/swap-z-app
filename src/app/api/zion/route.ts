import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { ZION_SYSTEM_PROMPT } from "@/lib/zion/system-prompt";
import { getTokenSecurity, isGoPlusSupported, type GoPlusTokenSecurity } from "@/lib/api/goplus";
import { getHoneypot, isHoneypotSupported, type HoneypotResponse } from "@/lib/api/honeypot";
import { getTokenInfo, getTopPools, type TokenInfo, type PoolSummary } from "@/lib/api/geckoterminal";
import { findToken, DEFAULT_TOKENS, type Token } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";

// Node runtime — Anthropic SDK uses Node-native streams
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/zion — streaming risk advisory for a token pair.
 *
 * Query params (or JSON body for POST):
 *   chain      ChainId (ethereum, bsc, ...)
 *   fromAddr   address or "native" or token symbol (resolved from seed list)
 *   toAddr     address or "native" or token symbol
 *   amountIn   user-facing amount (string)
 *   message    optional follow-up question (skips the data-gather phase)
 *
 * Streams text/plain (newline-buffered tokens) — drop-in for fetch().body reader.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const chain    = (params.get("chain") || "ethereum") as ChainId;
  const fromAddr = params.get("fromAddr") || "";
  const toAddr   = params.get("toAddr") || "";
  const amountIn = params.get("amountIn") || "1.0";
  const message  = params.get("message") || "";

  return runZion({ chain, fromAddr, toAddr, amountIn, message });
}

interface RunArgs {
  chain: ChainId;
  fromAddr: string;
  toAddr: string;
  amountIn: string;
  message: string;
}

async function runZion(args: RunArgs) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      sseEvent("Missing ANTHROPIC_API_KEY on the server. Configure it in Vercel project settings."),
      { headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const client = new Anthropic({ apiKey });

  // ─── Resolve tokens from our seed list (so demo works with friendly symbols) ──
  const fromToken = resolveToken(args.chain, args.fromAddr);
  const toToken   = resolveToken(args.chain, args.toAddr);

  // ─── Fetch real on-chain data in parallel (only on EVM chains we support) ───
  const [fromSec, toSec, fromHoney, toHoney, fromInfo, toInfo, pools] = await Promise.all([
    safeGoPlus(args.chain, fromToken?.address),
    safeGoPlus(args.chain, toToken?.address),
    safeHoneypot(args.chain, fromToken?.address),
    safeHoneypot(args.chain, toToken?.address),
    safeGeckoToken(args.chain, fromToken?.address),
    safeGeckoToken(args.chain, toToken?.address),
    getTopPools(args.chain, 4).catch(() => [] as PoolSummary[]),
  ]);

  // ─── Build the user message: factual on-chain payload, no prose ───────────
  const payload = buildDataPayload({
    chain: args.chain,
    amountIn: args.amountIn,
    fromToken, toToken,
    fromSec, toSec,
    fromHoney, toHoney,
    fromInfo, toInfo,
    pools,
  });

  const userText = args.message
    ? `Earlier you analyzed the pair below. The user asks: "${args.message}"\n\nReference data:\n${payload}`
    : `Analyze this pair end-to-end using your standard framework. Output ONLY the terminal trace, no preamble.\n\nReference data:\n${payload}`;

  // ─── Stream Claude Haiku 4.5 with prompt caching on the system prompt ────
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        const msgStream = await client.messages.stream({
          model: "claude-haiku-4-5",
          max_tokens: 1400,
          system: [
            {
              type: "text",
              text: ZION_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: userText }],
        });

        msgStream.on("text", (delta) => {
          controller.enqueue(encoder.encode(delta));
        });
        msgStream.on("error", (err) => {
          controller.enqueue(encoder.encode(`\n\n[ZION error: ${err?.message ?? String(err)}]\n`));
        });
        await msgStream.finalMessage();
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`[ZION error: ${msg}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function resolveToken(chain: ChainId, q: string): Token | undefined {
  if (!q) return undefined;
  // Lookup by symbol or address in our seed list first
  const seed = findToken(chain, q);
  if (seed) return seed;
  // Construct a minimal token shell from raw address (for the explorer flow)
  if (q === "native") {
    return { symbol: "NATIVE", name: "Native token", chain, address: "native", decimals: 18 };
  }
  if (q.startsWith("0x") && q.length === 42) {
    return { symbol: "TOKEN", name: "Custom token", chain, address: q, decimals: 18 };
  }
  // Search whole list by symbol across the chain (already done by findToken)
  // Fall back to undefined
  return undefined;
}

async function safeGoPlus(chain: ChainId, addr?: string) {
  if (!addr || addr === "native" || !isGoPlusSupported(chain)) return null;
  return getTokenSecurity(chain, addr);
}
async function safeHoneypot(chain: ChainId, addr?: string) {
  if (!addr || addr === "native" || !isHoneypotSupported(chain)) return null;
  return getHoneypot(chain, addr);
}
async function safeGeckoToken(chain: ChainId, addr?: string) {
  if (!addr || addr === "native") return null;
  return getTokenInfo(chain, addr);
}

interface BuildArgs {
  chain: ChainId;
  amountIn: string;
  fromToken: Token | undefined;
  toToken:   Token | undefined;
  fromSec:   GoPlusTokenSecurity | null;
  toSec:     GoPlusTokenSecurity | null;
  fromHoney: HoneypotResponse | null;
  toHoney:   HoneypotResponse | null;
  fromInfo:  TokenInfo | null;
  toInfo:    TokenInfo | null;
  pools:     PoolSummary[];
}

function buildDataPayload(a: BuildArgs): string {
  const lines: string[] = [];
  lines.push(`chain: ${a.chain}`);
  lines.push(`amount_in: ${a.amountIn}`);

  lines.push("\nFROM TOKEN:");
  lines.push(`  symbol: ${a.fromToken?.symbol ?? "?"}`);
  lines.push(`  name:   ${a.fromToken?.name ?? "?"}`);
  lines.push(`  addr:   ${a.fromToken?.address ?? "?"}`);
  lines.push(`  is_native: ${a.fromToken?.address === "native"}`);
  if (a.fromInfo) {
    lines.push(`  gecko_price_usd: ${a.fromInfo.priceUsd ?? "n/a"}`);
    lines.push(`  gecko_volume_24h: ${a.fromInfo.volume24h ?? "n/a"}`);
    lines.push(`  gecko_mcap_usd: ${a.fromInfo.mcapUsd ?? "n/a"}`);
    lines.push(`  gecko_total_supply: ${a.fromInfo.totalSupply ?? "n/a"}`);
  }
  if (a.fromSec) lines.push(serializeGoPlus("  ", a.fromSec));
  if (a.fromHoney) lines.push(serializeHoneypot("  ", a.fromHoney));

  lines.push("\nTO TOKEN:");
  lines.push(`  symbol: ${a.toToken?.symbol ?? "?"}`);
  lines.push(`  name:   ${a.toToken?.name ?? "?"}`);
  lines.push(`  addr:   ${a.toToken?.address ?? "?"}`);
  lines.push(`  is_native: ${a.toToken?.address === "native"}`);
  if (a.toInfo) {
    lines.push(`  gecko_price_usd: ${a.toInfo.priceUsd ?? "n/a"}`);
    lines.push(`  gecko_volume_24h: ${a.toInfo.volume24h ?? "n/a"}`);
    lines.push(`  gecko_mcap_usd: ${a.toInfo.mcapUsd ?? "n/a"}`);
    lines.push(`  gecko_total_supply: ${a.toInfo.totalSupply ?? "n/a"}`);
  }
  if (a.toSec) lines.push(serializeGoPlus("  ", a.toSec));
  if (a.toHoney) lines.push(serializeHoneypot("  ", a.toHoney));

  if (a.pools.length) {
    lines.push("\nTOP POOLS ON CHAIN (context):");
    a.pools.forEach((p) => {
      lines.push(`  - ${p.name} on ${p.dex} | TVL $${Math.round(p.tvlUsd).toLocaleString()} | 24h vol $${Math.round(p.volume24h).toLocaleString()} | Δ ${p.change24h.toFixed(2)}%`);
    });
  }

  if (!a.fromSec && !a.toSec && !a.fromHoney && !a.toHoney && !a.fromInfo && !a.toInfo) {
    lines.push("\nNOTE: No external risk-API coverage returned data for this pair on this chain. Proceed accordingly per your edge-case rules.");
  }

  return lines.join("\n");
}

function serializeGoPlus(prefix: string, s: GoPlusTokenSecurity): string {
  const fields: [string, string | undefined][] = [
    ["goplus_is_honeypot",      s.is_honeypot],
    ["goplus_buy_tax",          s.buy_tax],
    ["goplus_sell_tax",         s.sell_tax],
    ["goplus_is_open_source",   s.is_open_source],
    ["goplus_is_proxy",         s.is_proxy],
    ["goplus_is_mintable",      s.is_mintable],
    ["goplus_can_take_back_ownership", s.can_take_back_ownership],
    ["goplus_hidden_owner",     s.hidden_owner],
    ["goplus_self_destruct",    s.selfdestruct],
    ["goplus_external_call",    s.external_call],
    ["goplus_cannot_buy",       s.cannot_buy],
    ["goplus_cannot_sell_all",  s.cannot_sell_all],
    ["goplus_trading_cooldown", s.trading_cooldown],
    ["goplus_anti_whale",       s.is_anti_whale],
    ["goplus_blacklist",        s.is_blacklisted],
    ["goplus_whitelist",        s.is_whitelisted],
    ["goplus_slippage_modifiable", s.slippage_modifiable],
    ["goplus_personal_slippage_modifiable", s.personal_slippage_modifiable],
    ["goplus_holder_count",     s.holder_count],
    ["goplus_lp_holder_count",  s.lp_holder_count],
    ["goplus_lp_total_supply",  s.lp_total_supply],
    ["goplus_total_supply",     s.total_supply],
  ];
  const out = fields.filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${prefix}${k}: ${v}`);

  // Top holders concentration
  if (s.holders && s.holders.length) {
    const top10 = s.holders.slice(0, 10);
    const sum = top10.reduce((acc, h) => acc + parseFloat(h.percent || "0"), 0);
    out.push(`${prefix}goplus_top10_holder_pct: ${(sum * 100).toFixed(2)}%`);
  }
  // LP locked
  if (s.lp_holders && s.lp_holders.length) {
    const locked = s.lp_holders.filter((h) => h.is_locked === 1).reduce((acc, h) => acc + parseFloat(h.percent || "0"), 0);
    out.push(`${prefix}goplus_lp_locked_pct: ${(locked * 100).toFixed(2)}%`);
  }
  return out.join("\n");
}

function serializeHoneypot(prefix: string, h: HoneypotResponse): string {
  const out: string[] = [];
  if (h.honeypotResult?.isHoneypot !== undefined) out.push(`${prefix}honeypot_is_honeypot: ${h.honeypotResult.isHoneypot}`);
  if (h.honeypotResult?.honeypotReason)           out.push(`${prefix}honeypot_reason: ${h.honeypotResult.honeypotReason}`);
  if (h.summary?.risk)                            out.push(`${prefix}honeypot_risk: ${h.summary.risk}`);
  if (h.summary?.flags?.length)                   out.push(`${prefix}honeypot_flags: ${h.summary.flags.join(", ")}`);
  if (h.simulationResult?.buyTax !== undefined)   out.push(`${prefix}honeypot_buy_tax: ${h.simulationResult.buyTax}`);
  if (h.simulationResult?.sellTax !== undefined)  out.push(`${prefix}honeypot_sell_tax: ${h.simulationResult.sellTax}`);
  if (h.simulationResult?.transferTax !== undefined) out.push(`${prefix}honeypot_transfer_tax: ${h.simulationResult.transferTax}`);
  if (h.pair?.liquidity !== undefined)            out.push(`${prefix}honeypot_pair_liquidity_usd: ${h.pair.liquidity}`);
  if (h.token?.totalHolders)                      out.push(`${prefix}honeypot_total_holders: ${h.token.totalHolders}`);
  return out.join("\n");
}

function sseEvent(text: string): string {
  return text;
}

// Suppress unused import warning while keeping availability for future extension
void DEFAULT_TOKENS;
