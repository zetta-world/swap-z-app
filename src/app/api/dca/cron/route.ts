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
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { CexId, CexOrder } from "@/lib/cex/types";
import { taxaEmUsd } from "@/lib/cex/taxa";

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
 * Grava no máximo uma vez por `janelaMs` para a mesma chave.
 *
 * ⚠️ SEM ISTO, UM PLANO BARRADO GERA 288 EVENTOS POR DIA dizendo a mesma coisa,
 * e o sinal afoga no volume — mesmo efeito de não gravar nada. O
 * `platform_events` já recebe ~522/dia e não tem política de retenção.
 *
 * ⚠️ FALHA PARA O LADO DE GRAVAR. Se o `admin_kv` não responder, o evento sai:
 * duplicata é ruído, ausência é cegueira, e entre os dois o ruído é barato.
 */
async function primeiraVezNaJanela(chave: string, janelaMs: number): Promise<boolean> {
  const db = getSupabaseAdmin();
  if (!db) return true;
  const k = `dcadedup:${chave}`;
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", k).maybeSingle();
    const antes = data?.value ? Date.parse(data.value) : 0;
    if (Number.isFinite(antes) && Date.now() - antes < janelaMs) return false;
    const agora = new Date().toISOString();
    await db.from("admin_kv").upsert({ key: k, value: agora, updated_at: agora }, { onConflict: "key" });
    return true;
  } catch { return true; }
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

  /**
   * ⚠️ O ESTADO É O DO DCA, não o do autopilot — e a falta deste argumento
   * custou o primeiro teste real (25/08). O plano do dono foi barrado por uma
   * chave que existe para segurar o robô de IA e que nunca foi criada.
   */
  const [liberacao, pilotos] = await Promise.all([lerLiberacao("dca"), lerPilotos("dca")]);

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
  if (!v.permitido) {
    /**
     * ⚠️⚠️ BARRADO NÃO PODE SER SILENCIOSO — invariante nº 7, e eu a violei.
     *
     * A versão anterior só devolvia `{ acao: "barrado" }` no corpo da resposta
     * HTTP, que ninguém lê. O dono via "0 de 3 comprados" para sempre, sem uma
     * linha explicando por quê — indistinguível de "o cron não roda".
     *
     * ⚠️ O CRON DO AUTOPILOT JÁ FAZIA ISSO CERTO. Eu li aquele arquivo para
     * escrever este e copiei a estrutura sem a parte que importava: lá as
     * sessões barradas viram linha em `autopilot_runs` com a causa.
     *
     * ⚠️ E o dedup é por PLANO e por CAUSA, uma vez por hora: sem ele, um plano
     * barrado geraria 288 eventos por dia dizendo a mesma coisa, e o sinal
     * afogaria no volume — mesmo efeito de não gravar nada. Uma linha por hora
     * monta a linha do tempo sem encher o log.
     */
    if (await primeiraVezNaJanela(`barrado:${p.id}:${v.causa}`, 3_600_000)) {
      await recordEvent("dca_barrado", { wallet: p.wallet_address, meta: {
      plano: p.id, symbol: p.symbol, modo: p.modo, causa: v.causa,
      why: "plano vencido NÃO executado: a liberação do DCA está fechada. "
        + "Abrir em admin_kv (dca_liberado = 'true') ou autorizar a carteira "
        + "como piloto em dca_pilotos",
      } });
    }
    return { plano: p.id, acao: "barrado", detalhe: v.causa };
  }

  /**
   * ⚠️⚠️ PLANO SIMULADO NÃO TEM CONEXÃO — e não deve ter.
   *
   * É o ponto do modo: exercitar relógio, reserva, tetos e extrato SEM entregar
   * a chave da corretora a ninguém. Só o plano REAL exige credencial, e o banco
   * já garante isso (check `dca_planos_real_exige_conexao`).
   */
  const simulado = p.modo === "simulado";
  let conexao: Awaited<ReturnType<typeof lerConexaoPorId>> = null;
  if (!simulado) {
    conexao = await lerConexaoPorId(p.conexao_id ?? "");
    if (!conexao || !conexao.is_active) {
      await avancarPlano(p.id, { status: "encerrado", encerradoPor: "conexao_revogada" });
      return { plano: p.id, acao: "encerrado", detalhe: "conexao_revogada" };
    }
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
    // Plano simulado não tem conexão, logo não tem prazo de credencial.
    conexaoExpiraIso: conexao?.expires_at ?? "",
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
  /**
   * ⚠️⚠️ A CARTEIRA, NÃO O PLANO (26/08). Esta linha passava `[p.id]`, e com
   * isso o "teto diário da carteira" era um teto POR PLANO: dez planos na
   * mesma carteira davam dez vezes o limite — o cenário exato que o cabeçalho
   * de `gastoHojeDaCarteira` nomeia como motivo dela existir.
   *
   * ⚠️ E É CONSULTADO A CADA PLANO, sem cache, DE PROPÓSITO. Numa passada com
   * três planos vencidos da mesma carteira, o segundo tem de enxergar o que o
   * primeiro acabou de gastar. Um valor lido uma vez no início da passada
   * reabriria o furo dentro da própria passada.
   */
  const gastoHoje = await gastoHojeDaCarteira(p.wallet_address);
  if (gastoHoje === null) {
    // ⚠️ FALHA FECHADO. Um erro de consulta — ou uma leitura que estourou o
    // teto e pode estar cortada — que virasse `0` abriria o teto diário
    // inteiro exatamente quando o banco está ruim.
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
  if (reserva === "ja_reservado") {
    /**
     * ⚠️ NORMAL UMA VEZ, SINTOMA SE INSISTE. Duas passadas concorrentes no
     * mesmo ciclo é o caso para o qual a trava existe. Mas um plano cujo
     * avanço falhou (acima) bate aqui PARA SEMPRE, e sem registro isso é
     * indistinguível de um plano que simplesmente não tem janela vencida.
     * Uma linha por hora por ciclo monta a linha do tempo sem encher o log.
     */
    if (await primeiraVezNaJanela(`ja_reservado:${p.id}:${d.ciclo}`, 3_600_000)) {
      await recordEvent("dca_ciclo_ja_reservado", { wallet: p.wallet_address, meta: {
        plano: p.id, ciclo: d.ciclo,
        why: "ciclo ja reservado por outra passada. Se repetir de hora em hora, "
          + "o plano congelou: a compra foi feita e o avanco do plano falhou.",
      } });
    }
    return { plano: p.id, acao: "ja_em_curso" };
  }
  if (reserva === "erro") {
    await avisar("nao consegui reservar o ciclo — NADA foi comprado", { plano: p.id, ciclo: d.ciclo });
    return { plano: p.id, acao: "erro", detalhe: "reserva falhou" };
  }

  // ── passo 2: a ordem ────────────────────────────────────────────────
  const quantidade = teto.valorUsd / ref;
  try {
    /**
     * ⚠️⚠️ AQUI SAI DINHEIRO REAL — exceto em plano simulado, onde esta é a
     * ÚNICA linha que muda.
     *
     * Todo o resto do caminho é idêntico: mesma decisão de janela, mesma
     * reserva com a trava unique, mesmos tetos, mesmo preço de referência do
     * mercado real, mesmo registro. É o que faz o teste sem dinheiro VALER —
     * se ele fosse um caminho paralelo, provaria só que o caminho paralelo
     * funciona.
     *
     * ⚠️ E o `order.id` de um ciclo simulado é prefixado. Um id que pudesse
     * ser confundido com o de uma ordem real é como um extrato simulado vira
     * evidência de compra que nunca houve.
     */
    const order = simulado
      ? { id: `simulado:${p.id.slice(0, 8)}:${d.ciclo}`, average: ref, filled: quantidade, cost: teto.valorUsd }
      : (await placeCexOrder(
          p.exchange_id as CexId,
          decifrarConexao(conexao!),
          { symbol: p.symbol, type: "market", side: "buy", amount: quantidade },
        )).order;

    const preco = Number(order.average) > 0 ? Number(order.average) : ref;
    const qtd   = Number(order.filled)  > 0 ? Number(order.filled)  : quantidade;
    const custo = Number(order.cost)    > 0 ? Number(order.cost)    : preco * qtd;

    /**
     * ⚠️ A TAXA QUE A CORRETORA COBROU DE VERDADE (26/08).
     *
     * `custo` é `order.cost` — o TOTAL GASTO, não a taxa. Sem esta linha, a
     * projeção de `lib/dca/custo.ts` não tinha contra o que ser conferida, e
     * projeção que ninguém afere é promessa.
     *
     * ⚠️ PLANO SIMULADO GRAVA `null`, NUNCA 0. Uma simulação não pagou taxa
     * nenhuma — dizer "a corretora cobrou zero" seria inventar uma medição. O
     * `compararComRealizado()` conta ciclo sem registro à parte, então um plano
     * simulado aparece honestamente como "0 medidos", e não como taxa zero.
     *
     * Numa compra a corretora costuma cobrar na moeda BASE (vem menos token),
     * e `taxaEmUsd` resolve esse caso exato com `custo / qtd` — o preço que
     * acabou de ser realizado. Uma consulta de preço a menos é uma fonte de
     * erro a menos.
     */
    const t = simulado
      ? { usd: null as number | null, naoPrecificada: null }
      : taxaEmUsd(order as CexOrder, custo, qtd, p.symbol);
    if (t.naoPrecificada) {
      await avisar("taxa do ciclo NAO precificada — a alicota real fica sem este ciclo", {
        plano: p.id, ciclo: d.ciclo, moeda: t.naoPrecificada.moeda, valor: t.naoPrecificada.valor,
      });
    }

    // ── passo 3: o registro ───────────────────────────────────────────
    const gravou = await fecharCiclo(p.id, d.ciclo, {
      status: "feito", orderId: order.id, preco, quantidade: qtd, custoUsd: custo, simulado,
      // ⚠️ `naoPrecificada` presente significa que a taxa EXISTE e não soubemos
      // converter — `null` na coluna, e o motivo gravado ao lado.
      taxaUsd: t.naoPrecificada ? null : t.usd,
      taxaNaoPrecificada: t.naoPrecificada,
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
    /**
     * ⚠️⚠️ ESTA GRAVAÇÃO NÃO PODE FALHAR CALADA (26/08).
     *
     * `avancarPlano` devolve `false` quando o banco recusa — e o supabase-js
     * resolve com `{ error }` em vez de lançar, então o `await` sozinho não
     * prova nada. A rota PATCH deste mesmo recurso já checava; o cron não.
     *
     * O estrago não é comprar duas vezes — a reserva com `unique` impede isso.
     * É pior de diagnosticar: o dinheiro SAIU e o relógio não andou, então toda
     * passada seguinte recalcula o MESMO número de ciclo, bate em
     * `ja_reservado` e sai sem fazer nada. O plano CONGELA para sempre, e o
     * dono vê "1 de 12 comprados" sem uma linha dizendo por quê — a invariante
     * nº 7 outra vez, do lado que já gastou.
     */
    if (!await avancarPlano(p.id, {
      ciclosFeitos: feitos, ciclosPulados: pulados, gastoAcumulado: gasto,
      nextRunAt: d.proximoRunAt,
      ...(acabou ? { status: "completo" as const, encerradoPor: "completo" } : {}),
    })) {
      await avisar("COMPRA feita e plano NAO avancado — o plano congela ate mao humana", {
        plano: p.id, ciclo: d.ciclo, order_id: order.id, custo,
        why: "ciclos_feitos, gasto_acumulado_usd e next_run_at ficaram para tras. "
          + "A proxima passada recalcula o mesmo ciclo e sai em ja_reservado.",
      });
    }

    return {
      plano: p.id,
      acao: simulado ? "simulou" : "comprou",
      detalhe: `${qtd} ${base} por $${custo.toFixed(2)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // ⚠️ O ciclo fica `falhou`, não volta para `reservado`: repetir o número
    // faria a próxima passada tentar de novo e a trava unique a recusaria para
    // sempre. Falhou é um estado final, e conta como ciclo gasto.
    await fecharCiclo(p.id, d.ciclo, { status: "falhou", motivo: msg, simulado });
    await avancarPlano(p.id, { ciclosPulados: pulados, nextRunAt: d.proximoRunAt });
    return { plano: p.id, acao: "falhou", detalhe: msg.slice(0, 120) };
  }
}
