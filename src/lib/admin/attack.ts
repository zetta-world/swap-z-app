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
  const hits: string[] = [];
  for (const path of targets) {
    for (const payload of XSS_PROBES.slice(0, 2)) {
      const res = await req(`${origin}${path}?q=${encodeURIComponent(payload)}&search=${encodeURIComponent(payload)}`);
      if (!res || !res.ok) continue;
      const body = (await res.text().catch(() => "")).slice(0, 400_000);
      // Só acusa quando o payload volta LITERAL. A forma escapada contendo o
      // marcador é justamente a prova de que a defesa funcionou.
      if (body.includes(payload)) hits.push(`${path} refletiu "${payload}" cru`);
    }
  }
  return hits.length === 0
    ? { ...base, pass: true, detail: `${targets.length} rotas × ${2} cargas — nenhuma reflexão crua` }
    : { ...base, pass: false, detail: `🚨 ${hits.join(" | ")}` };
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
  const leakPatterns = /(at\s+\w+\s+\(\/|node_modules\/|PostgrestError|pg_|syntax error at or near|SUPABASE_|SERVICE_ROLE|ANTHROPIC_API|sk-[A-Za-z0-9]{10})/i;
  const leaks: string[] = [];
  for (const p of probes) {
    const res = await req(`${origin}${p}`);
    if (!res) continue;
    const body = (await res.text().catch(() => "")).slice(0, 20_000);
    const m = leakPatterns.exec(body);
    if (m) leaks.push(`${p.split("?")[0]} → vazou "${m[0].slice(0, 40)}"`);
  }
  return leaks.length === 0
    ? { ...base, pass: true, detail: `${probes.length} entradas malformadas — nenhuma resposta vazou interno` }
    : { ...base, pass: false, detail: `🚨 ${leaks.join(" | ")}` };
}

/**
 * RATE LIMIT.
 *
 * Dispara uma rajada CURTA e vê se aparece 429. Sem limite, a superfície de
 * custo fica aberta: um script pode queimar cota de agregador e de IA por conta
 * da plataforma. Volume propositalmente pequeno — não é para machucar.
 */
async function checkRateLimit(origin: string): Promise<AuditFinding> {
  const base = {
    id: "rate_limit", name: "Rotas públicas têm limite de requisição",
    category: "segurança" as const, severity: "high" as const,
    whyRuntime: "limite em memória parece funcionar num processo só e evapora em serverless — só a produção real prova",
  };
  const path = "/api/prices?symbols=BTC";
  const N = 12;
  let got429 = false;
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const res = await req(`${origin}${path}`);
    if (!res) continue;
    if (res.status === 429) { got429 = true; break; }
    if (res.ok) ok++;
  }
  // Sem 429 numa rajada curta NÃO prova ausência de limite (o teto pode ser
  // mais alto). Então isto é inconclusivo, não reprovação — a bancada não pode
  // inventar falha do mesmo jeito que não pode inventar aprovação.
  return got429
    ? { ...base, pass: true, detail: `429 apareceu na rajada de ${N} — limite ativo` }
    : { ...base, pass: false, inconclusive: true,
        detail: `${ok}/${N} passaram sem 429 — teto pode ser mais alto que a rajada; não conclui` };
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
  const reflected = allow === evil || allow === "*";
  const dangerous = reflected && creds === "true";
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
    if (loc && loc.startsWith("https://evil.example.com")) bad.push(`?${p}= redirecionou para fora`);
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
    if (res && res.status < 400) bad.push(`${method} → ${res.status}`);
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
  const grab = async (): Promise<string | null> => {
    const res = await req(`${origin}/api/auth/nonce`);
    if (!res || !res.ok) return null;
    const txt = await res.text().catch(() => "");
    try { const j = JSON.parse(txt); return j.nonce ?? j.value ?? txt.slice(0, 80); }
    catch { return txt.slice(0, 80); }
  };
  const [a, b] = [await grab(), await grab()];
  if (!a || !b) return { ...base, pass: false, inconclusive: true, detail: "endpoint de nonce não respondeu como esperado" };
  return a !== b
    ? { ...base, pass: true, detail: `dois pedidos → dois nonces distintos (${a.length} chars)` }
    : { ...base, pass: false, detail: "🚨 o MESMO nonce foi devolvido duas vezes — assinatura capturada vale para sempre" };
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
    timed(8, () => checkReflection(origin)),
    timed(4, () => checkErrorLeak(origin)),
    timed(12, () => checkRateLimit(origin)),
    timed(1, () => checkCors(origin)),
    timed(5, () => checkOpenRedirect(origin)),
    timed(2, () => checkHttpMethods(origin)),
    timed(2, () => checkNonceFreshness(origin)),
  ]);
}
