/**
 * As CHAVES dos gates do flywheel, e a classificação de quem gasta token.
 *
 * POR QUE ESTE ARQUIVO É SEPARADO DE `gates.ts` (auditoria 01/08):
 *
 * `gates.ts` importa o cliente Supabase de servidor, então nada marcado
 * `"use client"` pode importá-lo. O painel de admin, que é client, era obrigado
 * a REDIGITAR a lista de gates — e redigitou errado três vezes:
 *
 *   1. `pause_oracle` e `pause_arbiter2` existiam no cron mas não apareciam no
 *      painel: mesas que só se apagavam por deploy.
 *   2. O disjuntor de custo pausava só `pause_tournament`, uma chave que já
 *      estava desligada — disparava sem cortar gasto nenhum (30/07).
 *   3. Mesmo depois do conserto, faltavam `pause_agent_a`, `pause_radar` e
 *      `pause_sniper` na lista de corte (01/08).
 *
 * Três bugs, uma causa: a mesma verdade escrita em lugares diferentes. Aqui não
 * há import de servidor, então servidor E cliente derivam da MESMA fonte.
 *
 * Os comentários de cada gate (o que a mesa faz, e por que tem gate próprio)
 * seguem em `gates.ts`, junto do leitor que os consome.
 */

export type FlywheelGateKey =
  | "pause_backtest" | "pause_agent_a" | "pause_agent_b" | "pause_tournament"
  | "pause_paper" | "pause_radar" | "pause_sniper" | "pause_arbiter"
  | "pause_oracle" | "pause_arbiter2"
  | "pause_ragnarok" | "pause_ragnarok_ai" | "pause_ragnarok_dex" | "pause_ullr"
  | "pause_zion";

export const FLYWHEEL_GATE_KEYS: FlywheelGateKey[] = [
  "pause_backtest", "pause_agent_a", "pause_agent_b", "pause_tournament",
  "pause_paper", "pause_radar", "pause_sniper", "pause_arbiter",
  "pause_oracle", "pause_arbiter2",
  "pause_ragnarok", "pause_ragnarok_ai", "pause_ragnarok_dex", "pause_ullr",
  "pause_zion",
];

/**
 * Este gate corta gasto de TOKEN quando fechado?
 *
 * O disjuntor de custo de IA mantinha a lista de quem desligar escrita à mão
 * dentro do watchdog. Toda mesa nova nascia fora dela — e ninguém percebia,
 * porque o disjuntor continuava disparando, mandando o alerta e cortando os
 * gates antigos. Um disjuntor que dispara e não corta o gasto é PIOR que não
 * ter disjuntor: ele produz o registro de que agiu.
 *
 * Agora a classificação mora ao lado da definição do gate e o watchdog deriva a
 * lista. Gate novo sem entrada aqui não compila (o `Record` é total), e
 * `gates.test.ts` cobra a classificação explícita.
 *
 * `false` significa "mesa mecânica / dado público": desligá-la num corte de
 * custo não economizaria nada e ainda calaria o GRUPO DE CONTROLE que dá
 * sentido à comparação com as mesas de IA — o experimento perderia o eixo justo
 * exatamente quando o dinheiro aperta, que é quando ele mais importa.
 */
export const GATE_SPENDS_TOKENS: Record<FlywheelGateKey, boolean> = {
  pause_backtest:     true,   // master das varreduras
  pause_agent_a:      true,   // ZION self_scan
  pause_agent_b:      true,   // Ferrari híbrido
  pause_tournament:   true,   // stack multi-provedor
  pause_radar:        true,   // brain-wake do radar
  pause_sniper:       true,   // SNIPER
  pause_oracle:       true,   // VÖLVA
  pause_ragnarok_ai:  true,   // MÍMIR
  pause_zion:         true,   // o /api/zion do usuário — o maior de todos
  pause_paper:        false,  // preço público, zero LLM
  pause_arbiter:      false,  // detector de spread, zero LLM
  pause_arbiter2:     false,  // spot+perp hedgeado, zero LLM
  pause_ragnarok:     false,  // VÖLUNDR — seletor mecânico
  pause_ragnarok_dex: false,  // FREYJA — mesmo seletor mecânico, praça DEX
  pause_ullr:         false,  // ULLR — regra de idade/liquidez/fluxo, sem LLM
};

/** Os gates que o disjuntor de custo deve fechar. Derivado, nunca digitado. */
export const TOKEN_SPENDING_GATES: FlywheelGateKey[] =
  FLYWHEEL_GATE_KEYS.filter((k) => GATE_SPENDS_TOKENS[k]);
