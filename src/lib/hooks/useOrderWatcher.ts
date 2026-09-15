"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  listPendingOrders, updatePendingOrder, type PendingOrder,
} from "@/lib/zion/orders";
import { useSwap } from "@/lib/store/swap";
import { findToken } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import {
  direcaoDoGatilho, simboloVigiado, lerPrecoDoGatilho, gatilhoAtingido,
} from "@/lib/orders/gatilho";

const POLL_MS = 20_000;

/**
 * Global price watcher that polls /api/prices every 20 s for all pending
 * conditional orders. When the market reaches an order's triggerPrice the
 * order is marked "triggered", a persistent toast fires, and the swap store
 * is pre-loaded so the user just taps the toast CTA to open execution.
 *
 * Mount once in AppShell. Safe to mount even when no orders exist.
 */
export function useOrderWatcher() {
  const { setFromToken, setToToken, setAmountIn, setSelectedSource, setExecuteOpen } = useSwap();
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const tick = async () => {
      const orders = listPendingOrders().filter(
        (o) => o.status === "pending" && o.card.triggerPrice && !o.triggeredAt,
      );
      if (orders.length === 0) return;

      // Collect unique token keys to price: "<chain>:<address>"
      const keys = new Set<string>();
      for (const o of orders) {
        const chain = o.card.chain as ChainId;
        /**
         * ⚠⚠ O SÍMBOLO VIGIADO, NÃO O `from` (achado A22). Numa COMPRA o
         * `from` é a stablecoin com que se paga — e era o preço DELA que este
         * laço buscava, US$ 1,00, contra um gatilho do token.
         */
        const sym   = simboloVigiado(o.card);
        if (!sym) continue;
        const tok = findToken(chain, sym);
        if (tok && tok.address !== "native") {
          keys.add(`${chain}:${tok.address}`);
        } else if (tok?.address === "native") {
          keys.add(`${chain}:native`);
        }
      }
      if (keys.size === 0) return;

      let prices: Record<string, number | null> = {};
      try {
        const res = await fetch(`/api/prices?tokens=${encodeURIComponent([...keys].join(","))}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json() as { prices: Record<string, number | null> };
        prices = data.prices ?? {};
      } catch {
        return;
      }

      for (const o of orders) {
        if (notifiedRef.current.has(o.id)) continue;
        if (!checkTrigger(o, prices)) continue;

        // Mark triggered in storage
        updatePendingOrder(o.id, { status: "triggered", triggeredAt: Date.now() });
        notifiedRef.current.add(o.id);

        // Resolve tokens so the toast CTA can pre-load the swap store
        const chain      = o.card.chain as ChainId;
        const fromToken  = findToken(chain, o.card.from?.symbol ?? "") ?? findToken(chain, o.card.from?.address ?? "");
        const toToken    = findToken(chain, o.card.to?.symbol   ?? "") ?? findToken(chain, o.card.to?.address   ?? "");

        const title = o.card.title ?? `${o.card.from?.symbol ?? "?"} → ${o.card.to?.symbol ?? "?"}`;

        toast.success(`ZION — gatilho atingido`, {
          description: title,
          duration: 0,
          action: {
            label: "Executar",
            onClick: () => {
              if (fromToken) setFromToken(fromToken);
              if (toToken)   setToToken(toToken);
              if (o.card.from?.amount) setAmountIn(o.card.from.amount);
              setSelectedSource(null);
              setTimeout(() => setExecuteOpen(true), 100);
            },
          },
        });
      }
    };

    void tick();
    timerRef.current = setInterval(tick, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * O gatilho foi atingido? A decisão mora em `lib/orders/gatilho.ts`, pura e com
 * teste que a executa — aqui fica só a busca do preço.
 *
 * ⚠️ ANTES ESTA FUNÇÃO DECIDIA TRÊS COISAS DE UMA VEZ, e errava duas:
 * qual moeda vigiar (usava o `from`, que na compra é a stablecoin), como ler o
 * preço (`replace(/[^0-9.]/g)` virava `1e-5` em `15`) e para que lado comparar
 * (`stop_loss` caía no ramo da subida).
 */
function checkTrigger(
  o: PendingOrder,
  prices: Record<string, number | null>,
): boolean {
  const direcao = direcaoDoGatilho(o.card.kind);
  // ⚠️ `kind` que não reconhecemos NÃO dispara. A união termina em
  // `(string & {})`: o modelo pode inventar um nome, e o `else` mudo de antes
  // dava semântica de VENDA a qualquer invenção.
  if (!direcao) return false;

  const gatilho = lerPrecoDoGatilho(o.card.triggerPrice);
  if (gatilho == null) return false;

  const sym = simboloVigiado(o.card);
  if (!sym) return false;

  const chain = o.card.chain as ChainId;
  const tok = findToken(chain, sym);
  if (!tok) return false;

  const priceKey = tok.address === "native" ? `${chain}:native` : `${chain}:${tok.address}`;
  const current  = prices[priceKey];
  if (current == null) return false;

  return gatilhoAtingido(direcao, current, gatilho);
}
