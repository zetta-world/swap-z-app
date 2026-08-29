/**
 * Per-provider circuit breaker (P2.11). A model whose key is broken or whose
 * endpoint is down (the exact Grok/Kimi "auth rejected" the CEO saw) shouldn't
 * be hammered every tick — it just wastes latency and floods alerts. After N
 * consecutive failures a provider is TRIPPED and skipped for a cooldown, then
 * given one probe again. A single success resets it.
 *
 * State lives in admin_kv (key `cb:<providerId>`) so it survives across
 * serverless invocations. Best-effort: any DB hiccup fails OPEN (treats the
 * provider as usable) so the breaker can never itself take the flywheel down.
 */
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { notifyTelegram } from "@/lib/admin/track";

const THRESHOLD   = Number(process.env.AI_CB_THRESHOLD ?? 3);              // consecutive fails to trip
const COOLDOWN_MS = Number(process.env.AI_CB_COOLDOWN_MIN ?? 60) * 60_000; // skip window once tripped

/**
 * ⚠️ ESPERA MAIOR PARA CAUSA QUE NÃO PASSA SOZINHA (29/08).
 *
 * Sessenta minutos são desenhados para instabilidade: sonda, passa, reseta. Numa
 * causa PERMANENTE o ciclo vira infinito — trip → 60min → sonda → mesmo 403 →
 * trip — e o dono recebe o mesmo alerta de hora em hora, para sempre. Foi o que
 * a Mistral fez em 29/08.
 *
 * ⚠️ MAS CONTINUA SONDANDO. Parar de vez exigiria alguém lembrar de rearmar, e
 * um provedor que fica morto até intervenção manual é a morte silenciosa que o
 * cabeçalho deste arquivo promete não causar. Seis horas dão folga sem abrir mão
 * do conserto automático: mexeu no plano, o próximo teste passa e reseta.
 */
const COOLDOWN_PERMANENTE_MS =
  Number(process.env.AI_CB_COOLDOWN_PERMANENTE_MIN ?? 360) * 60_000;

/** ⚠️ `causa` é o que evita repetir o MESMO alerta. Ausente em estado antigo —
 *  o `read` trata como indefinida, e o primeiro trip volta a avisar. */
interface CBState { fails: number; trippedUntil: number | null; causa?: ClasseFalha }

/**
 * A classe da falha — e ela existe porque a AÇÃO e a ESPERA dependem dela.
 *
 * `plano`, `modelo` e `auth` são PERMANENTES: esperar não conserta, e sondar de
 * hora em hora só gera alerta repetido. `cota` e `upstream` passam sozinhos.
 */
export type ClasseFalha =
  | "sem_detalhe" | "plano" | "modelo" | "auth" | "cota" | "upstream" | "desconhecida";

/** Falhas que NÃO se resolvem com o tempo — alguém tem de mexer em algo. */
export const CLASSES_PERMANENTES: ReadonlySet<ClasseFalha> =
  new Set<ClasseFalha>(["plano", "modelo", "auth"]);

/**
 * Classifica o erro do upstream.
 *
 * ⚠️⚠️ O TERCEIRO CASO EXISTE PORQUE O SEGUNDO NÃO BASTOU (29/08).
 *
 * O ramo de MODELO nasceu em 25/07: o "conserte a chave" genérico mandou o dono
 * caçar problema de credencial quando a DeepSeek tinha apenas APOSENTADO o nome
 * do modelo. Ele procura `not found`, `not supported`, `invalid`, `deprecated`,
 * `retired`.
 *
 * Em 29/08 a Mistral respondeu:
 *
 *     403 · "This model is not available in your subscription tier"
 *     type: tier_not_allowed · code: 1910
 *
 * **"not available" não está na lista** — a mesma cicatriz a um sinônimo de
 * distância. A linha caiu no ramo de AUTH (por causa do 403) e o alerta mandou
 * "gere outra chave no provedor", que não conserta nada: a chave é aceita, o
 * que é recusado é o MODELO, por direito de plano.
 *
 * É um caso distinto dos dois anteriores. Não é credencial e não é nome morto:
 * o modelo existe e a chave vale — o plano é que não o inclui. A ação também é
 * outra: trocar por um modelo do tier, ou subir o plano.
 *
 * ⚠️ E O PADRÃO PEDE DUAS CONDIÇÕES, NÃO UMA PALAVRA. Casar só `unavailable`
 * engoliria `503 service unavailable`, que é instabilidade passageira e tem
 * ação oposta (esperar). Por isso exige um termo de PLANO *e* um de RECUSA.
 */
export function classificarFalha(reason?: string): ClasseFalha {
  const r = (reason ?? "").toLowerCase();
  if (!r) return "sem_detalhe";

  const fala_de_plano = /\btier\b|subscription|\bplano?\b|assinatura|entitle/.test(r);
  const fala_de_recusa = /not (allowed|available|included|enabled)|upgrade|não (permitid|disponív)/.test(r);
  if (/tier[_ ]?not[_ ]?allowed/.test(r) || (fala_de_plano && fala_de_recusa)) return "plano";

  if (/model|modelo/.test(r) && /(not (found|supported)|invalid|unsupported|supported api model|deprecat|retir)/.test(r)) {
    return "modelo";
  }
  if (/\b(401|403)\b|unauthorized|forbidden|invalid api key|authentication/.test(r)) return "auth";
  if (/\b429\b|rate limit|quota|insufficient|balance|credit/.test(r)) return "cota";
  if (/\b(5\d{2})\b|timeout|timed out|abort|econnreset|fetch failed/.test(r)) return "upstream";
  return "desconhecida";
}

const ACAO: Record<ClasseFalha, string> = {
  sem_detalhe:   "Sem detalhe do upstream — ver Logs no painel.",
  plano:         "PLANO → o modelo não está na sua assinatura. Troque <PROVEDOR>_MODEL "
               + "na Vercel por um do seu tier, ou suba o plano. NÃO é a chave.",
  modelo:        "MODELO INVÁLIDO/APOSENTADO → troque <PROVEDOR>_MODEL na Vercel (sem deploy). Não é a chave.",
  auth:          "AUTH → chave inválida/revogada. Gere outra no provedor.",
  cota:          "COTA/CRÉDITO → sem saldo ou rate limit. Recarregue ou baixe a frequência.",
  upstream:      "UPSTREAM instável/lento → costuma passar sozinho; se persistir, troque o modelo por um mais rápido.",
  desconhecida:  "Causa não classificada — ver Logs no painel.",
};

/** A AÇÃO que o operador tem de tomar, em uma frase. */
export function diagnoseFailure(reason?: string): string {
  return ACAO[classificarFalha(reason)];
}

function keyFor(id: string): string { return `cb:${id}`; }

async function read(id: string): Promise<CBState> {
  const db = getSupabaseAdmin();
  if (!db) return { fails: 0, trippedUntil: null };
  try {
    const { data } = await db.from("admin_kv").select("value").eq("key", keyFor(id)).maybeSingle();
    if (data?.value) {
      const s = JSON.parse(data.value) as Partial<CBState>;
      return { fails: Number(s.fails) || 0, trippedUntil: s.trippedUntil ?? null, causa: s.causa };
    }
  } catch { /* fail open */ }
  return { fails: 0, trippedUntil: null };
}

async function write(id: string, state: CBState): Promise<void> {
  const db = getSupabaseAdmin();
  if (!db) return;
  try {
    await db.from("admin_kv").upsert(
      { key: keyFor(id), value: JSON.stringify(state), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  } catch { /* best-effort */ }
}

/** True while the provider is in its cooldown window — callers should skip it. */
export async function isTripped(id: string): Promise<boolean> {
  const s = await read(id);
  return s.trippedUntil != null && Date.now() < s.trippedUntil;
}

/** Record the outcome of one call. Success resets; the Nth consecutive failure
 *  trips the breaker and pages once. `reason` (the upstream error) is appended
 *  to the trip alert so the operator knows WHY — key vs credit vs model. */
export async function recordResult(id: string, label: string, ok: boolean, reason?: string): Promise<void> {
  const s = await read(id);
  if (ok) {
    if (s.fails !== 0 || s.trippedUntil != null) await write(id, { fails: 0, trippedUntil: null });
    return;
  }
  const fails = s.fails + 1;
  const alreadyTripped = s.trippedUntil != null && Date.now() < s.trippedUntil;
  if (fails >= THRESHOLD && !alreadyTripped) {
    const causa = classificarFalha(reason);
    const permanente = CLASSES_PERMANENTES.has(causa);
    const espera = permanente ? COOLDOWN_PERMANENTE_MS : COOLDOWN_MS;
    await write(id, { fails, trippedUntil: Date.now() + espera, causa });

    /**
     * ⚠️⚠️ O ALERTA É POR CAUSA, NÃO POR CICLO (29/08).
     *
     * Antes, cada trip mandava mensagem. Numa causa permanente isso é o MESMO
     * alerta a cada janela, indefinidamente — e alerta que se repete sem
     * novidade treina o operador a ignorar, que é a armadilha que este repo já
     * nomeou. A Mistral gerou nove desses em um dia, todos idênticos.
     *
     * ⚠️ E SÓ CALA PARA CAUSA PERMANENTE E IGUAL. Se a classe MUDA — o plano foi
     * resolvido e agora falta crédito — isso é notícia, e avisa. Causa
     * passageira continua avisando sempre: ali a repetição É a informação.
     */
    const repetido = permanente && s.causa === causa;
    if (!repetido) {
      const why = reason ? `\nLast error: ${reason.slice(0, 160)}` : "";
      const nota = permanente
        ? `\n<i>Causa permanente: não avisarei de novo enquanto for a mesma. Sondando a cada ${Math.round(espera / 60_000)}min — some sozinho quando resolver.</i>`
        : "";
      notifyTelegram(`🔌 <b>Circuit breaker</b> — ${label} tripped after ${fails} straight failures. Skipping for ${Math.round(espera / 60_000)}min.\n➡️ ${diagnoseFailure(reason)}${why}${nota}`);
    }
  } else {
    await write(id, { fails, trippedUntil: s.trippedUntil, causa: s.causa });
  }
}
