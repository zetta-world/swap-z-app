/**
 * DVOL — o índice de volatilidade implícita da Deribit.
 *
 * ⚠️ HOST NOVO, SEM PROVA DE RESPOSTA. `www.deribit.com` nunca foi chamado por
 * este repo. A cascata de sempre não se aplica (não há segunda fonte gratuita
 * de IV histórica que eu conheça), então o que resta é o rastro: cada recusa
 * vira `{ status }` que sobe até a tela.
 *
 * Isso importa mais aqui do que nas outras fases. Em 04/08 eu escolhi a Bybit
 * argumentando evidência que não existia e levei 403; em 06/08 o
 * `yields.llama.fi` respondeu de primeira. Nos dois casos a diferença entre
 * "funcionou" e "funcionou pela metade" só existiu porque o status foi gravado.
 *
 * ⚠️ E É A ÚNICA FONTE. Se ela recusar, a Fase 5 não vira "prêmio de variância
 * é zero" — vira "não medimos". As duas coisas não podem sair iguais na tela.
 */

/** Uma vela do índice: `[timestamp, abertura, máxima, mínima, fechamento]`. */
type VelaDvol = [number, number, number, number, number];

export interface DvolFetch {
  /** dia UTC → DVOL de fechamento. */
  porDia: Map<string, number>;
  falha?: string;
  /** A janela que a fonte realmente devolveu, que pode não ser a pedida. */
  primeiroDia?: string;
  ultimoDia?: string;
}

/**
 * ⚠️ RESOLUÇÃO EM SEGUNDOS, não em rótulo. A API aceita `resolution` como
 * número de segundos; `86400` é um dia. Passar "1D" devolve erro de parâmetro,
 * e um erro de parâmetro engolido viraria série vazia lida como "sem prêmio".
 */
const UM_DIA_S = 86_400;

export async function fetchDvol(
  moeda: "BTC" | "ETH", desdeMs: number, ateMs: number,
): Promise<DvolFetch> {
  const params = new URLSearchParams({
    currency: moeda,
    start_timestamp: String(Math.round(desdeMs)),
    end_timestamp: String(Math.round(ateMs)),
    resolution: String(UM_DIA_S),
  });
  const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?${params}`;
  try {
    // Medição roda a pedido; cache pode servir leitura falsa indistinguível de
    // medição nova. Mesma decisão do funding e do /pools.
    const res = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { porDia: new Map(), falha: `deribit:${res.status}` };
    const body = await res.json() as {
      result?: { data?: VelaDvol[] };
      error?: { message?: string };
    };
    if (body.error) {
      return { porDia: new Map(), falha: `deribit:${String(body.error.message).slice(0, 60)}` };
    }
    const velas = body.result?.data;
    if (!Array.isArray(velas)) return { porDia: new Map(), falha: "deribit: resposta sem série" };
    if (velas.length === 0) return { porDia: new Map(), falha: "deribit: série vazia" };

    const porDia = new Map<string, number>();
    for (const v of velas) {
      if (!Array.isArray(v) || v.length < 5) continue;
      const [t, , , , fecha] = v;
      if (!(t > 0) || !Number.isFinite(fecha)) continue;
      porDia.set(new Date(t).toISOString().slice(0, 10), fecha);
    }
    if (porDia.size === 0) return { porDia, falha: "deribit: nenhuma vela utilizável" };
    const dias = [...porDia.keys()].sort();
    return { porDia, primeiroDia: dias[0], ultimoDia: dias[dias.length - 1] };
  } catch (e) {
    return { porDia: new Map(), falha: `deribit:${String(e).slice(0, 60)}` };
  }
}
