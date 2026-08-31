import { NextRequest, NextResponse } from "next/server";
import { getTopPools, getTrendingPools, ehIndisponivel } from "@/lib/api/geckoterminal";
import { isValidChain } from "@/lib/validate";
import { rateLimitDurable, getClientId } from "@/lib/rate-limit";
import { recordEvent } from "@/lib/admin/track";
import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { faixaDoTier, cacheControlDa } from "@/lib/pools/faixas";
import type { Tier } from "@/lib/tier/types";

export const runtime = "nodejs";

/**
 * ⚠️⚠️ `force-dynamic`, E A LINHA QUE SAIU DAQUI ERA UM VAZAMENTO ENTRE TIERS.
 *
 * Esta rota exportava `revalidate = 30`, que guarda a RESPOSTA e serve a mesma
 * a todo mundo. A partir do momento em que a resposta varia por tier, isso
 * entrega o dado de 30 s do Einherjar ao visitante — ou prende o Einherjar no
 * dado de 15 minutos do visitante, dependendo de quem aqueceu o cache primeiro.
 *
 * Ler o cookie de sessão já tornaria a rota dinâmica na prática; declarar é
 * melhor que depender do efeito colateral de uma leitura que alguém pode
 * remover num refactor sem perceber o que estava segurando.
 */
export const dynamic = "force-dynamic";

const RL_OPTS = { windowMs: 60_000, max: 60 };

/**
 * O tier de quem pediu.
 *
 * ⚠️ FALHA PARA `free`, SEMPRE — mesmo padrão de `/api/quote`. Sessão ausente,
 * banco fora, tier ilegível: tudo cai na faixa mais barata. O erro possível
 * nessa direção é um pagante ver dado um pouco mais velho, que ele reclama e a
 * gente conserta; na direção oposta, a plataforma inteira passaria a operar na
 * faixa de 30 s sem ninguém ter pedido, e isso só aparece na fatura.
 */
async function tierDoPedido(): Promise<Tier> {
  try {
    const s = await getSession();
    if (!s) return "free";
    const { tier } = await getTierForWallet(s.sub, s.chain);
    return tier;
  } catch {
    return "free";
  }
}

export async function GET(req: NextRequest) {
  const rl = await rateLimitDurable(`pools:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return NextResponse.json(
      { pools: [], error: "rate_limited", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const chainParam = req.nextUrl.searchParams.get("chain");
  const trending   = req.nextUrl.searchParams.get("trending") === "1";

  if (chainParam && !isValidChain(chainParam)) {
    return NextResponse.json({ pools: [], error: "invalid chain" }, { status: 400 });
  }

  const tier  = await tierDoPedido();
  const faixa = faixaDoTier(tier);

  try {
    const pools = trending
      ? await getTrendingPools(20, faixa.ttlSegundos)
      : chainParam
        ? await getTopPools(chainParam, 12, faixa.ttlSegundos)
        : await getTrendingPools(20, faixa.ttlSegundos);

    return NextResponse.json(
      // `faixa` sai na resposta para a tela poder dizer "atualiza a cada X" em
      // vez de o usuário adivinhar por que o número não mexe.
      { pools, ts: Date.now(), faixa: faixa.id, atualizaEmSegundos: faixa.ttlSegundos },
      { headers: { "Cache-Control": cacheControlDa(faixa) } },
    );
  } catch (err) {
    /**
     * ⚠️⚠️ FONTE FORA DO AR NÃO PODE SAIR COMO 200 + LISTA VAZIA (30/08).
     *
     * Era o que acontecia: o cliente engolia o 429 da GeckoTerminal, a rota
     * devolvia { pools: [] } com 200, e a tela mostrava "nenhuma pool
     * encontrada". Medido em produção — /api/pools?chain=polygon devolvia 0
     * enquanto a GeckoTerminal tinha 20 para polygon_pos.
     */
    if (ehIndisponivel(err)) {
      await recordEvent("pools_fonte_indisponivel", { meta: {
        motivo: err.motivo, status: err.status, faixa: faixa.id,
        chain: chainParam ?? (trending ? "trending" : "trending_default"),
        why: "GeckoTerminal nao respondeu. A tela mostra falha, NAO 'nenhuma pool'. "
          + "Se 'motivo' for 'limite', e o teto da fonte — o conserto e plano pago "
          + "ou TTL maior na faixa que estourou.",
      } });
      return NextResponse.json(
        { pools: [], error: "upstream_unavailable", motivo: err.motivo },
        { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ pools: [], error: "internal" }, { status: 500 });
  }
}
