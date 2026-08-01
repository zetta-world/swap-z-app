/**
 * BANCADA DE ATAQUE — os testes de pentest que só rodam de fora, em produção.
 *
 * POR QUE ESTE ARQUIVO EXISTE:
 *
 * Na auditoria de segurança, boa parte dos testes não pôde ser executada porque
 * o ambiente de desenvolvimento fica atrás de um proxy que bloqueia saída. O
 * resultado foi uma lista de "não consegui verificar" que, com o tempo, é lida
 * como "está tudo bem". Não está — é ausência de evidência.
 *
 * Aqui as requisições saem do PRÓPRIO servidor de produção contra a PRÓPRIA URL
 * pública. É o mesmo caminho que um atacante percorreria, e responde o que
 * leitura de código não responde: o middleware realmente intercepta? o rate
 * limit realmente conta? o parâmetro realmente volta escapado?
 *
 * ═══ REGRAS DE SEGURANÇA — não negociáveis ═══
 *
 *  1. SOMENTE LEITURA. Nenhuma sonda cria, altera ou apaga dado. Payload de
 *     escrita não entra aqui nem "só para testar".
 *  2. PAYLOAD INERTE. As cargas são marcadores detectáveis, não exploits. O
 *     objetivo é ver SE o dado volta refletido — não conseguir execução.
 *  3. VOLUME MÍNIMO. O teste de rate limit usa poucas requisições em série.
 *     Uma bancada que derruba a própria produção é um ataque, não um teste.
 *  4. ALVO PRÓPRIO. `origin` vem do host da requisição do admin. Não existe
 *     campo para apontar isto a um domínio de terceiro.
 */

import type { AuditFinding } from "@/lib/admin/audit";
import { generateReflectionPayloads, judgeResponseLeaks } from "@/lib/admin/audit-ai";

const TIMEOUT_MS = 8000;

async function req(url: string, init?: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store", redirect: "manual" });
  } catch { return null; }
  finally { clearTimeout(t); }
}

/** Marcador único e inofensivo: não executa nada, só é fácil de procurar na
 *  resposta. Se ele voltar CRU (sem escapar), há reflexão explorável. */
const MARKER = "zzsentinel";
const XSS_PROBES = [
  `<${MARKER}>`,
  `"><${MARKER}>`,
  `';${MARKER};'`,
  `javascript:${MARKER}`,
];

// ═══════════════════════════════════════════════════════════════════════════
// DETECTORES — predicados PUROS, extraídos para poderem ser postos à prova.
//
// Enquanto a lógica de detecção vivia dentro de cada checagem, ela era
// inauditável: se um detector tivesse um bug que o fizesse sempre devolver
// "está limpo", TODAS as verificações passariam e nada acusaria. Uma suíte sem
// nenhum caso que DEVE falhar não prova que detecta — prova só que roda.
//
// Separados assim, o `selfTest()` no fim deste arquivo consegue apontá-los
// contra entradas sabidamente vulneráveis e exigir que reprovem.
// ═══════════════════════════════════════════════════════════════════════════

/** O corpo devolveu a carga LITERAL? (escapada não conta — é a defesa funcionando) */
export function detectsReflection(body: string, payload: string): boolean {
  return body.includes(payload);
}

const LEAK_PATTERNS = /(at\s+\w+\s+\(\/|node_modules\/|PostgrestError|pg_|syntax error at or near|SUPABASE_|SERVICE_ROLE|ANTHROPIC_API|sk-[A-Za-z0-9]{10})/i;

/** A resposta vaza interno (stack, driver, nome de env)? Devolve o trecho. */
export function detectsErrorLeak(body: string): string | null {
  const m = LEAK_PATTERNS.exec(body);
  return m ? m[0] : null;
}

/** CORS perigoso = origem arbitrária refletida (ou `*`) COM credenciais. */
export function detectsDangerousCors(allowOrigin: string | null, allowCreds: string | null, evilOrigin: string): boolean {
  const reflected = allowOrigin === evilOrigin || allowOrigin === "*";
  return reflected && allowCreds === "true";
}

/** O Location aponta para fora do domínio? */
export function detectsOpenRedirect(location: string | null, evilPrefix: string): boolean {
  return !!location && location.startsWith(evilPrefix);
}

/** Método perigoso aceito (TRACE/TRACK respondendo < 400). */
export function detectsDangerousMethod(status: number): boolean {
  return status < 400;
}

/**
 * REFLEXÃO DE ENTRADA (superfície de XSS).
 *
 * Manda o marcador em parâmetros de query de rotas públicas e procura ele
 * CRU no corpo. Escapado (`&lt;`) é o comportamento correto; cru dentro de HTML
 * é reflexão explorável.
 */
async function checkReflection(origin: string): Promise<AuditFinding> {
  const base = {
    id: "input_reflection", name: "Entrada do usuário não volta refletida sem escape",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "só a resposta REAL mostra se o framework escapou; o código-fonte não prova o que foi renderizado",
  };
  const targets = ["/", "/swap", "/pools", "/pair"];
  // A IA AMPLIA a lista de cargas; as fixas continuam sempre presentes para
  // que duas execuções da bancada sigam comparáveis.
  const batch = await generateReflectionPayloads(MARKER, XSS_PROBES);
  const used = batch.payloads.slice(0, 6);
  const hits: string[] = [];
  for (const path of targets) {
    for (const payload of used) {
      const res = await req(`${origin}${path}?q=${encodeURIComponent(payload)}&search=${encodeURIComponent(payload)}`);
      if (!res || !res.ok) continue;
      const body = (await res.text().catch(() => "")).slice(0, 400_000);
      // Só acusa quando o payload volta LITERAL. A forma escapada contendo o
      // marcador é justamente a prova de que a defesa funcionou.
      if (detectsReflection(body, payload)) hits.push(`${path} refletiu "${payload}" cru`);
    }
  }
  const origem = batch.source === "ia"
    ? `cargas ampliadas por IA (${batch.model ?? "modelo"}${batch.rejected ? `, ${batch.rejected} recusadas na sanitização` : ""})`
    : `cargas fixas${batch.note ? ` (${batch.note})` : ""}`;
  return hits.length === 0
    ? { ...base, pass: true, detail: `${targets.length} rotas × ${used.length} cargas — nenhuma reflexão crua · ${origem}` }
    : { ...base, pass: false, detail: `🚨 ${hits.join(" | ")} · ${origem}` };
}

/**
 * VAZAMENTO DE ERRO / SQL.
 *
 * Manda entradas malformadas em rotas de API e procura, na resposta, pedaços de
 * stack trace, SQL ou nome de driver. Não tenta injetar: tenta ver se o sistema
 * CONTA demais quando erra — que é o primeiro passo de qualquer invasão.
 */
async function checkErrorLeak(origin: string): Promise<AuditFinding> {
  const base = {
    id: "error_disclosure", name: "Erros não vazam stack trace nem detalhe de banco",
    category: "segurança" as const, severity: "high" as const,
    whyRuntime: "o modo de produção muda o formato do erro — em dev vaza, em prod não, e só a prod responde por si",
  };
  const probes = [
    "/api/prices?symbols='%20OR%201=1--",
    "/api/pair?chain=..%2F..%2F..%2Fetc%2Fpasswd&address=x",
    "/api/pools?limit=-99999999",
    "/api/quote?mode=quote&source=%00&fromChain=x",
  ];
  const leaks: string[] = [];
  const clean: Array<{ path: string; body: string }> = [];
  for (const p of probes) {
    const res = await req(`${origin}${p}`);
    if (!res) continue;
    const body = (await res.text().catch(() => "")).slice(0, 20_000);
    const leak = detectsErrorLeak(body);
    if (leak) leaks.push(`${p.split("?")[0]} → vazou "${leak.slice(0, 40)}"`);
    else clean.push({ path: p.split("?")[0], body });
  }
  // A regex pega o que foi PREVISTO. O modelo relê o que passou e pode apontar
  // vazamento que ninguém pensou em listar — que é justamente a classe que
  // escapa. Só ACRESCENTA suspeita: nunca revoga o veredito determinístico.
  const judged = await judgeResponseLeaks(clean.map((c) => c.body));
  const aiLeaks = judged
    .filter((j) => clean[j.index])
    .map((j) => `${clean[j.index].path} → [IA] ${j.what.slice(0, 80)}`);

  const all = [...leaks, ...aiLeaks];
  return all.length === 0
    ? { ...base, pass: true, detail: `${probes.length} entradas malformadas — nada vazou (regex + segunda leitura por IA)` }
    : { ...base, pass: false, detail: `🚨 ${all.join(" | ")}` };
}

/**
 * RATE LIMIT — fura o cache E excede o teto conhecido.
 *
 * Duas correções, cada uma vinda de um resultado inconclusivo:
 *
 *  1. As primeiras 12 requisições eram IDÊNTICAS: a CDN servia todas na borda e
 *     o limitador nunca rodava. A sonda testava o cache, não a defesa.
 *  2. Depois de furar o cache, 25 requisições ainda passaram — porque o teto de
 *     `/api/prices` é 90/min. Uma rajada menor que o teto não prova nada; ela
 *     só descobre que 25 < 90.
 *
 * Agora dispara em LOTES PARALELOS até exceder o teto. E tem uma propriedade
 * que importa: a sonda é AUTO-LIMITADA quando a defesa funciona — ela para no
 * primeiro 429. O volume cheio só sai se realmente não houver limite, que é
 * exatamente o caso em que se quer saber.
 *
 * A HIPÓTESE QUE ELA PRECISA DISTINGUIR: `/api/prices` usa o limitador EM
 * MEMÓRIA, não o durável. Em serverless cada instância tem o próprio contador,
 * então o teto efetivo é 90 × instâncias — e o limite "existe" no código sem
 * proteger de verdade. Passar do teto sem 429 é forte indício disso, e o
 * relatório diz isso em vez de dar um "não sei" mudo.
 */
const RL_KNOWN_MAX = Number(process.env.AUDIT_RL_KNOWN_MAX ?? 90);

async function checkRateLimit(origin: string): Promise<AuditFinding> {
  const base = {
    id: "rate_limit", name: "Limite de requisição é REALMENTE aplicado na origem",
    category: "segurança" as const, severity: "high" as const,
    whyRuntime: "limitador em memória parece funcionar num processo só e se dilui entre instâncias serverless; só a produção real revela",
  };
  const total = RL_KNOWN_MAX + 15;   // o bastante para cruzar o teto
  const batch = 10;
  let sent = 0, ok = 0;
  let trippedAt: number | null = null;

  for (let i = 0; i < total && trippedAt === null; i += batch) {
    const n = Math.min(batch, total - i);
    const results = await Promise.all(
      Array.from({ length: n }, (_, k) =>
        req(`${origin}/api/prices?symbols=BTC&_cb=${Date.now()}_${i + k}`)),
    );
    for (let k = 0; k < results.length; k++) {
      const res = results[k];
      sent++;
      if (!res) continue;
      if (res.status === 429) { trippedAt = i + k + 1; break; }
      if (res.ok) ok++;
    }
  }

  if (trippedAt !== null) {
    return { ...base, pass: true,
      detail: `429 na requisição ~${trippedAt} (teto configurado: ${RL_KNOWN_MAX}/min) — limitador aplicado na origem` };
  }
  // Passou do teto sem 429: ou não há aplicação, ou o contador em memória se
  // diluiu entre instâncias. Os dois são problema; o segundo é o mais provável
  // e o mais fácil de não perceber.
  return { ...base, pass: false,
    detail: `🚨 ${ok}/${sent} passaram SEM 429, acima do teto de ${RL_KNOWN_MAX}/min mesmo furando o cache — `
      + "o limitador em memória provavelmente se dilui entre instâncias serverless (cada uma com contador próprio). "
      + "Trocar por rateLimitDurable nesta rota." };
}

/**
 * CORS.
 *
 * Pergunta com `Origin` de site hostil. Se a resposta devolver
 * `Access-Control-Allow-Origin` refletindo esse domínio E permitir credenciais,
 * qualquer site consegue agir como o usuário logado.
 */
async function checkCors(origin: string): Promise<AuditFinding> {
  const base = {
    id: "cors_policy", name: "CORS não libera origem arbitrária com credenciais",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "o header é adicionado em runtime pelo framework/CDN — não dá para conferir isso lendo arquivo",
  };
  const evil = "https://evil.example.com";
  const res = await req(`${origin}/api/prices?symbols=BTC`, { headers: { Origin: evil } });
  if (!res) return { ...base, pass: false, inconclusive: true, detail: "sem resposta" };
  const allow = res.headers.get("access-control-allow-origin");
  const creds = res.headers.get("access-control-allow-credentials");
  const dangerous = detectsDangerousCors(allow, creds, evil);
  return dangerous
    ? { ...base, pass: false, detail: `🚨 devolve ACAO=${allow} com credenciais — qualquer site age como o usuário` }
    : { ...base, pass: true, detail: `ACAO=${allow ?? "ausente"} · credenciais=${creds ?? "não"} — sem combinação perigosa` };
}

/**
 * REDIRECIONAMENTO ABERTO.
 *
 * Um `?next=` que aceita domínio externo vira isca de phishing com o SEU
 * domínio no link.
 */
async function checkOpenRedirect(origin: string): Promise<AuditFinding> {
  const base = {
    id: "open_redirect", name: "Não redireciona para domínio externo",
    category: "segurança" as const, severity: "medium" as const,
    whyRuntime: "depende do middleware em execução; a validação pode existir e não estar no caminho da rota",
  };
  const evil = "https://evil.example.com/pwn";
  const params = ["next", "redirect", "returnTo", "callbackUrl", "url"];
  const bad: string[] = [];
  for (const p of params) {
    const res = await req(`${origin}/?${p}=${encodeURIComponent(evil)}`);
    if (!res) continue;
    const loc = res.headers.get("location");
    if (detectsOpenRedirect(loc, "https://evil.example.com")) bad.push(`?${p}= redirecionou para fora`);
  }
  return bad.length === 0
    ? { ...base, pass: true, detail: `${params.length} parâmetros de redirect testados — nenhum saiu do domínio` }
    : { ...base, pass: false, detail: `🚨 ${bad.join(" | ")}` };
}

/**
 * MÉTODOS HTTP PERIGOSOS.
 *
 * TRACE/TRACK ecoam cabeçalhos (inclusive cookie) e servem para roubo de
 * sessão. Devem ser recusados.
 */
async function checkHttpMethods(origin: string): Promise<AuditFinding> {
  const base = {
    id: "http_methods", name: "Métodos perigosos (TRACE/TRACK) recusados",
    category: "segurança" as const, severity: "medium" as const,
    whyRuntime: "quem responde a TRACE costuma ser a CDN/proxy, que não aparece no código da aplicação",
  };
  const bad: string[] = [];
  for (const method of ["TRACE", "TRACK"]) {
    const res = await req(origin, { method });
    if (res && detectsDangerousMethod(res.status)) bad.push(`${method} → ${res.status}`);
  }
  return bad.length === 0
    ? { ...base, pass: true, detail: "TRACE e TRACK recusados" }
    : { ...base, pass: false, detail: `🚨 ${bad.join(" | ")} — ecoa cabeçalhos, permite roubo de sessão` };
}

/**
 * NONCE DE LOGIN É DE USO ÚNICO.
 *
 * O nonce do SIWE/SIWS existe para impedir replay: se o mesmo valor for aceito
 * duas vezes, uma assinatura capturada vale para sempre. Aqui só verificamos
 * que dois pedidos devolvem nonces DIFERENTES — reusar um nonce de verdade
 * exigiria assinar, o que a bancada não faz.
 */
async function checkNonceFreshness(origin: string): Promise<AuditFinding> {
  const base = {
    id: "auth_nonce", name: "Nonce de login é único por pedido",
    category: "segurança" as const, severity: "high" as const,
    whyRuntime: "nonce previsível/reutilizado só aparece pedindo dois de verdade e comparando",
  };
  // A rota exige `address` + `chain`; sem eles devolve 400 e a sonda antiga
  // concluía "não respondeu como esperado" — culpando o endpoint por um erro
  // que era dela. Endereço com checksum EIP-55 válido, só leitura.
  const q = "?chain=evm&address=0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const grab = async (): Promise<string | null> => {
    const res = await req(`${origin}/api/auth/nonce${q}`);
    if (!res || !res.ok) return null;
    const txt = await res.text().catch(() => "");
    try {
      const j = JSON.parse(txt);
      // `ok:false` é resposta VÁLIDA de erro (auth não configurada, rate
      // limit): não é nonce, e tratar como se fosse compararia mensagens de
      // erro entre si e "passaria" sem ter testado nada.
      if (j?.ok === false || !j?.nonce) return null;
      return String(j.nonce);
    } catch { return null; }
  };
  const [a, b] = [await grab(), await grab()];
  if (!a || !b) {
    return { ...base, pass: false, inconclusive: true,
      detail: "endpoint de nonce não devolveu nonce (auth pode estar desconfigurada neste ambiente, ou o rate limit da própria rota barrou)" };
  }
  return a !== b
    ? { ...base, pass: true, detail: `dois pedidos → dois nonces distintos (${a.length} chars)` }
    : { ...base, pass: false, detail: "🚨 o MESMO nonce foi devolvido duas vezes — assinatura capturada vale para sempre" };
}


// ═══════════════════════════════════════════════════════════════════════════
// CANÁRIO — o teste do testador.
//
// Uma bancada sem nenhum caso que DEVE falhar não prova que detecta nada. Se um
// detector tivesse um bug que o fizesse sempre devolver "limpo", os 17 checks
// ficariam verdes e a nota 10 seria ficção — e nada, em lugar nenhum, acusaria.
//
// Aqui cada detector é apontado contra um alvo SABIDAMENTE vulnerável e contra
// um sabidamente são. Ele precisa acertar os dois: reprovar o vulnerável (senão
// está cego) e aprovar o são (senão é alarmista e vira ruído).
//
// Roda em MEMÓRIA, sem rede: nenhum endpoint vulnerável é publicado para isso.
// Alvo de teste vulnerável em produção seria trocar um problema por outro.
// ═══════════════════════════════════════════════════════════════════════════

interface CanaryCase { name: string; detected: boolean; expected: boolean }

function runCanaryCases(): CanaryCase[] {
  const evil = "https://evil.example.com";
  return [
    // ── deve DETECTAR (alvo vulnerável) ──
    { name: "reflexão crua", expected: true,
      detected: detectsReflection(`<div><${MARKER}></div>`, `<${MARKER}>`) },
    { name: "stack trace vazado", expected: true,
      detected: detectsErrorLeak("Error\n    at handler (/var/task/node_modules/pg/lib.js:12)") !== null },
    { name: "nome de segredo vazado", expected: true,
      detected: detectsErrorLeak("missing SUPABASE_SERVICE_ROLE_KEY") !== null },
    { name: "CORS refletido com credenciais", expected: true,
      detected: detectsDangerousCors(evil, "true", evil) },
    { name: "CORS wildcard com credenciais", expected: true,
      detected: detectsDangerousCors("*", "true", evil) },
    { name: "redirect para domínio externo", expected: true,
      detected: detectsOpenRedirect(`${evil}/pwn`, evil) },
    { name: "TRACE aceito", expected: true,
      detected: detectsDangerousMethod(200) },

    // ── NÃO deve detectar (alvo são) — senão vira alarme falso, e alarme
    //    falso treina o operador a ignorar o alarme verdadeiro ──
    { name: "carga escapada (defesa OK)", expected: false,
      detected: detectsReflection(`<div>&lt;${MARKER}&gt;</div>`, `<${MARKER}>`) },
    { name: "erro genérico sem interno", expected: false,
      detected: detectsErrorLeak('{"ok":false,"error":"invalid_chain"}') !== null },
    { name: "CORS sem credenciais", expected: false,
      detected: detectsDangerousCors(evil, null, evil) },
    { name: "redirect interno", expected: false,
      detected: detectsOpenRedirect("/dashboard", evil) },
    { name: "TRACE recusado", expected: false,
      detected: detectsDangerousMethod(405) },
  ];
}

/**
 * Verificação de sanidade da PRÓPRIA bancada. Quando reprova, a nota do
 * relatório perde o sentido — e por isso ela é CRÍTICA: um detector cego
 * transforma todo verde da tela em ficção.
 */
export function selfTest(): AuditFinding {
  const base = {
    id: "bench_selftest", name: "A bancada consegue detectar (controle negativo)",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "sem caso que DEVE falhar, uma suíte não prova que detecta — prova só que roda",
  };
  const cases = runCanaryCases();
  const blind = cases.filter((c) => c.expected && !c.detected).map((c) => c.name);
  const noisy = cases.filter((c) => !c.expected && c.detected).map((c) => c.name);

  if (blind.length > 0) {
    return { ...base, pass: false,
      detail: `🚨 BANCADA CEGA — não detectou alvo vulnerável: ${blind.join(", ")}. `
        + "Enquanto isso não for corrigido, TODO verde deste relatório é ficção." };
  }
  if (noisy.length > 0) {
    return { ...base, pass: false,
      detail: `⚠ falso positivo em alvo são: ${noisy.join(", ")} — alarme falso treina a ignorar o alarme verdadeiro` };
  }
  return { ...base, pass: true,
    detail: `${cases.length} canários: ${cases.filter((c) => c.expected).length} vulneráveis detectados, `
      + `${cases.filter((c) => !c.expected).length} sãos aprovados` };
}


/**
 * ATRIBUIÇÃO FORJADA (classe IDOR).
 *
 * O buraco que motivou esta sonda: `/api/operations/record` lia a carteira do
 * CORPO da requisição, sem sessão, justificado por "isto é analytics, não
 * auth". Mas a tabela alimenta o painel de receita — qualquer um podia inflar
 * o volume da plataforma ou pendurar um trade forjado na carteira alheia.
 *
 * Nenhum dos 17 checks anteriores olhava para isso: todos testavam ACESSO
 * (consigo entrar?) e nenhum testava ATRIBUIÇÃO (consigo dizer que sou outro?).
 * É a classe de falha mais comum em API e estava inteira fora da bancada.
 *
 * A sonda envia um registro com carteira alheia declarada e SEM sessão. Aceitar
 * com atribuição é falha; recusar ou gravar anônimo é o comportamento correto.
 */
async function checkForgedAttribution(origin: string): Promise<AuditFinding> {
  const base = {
    id: "forged_attribution", name: "Não aceita atribuição de identidade vinda do cliente",
    category: "segurança" as const, severity: "critical" as const,
    whyRuntime: "só a requisição real revela se o servidor confia no corpo ou no cookie assinado",
  };
  const victim = "0x000000000000000000000000000000000000dEaD";
  const ref = `audit-canary-${Date.now()}`;
  const res = await req(`${origin}/api/operations/record`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Sem cookie de sessão: a única identidade aqui é a ALEGADA no corpo.
    body: JSON.stringify({ kind: "dex_swap", status: "confirmed", wallet: victim, ref, volumeUsd: 0 }),
  });
  if (!res) return { ...base, pass: false, inconclusive: true, detail: "rota não respondeu" };

  // 401/403 = recusou. 2xx = aceitou, e aí só o banco diz se atribuiu.
  if (res.status === 401 || res.status === 403) {
    return { ...base, pass: true, detail: `recusou registro sem sessão (${res.status})` };
  }
  const { getSupabaseAdmin } = await import("@/lib/supabase/server");
  const db = getSupabaseAdmin();
  if (!db) return { ...base, pass: false, inconclusive: true, detail: "sem banco para conferir a atribuição" };

  const { data } = await db.from("operations").select("wallet_address").eq("ref", ref).maybeSingle();
  if (!data) {
    return { ...base, pass: true, detail: "registro sem sessão não foi persistido" };
  }
  const attributed = (data as { wallet_address: string | null }).wallet_address;
  // Limpa o canário: a bancada não pode sujar a tabela que ela audita.
  await db.from("operations").delete().eq("ref", ref);

  return attributed === victim
    ? { ...base, pass: false,
        detail: `🚨 gravou atribuído a ${victim.slice(0, 10)}… SEM sessão — dá para inflar volume e pendurar trade em carteira alheia` }
    : { ...base, pass: true, detail: `gravou como ${attributed ?? "anônimo"}, ignorando a carteira alegada no corpo` };
}

/** Roda a bancada de ataque inteira em paralelo. */
export async function runAttackSuite(origin: string): Promise<AuditFinding[]> {
  const timed = async (calls: number, fn: () => Promise<AuditFinding>): Promise<AuditFinding> => {
    const start = Date.now();
    try {
      const f = await fn();
      return { ...f, durationMs: Date.now() - start, calls };
    } catch (e) {
      return {
        id: "attack_error", name: "sonda de ataque falhou", category: "segurança",
        severity: "low", pass: false, inconclusive: true,
        detail: (e as Error).message?.slice(0, 120) ?? "erro",
        whyRuntime: "—", durationMs: Date.now() - start, calls,
      };
    }
  };
  return Promise.all([
    // O canário PRIMEIRO: se a bancada estiver cega, o resto não vale nada.
    timed(0, async () => selfTest()),
    timed(8, () => checkReflection(origin)),
    timed(4, () => checkErrorLeak(origin)),
    timed(RL_KNOWN_MAX + 15, () => checkRateLimit(origin)),
    timed(1, () => checkCors(origin)),
    timed(5, () => checkOpenRedirect(origin)),
    timed(2, () => checkHttpMethods(origin)),
    timed(2, () => checkNonceFreshness(origin)),
    timed(3, () => checkForgedAttribution(origin)),
  ]);
}
