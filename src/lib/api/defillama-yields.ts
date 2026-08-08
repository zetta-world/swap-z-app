/**
 * RENDIMENTO ON-CHAIN — a leitura de APY que o repo nunca teve.
 *
 * ⚠️ ESTE ARQUIVO NÃO É `defillama.ts`, E A DIFERENÇA IMPORTA.
 *
 * `defillama.ts` lê `api.llama.fi/overview/dexs` — volume agregado de DEX, e
 * funciona em produção há meses. Isto aqui lê `yields.llama.fi/pools`, que é
 * **outro host**.
 *
 * Host diferente é bloqueio diferente. Foi exatamente essa distinção que me
 * escapou em 04/08: eu argumentei que `fapi.binance.com` devia funcionar porque
 * `data-api.binance.vision` funcionava, e argumentei que a Bybit devia funcionar
 * porque uma função a chamava — só que essa função fazia `catch { return "" }`,
 * então provava que ela não quebra, não que ela responde. Vieram 451 e 403.
 *
 * Por isso aqui NADA é engolido: cada recusa vira `{ host, status }` que sobe
 * até a tela. Se `yields.llama.fi` recusar IP de datacenter, a primeira rodada
 * diz "yields.llama.fi:403" em vez de "nenhum dado".
 */

/** Host primário. O de baixo é espelho documentado da mesma casa. */
const HOSTS = [
  "https://yields.llama.fi/pools",
  "https://api.llama.fi/yields/pools",
] as const;

/**
 * O que um adaptador do `yield-server` é obrigado a devolver.
 *
 * ⚠️ OS CAMPOS ENRIQUECIDOS SÃO OPCIONAIS DE PROPÓSITO. O README do
 * `DefiLlama/yield-server` documenta só a saída do adaptador (`pool`, `chain`,
 * `project`, `symbol`, `tvlUsd`, `apyBase`, `apyReward`, …). Os campos que o
 * servidor acrescenta depois — `apy`, `apyMean30d`, `stablecoin`, `sigma`,
 * `count` — não estão documentados em lugar nenhum que eu tenha conseguido
 * conferir. Tratá-los como garantidos seria assumir contrato que ninguém
 * assinou; tratá-los como ausentes quando vierem seria jogar dado fora.
 *
 * Então: opcionais, e quem consome tem que dizer na tela quando faltou.
 */
export interface LlamaPool {
  pool?: string;
  chain?: string;
  project?: string;
  symbol?: string;
  tvlUsd?: number;
  /** Rendimento de juros/taxa. É o que manda — ver a nota em `apyReward`. */
  apyBase?: number | null;
  /**
   * ⚠️ NUNCA SOMAR ISTO NO TITULAR. Recompensa é paga num token de incentivo
   * que pode cair 80% antes de você vender, e o APY publicado assume venda
   * instantânea a preço de tela. Aparece ao lado, separado, sempre.
   */
  apyReward?: number | null;
  /** Total já somado pela fonte. Só serve de último recurso — ver `apyDe`. */
  apy?: number | null;
  /** Média de 30 dias, quando o servidor calcula. Muito melhor que à vista. */
  apyMean30d?: number | null;
  stablecoin?: boolean;
  ilRisk?: string;
  exposure?: string;
  poolMeta?: string | null;
  underlyingTokens?: string[] | null;
}

export interface FalhaHost { host: string; status: number | string }

export interface YieldsFetch {
  pools: LlamaPool[];
  /** Qual host respondeu. Vazio quando nenhum respondeu. */
  hostUsado: string;
  falhas: FalhaHost[];
}

/**
 * Busca a lista inteira de piscinas, em cascata pelos hosts conhecidos.
 *
 * ⚠️ A LISTA É GRANDE (~15 mil piscinas, alguns MB). Filtrar aqui seria
 * tentador e errado: quem decide o recorte é a lista declarada em
 * `rendimento.ts`, que passa por PR. Filtro escondido dentro do cliente HTTP é
 * decisão de produto sem revisão.
 */
export async function fetchLlamaYields(deadline?: number): Promise<YieldsFetch> {
  const falhas: FalhaHost[] = [];
  for (const host of HOSTS) {
    if (deadline != null && Date.now() > deadline) {
      falhas.push({ host, status: "tempo esgotado antes de tentar" });
      break;
    }
    try {
      const res = await fetch(host, {
        headers: { accept: "application/json" },
        /**
         * ⚠️ SEM CACHE DE PROPÓSITO, e não é descuido de performance.
         *
         * A resposta tem alguns MB (~15 mil piscinas). O cache de dados do
         * Next tem teto por entrada e simplesmente NÃO guarda o que passa
         * dele — silenciosamente. O resultado seria um `revalidate` que
         * parece configurado e nunca guarda nada, ou pior, guarda uma
         * resposta truncada. Medição roda a pedido, algumas vezes por
         * semana; pagar a rede é mais barato que confiar num cache que pode
         * não existir.
         */
        cache: "no-store",
      });
      if (!res.ok) { falhas.push({ host, status: res.status }); continue; }
      const body = await res.json() as { data?: LlamaPool[] } | LlamaPool[];
      const pools = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(pools)) {
        falhas.push({ host, status: "resposta sem lista de piscinas" });
        continue;
      }
      if (pools.length === 0) {
        falhas.push({ host, status: "lista vazia" });
        continue;
      }
      return { pools, hostUsado: host, falhas };
    } catch (e) {
      falhas.push({ host, status: String(e).slice(0, 80) });
    }
  }
  return { pools: [], hostUsado: "", falhas };
}

/** Resumo legível das recusas — QUE falhou sem O QUÊ é a parte inútil. */
export function resumoFalhas(falhas: FalhaHost[]): string {
  return falhas.map((f) => `${new URL(f.host).host}:${f.status}`).join(" ");
}

/**
 * ⚠️ HISTÓRICO DE UMA PISCINA — `/chart/{pool}`, o mesmo host de `/pools`.
 *
 * A distinção com a nota do topo deste arquivo importa e é a favor: ali o risco
 * era `yields.llama.fi` ser um HOST diferente de `api.llama.fi`, com bloqueio
 * próprio. Aqui é o MESMO host, caminho diferente — e `/pools` já respondeu em
 * produção em 06/08. Evidência positiva de verdade, não ausência de erro.
 *
 * Ainda assim o status de cada piscina é registrado: uma piscina pode não ter
 * histórico enquanto o host inteiro responde, e "sem histórico" não pode virar
 * série vazia silenciosa.
 */
export interface PontoChart {
  /** ISO 8601 vindo da fonte. Convertido para dia UTC por quem consome. */
  timestamp?: string;
  tvlUsd?: number;
  apy?: number | null;
  apyBase?: number | null;
  apyReward?: number | null;
}

export interface ChartFetch {
  poolId: string;
  pontos: PontoChart[];
  falha?: string;
}

export async function fetchPoolChart(poolId: string): Promise<ChartFetch> {
  const url = `https://yields.llama.fi/chart/${encodeURIComponent(poolId)}`;
  try {
    // Mesma decisão do `/pools`: medição roda a pedido, e cache pode servir
    // uma leitura falsa indistinguível de uma medição. Ver a nota `SEM_CACHE`
    // na rota de funding.
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { poolId, pontos: [], falha: String(res.status) };
    const body = await res.json() as { data?: PontoChart[] };
    const pontos = body.data;
    if (!Array.isArray(pontos)) return { poolId, pontos: [], falha: "resposta sem série" };
    if (pontos.length === 0) return { poolId, pontos: [], falha: "série vazia" };
    return { poolId, pontos };
  } catch (e) {
    return { poolId, pontos: [], falha: String(e).slice(0, 60) };
  }
}
