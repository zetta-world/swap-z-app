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
  | "pause_zion"
  | "pause_urdr";

export const FLYWHEEL_GATE_KEYS: FlywheelGateKey[] = [
  "pause_backtest", "pause_agent_a", "pause_agent_b", "pause_tournament",
  "pause_paper", "pause_radar", "pause_sniper", "pause_arbiter",
  "pause_oracle", "pause_arbiter2",
  "pause_ragnarok", "pause_ragnarok_ai", "pause_ragnarok_dex", "pause_ullr",
  "pause_zion", "pause_urdr",
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
 * `false` significa "fechar este gate não é a ferramenta certa para cortar
 * custo". Nas mesas mecânicas porque não há custo nenhum a cortar — e desligar
 * calaria o GRUPO DE CONTROLE que dá sentido à comparação com as mesas de IA,
 * fazendo o experimento perder o eixo justo exatamente quando o dinheiro
 * aperta, que é quando ele mais importa.
 *
 * ⚠ CORREÇÃO 01/08 (mesmo dia) — `pause_backtest` ESTAVA `true` E ISSO ESTAVA
 * ERRADO.
 *
 * Ele é o master das varreduras, então "gasta token" parecia óbvio. Mas ele
 * envolve o tick INTEIRO: dentro dele rodam VÖLUNDR, SKAÐI, FREYJA e ULLR, que
 * são justamente as mesas mecânicas. Fechá-lo num corte de custo derrubaria o
 * grupo de controle junto — exatamente o que o parágrafo acima proíbe. Eu
 * escrevi a regra e violei na linha seguinte.
 *
 * E não custava nada em economia: TODO caminho que gasta token dentro daquele
 * cron já tem gate próprio — `pause_agent_a`, `pause_agent_b`,
 * `pause_tournament`, `pause_oracle`, `pause_ragnarok_ai`. Fechar esses corta o
 * gasto por inteiro e deixa as mesas mecânicas trabalhando.
 *
 * Continua desligável À MÃO pelo painel quando o operador quiser parar tudo. O
 * que ele não é: ferramenta de corte AUTOMÁTICO de custo.
 */
export const GATE_SPENDS_TOKENS: Record<FlywheelGateKey, boolean> = {
  pause_backtest:     false,  // master do tick — fechá-lo levaria o CONTROLE junto
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
  pause_urdr:         false,  // URÐR — obedece ao histórico medido, zero LLM
};

/** Os gates que o disjuntor de custo deve fechar. Derivado, nunca digitado. */
export const TOKEN_SPENDING_GATES: FlywheelGateKey[] =
  FLYWHEEL_GATE_KEYS.filter((k) => GATE_SPENDS_TOKENS[k]);
