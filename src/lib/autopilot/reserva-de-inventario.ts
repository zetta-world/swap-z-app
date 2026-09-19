/**
 * ⚠️⚠️⚠️ CONFERIR NÃO É RESERVAR — achados A134 e A135.
 *
 * O Round 9 trouxe posse e exposição para o servidor, e parou aí: ler,
 * conferir, e só depois agir. Isso é READ-THEN-ACT, e duas requisições
 * simultâneas leem o MESMO estado:
 *
 *     posição do bot = 0,01 · duas vendas de 0,01 → saem 0,02
 *                                                   e 0,01 é do dono
 *     exposição 190, teto 200 · duas compras de 10 → 210 > 200
 *
 * ⚠️ E O TETO DIÁRIO NÃO RESOLVE. Ele é atômico desde o A132, mas responde
 * outra pergunta: "quantas ordens ainda cabem hoje". Havendo duas vagas, as
 * duas ordens passam por ele e se atropelam no inventário.
 *
 * ⚠️ LOCK EM MEMÓRIA NÃO SERVE. Cada invocação serverless é outro processo, e
 * o navegador e o cron nem rodam na mesma máquina. A reserva é tomada DENTRO
 * da transação que a confere, com `for update` na linha (migration 0064).
 *
 * ⚠️ E ELA EXPIRA. A reserva cobre o intervalo entre autorizar e a ordem
 * EXISTIR. Depois disso quem descreve a realidade é o intent — e, na venda, o
 * `exit_armed`. Uma reserva eterna de uma ordem que ficou UNKNOWN e nunca
 * executou trancaria a posição para sempre.
 */

import { getSupabaseAdmin } from "@/lib/supabase/server";

export type MotivoDaRecusaDeReserva =
  | "sem_posicao" | "saida_ja_armada" | "quantidade_ja_reservada"
  | "quantidade_invalida" | "teto_estourado" | "nocional_nao_mensuravel"
  | "teto_invalido" | "sessao_inexistente" | "erro";

export type ReservaDeVenda =
  | { ok: true; qtd: number; limitada: boolean; naPosicao: number }
  | { ok: false; motivo: MotivoDaRecusaDeReserva; porque: string };

export type ReservaDeExposicao =
  | { ok: true; exposicaoUsd: number; reservadoUsd: number; tetoUsd: number }
  | { ok: false; motivo: MotivoDaRecusaDeReserva; porque: string };

export interface DependenciasDaReservaDeInventario {
  chamarRpc?: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
}

async function rpc(
  nome: string, args: Record<string, unknown>, deps: DependenciasDaReservaDeInventario,
): Promise<Record<string, unknown> | { __erro: string }> {
  try {
    if (deps.chamarRpc) {
      return (await deps.chamarRpc(nome, args) ?? {}) as Record<string, unknown>;
    }
    const db = getSupabaseAdmin();
    if (!db) return { __erro: "supabase nao configurado" };
    const { data, error } = await db.rpc(
      nome as "autopilot_reservar_venda", args as never) as
      { data: unknown; error: { message: string } | null };
    // ⚠️ O cliente RESOLVE com `{ error }` — não lança. Sem esta linha, falha
    // de banco passaria por reserva concedida.
    if (error) return { __erro: error.message.slice(0, 200) };
    return ((data ?? {}) as Record<string, unknown>);
  } catch (e) {
    return { __erro: ((e as Error)?.message ?? String(e)).slice(0, 200) };
  }
}

const motivoDe = (r: Record<string, unknown>): MotivoDaRecusaDeReserva =>
  (typeof r.motivo === "string" ? r.motivo : "erro") as MotivoDaRecusaDeReserva;

/**
 * Reserva, atomicamente, a quantidade que esta venda autônoma pode mandar.
 *
 * ⚠️ ELA LIMITA EM VEZ DE RECUSAR quando o pedido passa do que o bot tem — a
 * mesma conduta do A131 (`quantoPodeVender`), agora dentro da transação que
 * também impede a segunda venda concorrente.
 */
export async function reservarVendaDoBot(
  sessionId: string, base: string, pedido: number,
  deps: DependenciasDaReservaDeInventario = {},
): Promise<ReservaDeVenda> {
  const r = await rpc("autopilot_reservar_venda",
    { p_session_id: sessionId, p_base: base, p_qty: pedido }, deps);
  if ("__erro" in r) {
    return { ok: false, motivo: "erro",
      porque: `nao deu para reservar a posicao: ${r.__erro} — sem reserva, `
        + "nenhuma venda autonoma sai" };
  }
  if (r.ok !== true) {
    const motivo = motivoDe(r);
    return { ok: false, motivo, porque: porqueDaVenda(motivo, r) };
  }
  return { ok: true, qtd: Number(r.qtd), limitada: r.limitada === true,
    naPosicao: Number(r.na_posicao) };
}

function porqueDaVenda(motivo: MotivoDaRecusaDeReserva, r: Record<string, unknown>): string {
  switch (motivo) {
    case "sem_posicao":
      return "o bot nao tem posicao aberta nesta moeda — o saldo da conta e do "
        + "usuario, e vende-lo nao esta no mandato do autopilot";
    case "saida_ja_armada":
      return `ja existe uma ordem de saida viva (${String(r.ordem_armada ?? "?")}) — `
        + "uma segunda venda despejaria a mesma bolsa duas vezes";
    case "quantidade_ja_reservada":
      return `a posicao inteira ja esta prometida a outra venda em voo `
        + `(${String(r.reservado ?? "?")} de ${String(r.na_posicao ?? "?")})`;
    default:
      return `reserva de venda recusada: ${motivo}`;
  }
}

/** Devolve a quantidade reservada. ⚠️ SÓ na recusa PROVADA — nunca em UNKNOWN. */
export async function liberarVendaDoBot(
  sessionId: string, base: string, qtd: number,
  deps: DependenciasDaReservaDeInventario = {},
): Promise<void> {
  if (!(qtd > 0)) return;
  await rpc("autopilot_liberar_venda",
    { p_session_id: sessionId, p_base: base, p_qty: qtd }, deps);
}

/**
 * Reserva, atomicamente, o capital desta entrada contra o teto de exposição.
 *
 * ⚠️ A EXPOSIÇÃO REAL É SOMADA DENTRO DA TRANSAÇÃO, junto do que já está
 * prometido. Duas compras concorrentes disputam o lock da linha da sessão, e a
 * segunda lê a reserva da primeira.
 */
export async function reservarExposicaoDoBot(
  sessionId: string, entradaUsd: number, tetoUsd: number,
  deps: DependenciasDaReservaDeInventario = {},
): Promise<ReservaDeExposicao> {
  const r = await rpc("autopilot_reservar_exposicao",
    { p_session_id: sessionId, p_usd: entradaUsd, p_teto: tetoUsd }, deps);
  if ("__erro" in r) {
    return { ok: false, motivo: "erro",
      porque: `nao deu para reservar exposicao: ${r.__erro} — exposicao `
        + "desconhecida nao autoriza entrada nova" };
  }
  if (r.ok !== true) {
    const motivo = motivoDe(r);
    return { ok: false, motivo,
      porque: motivo === "teto_estourado"
        ? `exposicao ${String(r.exposicao ?? "?")} + reservado `
          + `${String(r.reservado ?? "?")} + entrada ${entradaUsd} passa do teto `
          + `${String(r.teto ?? tetoUsd)} do modo de risco desta sessao`
        : `reserva de exposicao recusada: ${motivo}` };
  }
  return { ok: true, exposicaoUsd: Number(r.exposicao),
    reservadoUsd: Number(r.reservado), tetoUsd: Number(r.teto) };
}

/** Devolve o capital reservado. ⚠️ SÓ na recusa PROVADA. */
export async function liberarExposicaoDoBot(
  sessionId: string, usd: number, deps: DependenciasDaReservaDeInventario = {},
): Promise<void> {
  if (!(usd > 0)) return;
  await rpc("autopilot_liberar_exposicao", { p_session_id: sessionId, p_usd: usd }, deps);
}
