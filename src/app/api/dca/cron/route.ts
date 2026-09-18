import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { decidirCiclo, tetoDoCiclo, type Intervalo } from "@/lib/dca/relogio";
import {
  planosVencidos, reservarCiclo, fecharCiclo, gravarPulo, avancarPlano,
  gastoHojeDaCarteira, type PlanoRow,
} from "@/lib/dca/store";
import {
  lerConexaoPorId, decifrarConexao, credenciaisDoIntentParaRecovery,
} from "@/lib/cex/conexoes";
import { executarOrdemCex } from "@/lib/cex/execucao/executor";
import { intentVivoDoPlano, intentPorId } from "@/lib/cex/execucao/intents";
import { reconciliarIntent } from "@/lib/cex/execucao/reconciliador";
import { decidirPeloIntent } from "@/lib/dca/liquidacao";
import { decidirCapacidade, lerCapacidades, type EstadoDasCapacidades }
  from "@/lib/dca/capacidade";
import { getCexSpotPrices } from "@/lib/api/cex-spot";
import { lerLiberacao, lerPilotos, decidirAutomacao } from "@/lib/autopilot/liberacao";
import { getFlywheelGates } from "@/lib/admin/gates";
import { setCronHeartbeat } from "@/lib/admin/health";
import { pegarATrava, soltarATrava } from "@/lib/dca/trava";
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

  /**
   * ⚠⚠ UMA PASSADA POR VEZ — achado A20 da auditoria externa.
   *
   * O teto diário é da CARTEIRA e é aplicado por leitura-depois-ação:
   * `gastoHojeDaCarteira` lê, `tetoDoCiclo` decide, e só depois a ordem sai.
   * Duas invocações concorrentes leem o MESMO gasto e disparam as duas.
   *
   * ⚠️ A `unique` do `reservarCiclo` NÃO cobre isto: ela impede repetir o
   * MESMO ciclo do MESMO plano. O teto atravessa PLANOS — dois planos da mesma
   * carteira reservam ciclos diferentes, passam os dois, e estouram o teto
   * juntos.
   *
   * ⚠️ E o comentário de `gastoHoje` lá embaixo já SUPUNHA serialização — diz
   * que a consulta é refeita a cada plano "para o segundo enxergar o que o
   * primeiro gastou". Está certo DENTRO de uma passada, e é exatamente a
   * suposição que uma segunda passada simultânea quebra. Esta trava é o que
   * torna aquele comentário verdadeiro.
   */
  const trava = await pegarATrava();
  if (trava === "ocupada") {
    // Rotina, e sai calado: é o caso para o qual a trava existe.
    return NextResponse.json({ ok: true, processed: 0, nota: "outra passada em curso" });
  }
  if (trava === "nao_sei") {
    /**
     * ⚠⚠ FALHA FECHADO. Seguir sem saber se outra passada está comprando é
     * exatamente o defeito que esta trava fecha. Uma janela perdida é
     * recuperável — a próxima vem em 5 minutos; um teto diário estourado não é.
     * O DCA já falha fechado quando `gastoHoje` vem `null`, pelo mesmo motivo.
     */
    await avisar("nao consegui ler a trava da passada — NADA foi executado", {
      why: "seguir sem a trava arrisca duas passadas comprando com o mesmo teto diario",
    });
    return NextResponse.json({ ok: false, error: "trava_indisponivel", processed: 0 }, { status: 503 });
  }

  try {
    return await passada();
  } finally {
    // ⚠️ `finally`: uma exceção no meio não pode deixar a trava presa até o TTL.
    await soltarATrava();
  }
}

async function passada(): Promise<NextResponse> {
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
  const [liberacao, pilotos, capacidades] = await Promise.all([
    lerLiberacao("dca"), lerPilotos("dca"),
    /**
     * ⚠️ AS DUAS CAPACIDADES, numa ida só, para a passada inteira (A112).
     * Simulado e real são interruptores DIFERENTES, e o real nasce fechado.
     */
    lerCapacidades(getSupabaseAdmin()),
  ]);

  const resumo: Array<{ plano: string; acao: string; detalhe?: string }> = [];
  for (const p of planos) {
    try {
      resumo.push(await processarPlano(p, agoraIso, liberacao, pilotos, capacidades));
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
  capacidades: EstadoDasCapacidades,
): Promise<{ plano: string; acao: string; detalhe?: string }> {
  /**
   * ⚠️ GATE PRÓPRIO, função compartilhada. `decidirAutomacao` é decisão PURA
   * sobre um estado lido do banco — o DCA passa o SEU estado. Abrir robô de IA
   * ao público e abrir poupança ao público são decisões diferentes.
   */
  /**
   * ⚠️⚠️ A CAPACIDADE DO MODO, ANTES DE TUDO — achado A112.
   *
   * `dca_liberado` foi aberto em 25/08 "para o primeiro teste SIMULADO" — a
   * justificativa está gravada ao lado dele em produção — e o MESMO
   * interruptor liberava o caminho REAL. Agora são duas capacidades, e a real
   * nasce FECHADA: ausência de `dca_real_liberado` é recusa.
   *
   * ⚠️ E ELA VEM ANTES do gate de automação, de propósito: "este produto pode
   * mover dinheiro?" é pergunta anterior a "esta carteira pode automatizar?".
   */
  const capacidade = decidirCapacidade(
    (p.modo === "real" ? "real" : "simulado"), capacidades);
  if (!capacidade.permitido) {
    if (await primeiraVezNaJanela(`sem_capacidade:${p.id}:${capacidade.causa}`, 3_600_000)) {
      await recordEvent("dca_sem_capacidade", { wallet: p.wallet_address, meta: {
        plano: p.id, modo: p.modo, causa: capacidade.causa,
        why: p.modo === "real"
          ? "DCA REAL exige `dca_real_liberado = true` em admin_kv. Ele nasce FECHADO "
            + "de proposito: o interruptor antigo foi aberto para um teste SIMULADO."
          : "DCA simulado exige `dca_simulado_liberado` (ou a chave legada `dca_liberado`).",
      } });
    }
    return { plano: p.id, acao: "sem_capacidade", detalhe: capacidade.causa };
  }

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
    /**
     * ⚠️⚠️ TRÊS RESPOSTAS, TRÊS CONDUTAS — achado A115.
     *
     * `!conexao` cobria `null` e `undefined` juntos, e ENCERRAVA o plano como
     * "conexao_revogada" nos dois. Ou seja: uma falha de leitura do banco
     * matava um plano de poupança do cliente, com um motivo que dizia outra
     * coisa. Fail-closed estava certo; destruir estado não.
     */
    if (conexao === undefined) {
      // Não deu para olhar. Nada sai, e o plano continua vivo.
      return { plano: p.id, acao: "adiado", detalhe: "cofre ilegivel — nada enviado" };
    }
    if (conexao === null || !conexao.is_active) {
      await avancarPlano(p.id, { status: "encerrado", encerradoPor: "conexao_revogada" });
      return { plano: p.id, acao: "encerrado", detalhe: "conexao_revogada" };
    }
  }

  /**
   * ⚠️⚠️ A PRIMEIRA PERGUNTA DA PASSADA: SOBROU DÚVIDA DA VEZ ANTERIOR?
   *
   * Achados A104 e A105. O cron antigo fazia `submit → timeout → falhou →
   * avança`, e a ordem podia ter executado. Agora um intent não-terminal deste
   * plano BLOQUEIA tudo até a corretora responder: nada de ciclo novo, nada de
   * avanço, nada de segunda ordem. Primeiro se descobre a verdade.
   */
  const dbExec = getSupabaseAdmin();
  if (!dbExec) {
    return { plano: p.id, acao: "adiado", detalhe: "sem banco para conferir intents" };
  }
  const vivo = await intentVivoDoPlano(dbExec, p.id);
  if (vivo === undefined) {
    // ⚠️ Falha de leitura NÃO é "nada pendente". Falha FECHADO.
    return { plano: p.id, acao: "adiado", detalhe: "nao consegui ler intents pendentes" };
  }
  if (vivo) {
    const rec = await reconciliarIntent({
      db: dbExec,
      // A127: o pending usa a versão gravada NO INTENT. Mesmo se o plano for
      // rearmado no futuro, a identidade histórica desta ordem não migra.
      credenciais: async (intent) => credenciaisDoIntentParaRecovery(dbExec, intent),
    }, vivo);
    /**
     * ⚠️⚠️⚠️ RELER O MESMO INTENT, PELO ID — achado A117.
     *
     * A linha que estava aqui era o pior defeito do arquivo:
     *
     *     const atual = (await intentVivoDoPlano(dbExec, p.id)) ?? null;
     *     const decisao = decidirPeloIntent(atual ?? { ...vivo, state: "FILLED" });
     *
     * `intentVivoDoPlano` só enxerga estados NÃO-terminais. O caminho feliz da
     * reconciliação — a corretora confirmou, o livro fechou em FILLED — faz o
     * intent SAIR dessa consulta, `atual` vinha `null`, e o `??` inventava um
     * intent FILLED com os números do PEDIDO. Ou seja: exatamente quando a
     * reconciliação FUNCIONAVA, o plano liquidava com `filled_qty = 0` virando
     * "comprou tudo" — o A81 ressuscitado por um fallback sintético, uma linha
     * abaixo do comentário que jura que "o que entra no ciclo é o que o livro
     * tem".
     *
     * Estado sintético não existe mais aqui, em lugar nenhum: depois de
     * reconciliar, relê-se o MESMO intent pelo id. `undefined` (falha de
     * leitura) adia, fail-closed; `null` (a linha SUMIU) é incidente crítico —
     * ninguém apaga intent — e também não avança.
     *
     * ⚠️⚠️ E DA RELEITURA EM DIANTE, TODO DADO DO INTENT VEM DE `atual` —
     * achado A119. `vivo` é a fotografia PRÉ-reconciliação: a taxa, o modo e
     * até o número do ciclo que ela carrega são anteriores ao que a corretora
     * acabou de responder. Liquidar o ciclo com `vivo.fee_total` gravava a taxa
     * VELHA (ou nenhuma) exatamente quando a reconciliação tinha acabado de
     * trazer a verdadeira. `vivo` só presta, daqui para frente, para o `id`
     * (é a chave da releitura) e para os ramos em que `atual` não existe —
     * e mesmo neles, só o ciclo, capturado ANTES da releitura.
     */
    const cicloDoIntentVivo = Number(vivo.cycle_number);
    const atual = await intentPorId(dbExec, vivo.id);
    if (atual === undefined) {
      await avisar("releitura do intent FALHOU — plano NAO avanca", {
        plano: p.id, ciclo: cicloDoIntentVivo, intent: vivo.id,
        why: "reconciliei e nao consegui reler o resultado. Avancar sobre leitura "
          + "falha e o mesmo que avancar as cegas.",
      });
      return { plano: p.id, acao: "adiado", detalhe: "nao consegui reler o intent" };
    }
    if (atual === null) {
      // ⚠️ A LINHA SUMIU DO LIVRO. Intents não se apagam — se não está lá,
      // algo gravíssimo aconteceu, e o plano congela até mão humana.
      await recordEvent("dca_intent_sumiu", { wallet: p.wallet_address, meta: {
        severity: "high", plano: p.id, ciclo: cicloDoIntentVivo, intent: vivo.id,
        why: "o intent existia antes da reconciliacao e NAO existe mais. Ninguem "
          + "apaga intent — o plano NAO avanca ate mao humana.",
      } });
      notifyTelegram(`🔴 DCA — intent SUMIU do livro\nplano ${p.id} · intent ${vivo.id}`);
      return { plano: p.id, acao: "adiado", detalhe: "intent sumiu do livro" };
    }
    const decisao = decidirPeloIntent(atual);

    if (decisao.acao === "esperar") {
      await avisar("ciclo de DCA em DUVIDA — plano NAO avanca ate reconciliar", {
        plano: p.id, ciclo: Number(atual.cycle_number), intent: atual.id,
        estado: rec.estado, porque: decisao.porque,
        why: "a ordem pode ter executado. Avancar o ciclo agora arriscaria comprar duas vezes.",
      });
      return { plano: p.id, acao: "em_duvida", detalhe: decisao.porque };
    }
    if (decisao.acao === "quarentena") {
      await avisar("intent do DCA em QUARENTENA — mao humana", {
        plano: p.id, ciclo: Number(atual.cycle_number), intent: atual.id, porque: decisao.porque,
      });
      return { plano: p.id, acao: "quarentena", detalhe: decisao.porque };
    }

    /**
     * ⚠️ O CICLO FECHA COM O QUE O LIVRO TEM, não com o que foi pedido. É o
     * achado A81 no caminho do DCA: `filled` ausente não vira "comprou tudo".
     *
     * ⚠️⚠️ E A TAXA TAMBÉM VEM DO LIVRO RELIDO (A119): `decidirPeloIntent` não
     * devolve fee — o único caminho da taxa até o ciclo é `atual.fee_total`,
     * lido DEPOIS da reconciliação. A fotografia velha (`vivo`) pré-datada
     * gravaria taxa 0/null sobre um fill que já tinha taxa na corretora.
     */
    const ciclo = Number(atual.cycle_number);
    const fechou = await fecharCiclo(p.id, ciclo, {
      status: decisao.status, motivo: decisao.motivo ?? undefined,
      orderId: decisao.orderId ?? undefined,
      preco: decisao.precoMedio ?? undefined,
      quantidade: decisao.quantidade || undefined,
      custoUsd: decisao.custoUsd || undefined,
      simulado: atual.simulated,
      taxaUsd: atual.simulated ? null : atual.fee_total,
    });
    if (!fechou) {
      await avisar("intent resolvido e ciclo NAO fechado — reconciliar a mao", {
        plano: p.id, ciclo, intent: vivo.id,
      });
    }
    const feitosAgora = p.ciclos_feitos + (decisao.contaComoFeito ? 1 : 0);
    const puladosAgora = p.ciclos_pulados + (decisao.contaComoFeito ? 0 : 1);
    const gastoAgora = Number(p.gasto_acumulado_usd) + decisao.custoUsd;
    const acabouAgora = feitosAgora + puladosAgora >= p.ciclos_total;
    if (!await avancarPlano(p.id, {
      ciclosFeitos: feitosAgora, ciclosPulados: puladosAgora,
      gastoAcumulado: gastoAgora, nextRunAt: new Date(Date.now() + 60_000).toISOString(),
      ...(acabouAgora ? { status: "completo" as const, encerradoPor: "completo" } : {}),
    })) {
      await avisar("intent resolvido e plano NAO avancou — congela ate mao humana", {
        plano: p.id, ciclo, intent: vivo.id,
      });
    }
    return { plano: p.id, acao: decisao.contaComoFeito ? "reconciliado_comprou" : "reconciliado_sem_compra",
      detalhe: `${decisao.quantidade} por $${decisao.custoUsd.toFixed(2)}` };
  }

  /**
   * ⚠️⚠️ A127 — RETIRED pode resolver a dúvida histórica acima, mas NÃO pode
   * iniciar ciclo novo. Só chegamos aqui quando não há intent vivo pendente.
   * Substituída não é revogada: o plano fica vivo, aguardando reconexão/rebind
   * explícito, e não herda automaticamente outra conexão CURRENT.
   */
  if (!simulado && conexao && conexao.is_active && !conexao.is_current) {
    return { plano: p.id, acao: "adiado",
      detalhe: "conexao_substituida — requer_reconexao" };
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
    /**
     * ⚠️⚠️ AGORA QUEM EXECUTA É O EXECUTOR AUTORITATIVO — achado A107.
     *
     * O intent é gravado ANTES do envio, o kill-switch é conferido no limiar
     * (A106 — este cron NUNCA consultava `disable_cex`), e um timeout vira
     * DÚVIDA em vez de "falhou" (A104).
     *
     * ⚠️ O SIMULADO PERCORRE O MESMO CAMINHO. É a única linha que muda lá
     * dentro, e é o que faz o teste sem dinheiro valer.
     */
    const exec = await executarOrdemCex(
      { db: dbExec },
      { origin: "dca_cron", autonomous: true, walletAddress: p.wallet_address,
        planId: p.id, cycleNumber: d.ciclo, conexaoId: p.conexao_id },
      { exchangeId: p.exchange_id as CexId, symbol: p.symbol, side: "buy",
        type: "market", qty: quantidade, notionalUsd: teto.valorUsd,
        simulated: simulado, precoDeReferencia: ref },
      simulado ? null : decifrarConexao(conexao!),
    );

    /**
     * ⚠️⚠️ ACHADO A104, NO PONTO EXATO. Dúvida NÃO fecha o ciclo e NÃO avança o
     * plano. O ciclo fica reservado e o intent fica em UNKNOWN; a passada
     * seguinte reconcilia ANTES de qualquer coisa (ver o topo desta função).
     */
    if (exec.desfecho === "incerto") {
      await avisar("ordem do DCA INCERTA — pode ter executado; plano NAO avanca", {
        plano: p.id, ciclo: d.ciclo, intent: exec.intentId, porque: exec.porque,
        why: "marcar como falhou e avancar arriscaria comprar de novo o que ja foi comprado.",
      });
      return { plano: p.id, acao: "em_duvida", detalhe: exec.porque.slice(0, 120) };
    }

    if (exec.desfecho === "recusado") {
      /**
       * ⚠️ RECUSA PROVADA: nada saiu. O ciclo conta como consumido — senão o
       * plano congela recalculando o mesmo número para sempre (cicatriz 26/08).
       */
      if (!await fecharCiclo(p.id, d.ciclo, { status: "falhou", motivo: exec.porque.slice(0, 200), simulado })) {
        await avisar("ordem recusada e ciclo nao marcado — fica preso em reservado", {
          plano: p.id, ciclo: d.ciclo, erro: exec.porque.slice(0, 160),
        });
      }
      if (!await avancarPlano(p.id, { ciclosPulados: pulados + 1, nextRunAt: d.proximoRunAt })) {
        await avisar("ordem recusada e plano NAO avancou — congela ate mao humana", {
          plano: p.id, ciclo: d.ciclo, erro: exec.porque.slice(0, 160),
        });
      }
      return { plano: p.id, acao: "falhou", detalhe: exec.porque.slice(0, 120) };
    }

    /**
     * ⚠️⚠️ ACHADO A81. Os números vêm do LIVRO (`exec.filledQty`), não do
     * pedido. O código antigo fazia `Number(order.filled) > 0 ? ... : quantidade`
     * — `filled` ausente virava "comprou tudo", e o plano gastava orçamento
     * sobre uma compra que podia não ter acontecido.
     */
    if (exec.filledQty <= 0) {
      // ACK sem preenchimento: a ordem está viva na corretora. Não fecha nada.
      await avisar("ordem do DCA aceita e AINDA SEM preenchimento — plano NAO avanca", {
        plano: p.id, ciclo: d.ciclo, intent: exec.intentId, estado: exec.state,
      });
      return { plano: p.id, acao: "em_duvida", detalhe: "aceita sem fill" };
    }
    const order = { id: exec.externalOrderId ?? exec.intentId };
    const qtd   = exec.filledQty;
    const custo = exec.filledQuote > 0 ? exec.filledQuote : ref * qtd;
    const preco = custo / qtd;

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
    /**
     * ⚠️ A TAXA VEM DO LIVRO, não de um objeto de ordem que já não existe. O
     * executor ingere `fee`/`fee_currency` junto do fill, e `taxaEmUsd`
     * continua sendo a única conta que sabe converter — inclusive o caso da
     * taxa cobrada na moeda BASE, que não precisa de consulta de preço.
     */
    const t = simulado
      ? { usd: null as number | null, naoPrecificada: null }
      : taxaEmUsd(
          { fee: exec.feeTotal != null && exec.feeCurrency
              ? { cost: exec.feeTotal, currency: exec.feeCurrency } : undefined } as CexOrder,
          custo, qtd, p.symbol);
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
    /**
     * ⚠⚠ O CICLO QUE FALHOU TEM DE CONTAR — SENÃO O PLANO CONGELA PARA SEMPRE.
     *
     * O comentário que estava aqui dizia a coisa certa e o código não a fazia:
     * *"Falhou é um estado final, e conta como ciclo gasto"* — só que **nada
     * incrementava**. `decidirCiclo` deriva o número do ciclo de
     * `ciclosFeitos + ciclosPulados + 1` (`relogio.ts:148`), e a falha não
     * mexia em nenhum dos dois.
     *
     * A passada seguinte recalculava o MESMO número, batia na trava `unique` do
     * `reservarCiclo`, saía em `ja_reservado` — e assim a cada 5 minutos, para
     * sempre. Uma única ordem recusada pela corretora matava o plano de
     * poupança inteiro, em silêncio, e o dono via "1 de 12" congelado sem uma
     * linha dizendo por quê. É exatamente o desfecho que o caminho de SUCESSO
     * logo acima descreve por escrito e se protege de ter.
     *
     * ⚠️ E NÃO SE REPETE O NÚMERO, DE PROPÓSITO: uma ordem a mercado que estourou
     * por timeout pode ter sido aceita pela corretora. Repetir arrisca comprar
     * DUAS vezes; consumir o ciclo e seguir arrisca comprar uma vez a menos.
     * Só um dos dois devolve dinheiro ao dono.
     *
     * `ciclos_pulados` passa a significar "ciclos consumidos sem compra" — pulo
     * de janela e ordem falha. O extrato continua distinguindo os dois por
     * ciclo (`pulado` vs `falhou`, com o motivo), e o rótulo da tela foi
     * corrigido junto: dizer "pulados" para uma ordem que falhou seria a mesma
     * mentira de contador que `encerrado` vs `completo` já custou a esta casa.
     */
    if (!await fecharCiclo(p.id, d.ciclo, { status: "falhou", motivo: msg, simulado })) {
      await avisar("ordem FALHOU e o ciclo nao foi marcado — ele fica preso em reservado", {
        plano: p.id, ciclo: d.ciclo, erro: msg.slice(0, 160),
      });
    }
    if (!await avancarPlano(p.id, { ciclosPulados: pulados + 1, nextRunAt: d.proximoRunAt })) {
      await avisar("ordem FALHOU e o plano NAO avancou — o plano congela ate mao humana", {
        plano: p.id, ciclo: d.ciclo, erro: msg.slice(0, 160),
        why: "ciclos_pulados e next_run_at ficaram para tras. A proxima passada recalcula "
          + "o mesmo ciclo e sai em ja_reservado, a cada 5 minutos, para sempre.",
      });
    }
    return { plano: p.id, acao: "falhou", detalhe: msg.slice(0, 120) };
  }
}
