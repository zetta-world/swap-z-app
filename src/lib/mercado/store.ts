/**
 * O CACHE DE VELAS — a única camada que fala com o banco e com a fonte.
 *
 * ⚠️ A ARITMÉTICA QUE DECIDE O QUE BUSCAR VIVE EM `velas.ts`, pura e testada.
 * Aqui só há leitura, escrita e a costura entre as duas. É a mesma separação de
 * `celeiro/store.ts`, e ela existe porque foi a falta dela que fez a arena
 * antiga ter regra de negócio dentro de rota, onde nenhum teste alcança.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTimedCandles } from "@/lib/api/market-indicators";
import {
  velaFechada, ultimaVelaFechada, oQueFaltaBuscar, estenderCobertura,
  fatiar, duracaoDoIntervaloMs,
  type VelaComTempo, type Cobertura,
} from "@/lib/mercado/velas";

/**
 * ⚠️ O TETO DE UMA BUSCA, em velas. A fonte pagina de 1000 em 1000 e
 * `fetchTimedCandles` já faz o laço — este número é quantas ela pode pedir numa
 * ida só, para uma janela absurda não virar uma rajada contra o limite por IP.
 *
 * 800 dias cobre os 2 anos que o tier mais alto pede, com folga.
 */
const MAX_VELAS_POR_BUSCA = 800;

export interface LeituraDeVelas {
  velas: VelaComTempo[];
  /** Quantas vieram do BANCO — o número que prova que o cache está pagando. */
  doCache: number;
  /** Quantas foram buscadas na FONTE nesta chamada. */
  daFonte: number;
  /**
   * ⚠️ `null` quando a leitura foi completa. Texto quando a fonte recusou ou o
   * banco falhou — nunca uma lista vazia fingindo "não há velas".
   */
  porqueIncompleta: string | null;
}

/** As velas já gravadas para (símbolo, intervalo) dentro de uma faixa. */
async function lerDoBanco(
  db: SupabaseClient, simbolo: string, intervalo: string, de: number, ate: number,
): Promise<{ velas: VelaComTempo[]; erro: string | null }> {
  const { data, error } = await db
    .from("mercado_vela")
    .select("abriu_em, high, low, close, volume")
    .eq("simbolo", simbolo).eq("intervalo", intervalo)
    .gte("abriu_em", de).lte("abriu_em", ate)
    .order("abriu_em", { ascending: true });

  // ⚠️ `supabase-js` resolve com `{ data: null, error }` — não lança.
  if (error) return { velas: [], erro: error.message.slice(0, 160) };
  return {
    velas: (data ?? []).map((r) => ({
      t: Number(r.abriu_em),
      high: Number(r.high), low: Number(r.low),
      close: Number(r.close), volume: Number(r.volume),
    })),
    erro: null,
  };
}

async function lerCobertura(
  db: SupabaseClient, simbolo: string, intervalo: string,
): Promise<Cobertura | null> {
  const { data, error } = await db
    .from("mercado_cobertura")
    .select("coberto_de, coberto_ate, fonte_esgotou")
    .eq("simbolo", simbolo).eq("intervalo", intervalo)
    .maybeSingle();
  if (error || !data) return null;
  return {
    cobertoDe: Number(data.coberto_de),
    cobertoAte: Number(data.coberto_ate),
    fonteEsgotou: Boolean(data.fonte_esgotou),
  };
}

/**
 * Grava as velas FECHADAS e move a cobertura.
 *
 * ⚠️⚠️ O FILTRO DE VELA FECHADA MORA AQUI, na porta do banco. Deixá-lo para o
 * chamador significaria que basta um caminho esquecer para a vela corrente ser
 * gravada — e ela serviria o preço daquele instante para sempre.
 */
async function gravar(
  db: SupabaseClient, simbolo: string, intervalo: string,
  vindas: VelaComTempo[], coberturaAtual: Cobertura | null,
  fonteEsgotou: boolean, agoraMs: number,
): Promise<{ gravadas: number; erro: string | null }> {
  const fechadas = vindas.filter((v) => velaFechada(v.t, intervalo, agoraMs));

  if (fechadas.length > 0) {
    const { error } = await db.from("mercado_vela").upsert(
      fechadas.map((v) => ({
        simbolo, intervalo, abriu_em: v.t,
        high: v.high, low: v.low, close: v.close, volume: v.volume,
      })),
      { onConflict: "simbolo,intervalo,abriu_em" },
    );
    if (error) return { gravadas: 0, erro: error.message.slice(0, 160) };
  }

  /**
   * ⚠️ A COBERTURA ANDA COM O QUE FOI GRAVADO, não com o que foi pedido nem com
   * o que veio da fonte incluindo a vela aberta. Ver `estenderCobertura`.
   */
  const nova = estenderCobertura(coberturaAtual, fechadas, fonteEsgotou);
  if (nova) {
    const { error } = await db.from("mercado_cobertura").upsert({
      simbolo, intervalo,
      coberto_de: nova.cobertoDe, coberto_ate: nova.cobertoAte,
      fonte_esgotou: nova.fonteEsgotou,
      atualizada_em: new Date(agoraMs).toISOString(),
    }, { onConflict: "simbolo,intervalo" });
    if (error) return { gravadas: fechadas.length, erro: error.message.slice(0, 160) };
  }

  return { gravadas: fechadas.length, erro: null };
}

/**
 * As velas de [desde, ate] — do banco quando dá, da fonte só o que falta.
 *
 * ⚠️⚠️ É AQUI QUE O CUSTO DO PRODUTO SE DECIDE. Sem esta função, cada backtest
 * de cada cliente refaz a busca do mesmo BTC contra um limite por IP; com ela,
 * o milésimo backtest não faz requisição nenhuma.
 *
 * ⚠️ E A BUSCA É DA FAIXA CANÔNICA, não da janela do cliente. Quem quer 90 dias
 * e quem quer 2 anos leem o MESMO material e fatiam em memória. Se a busca
 * acompanhasse o pedido, cada janela viraria uma chave diferente — o defeito
 * exato do cache de hoje.
 */
export async function velasDoIntervalo(
  db: SupabaseClient | null,
  simbolo: string,
  intervalo: string,
  desde: number,
  ate: number,
  agoraMs: number = Date.now(),
): Promise<LeituraDeVelas> {
  const dur = duracaoDoIntervaloMs(intervalo);
  if (dur == null) {
    return { velas: [], doCache: 0, daFonte: 0, porqueIncompleta: `intervalo desconhecido: ${intervalo}` };
  }

  /**
   * ⚠️ SEM BANCO, A BANCADA AINDA FUNCIONA — só cara. Cair para a fonte direto
   * é melhor-esforço honesto; travar seria transformar uma falha de cache em
   * falha de produto.
   */
  if (!db) {
    const n = Math.min(MAX_VELAS_POR_BUSCA, Math.floor((ate - desde) / dur) + 1);
    const v = await fetchTimedCandles(simbolo, intervalo, n, 3600, ate);
    return {
      velas: fatiar(v, desde, ate), doCache: 0, daFonte: v.length,
      porqueIncompleta: "sem banco — esta leitura não foi cacheada e vai custar de novo",
    };
  }

  const cobertura = await lerCobertura(db, simbolo, intervalo);
  const faltam = oQueFaltaBuscar(cobertura, desde, ate, intervalo, agoraMs);

  let daFonte = 0;
  const problemas: string[] = [];

  for (const faixa of faltam) {
    const quantas = Math.min(MAX_VELAS_POR_BUSCA, Math.floor((faixa.ate - faixa.de) / dur) + 1);
    if (quantas <= 0) continue;

    const vindas = await fetchTimedCandles(simbolo, intervalo, quantas, 3600, faixa.ate);
    daFonte += vindas.length;

    /**
     * ⚠️⚠️ "A FONTE ACABOU" É INFERIDO DE VIR MENOS DO QUE CABE, e só isso.
     *
     * `fetchTimedCandles` faz `break` tanto no fim do histórico quanto num erro
     * de rede — os dois devolvem menos velas. Não dá para distinguir daqui, e
     * por isso o esgotamento só é marcado quando a busca trouxe ALGUMA COISA e
     * ainda assim veio curta: uma busca que voltou vazia é falha, não fundo.
     *
     * Marcar fundo numa falha congelaria o histórico no ponto do erro, para
     * sempre — é o irmão do 429 que virou "nenhuma pool encontrada".
     */
    const esgotou = vindas.length > 0 && vindas.length < quantas;
    if (vindas.length === 0) {
      problemas.push(`a fonte não devolveu vela para ${new Date(faixa.de).toISOString().slice(0, 10)}–${new Date(faixa.ate).toISOString().slice(0, 10)}`);
    }

    const g = await gravar(db, simbolo, intervalo, vindas, cobertura, esgotou, agoraMs);
    if (g.erro) problemas.push(`gravação: ${g.erro}`);
  }

  const { velas, erro } = await lerDoBanco(db, simbolo, intervalo, desde, ate);
  if (erro) problemas.push(`leitura: ${erro}`);

  /**
   * ⚠️ A VELA CORRENTE NUNCA ESTÁ NO BANCO, e quem pede uma janela que termina
   * hoje precisa saber disso — senão lê "faltou dado" onde o certo é "o dia
   * ainda não acabou".
   */
  const fim = ultimaVelaFechada(intervalo, agoraMs);
  if (fim != null && ate > fim) {
    problemas.push(`a janela pedida vai até ${new Date(ate).toISOString().slice(0, 10)}, mas a última vela FECHADA é ${new Date(fim).toISOString().slice(0, 10)} — o período corrente ainda está aberto`);
  }

  return {
    velas,
    doCache: velas.length,
    daFonte,
    porqueIncompleta: problemas.length > 0 ? problemas.join(" · ") : null,
  };
}
