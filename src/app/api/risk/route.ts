import { NextRequest, NextResponse } from "next/server";
import { getTokenSecurity, isGoPlusSupported, type GoPlusTokenSecurity } from "@/lib/api/goplus";
import { getHoneypot, isHoneypotSupported, type HoneypotResponse } from "@/lib/api/honeypot";
import { getTokenInfo, type TokenInfo } from "@/lib/api/geckoterminal";
import { rateLimit, getClientId } from "@/lib/rate-limit";
import { isValidChain, validateAddress } from "@/lib/validate";

export const runtime = "nodejs";
export const revalidate = 60;

// Risk scanner is read-only on free APIs — slightly more permissive limit.
const RL_OPTS = { windowMs: 60_000, max: 30 };

/**
 * /api/risk?chain=ethereum&address=0x...
 * Aggregates GoPlus + Honeypot.is + GeckoTerminal into one normalized payload
 * the client renders directly. Also derives a deterministic risk score 0-100.
 */
export async function GET(req: NextRequest) {
  // Rate limit
  const rl = rateLimit(`risk:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Validate inputs
  const chain   = req.nextUrl.searchParams.get("chain");
  const addrRaw = req.nextUrl.searchParams.get("address");

  if (!isValidChain(chain)) {
    return NextResponse.json({ error: "invalid chain" }, { status: 400 });
  }
  const address = validateAddress(addrRaw);
  if (!address) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  const [security, honey, info] = await Promise.all([
    isGoPlusSupported(chain)   ? getTokenSecurity(chain, address) : Promise.resolve(null),
    isHoneypotSupported(chain) ? getHoneypot(chain, address)      : Promise.resolve(null),
    getTokenInfo(chain, address),
  ]);

  const { score, category, signals } = scoreRisk(security, honey);

  return NextResponse.json(
    {
      chain, address,
      score, category, signals,
      security: security ? compactGoPlus(security) : null,
      honeypot: honey    ? compactHoneypot(honey) : null,
      info,
      ts: Date.now(),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } },
  );
}

interface Signal { kind: "ok" | "warn" | "danger"; label: string; weight: number; }

function scoreRisk(s: GoPlusTokenSecurity | null, h: HoneypotResponse | null) {
  let score = 0;
  const signals: Signal[] = [];
  const add = (kind: Signal["kind"], label: string, weight: number) => {
    score += weight;
    signals.push({ kind, label, weight });
  };

  // GoPlus signals
  if (s) {
    if (s.is_honeypot === "1")            add("danger", "GoPlus honeypot flag",       60);
    if (s.cannot_sell_all === "1")        add("danger", "Cannot sell all",             50);
    if (s.cannot_buy === "1")             add("danger", "Cannot buy",                  50);
    const buyTax  = parseFloat(s.buy_tax  || "0");
    const sellTax = parseFloat(s.sell_tax || "0");
    if (sellTax > 0.10)                   add("danger", `Sell tax ${(sellTax*100).toFixed(1)}%`, 30);
    else if (sellTax > 0.05)              add("warn",   `Sell tax ${(sellTax*100).toFixed(1)}%`, 8);
    else if (sellTax > 0.03)              add("warn",   `Sell tax ${(sellTax*100).toFixed(1)}%`, 3);
    if (buyTax > 0.10)                    add("danger", `Buy tax ${(buyTax*100).toFixed(1)}%`,   20);
    else if (buyTax > 0.05)               add("warn",   `Buy tax ${(buyTax*100).toFixed(1)}%`,   3);
    if (sellTax > buyTax + 0.05)          add("warn",   "Asymmetric buy/sell tax",     10);
    if (s.is_open_source === "0")         add("warn",   "Contract not open source",    15);
    if (s.is_proxy === "1")               add("warn",   "Proxy contract",              10);
    if (s.is_mintable === "1")            add("warn",   "Mintable token",              10);
    if (s.can_take_back_ownership === "1") add("warn",  "Owner reclaim possible",      10);
    if (s.hidden_owner === "1")           add("danger", "Hidden owner",                20);
    if (s.selfdestruct === "1")           add("warn",   "Self-destruct present",       10);
    if (s.is_blacklisted === "1")         add("warn",   "Blacklist mechanism",         5);
    if (s.trading_cooldown === "1")       add("warn",   "Trading cooldown",            5);
    if (s.slippage_modifiable === "1")    add("warn",   "Slippage modifiable",         8);
    // Top-10 holder concentration
    if (s.holders) {
      const top10 = s.holders.slice(0, 10).reduce((acc, x) => acc + parseFloat(x.percent || "0"), 0);
      if (top10 > 0.50)      add("danger", `Top-10 holders ${(top10*100).toFixed(1)}%`, 15);
      else if (top10 > 0.25) add("warn",   `Top-10 holders ${(top10*100).toFixed(1)}%`, 5);
      else                   add("ok",     `Top-10 holders ${(top10*100).toFixed(1)}%`, 0);
    }
    if (s.lp_holders) {
      const locked = s.lp_holders.filter((x) => x.is_locked === 1)
        .reduce((acc, x) => acc + parseFloat(x.percent || "0"), 0);
      if (locked > 0.50)  add("ok",   `LP locked ${(locked*100).toFixed(1)}%`, 0);
      else                add("warn", `LP unlocked / partial`,                  10);
    }
  }

  // Honeypot.is overlay
  if (h) {
    if (h.honeypotResult?.isHoneypot)     add("danger", `Honeypot.is: ${h.honeypotResult.honeypotReason ?? "honeypot"}`, 50);
    if (h.summary?.risk === "high")       add("danger", "Honeypot.is risk: HIGH",      20);
    else if (h.summary?.risk === "medium") add("warn",  "Honeypot.is risk: MEDIUM",    10);
  }

  if (signals.length === 0) {
    signals.push({ kind: "warn", label: "No external risk coverage on this chain", weight: 0 });
  }

  score = Math.min(score, 100);
  const category = score >= 70 ? "danger" : score >= 40 ? "risky" : score >= 20 ? "caution" : "safe";
  return { score, category, signals };
}

function compactGoPlus(s: GoPlusTokenSecurity) {
  return {
    is_honeypot:        s.is_honeypot,
    buy_tax:            s.buy_tax,
    sell_tax:           s.sell_tax,
    is_open_source:     s.is_open_source,
    is_proxy:           s.is_proxy,
    is_mintable:        s.is_mintable,
    can_take_back_ownership: s.can_take_back_ownership,
    hidden_owner:       s.hidden_owner,
    selfdestruct:       s.selfdestruct,
    is_anti_whale:      s.is_anti_whale,
    is_blacklisted:     s.is_blacklisted,
    trading_cooldown:   s.trading_cooldown,
    slippage_modifiable: s.slippage_modifiable,
    holder_count:       s.holder_count,
    lp_holder_count:    s.lp_holder_count,
    token_name:         s.token_name,
    token_symbol:       s.token_symbol,
    dex:                s.dex,
  };
}

function compactHoneypot(h: HoneypotResponse) {
  return {
    isHoneypot: h.honeypotResult?.isHoneypot,
    reason:     h.honeypotResult?.honeypotReason,
    risk:       h.summary?.risk,
    flags:      h.summary?.flags,
    buyTax:     h.simulationResult?.buyTax,
    sellTax:    h.simulationResult?.sellTax,
    liquidity:  h.pair?.liquidity,
    holders:    h.token?.totalHolders,
  };
}

// re-export for type compatibility check
export type { TokenInfo };
