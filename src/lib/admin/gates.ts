/**
 * Flywheel runtime gates — operator on/off switches for the AI backtest stack,
 * stored in admin_kv (same table as the platform kill-switches) so the CEO can
 * pause spend from the admin panel WITHOUT a redeploy. Read on every backtest
 * cron tick and by the watchdog.
 *
 *   pause_backtest   — master OFF: no scan runs (resolution still closes open
 *                      trades, since it's free and keeps the ledger honest).
 *   pause_agent_a    — skip Agent A (ZION / Sonnet self_scan) only.
 *   pause_agent_b    — skip Agent B (Ferrari hybrid) only.
 *   pause_tournament — skip the per-provider tournament (the direct model stack
 *                      — Mistral/DeepSeek/Kimi/Llama/Grok) only. This is the one
 *                      that spends on the non-Anthropic providers.
 *   pause_paper      — skip the Gate.io paper-trading agent (simulated execution
 *                      of the flywheel's signals). Independent of the scans; it
 *                      spends NO tokens (public price only).
 *   pause_radar      — skip the radar's LLM brain-wake on price triggers (the
 *                      only radar stage that spends tokens). Trigger DETECTION
 *                      and the cron heartbeat keep running — they're free and
 *                      the watchdog would page "cron stalled" otherwise.
 *   pause_sniper     — skip the SNIPER agent (event-driven, budgeted,
 *                      objective-gated — docs/PLANO-AGENTE-SNIPER.md). Rides
 *                      the same radar triggers as its control group.
 *   pause_arbiter    — skip the ARBITER desk (cross-CEX spread detector —
 *                      zero-LLM, paper-booked; docs/PLANO-MESA-AGENTES.md).
 *   pause_oracle     — skip the ORÁCULO thesis desk (daily, context-driven,
 *                      multi-model; docs/PLANO-ORACULO-ANALISTA.md).
 *   pause_arbiter2   — skip the ARBITER 2.0 desk (spot+perp hedged spread
 *                      capture, $300 real-seed sim; docs/PLANO-ARBITER-REAL.md).
 *   pause_ragnarok   — skip the RAGNARÖK desk (VÖLUNDR — seletor mecânico
 *                      long-only, zero-LLM; docs/PLANO-RAGNAROK.md). Gate
 *                      próprio de propósito: é mesa nova operando sozinha, e
 *                      tem que dar pra desligar SEM derrubar o resto do tick.
 *   pause_ragnarok_ai — skip a mesa de IA do Ragnarök (MÍMIR). Gate SEPARADO do
 *                      mecânico: a mesa de IA gasta token, a mecânica não, então
 *                      um corte de custo não pode calar o controle junto.
 *   pause_ragnarok_dex — skip a mesa DEX (FREYJA). Gate próprio: ela depende da
 *                      GeckoTerminal, e uma API de terceiro instável não pode
 *                      obrigar a desligar as mesas de CEX junto.
 *   pause_ullr       — skip o arqueiro (ULLR, lançamentos on-chain). Terreno de
 *                      risco mais alto: gate próprio para poder calar SÓ ele.
 *   pause_urdr       — skip a URÐR, a Norna do passado: mesa MECÂNICA que escolhe
 *                      pelo histórico medido em vez da prioridade declarada. É o
 *                      terceiro braço do duelo — sem ela, "IA com evidência" e
 *                      "regra sem evidência" ficam confundidas numa comparação só.
 *   pause_zion       — desliga o `/api/zion` VOLTADO AO USUÁRIO (auditoria
 *                      01/08). Era o maior gastador de token da plataforma e o
 *                      ÚNICO sem gate: o disjuntor de custo podia pausar as sete
 *                      mesas internas e o gasto continuar correndo pela porta da
 *                      frente. Último recurso — degrada o produto de propósito.
 *
 * Everything defaults to running (all gates false) — a missing/empty admin_kv
 * never accidentally pauses the flywheel.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { FLYWHEEL_GATE_KEYS, type FlywheelGateKey } from "@/lib/admin/gate-keys";

// As chaves e a classificação de gasto moram em `gate-keys.ts` — módulo puro,
// sem import de servidor, para que o painel de admin (client) derive da MESMA
// fonte em vez de redigitar a lista. Ver o cabeçalho de lá: três bugs nasceram
// dessa duplicação. Reexportado aqui para não quebrar quem já importa daqui.
export { FLYWHEEL_GATE_KEYS, GATE_SPENDS_TOKENS, TOKEN_SPENDING_GATES } from "@/lib/admin/gate-keys";
export type { FlywheelGateKey } from "@/lib/admin/gate-keys";

export type FlywheelGates = Record<FlywheelGateKey, boolean>;

export async function getFlywheelGates(): Promise<FlywheelGates> {
  // Derivado, não digitado — mesma razão de `gate-keys.ts`: uma mesa nova cuja
  // chave ficasse de fora deste literal ficaria SEMPRE lida como `undefined`,
  // ou seja, rodando, mesmo com o operador tendo desligado no painel.
  const gates = Object.fromEntries(FLYWHEEL_GATE_KEYS.map((k) => [k, false])) as FlywheelGates;
  const db = getSupabaseAdmin();
  if (!db) return gates;
  try {
    const { data } = await db.from("admin_kv").select("key, value").in("key", FLYWHEEL_GATE_KEYS);
    for (const r of data ?? []) {
      if ((FLYWHEEL_GATE_KEYS as string[]).includes(r.key)) gates[r.key as FlywheelGateKey] = r.value === "true";
    }
  } catch { /* table may not exist yet — all gates stay false (running) */ }
  return gates;
}
