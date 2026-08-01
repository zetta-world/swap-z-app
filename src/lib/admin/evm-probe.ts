/**
 * SONDA EVM — a allowlist fixada ainda corresponde à realidade?
 *
 * O EQUIVALENTE DA SONDA DA JUPITER, PARA O LADO EVM.
 *
 * A allowlist de swap (`NEXT_PUBLIC_ALLOWED_SWAP_TARGETS` / `_SPENDERS`) é uma
 * lista CONGELADA de endereços. Ela protege contra dreno — mas cria um risco
 * novo e silencioso: se 0x ou LiFi migrarem de contrato (upgrade de roteador,
 * v3 do AllowanceHolder), a cotação passa a devolver um endereço que NÃO está
 * na lista, e `assertTrusted` bloqueia **todo swap EVM** dos usuários.
 *
 * Isso é a Jupiter ao contrário: lá o terceiro sumiu e o app parou; aqui o
 * terceiro se MOVE e a nossa própria trava para o app. Os dois são invisíveis
 * no repositório, porque em ambos o código está correto — o mundo é que mudou.
 *
 * Uma cotação é só chamada de API: sem fundos, sem assinatura, sem gás. Então
 * dá pra perguntar aos agregadores, agora, quais endereços eles usariam — e
 * comparar com a lista fixada.
 *
 * NÃO SIMULA TRÁFEGO. A tentação de "gerar dados" escrevendo eventos falsos de
 * swap foi recusada de propósito: tráfego sintético que parece real contamina
 * exatamente as medições que existem para ser honestas. Isto aqui é verificação
 * (compara o real contra o configurado), não fabricação.
 */

import { fetchZeroXPrice, ZEROX_CHAIN_IDS, ZEROX_NATIVE, isZeroXSupported } from "@/lib/api/zerox";
import { fetchLiFiQuote, LIFI_CHAIN_IDS, LIFI_NATIVE, isLiFiSupported } from "@/lib/api/lifi";
import { checkSwapTarget, checkSwapSpender } from "@/lib/swap/trusted-targets";
import { findToken } from "@/lib/tokens";
import type { ChainId } from "@/lib/chains";
import type { AuditFinding } from "@/lib/admin/audit";

/** Mesma conta de leitura usada no auto-populate: EIP-55 válido, sem fundos.
 *  (0x recusa checksum inválido — foi o motivo de "7 rotas falharam".) */
const READER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** Enxuto de propósito: a bancada roda dentro de 60s junto de tudo mais. */
const PROBE_CHAINS: ChainId[] = ["ethereum", "polygon", "base", "arbitrum"];

export interface EvmProbeRow {
  chain: string;
  source: "0x" | "lifi";
  target?: string;
  spender?: string;
  /** A lista está configurada para esta chain? */
  configured: boolean;
  /** O endereço devolvido AGORA está na lista? */
  allowed: boolean;
  error?: string;
}

/** Espaça as chamadas: o tier gratuito da 0x devolve 429 em rajada. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function probeEvmRoutes(): Promise<EvmProbeRow[]> {
  const rows: EvmProbeRow[] = [];
  const zeroXKey = process.env.ZEROX_API_KEY;
  const lifiKey = process.env.LIFI_API_KEY;

  for (const chain of PROBE_CHAINS) {
    const usdc = findToken(chain, "USDC");
    if (!usdc || usdc.address === "native") continue;
    // Vender um ERC-20 é o que força o agregador a revelar o SPENDER — com
    // token nativo não há approval, e o campo simplesmente não vem.
    const sellAmount = (100n * 10n ** BigInt(usdc.decimals)).toString();

    if (zeroXKey && isZeroXSupported(chain) && ZEROX_CHAIN_IDS[chain]) {
      await pause(300);
      const chainId = ZEROX_CHAIN_IDS[chain]!;
      try {
        const p = await fetchZeroXPrice(
          { chainId, sellToken: usdc.address, buyToken: ZEROX_NATIVE, sellAmount, taker: READER, slippageBps: 50 },
          zeroXKey,
        );
        // No fluxo AllowanceHolder o `to` da transação e o spender do approve
        // são o MESMO contrato — por isso o spender responde pelos dois.
        const spender = p.issues?.allowance?.spender;
        const tgt = checkSwapTarget(chainId, spender);
        const sp = checkSwapSpender(chainId, spender);
        rows.push({
          chain, source: "0x", target: spender, spender,
          configured: tgt.configured || sp.configured,
          allowed: (!tgt.configured || tgt.ok) && (!sp.configured || sp.ok),
        });
      } catch (e) {
        rows.push({ chain, source: "0x", configured: false, allowed: false, error: (e as Error).message?.slice(0, 90) });
      }
    }

    if (isLiFiSupported(chain) && LIFI_CHAIN_IDS[chain]) {
      const chainId = LIFI_CHAIN_IDS[chain]!;
      try {
        const q = await fetchLiFiQuote(
          { fromChainId: chainId, toChainId: chainId, fromToken: usdc.address, toToken: LIFI_NATIVE,
            fromAmount: sellAmount, fromAddress: READER, toAddress: READER, slippageBps: 50 },
          lifiKey,
        );
        const target = q.transactionRequest?.to;
        const spender = q.estimate?.approvalAddress;
        const tgt = checkSwapTarget(chainId, target);
        const sp = checkSwapSpender(chainId, spender);
        rows.push({
          chain, source: "lifi", target, spender,
          configured: tgt.configured || sp.configured,
          allowed: (!tgt.configured || tgt.ok) && (!sp.configured || sp.ok),
        });
      } catch (e) {
        rows.push({ chain, source: "lifi", configured: false, allowed: false, error: (e as Error).message?.slice(0, 90) });
      }
    }
  }
  return rows;
}

/** Verificação para a bancada: a lista fixada bate com o que os agregadores
 *  devolvem AGORA? */
export async function checkEvmAllowlistDrift(): Promise<AuditFinding> {
  const base = {
    id: "evm_allowlist_drift", name: "Allowlist EVM confere com o que os agregadores devolvem hoje",
    category: "integração" as const, severity: "critical" as const,
    whyRuntime: "a lista é congelada e o agregador pode migrar de contrato — só perguntando a ele agora dá pra saber",
  };
  const rows = await probeEvmRoutes();
  const ok = rows.filter((r) => !r.error);
  if (ok.length === 0) {
    return { ...base, pass: false, inconclusive: true,
      detail: `nenhuma rota respondeu${rows[0]?.error ? ` (${rows[0].error})` : ""}` };
  }
  const configured = ok.filter((r) => r.configured);
  const blocked = configured.filter((r) => !r.allowed);

  if (blocked.length > 0) {
    return { ...base, pass: false,
      detail: `🚨 ${blocked.length} rota(s) que os usuários USARIAM estão FORA da allowlist e seriam bloqueadas: `
        + blocked.map((r) => `${r.source}/${r.chain} → ${r.spender?.slice(0, 10)}…`).join(", ")
        + " — o agregador provavelmente migrou de contrato" };
  }
  if (configured.length === 0) {
    // Allowlist não configurada = swap passa direto. Não é "drift", é ausência
    // de trava — e o `swap_guards_posture` já reprova isso separadamente. Aqui
    // seria contar a mesma falha duas vezes e distorcer a nota.
    return { ...base, pass: true,
      detail: `${ok.length} rotas verificadas; allowlist não configurada nestas chains (a trava em si é cobrada em outra verificação)` };
  }
  return { ...base, pass: true,
    detail: `${configured.length}/${ok.length} rotas com allowlist configurada — todas batem com o endereço devolvido agora` };
}
