/**
 * CAMADA DE IA DA BANCADA — a IA propõe e interpreta; o CÓDIGO executa.
 *
 * A DIVISÃO DE TRABALHO, E POR QUE ELA É ASSIM:
 *
 * A tentação é dar o volante ao modelo: "seja um pentester, ataque a
 * plataforma". Isso é ruim por três motivos concretos —
 *
 *   1. Disparar requisição não precisa de inteligência. É código
 *      determinístico, e a bancada já faz melhor: rápido, reproduzível, barato.
 *   2. Um modelo no comando executor pode gerar carga DESTRUTIVA contra a
 *      produção. Um "teste" que apaga dado real não é teste.
 *   3. Resultado não-reproduzível não serve de auditoria. Auditar é poder
 *      repetir e obter o mesmo veredito.
 *
 * Onde o modelo ganha do código, e ganha feio:
 *
 *   · GERAR VARIANTES — um humano codifica 4 cargas de XSS; o modelo produz
 *     dezenas, com codificações e contextos que ninguém lembraria de listar.
 *   · INTERPRETAR RESPOSTA — "este JSON de erro revela estrutura interna?" é
 *     julgamento sobre texto, exatamente onde regex é frágil e modelo é forte.
 *
 * Então: o modelo escreve a lista de cargas, o código dispara, o modelo lê o
 * que voltou. Mesmo desenho do MÍMIR — e pela mesma razão: tudo que a IA
 * produz volta por um portão determinístico antes de virar ação.
 *
 * TRAVAS QUE NÃO DEPENDEM DO PROMPT:
 *   · toda carga gerada é SANITIZADA aqui antes de sair (tamanho, caracteres,
 *     e recusa de qualquer coisa com cara de escrita/SQL destrutivo);
 *   · as cargas só entram em querystring de GET — nunca em corpo, nunca em
 *     método que escreve;
 *   · sem modelo configurado, a bancada segue com as cargas fixas. A camada de
 *     IA AMPLIA a cobertura; ela nunca é pré-requisito.
 *
 * Assento: papel `brain` do registry (Mistral por padrão — tier gratuito). Esta
 * tarefa quer volume barato, não o melhor raciocínio do mercado.
 */

import { openaiCompatChat } from "@/lib/ai/provider";
import { roleProvider } from "@/lib/ai/registry";
import { isTripped, recordResult } from "@/lib/ai/circuit";

/** Teto de cargas por rodada — a bancada tem 60s no total. */
const MAX_PAYLOADS = 24;
const MAX_LEN = 120;

/**
 * Sanitiza uma carga proposta pelo modelo.
 *
 * Recusa (em vez de "limpar") qualquer coisa que sugira ESCRITA. Uma carga de
 * reflexão precisa apenas voltar visível; nada aqui tem motivo legítimo para
 * conter DROP, DELETE ou UPDATE. Se o modelo propôs isso, a carga é descartada
 * inteira — sanear parcialmente um payload perigoso é como desarmar metade de
 * uma bomba.
 */
export function sanitizePayload(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const p = raw.trim();
  if (p.length === 0 || p.length > MAX_LEN) return null;
  // Verbos destrutivos de SQL/shell — descarte total, sem tentativa de limpeza.
  if (/\b(drop|delete|truncate|update|insert|alter|grant|revoke|shutdown|rm\s+-rf|curl|wget)\b/i.test(p)) return null;
  // Sequências de comando de shell.
  if (/[;|&`$]\s*\(/.test(p) || /\$\(/.test(p)) return null;
  // Precisa ser imprimível ASCII: carga com byte de controle serve para
  // confundir log, não para testar reflexão.
  if (!/^[\x20-\x7E]+$/.test(p)) return null;
  return p;
}

const SYSTEM = [
  "You generate INERT test payloads for a defensive security bench that a site owner runs against their OWN production site.",
  "Goal: detect whether user input is REFLECTED unescaped in HTTP responses (XSS surface) — not to achieve execution.",
  "",
  "Every payload MUST:",
  "  • be a short string that is easy to spot verbatim in a response body,",
  "  • contain the literal marker token given by the user,",
  "  • be safe to place in a URL query string of a GET request,",
  "  • be printable ASCII, under 120 characters.",
  "",
  "NEVER produce: SQL write verbs (DROP/DELETE/UPDATE/INSERT/ALTER), shell command",
  "substitution, file paths to system files, or anything whose purpose is to CHANGE state.",
  "Reflection probes only.",
  "",
  "Vary the CONTEXT the payload would land in: raw HTML, inside an attribute,",
  "inside a JS string, inside a URL, inside JSON. Vary the encoding: plain,",
  "URL-encoded, HTML-entity, mixed case.",
  "",
  'Answer with STRICT JSON only: {"payloads":["...","..."]}',
].join("\n");

export interface PayloadBatch {
  payloads: string[];
  /** De onde vieram — o relatório precisa distinguir cobertura fixa de ampliada. */
  source: "ia" | "fixas";
  model?: string;
  /** Quantas o modelo propôs e foram RECUSADAS pela sanitização. */
  rejected: number;
  note?: string;
}

/** Extrai o array com tolerância a cerca de markdown / prosa em volta. */
function parsePayloads(text: string): string[] {
  const tryParse = (s: string): string[] | null => {
    try {
      const o = JSON.parse(s) as { payloads?: unknown };
      return Array.isArray(o.payloads) ? (o.payloads as unknown[]).map(String) : null;
    } catch { return null; }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { const r = tryParse(fenced[1].trim()); if (r) return r; }
  const braced = text.match(/\{[\s\S]*\}/);
  if (braced) { const r = tryParse(braced[0]); if (r) return r; }
  return [];
}

/**
 * Pede ao modelo variantes de carga de reflexão. Best-effort em tudo: sem
 * chave, breaker aberto ou resposta ilegível → devolve as cargas fixas. A
 * bancada NUNCA fica sem testar por causa de um LLM.
 */
export async function generateReflectionPayloads(marker: string, fallback: string[]): Promise<PayloadBatch> {
  const provider = roleProvider("brain");
  if (!provider?.apiKey) return { payloads: fallback, source: "fixas", rejected: 0, note: "sem provedor configurado" };
  if (await isTripped(provider.id)) return { payloads: fallback, source: "fixas", rejected: 0, note: "breaker aberto" };

  try {
    const r = await openaiCompatChat(
      {
        model: provider.model,
        system: SYSTEM,
        user: `Marker token: "${marker}". Produce ${MAX_PAYLOADS} distinct reflection payloads. JSON only.`,
        maxTokens: 900,
        timeoutMs: provider.timeoutMs ?? 20_000,
        temperature: provider.temperature,
      },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    await recordResult(provider.id, provider.label, true);

    const raw = parsePayloads(r.text);
    const clean: string[] = [];
    let rejected = 0;
    for (const p of raw) {
      const s = sanitizePayload(p);
      // Sem o marcador, a carga é inútil: não haveria como procurá-la na
      // resposta sem gerar falso positivo com conteúdo legítimo da página.
      if (s && s.includes(marker)) clean.push(s);
      else rejected++;
    }
    if (clean.length === 0) {
      return { payloads: fallback, source: "fixas", rejected, note: "nenhuma carga sobreviveu à sanitização" };
    }
    // As fixas SEMPRE entram: são a linha de base reproduzível. A IA amplia,
    // nunca substitui — senão duas execuções da bancada não se comparam.
    const merged = [...new Set([...fallback, ...clean])].slice(0, MAX_PAYLOADS);
    return { payloads: merged, source: "ia", model: r.model, rejected };
  } catch (e) {
    await recordResult(provider.id, provider.label, false, e instanceof Error ? e.message : String(e));
    return { payloads: fallback, source: "fixas", rejected: 0, note: "provedor indisponível" };
  }
}

// ── Intérprete de resposta ────────────────────────────────────────────────

const JUDGE_SYSTEM = [
  "You are a security reviewer reading HTTP response snippets from a site's OWN production.",
  "Decide whether each snippet leaks information that helps an attacker:",
  "internal stack traces, file paths, database driver/table names, environment variable",
  "names, API keys, or framework internals.",
  "",
  "A generic error message with no internals is FINE. A validation message is FINE.",
  "Be strict about real leaks and calm about noise — a false alarm here costs trust in the whole bench.",
  "",
  'Answer STRICT JSON only: {"leaks":[{"index":0,"what":"one short line"}]}',
  "Empty array if nothing leaks.",
].join("\n");

export interface LeakVerdict { index: number; what: string }

/**
 * Segunda leitura dos corpos de resposta que a sonda determinística já
 * classificou como limpos. Regex pega o que foi previsto; o modelo pega o que
 * não foi — que é exatamente a classe de coisa que passa despercebida.
 *
 * Nunca REVOGA uma reprovação: só ACRESCENTA suspeita. O determinístico manda.
 */
export async function judgeResponseLeaks(snippets: string[]): Promise<LeakVerdict[]> {
  if (snippets.length === 0) return [];
  const provider = roleProvider("brain");
  if (!provider?.apiKey) return [];
  if (await isTripped(provider.id)) return [];

  const body = snippets
    .map((s, i) => `[${i}] ${s.replace(/\s+/g, " ").slice(0, 600)}`)
    .join("\n---\n");

  try {
    const r = await openaiCompatChat(
      { model: provider.model, system: JUDGE_SYSTEM, user: body, maxTokens: 600,
        timeoutMs: provider.timeoutMs ?? 20_000, temperature: provider.temperature },
      { apiKey: provider.apiKey, baseUrl: provider.baseUrl },
    );
    await recordResult(provider.id, provider.label, true);
    try {
      const o = JSON.parse(r.text.replace(/```(?:json)?/g, "").trim()) as { leaks?: unknown };
      if (!Array.isArray(o.leaks)) return [];
      return (o.leaks as LeakVerdict[])
        .filter((l) => l && typeof l.index === "number" && typeof l.what === "string")
        .slice(0, 10);
    } catch { return []; }
  } catch (e) {
    await recordResult(provider.id, provider.label, false, e instanceof Error ? e.message : String(e));
    return [];
  }
}
