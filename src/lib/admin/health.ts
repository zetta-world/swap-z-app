import { getSupabaseAdmin } from "@/lib/supabase/server";
import { aiAtivo } from "@/lib/ai/ativo";

/**
 * Cron heartbeat (System Health / Phase 1). Each cron stamps a heartbeat every
 * run REGARDLESS of whether it did work, so the health panel can tell "the
 * cron is alive" even when there are zero sessions/suggestions. GitHub Actions
 * schedules are flaky, so a stale heartbeat is the early-warning signal that a
 * cron stopped firing. Best-effort, never throws.
 */
export async function setCronHeartbeat(name: string): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  const nowIso = new Date().toISOString();
  try {
    await db.from("admin_kv").upsert(
      { key: `cron:${name}:last`, value: nowIso, updated_at: nowIso },
      { onConflict: "key" },
    );
  } catch { /* heartbeat must never break the cron */ }
}

/**
 * Real Anthropic reachability + key check. Hits the public /v1/models endpoint
 * — authenticated but ZERO inference cost — so "Anthropic up" reflects the
 * actual API, not the old proxy of "did a ZION analysis run in the last 2h"
 * (which went falsely DOWN whenever the crons simply hadn't fired). Returns
 * ok:false with a note when the key is absent so callers can degrade clearly.
 */
export async function pingAnthropic(): Promise<{ ok: boolean; latencyMs: number | null; note?: string }> {
  /**
   * ⚠️ O NOME FICA, O ALVO SEGUE O `AI_PROVIDER` (22/08). Um monitor apontado
   * para um provedor fixo reportaria "tudo bem" enquanto o que a plataforma USA
   * estivesse fora do ar — e monitor apontado para o serviço errado é pior que
   * monitor nenhum: produz o registro de que alguém olhou.
   *
   * O nome permanece porque é a chave que o painel de saúde já espera; renomear
   * mexeria na tela por causa de uma troca de provedor.
   */
  const ativo = aiAtivo();
  if (!ativo.apiKey) {
    return { ok: false, latencyMs: null, note: `sem ${ativo.nomeDaChave} neste ambiente` };
  }
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = ativo.provedor === "anthropic"
      ? await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": ativo.apiKey, "anthropic-version": "2023-06-01" },
          signal: ctrl.signal, cache: "no-store",
        })
      : await fetch(`${ativo.baseUrl.replace(/\/+$/, "")}/models`, {
          headers: { Authorization: `Bearer ${ativo.apiKey}` },
          signal: ctrl.signal, cache: "no-store",
        });
    // 401/403 = problema de chave (alcançável mas quebrado) → reporta fora, com nota.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, latencyMs: Date.now() - start, note: `auth recusada — confira ${ativo.nomeDaChave}` };
    }
    return { ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { ok: false, latencyMs: null };
  } finally {
    clearTimeout(t);
  }
}

export interface DepPing { name: string; ok: boolean; latencyMs: number | null; note?: string }

/** Ping one OpenAI-compatible provider's /models endpoint (auth'd, ~free). */
async function pingOpenAICompat(label: string, baseUrl: string, apiKey: string): Promise<DepPing> {
  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: ctrl.signal, cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      // 401/403 is AMBIGUOUS: xAI (and some others) return 403 when the team
      // simply has NO CREDITS, with the reason in the body. Blindly saying
      // "check key" sent the operator hunting a key problem that was actually
      // a billing problem. Read the body and classify before labelling.
      const body = (await res.text().catch(() => "")).slice(0, 300);
      const noCredit = /credit|billing|balance|insufficient|quota|payment/i.test(body);
      const note = noCredit
        ? `no credits / billing (${res.status}) — top up the provider console`
        : `auth rejected (${res.status}) — check key${body ? `: ${body.slice(0, 120)}` : ""}`;
      return { name: label, ok: false, latencyMs: Date.now() - start, note };
    }
    return { name: label, ok: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { name: label, ok: false, latencyMs: null };
  } finally {
    clearTimeout(t);
  }
}

/** Health radar for every CONFIGURED AI provider (registry) — so the Ferrari's
 *  whole model stack is monitored, not just Anthropic. Providers without a key
 *  are skipped (not shown as down). Runs in parallel. */
export async function pingAiProviders(): Promise<DepPing[]> {
  const { configuredProviders } = await import("@/lib/ai/registry");
  const providers = configuredProviders();
  return Promise.all(providers.map((p) => pingOpenAICompat(p.label, p.baseUrl, p.apiKey!)));
}

/** Read the last-seen timestamps for the known crons. */
export async function getCronHeartbeats(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = { autopilot: null, backtest: null, radar: null };
  const db = getSupabaseAdmin();
  if (!db) return out;
  try {
    const { data } = await db.from("admin_kv").select("key, value").like("key", "cron:%");
    for (const r of data ?? []) {
      const m = /^cron:(.+):last$/.exec(r.key);
      if (m) out[m[1]] = r.value;
    }
  } catch { /* ignore */ }
  return out;
}
