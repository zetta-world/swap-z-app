/**
 * A ROTA DA BANCADA — onde o motor puro encontra o cliente, a cota e o banco.
 *
 * ⚠️⚠️ ELA NÃO DECIDE NADA. Cota é `bancada/cotas.ts`, portão do pedágio é
 * `bancada/vocabulario.ts`, aritmética é `motor.ts` e `veredito.ts`, isolamento
 * é `bancada/store.ts`. Aqui há só a costura — e é de propósito: regra de
 * negócio dentro de rota é onde nenhum teste alcança, e foi assim que a arena
 * antiga acumulou defeito que só aparecia em produção.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { checkFeatureTier, denialResponse } from "@/lib/tier/enforce";
import { rateLimitDurable } from "@/lib/rate-limit";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { donoDaSessao } from "@/lib/bancada/dono";
import {
  abrirRodada, fecharRodada, gravarResultado, consumoDaJanela,
} from "@/lib/bancada/store";
import { lerEstrategia, oPortaoDoPedagio } from "@/lib/bancada/vocabulario";
import { decidir, type PedidoDeRodada } from "@/lib/bancada/cotas";
import { rodar } from "@/lib/bancada/motor";
import { resumir, julgar } from "@/lib/bancada/veredito";
import { velasDoIntervalo } from "@/lib/mercado/store";
import { ultimaVelaFechada } from "@/lib/mercado/velas";
import type { Operacao } from "@/lib/bancada/motor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ ESTE LIMITE NÃO É A COTA, é o freio de rajada. A cota conta 24h e mede
 * plano; isto impede que um laço aberto por engano dispare cem rodadas em um
 * minuto antes de a cota sequer ser lida.
 */
const RL_OPTS = { windowMs: 60_000, max: 12 };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return denialResponse({ kind: "unauthenticated" });

  const verificado = donoDaSessao(session);
  // ⚠️ Não deveria acontecer com sessão válida, mas um `!` aqui trocaria um
  // estado impossível por um crash de produção.
  if (!verificado) return denialResponse({ kind: "unauthenticated" });
  const { dono, chain } = verificado;

  const portao = await checkFeatureTier("bancadaBacktest");
  if (portao) return denialResponse(portao);

  const rl = await rateLimitDurable(`bancada:rajada:${dono.toLowerCase()}`, RL_OPTS);
  if (!rl.ok) {
    return json({ ok: false, error: "muitas_rodadas_seguidas", retryAfter: rl.retryAfter }, 429);
  }

  const db = getSupabaseAdmin();
  if (!db) {
    /**
     * ⚠️ SEM BANCO A BANCADA NÃO RODA — e isto é o oposto do que `mercado/store`
     * faz sozinho. Lá, cair para a fonte é melhor-esforço honesto numa leitura;
     * aqui a rodada precisa ser CONTADA e GRAVADA. Rodar sem poder contar
     * entrega a cota inteira de graça e produz resultado que ninguém revê.
     */
    return json({ ok: false, error: "sem_banco", porque: "a bancada está indisponível por alguns instantes." }, 503);
  }

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo_invalido" }, 400); }
  const o = (corpo ?? {}) as Record<string, unknown>;

  // ── 1. O vocabulário: `unknown` vira estratégia, ou recusa com motivo ──
  const lida = lerEstrategia(o.estrategia);
  if (!lida.ok) return json({ ok: false, error: "estrategia_invalida", porque: lida.porque }, 400);
  const estrategia = lida.valor;

  const simbolos = Array.isArray(o.simbolos) ? o.simbolos.filter((s): s is string => typeof s === "string") : [];
  const intervalo = typeof o.intervalo === "string" ? o.intervalo : "1d";
  const capitalUsd = typeof o.capitalUsd === "number" ? o.capitalUsd : NaN;
  const janelaDias = typeof o.janelaDias === "number" ? o.janelaDias : NaN;

  /**
   * ⚠️⚠️ A JANELA TERMINA NA ÚLTIMA VELA FECHADA, e quem decide isso é o
   * SERVIDOR — nunca o corpo da requisição.
   *
   * Deixar o cliente mandar `janelaAte` permitiria escolher a janela depois de
   * saber o resultado, que é a forma mais educada de sobreajuste. E a vela do
   * período corrente muda a cada negócio: incluí-la mediria um dia que ainda
   * não aconteceu.
   */
  const fim = ultimaVelaFechada(intervalo, Date.now());
  if (fim == null || !Number.isFinite(janelaDias) || janelaDias <= 0) {
    return json({ ok: false, error: "janela_invalida", porque: "intervalo ou janela em dias inválidos" }, 400);
  }
  const janelaAte = fim;
  const janelaDe = fim - janelaDias * 86_400_000;

  const pedido: PedidoDeRodada = { simbolos, intervalo, janelaDe, janelaAte, capitalUsd };

  // ── 2. O portão do pedágio, ANTES da cota ─────────────────────────────
  /**
   * ⚠️ A ORDEM IMPORTA. A rodada recusada aqui é gravada como `recusada` e NÃO
   * consome cota — cobrar por ela puniria o cliente justamente pela mensagem
   * que o impediu de perder dinheiro, e ensinaria a não testar.
   */
  const pedagio = oPortaoDoPedagio(estrategia);
  if (!pedagio.ok) {
    const r = await abrirRodada(dono, chain, db, {
      estrategiaId: null, origem: "propria", capitalUsd: Number.isFinite(capitalUsd) ? capitalUsd : 1,
      simbolos, intervalo, janelaDe, janelaAte,
      praca: estrategia.praca, papel: estrategia.papel, params: { ...estrategia }, custoVelas: 0,
    });
    if (r.ok) await fecharRodada(dono, db, r.valor, "recusada", pedagio.porque);
    return json({ ok: false, error: "pedagio", porque: pedagio.porque, rodadaId: r.ok ? r.valor : null }, 422);
  }

  // ── 3. A cota ─────────────────────────────────────────────────────────
  const { tier } = await getTierForWallet(session.sub, session.chain);
  const consumo = await consumoDaJanela(dono, db);
  const d = decidir(tier, pedido, consumo);
  if (!d.ok) {
    return json({ ok: false, error: d.motivo, porque: d.porque, tier, cota: d.cota, upgradeUrl: "/pricing" },
      d.motivo === "consumo_desconhecido" ? 503 : 429);
  }

  // ── 4. A rodada nasce ANTES de haver resultado ────────────────────────
  const aberta = await abrirRodada(dono, chain, db, {
    estrategiaId: typeof o.estrategiaId === "string" ? o.estrategiaId : null,
    origem: o.origem === "casa" ? "casa" : "propria",
    capitalUsd, simbolos, intervalo, janelaDe, janelaAte,
    praca: estrategia.praca, papel: estrategia.papel,
    params: { ...estrategia }, custoVelas: d.custoVelas,
  });
  if (!aberta.ok) return json({ ok: false, error: "nao_consegui_abrir", porque: aberta.porque }, 500);
  const rodadaId = aberta.valor;

  // ── 5. As velas e o motor ─────────────────────────────────────────────
  const operacoes: Operacao[] = [];
  const problemas: string[] = [];
  const retornosDeSegurar: number[] = [];

  for (const simbolo of simbolos) {
    const leitura = await velasDoIntervalo(db, simbolo, intervalo, janelaDe, janelaAte);
    if (leitura.porqueIncompleta) problemas.push(`${simbolo}: ${leitura.porqueIncompleta}`);
    if (leitura.velas.length < 2) continue;

    operacoes.push(...rodar(leitura.velas, estrategia).operacoes);

    /**
     * ⚠️ O COMPETIDOR É "SEGURAR", medido na MESMA janela e SEM custo.
     *
     * Sem custo de propósito: comprar e não mexer paga uma ida e volta só, e
     * cobrar dele o mesmo pedágio da estratégia que operou quarenta vezes
     * inventaria vantagem para o nosso lado. O competidor tem de ser difícil de
     * bater — senão o veredito vira propaganda.
     */
    const p0 = leitura.velas[0].close;
    const pN = leitura.velas[leitura.velas.length - 1].close;
    if (p0 > 0) retornosDeSegurar.push(((pN - p0) / p0) * 100);
  }

  const resumo = resumir({ operacoes, velasLidas: d.custoVelas, aindaAbertas: 0 }, estrategia);
  const competidorPct = retornosDeSegurar.length > 0
    ? retornosDeSegurar.reduce((s, x) => s + x, 0) / retornosDeSegurar.length
    // ⚠️ `null`, nunca 0: zero afirmaria que o mercado ficou parado.
    : null;

  const v = julgar(resumo, estrategia, competidorPct);
  const naoMedido = [...v.naoMedido, ...problemas];

  await gravarResultado(dono, db, rodadaId, {
    brutoPct: resumo.brutoPct,
    taxaPct: resumo.taxaPct,
    derrapagemPct: resumo.derrapagemPct,
    liquidoPct: resumo.liquidoCompostoPct,
    n: resumo.n, acertos: resumo.acertos,
    equilibrioExigidoPct: v.equilibrioPct,
    veredito: v.veredito, naoMedido,
  });
  await fecharRodada(dono, db, rodadaId, "concluida");

  return json({
    ok: true, rodadaId, tier,
    restamHoje: d.restamHoje - 1,
    veredito: { ...v, naoMedido },
    resumo,
    competidorPct,
  });
}
