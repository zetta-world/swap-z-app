import { NextRequest, NextResponse } from "next/server";
import { getTopPools, getTrendingPools, ehIndisponivel } from "@/lib/api/geckoterminal";
import { recordEvent } from "@/lib/admin/track";
import { isValidChain } from "@/lib/validate";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const revalidate = 30;

const RL_OPTS = { windowMs: 60_000, max: 60 };

export async function GET(req: NextRequest) {
  // Rate limit (read-only / cached upstream, generous limit)
  const rl = await rateLimitDurable(`pools:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { pools: [], error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chainParam = req.nextUrl.searchParams.get("chain");
  const trending   = req.nextUrl.searchParams.get("trending") === "1";

  // Chain is optional; if provided, must whitelist.
  if (chainParam && !isValidChain(chainParam)) {
    return NextResponse.json({ pools: [], error: "invalid chain" }, { status: 400 });
  }

  try {
    const pools = trending
      ? await getTrendingPools(20)
      : chainParam
        ? await getTopPools(chainParam, 12)
        : await getTrendingPools(20);
    return NextResponse.json(
      { pools, ts: Date.now() },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (err) {
    /**
     * ⚠️⚠️ FONTE FORA DO AR NÃO PODE SAIR COMO 200 + LISTA VAZIA (30/08).
     *
     * Era o que acontecia: o cliente engolia o 429 da GeckoTerminal, esta rota
     * devolvia { pools: [] } com 200, e a tela mostrava "nenhuma pool
     * encontrada". Medido em produção — /api/pools?chain=polygon devolvia 0
     * enquanto a GeckoTerminal tinha 20 para polygon_pos, e optimism/avalanche
     * vinham com 429 explícito.
     *
     * 503 é o código certo: o pedido está correto, quem não respondeu foi a
     * dependência. E `Retry-After` diz ao navegador (e a qualquer CDN no
     * caminho) que não adianta martelar.
     */
    if (ehIndisponivel(err)) {
      // ⚠️ O EVENTO É GRAVADO AQUI, e não dentro do cliente de dados: aquele
      // módulo é importado por nove componentes "use client" e uma aresta de
      // valor até supabase/server recriaria o vazamento de 25/08.
      await recordEvent("pools_fonte_indisponivel", { meta: {
        motivo: err.motivo, status: err.status,
        chain: chainParam ?? (trending ? "trending" : "trending_default"),
        why: "GeckoTerminal nao respondeu. A tela mostra falha, NAO 'nenhuma pool'. "
          + "Se 'motivo' for 'limite', e o teto do tier gratuito (por IP, e os IPs "
          + "de saida da Vercel sao compartilhados) — o conserto e uma chave de API.",
      } });
      return NextResponse.json(
        { pools: [], error: "upstream_unavailable", motivo: err.motivo },
        { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
      );
    }
    // Defeito nosso: 500, e a mensagem NÃO vai para o navegador.
    return NextResponse.json({ pools: [], error: "internal" }, { status: 500 });
  }
}
