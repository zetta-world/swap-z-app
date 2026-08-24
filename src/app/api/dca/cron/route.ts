import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { decidirCiclo, tetoDoCiclo, type Intervalo } from "@/lib/dca/relogio";
import {
  planosVencidos, reservarCiclo, fecharCiclo, gravarPulo, avancarPlano,
  gastoHojeDaCarteira, type PlanoRow,
} from "@/lib/dca/store";
import { lerConexaoPorId, decifrarConexao } from "@/lib/cex/conexoes";
import { placeCexOrder } from "@/lib/cex/server";
import { getCexSpotPrices } from "@/lib/api/cex-spot";
import { lerLiberacao, lerPilotos, decidirAutomacao } from "@/lib/autopilot/liberacao";
import { getFlywheelGates } from "@/lib/admin/gates";
import { setCronHeartbeat } from "@/lib/admin/health";
import { recordEvent, notifyTelegram } from "@/lib/admin/track";
import type { CexId } from "@/lib/cex/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ⚠️⚠️ O CRON DO DCA — ROTA PRÓPRIA, e isso é o ponto.
 * (`docs/PLANO-DCA-AUTOMATICO.md` D3)
 *
 * Decisão do dono em 24/08: *"cada um é uma solução diferente"*. O DCA não
 * mora dentro do cron do autopilot, e o argumento mais forte é o RAIO DE
 * EXPLOSÃO: se `/api/autopilot/cron` devolver 500, para tudo que estiver
 * dentro dela. O autopilot é a peça complexa e arriscada — o plano de poupança
 * de alguém não pode morrer junto com um bug da IA.
 *
 * Heartbeat próprio, kill-switch próprio, gate de liberação próprio.
 *
 * ⚠️ E O DCA NÃO PERGUNTA NADA A NENHUM MODELO. É relógio + ordem a mercado.
 * Zero LLM, zero card, zero ZION.
 */

function autorizado(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

/** Teto de plataforma por ciclo. Env ausente NÃO significa "sem limite". */
function tetoPlataforma(): number {
  const n = Number(process.env.DCA_MAX_CICLO_USD ?? "");
  return Number.isFinite(n) && n > 0 ? n : 500;
}
function tetoDiarioCarteira(): number {
  const n = Number(process.env.DCA_MAX_DIARIO_USD ?? "");
  return Number.isFinite(n) && n > 0 ? n : 1000;
}
function minimoOrdem(): number {
  const n = Number(process.env.DCA_MIN_ORDEM_USD ?? "");
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/**
 * Alerta alto: o que exige mão humana, não o que é rotina.
 *
 * ⚠️ AGUARDADO. Na Vercel a função congela depois da resposta e um
 * `void recordEvent(...)` se perde — e o evento que mais importa aqui é
 * justamente "ordem executada e ciclo não fechado, reconciliar à mão".
 * Perder ESSE seria perder o único registro do pior desfecho previsto.
 *
 * A trava `event-durability` não teria pego: ela varria só
 * `src/app/admin/api`. Alargada junto com esta entrega.
 */
async function avisar(assunto: string, meta: Record<string, unknown>) {
  await recordEvent("dca_incidente", { meta: { why: assunto, ...meta } });
  notifyTelegram(`⚠️ DCA — ${assunto}\n${JSON.stringify(meta).slice(0, 400)}`);
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // ⚠️ Heartbeat ANTES de qualquer trava. Se o gate estiver fechado o watchdog
  // não pode acusar "cron parado" — a causa real ficaria atrás de alarme errado.
  await setCronHeartbeat("dca");

  const gates = await getFlywheelGates();
  if (gates.pause_dca) {
    return NextResponse.json({ ok: true, paused: true, processed: 0 });
  }

  const agoraIso = new Date().toISOString();
  const { planos, truncado } = await planosVencidos(agoraIso);
  if (truncado) {
    // ⚠️ Corte silencioso lê-se como "vi tudo". Se um dia houver mais planos
    // vencidos que o teto, o dono precisa saber que a fila não coube.
    await avisar("mais planos vencidos que o teto da passada", { teto: 200 });
  }

  const [liberacao, pilotos] = await Promise.all([lerLiberacao(), lerPilotos()]);

  const resumo: Array<{ plano: string; acao: string; detalhe?: string }> = [];
  for (const p of planos) {
    try {
      resumo.push(await processarPlano(p, agoraIso, liberacao, pilotos));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resumo.push({ plano: p.id, acao: "erro", detalhe: msg.slice(0, 120) });
    }
  }

  return NextResponse.json({ ok: true, processed: planos.length, truncado, resumo });
}

type Liberacao = Awaited<ReturnType<typeof lerLiberacao>>;
type Pilotos   = Awaited<ReturnType<typeof lerPilotos>>;

async function processarPlano(
  p: PlanoRow, agoraIso: string, liberacao: Liberacao, pilotos: Pilotos,
): Promise<{ plano: string; acao: string; detalhe?: string }> {
  /**
   * ⚠️ GATE PRÓPRIO, função compartilhada. `decidirAutomacao` é decisão PURA
   * sobre um estado lido do banco — o DCA passa o SEU estado. Abrir robô de IA
   * ao público e abrir poupança ao público são decisões diferentes.
   */
  const v = decidirAutomacao(p.wallet_address, liberacao, pilotos);
  if (!v.permitido) return { plano: p.id, acao: "barrado", detalhe: v.causa };

  const conexao = await lerConexaoPorId(p.conexao_id);
  if (!conexao || !conexao.is_active) {
    await avancarPlano(p.id, { status: "encerrado", encerradoPor: "conexao_revogada" });
    return { plano: p.id, acao: "encerrado", detalhe: "conexao_revogada" };
  }

  const d = decidirCiclo({
    agoraIso,
    nextRunAtIso:  p.next_run_at,
    intervalo:     p.intervalo as Intervalo,
    ciclosFeitos:  p.ciclos_feitos,
    ciclosPulados: p.ciclos_pulados,
    ciclosTotal:   p.ciclos_total,
    status:        p.status,
    // `null` = sem prazo duro; o relógio trata data ilegível como "sem prazo".
    conexaoExpiraIso: conexao.expires_at ?? "",
  });

  if (d.acao === "esperar") return { plano: p.id, acao: "espera" };

  // ── as janelas perdidas viram registro ANTES de qualquer compra ──────
  let pulados = p.ciclos_pulados;
  const pular = d.acao === "encerrar" || d.acao === "executar" || d.acao === "pular" ? d.pular : [];
  for (const j of pular) {
    if (await gravarPulo(p.id, j.ciclo, j.agendadoPara, j.motivo)) pulados += 1;
  }

  if (d.acao === "encerrar") {
    await avancarPlano(p.id, {
      ciclosPulados: pulados,
      status: d.motivo === "completo" ? "completo" : "encerrado",
      // ⚠️ COMPLETO ≠ MORTO. Um plano que parou porque a conexão expirou não é
      // um plano que terminou, e o dono precisa ver a diferença.
      encerradoPor: d.motivo,
    });
    return { plano: p.id, acao: "encerrado", detalhe: d.motivo };
  }

  if (d.acao === "pular") {
    await avancarPlano(p.id, { ciclosPulados: pulados, nextRunAt: d.proximoRunAt });
    return { plano: p.id, acao: "pulou", detalhe: `${pular.length} janelas` };
  }

  // ── quanto pode gastar ──────────────────────────────────────────────
  const gastoHoje = await gastoHojeDaCarteira([p.id]);
  if (gastoHoje === null) {
    // ⚠️ FALHA FECHADO. Um erro de consulta que virasse `0` abriria o teto
    // diário inteiro exatamente quando o banco está ruim.
    return { plano: p.id, acao: "adiado", detalhe: "gasto do dia desconhecido" };
  }
  const teto = tetoDoCiclo({
    porCicloUsd:           Number(p.por_ciclo_usd),
    gastoAcumuladoUsd:     Number(p.gasto_acumulado_usd),
    orcamentoTotalUsd:     Number(p.orcamento_total_usd),
    gastoHojeCarteiraUsd:  gastoHoje,
    tetoDiarioCarteiraUsd: tetoDiarioCarteira(),
    tetoPlataformaUsd:     tetoPlataforma(),
    minimoUsd:             minimoOrdem(),
  });
  if (!teto.ok) {
    if (teto.motivo === "orcamento_esgotado" || teto.motivo === "abaixo_do_minimo") {
      await avancarPlano(p.id, { ciclosPulados: pulados, status: "completo", encerradoPor: teto.motivo });
      return { plano: p.id, acao: "encerrado", detalhe: teto.motivo };
    }
    // Teto diário / plataforma: não encerra, tenta na próxima janela.
    await avancarPlano(p.id, { ciclosPulados: pulados, nextRunAt: d.proximoRunAt });
    return { plano: p.id, acao: "adiado", detalhe: teto.motivo };
  }

  /**
   * ⚠️⚠️ SEM PREÇO DE REFERÊNCIA, NÃO COMPRA.
   *
   * Mesma regra do `price-guard.ts`: o caminho de dinheiro falha FECHADO. DCA é
   * ordem a mercado por natureza, mas "a mercado" num livro seco é como se
   * perde 30% num tick — e aqui não há ninguém olhando a tela.
   */
  const base = p.symbol.split("/")[0]?.toUpperCase() ?? "";
  const precos = await getCexSpotPrices([base]).catch(() => new Map());
  const ref = precos.get(base)?.priceUsd ?? 0;
  if (!(ref > 0)) {
    await avancarPlano(p.id, { ciclosPulados: pulados, nextRunAt: d.proximoRunAt });
    return { plano: p.id, acao: "adiado", detalhe: "sem preco de referencia" };
  }

  /**
   * ⚠️⚠️ PASSO 1 DE TRÊS — A RESERVA. A ordem é INEGOCIÁVEL.
   *
   * `ja_reservado` é resultado NORMAL, não erro: significa que outra passada
   * está com este ciclo, e esta sai SEM GASTAR NADA. É a única garantia contra
   * comprar duas vezes — o lock por sessão tem TTL e não basta.
   */
  const reserva = await reservarCiclo(p.id, d.ciclo, d.agendadoPara);
  if (reserva === "ja_reservado") return { plano: p.id, acao: "ja_em_curso" };
  if (reserva === "erro") {
    await avisar("nao consegui reservar o ciclo — NADA foi comprado", { plano: p.id, ciclo: d.ciclo });
    return { plano: p.id, acao: "erro", detalhe: "reserva falhou" };
  }

  // ── passo 2: a ordem. DINHEIRO REAL SAI AQUI ────────────────────────
  const quantidade = teto.valorUsd / ref;
  try {
    const { order } = await placeCexOrder(
      p.exchange_id as CexId,
      decifrarConexao(conexao),
      { symbol: p.symbol, type: "market", side: "buy", amount: quantidade },
    );

    const preco = Number(order.average) > 0 ? Number(order.average) : ref;
    const qtd   = Number(order.filled)  > 0 ? Number(order.filled)  : quantidade;
    const custo = Number(order.cost)    > 0 ? Number(order.cost)    : preco * qtd;

    // ── passo 3: o registro ───────────────────────────────────────────
    const gravou = await fecharCiclo(p.id, d.ciclo, {
      status: "feito", orderId: order.id, preco, quantidade: qtd, custoUsd: custo,
    });
    if (!gravou) {
      /**
       * ⚠️ A ORDEM EXISTE E O REGISTRO NÃO. É o pior desfecho previsto no
       * plano — e é MELHOR que o inverso: o ciclo não repete, porque a reserva
       * está gravada. Pede mão humana em vez de tentar adivinhar.
       */
      await avisar("ordem EXECUTADA e ciclo NAO fechado — reconciliar a mao", {
        plano: p.id, ciclo: d.ciclo, order_id: order.id, custo,
      });
    }

    const feitos = p.ciclos_feitos + 1;
    const gasto  = Number(p.gasto_acumulado_usd) + custo;
    const acabou = feitos + pulados >= p.ciclos_total;
    await avancarPlano(p.id, {
      ciclosFeitos: feitos, ciclosPulados: pulados, gastoAcumulado: gasto,
      nextRunAt: d.proximoRunAt,
      ...(acabou ? { status: "completo" as const, encerradoPor: "completo" } : {}),
    });

    return { plano: p.id, acao: "comprou", detalhe: `${qtd} ${base} por $${custo.toFixed(2)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ⚠️ O ciclo fica `falhou`, não volta para `reservado`: repetir o número
    // faria a próxima passada tentar de novo e a trava unique a recusaria para
    // sempre. Falhou é um estado final, e conta como ciclo gasto.
    await fecharCiclo(p.id, d.ciclo, { status: "falhou", motivo: msg });
    await avancarPlano(p.id, { ciclosPulados: pulados, nextRunAt: d.proximoRunAt });
    return { plano: p.id, acao: "falhou", detalhe: msg.slice(0, 120) };
  }
}
