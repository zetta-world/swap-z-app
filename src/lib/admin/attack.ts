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
      if (body.includes(payload)) hits.push(`${path} refletiu "${payload}" cru`);
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
  const leakPatterns = /(at\s+\w+\s+\(\/|node_modules\/|PostgrestError|pg_|syntax error at or near|SUPABASE_|SERVICE_ROLE|ANTHROPIC_API|sk-[A-Za-z0-9]{10})/i;
  const leaks: string[] = [];
  const clean: Array<{ path: string; body: string }> = [];
  for (const p of probes) {
    const res = await req(`${origin}${p}`);
    if (!res) continue;
    const body = (await res.text().catch(() => "")).slice(0, 20_000);
    const m = leakPatterns.exec(body);
    if (m) leaks.push(`${p.split("?")[0]} → vazou "${m[0].slice(0, 40)}"`);
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
 * RATE LIMIT — com FURO DE CACHE, que é como o ataque real acontece.
 *
 * A primeira versão desta sonda disparava 12 requisições IDÊNTICAS e concluía
 * nada: a resposta é cacheável na CDN (`s-maxage`), então as 12 foram servidas
 * pela borda e NUNCA chegaram na origem. O limitador sequer rodou — a sonda
 * testou o cache, não a defesa.
 *
 * O comentário do próprio `/api/prices` já dizia como se contorna: "a malicious
 * caller can sidestep the cache by adding a unique query". É exatamente isso
 * que um atacante faz para queimar cota de agregador — então é exatamente isso
 * que a sonda precisa fazer, senão está medindo o adversário errado.
 *
 * Cada requisição leva um parâmetro único: passa pela borda, chega na origem,
 * e o limitador é de fato exercitado.
 */
async function checkRateLimit(origin: string): Promise<AuditFinding> {
  const base = {
    id: "rate_limit", name: "Rotas públicas limitam requisição mesmo furando o cache",
    category: "segurança" as const, severity: "high" as const,
    whyRuntime: "limite em memória parece funcionar num processo só e evapora em serverless; e a CDN pode esconder que ele nunca rodou",
  };
  const N = 25;
  let got429 = false;
  let ok = 0, sent = 0;
  for (let i = 0; i < N; i++) {
    // `_cb` = cache-buster: torna cada URL única, do mesmo jeito que um script
    // hostil faria para chegar na origem a cada tentativa.
    const res = await req(`${origin}/api/prices?symbols=BTC&_cb=${Date.now()}_${i}`);
    sent++;
    if (!res) continue;
    if (res.status === 429) { got429 = true; break; }
    if (res.ok) ok++;
  }
  return got429
    ? { ...base, pass: true, detail: `429 na requisição ${sent} de ${N} furando o cache — limitador ativo na origem` }
    : { ...base, pass: false, inconclusive: true,
        detail: `${ok}/${sent} passaram sem 429 mesmo furando o cache — teto acima de ${sent}/min; aumente a rajada para concluir` };
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
    timed(25, () => checkRateLimit(origin)),
    timed(1, () => checkCors(origin)),
    timed(5, () => checkOpenRedirect(origin)),
    timed(2, () => checkHttpMethods(origin)),
    timed(2, () => checkNonceFreshness(origin)),
  ]);
}
