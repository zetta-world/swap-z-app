/**
 * AS ESTRATÉGIAS SALVAS DO CLIENTE — e o interruptor do papel adiante.
 *
 * ⚠️⚠️ ELA EXISTE PORQUE A FASE 6 NÃO FUNCIONA SEM. Até aqui o `/laboratorio`
 * montava e rodava, e o parâmetro morria na tela: `salvarEstrategia` estava no
 * store desde a fase 1 e nenhuma rota o chamava. Uma mesa viva precisa de uma
 * estratégia que exista amanhã.
 *
 * ⚠️ Duas cotas diferentes moram aqui, e elas medem coisas diferentes:
 *   · `estrategiasSalvas` — armazenamento, custo perto de zero;
 *   · `mesasDePapel`      — CRON, o único custo que recorre.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getTierForWallet } from "@/lib/tier/check";
import { checkFeatureTier, denialResponse } from "@/lib/tier/enforce";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { donoDaSessao } from "@/lib/bancada/dono";
import {
  salvarEstrategia, listarEstrategias, arquivarEstrategia,
  contarEstrategiasVivas, contarMesasVivas, ligarPapelAdiante,
} from "@/lib/bancada/store";
import { lerEstrategia, oPortaoDoPedagio } from "@/lib/bancada/vocabulario";
import { BANCADA_COTAS } from "@/lib/tier/types";
import { duracaoDoIntervaloMs } from "@/lib/mercado/velas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function contexto() {
  const session = await getSession();
  if (!session) return { erro: denialResponse({ kind: "unauthenticated" }) } as const;
  const v = donoDaSessao(session);
  if (!v) return { erro: denialResponse({ kind: "unauthenticated" }) } as const;
  const db = getSupabaseAdmin();
  if (!db) return { erro: json({ ok: false, error: "sem_banco" }, 503) } as const;
  const { tier } = await getTierForWallet(session.sub, session.chain);
  return { session, dono: v.dono, chain: v.chain, db, tier } as const;
}

export async function GET() {
  const c = await contexto();
  if ("erro" in c) return c.erro;
  /**
   * ⚠️ AS INSTÂNCIAS DE AGENTE FICAM DE FORA (0043) — elas moram em
   * `/api/bancada/agentes`. As duas espécies compartilham a tabela porque
   * compartilham dono, símbolos, interruptor, cota e índice do cron; o que elas
   * NÃO compartilham é como se medem. Uma instância de agente listada como
   * "sua estratégia" apareceria com o alvo e o stop em branco — o bracket dela
   * é variável — e o cliente leria isso como estratégia mal salva.
   */
  const estrategias = (await listarEstrategias(c.dono, c.db)).filter((e) => e.mesa == null);
  return json({ ok: true, tier: c.tier, cota: BANCADA_COTAS[c.tier], estrategias });
}

export async function POST(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;

  const portao = await checkFeatureTier("bancadaBacktest");
  if (portao) return denialResponse(portao);

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo_invalido" }, 400); }
  const o = (corpo ?? {}) as Record<string, unknown>;

  const lida = lerEstrategia(o.estrategia);
  if (!lida.ok) return json({ ok: false, error: "estrategia_invalida", porque: lida.porque }, 400);

  /**
   * ⚠️ O PORTÃO DO PEDÁGIO VALE PARA O QUE SE SALVA, não só para o que se roda.
   * Guardar uma configuração que a plataforma recusa criaria uma mesa que nunca
   * abre — foi assim que o Maker de Faixa ficou dois dias sem operar.
   */
  const pedagio = oPortaoDoPedagio(lida.valor);
  if (!pedagio.ok) return json({ ok: false, error: "pedagio", porque: pedagio.porque }, 422);

  const vivas = await contarEstrategiasVivas(c.dono, c.db);
  // ⚠️ `null` = não consegui contar. Recusar é o único caminho honesto: liberar
  // entregaria a cota inteira exatamente quando o banco está ruim.
  if (vivas == null) return json({ ok: false, error: "consumo_desconhecido" }, 503);
  const teto = BANCADA_COTAS[c.tier].estrategiasSalvas;
  if (vivas >= teto) {
    return json({ ok: false, error: "limite_de_estrategias", porque:
      `seu plano guarda até ${teto} estratégia(s). Arquive uma para salvar outra.`, upgradeUrl: "/pricing" }, 429);
  }

  const simbolos = Array.isArray(o.simbolos) ? o.simbolos.filter((s): s is string => typeof s === "string") : [];
  const intervalo = typeof o.intervalo === "string" && duracaoDoIntervaloMs(o.intervalo) != null ? o.intervalo : "1h";
  const nome = typeof o.nome === "string" && o.nome.trim() ? o.nome.trim() : "sem nome";

  const r = await salvarEstrategia(c.dono, c.chain, c.db, {
    nome, params: { ...lida.valor }, praca: lida.valor.praca, papel: lida.valor.papel,
    simbolos, intervalo,
  });
  if (!r.ok) return json({ ok: false, error: "nao_consegui_salvar", porque: r.porque }, 500);
  return json({ ok: true, id: r.valor });
}

/** Liga/desliga o papel adiante, ou arquiva. */
export async function PATCH(req: NextRequest) {
  const c = await contexto();
  if ("erro" in c) return c.erro;

  let corpo: unknown;
  try { corpo = await req.json(); } catch { return json({ ok: false, error: "corpo_invalido" }, 400); }
  const o = (corpo ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : null;
  if (!id) return json({ ok: false, error: "id_ausente" }, 400);

  if (o.arquivar === true) {
    const r = await arquivarEstrategia(c.dono, c.db, id);
    return r.ok ? json({ ok: true }) : json({ ok: false, error: "falhou", porque: r.porque }, 500);
  }

  const ligar = o.papelAdiante === true;

  if (ligar) {
    /**
     * ⚠️⚠️ O PORTÃO DO PAPEL ADIANTE É O `trader`, e ele é verificado AQUI e
     * DE NOVO no cron a cada tick. Duas vezes de propósito: aqui para o cliente
     * receber o motivo na hora; lá porque quem cai de plano depois precisa
     * parar de consumir cron — e ninguém revisa isso à mão.
     */
    const portao = await checkFeatureTier("bancadaPapelAdiante");
    if (portao) return denialResponse(portao);

    const mesas = await contarMesasVivas(c.dono, c.db);
    if (mesas == null) return json({ ok: false, error: "consumo_desconhecido" }, 503);
    const teto = BANCADA_COTAS[c.tier].mesasDePapel;
    if (mesas >= teto) {
      return json({ ok: false, error: "limite_de_mesas", porque:
        `seu plano roda até ${teto} mesa(s) de papel adiante ao mesmo tempo.`, upgradeUrl: "/pricing" }, 429);
    }
  }

  const r = await ligarPapelAdiante(c.dono, c.db, id, ligar);
  return r.ok ? json({ ok: true, papelAdiante: ligar }) : json({ ok: false, error: "falhou", porque: r.porque }, 500);
}
