# Admin — SSO corporativo, MFA e RBAC (desenho R1/R2)

Status: 🔴 DESENHO — nada disto está implementado nem configurado. Entregável 3 do
`docs/PLANO-ADMIN-COMMAND-CENTER-2-20261025.md` (§4 R1/R2/R5, §12). SUPPORTING_REFERENCE: não define estado atual,
não autoriza migration, variável Vercel, provedor de identidade nem deploy.

| campo | valor |
|---|---|
| baseline lido | HEAD `ec63cb992d7b1ed8a86e2c1751255a438b1292b7` (tree `fd6caf2d…`), `src/**` = `10ebd12` |
| código | leitura direta + varredura (`scratchpad/admin-cc2/auth/scan-auth.cjs` → `auth-scan.json`); cruzado com `routes.json` (79 handlers) da Fase A |
| banco | 3 consultas `SELECT` agregadas, somente leitura, sem PII, em 26/10/2026 00:45 UTC no projeto do handoff (plano :41). Uma 4ª consulta (formato de caixa das chaves de admin) foi **negada pelo dono** e não foi repetida — o ponto fica para teste em R1 |
| dependências | só o que já está no `package.json`: `@supabase/supabase-js` 2.108.0 (`@supabase/auth-js` 2.108.0) e `jose` 5.10.0 (`package.json:34,43`). **`@supabase/ssr` NÃO está instalado** (nem no `package.json` nem em `node_modules/@supabase/`) e o desenho não precisa dele |
| documentos irmãos | permissões e ações por rota: `docs/ADMIN-API-AUTHORIZATION-MATRIX.md` (fonte dos nomes de permissão usados aqui); inventário: `docs/ADMIN-COMMAND-CENTER-INVENTARIO.md` |

## 0. Resumo

- Hoje **a sessão do Admin é a sessão da carteira** (`zswap_session`, JWT HS256, 12 h ou 30 dias), sem revogação no
  servidor, e a autorização é binária: `requireAdmin()` aceita **três fontes** (env, `platform_admins`, legado
  `tier_cache.source='admin'`). Não há papéis, MFA, step-up nem verificação de origem nas 79 rotas.
- Proposta: identidade corporativa **separada** da carteira, via **Supabase Auth OAuth** (provedores `google` e
  `azure`) com **PKCE executado no servidor** em route handlers do Next 16; **TOTP do Supabase (aal2)** como prova
  técnica de MFA independente do IdP; **convite obrigatório** (allowlist vinculada ao `sub` do IdP, não ao e-mail);
  **sessão admin própria** opaca, curta, revogável no banco; **step-up** nas 14 ações sensíveis; CSRF por
  `SameSite=Strict` + checagem de `Origin`/`Sec-Fetch-Site` + JSON obrigatório.
- RBAC: papéis e permissões **no código** (matriz testada), atribuições, sessões e auditoria append-only num schema
  privado; **um único ponto de decisão** (`authorizeAdmin(req, action)`) chamado em cada handler e cada página.
- Transição sem trancar o dono: `ADMIN_AUTH_MODE` ausente = comportamento atual (`legacy`); `dual` aceita as duas;
  `corp` só aceita corporativo. Break-glass por janela de tempo em env + carteira do dono; recuperação de MFA exige
  **duas pessoas**. Nenhum recurso pago é necessário.

---

## 1. Estado atual (medido)

### 1.1 Números contra o handoff

| medida | real (26/10) | handoff (25/10) | diferença |
|---|---|---|---|
| `src/app/admin/api/**/route.ts` | 66 arquivos · **79 handlers** (GET 46 · POST 33) | "66 handlers" | +13 (o handoff contou arquivos) |
| superfícies sob `src/app/admin` (route + page + layout) | **71** = 66 route + 4 page + 1 layout | — | o comentário do middleware ainda diz **54** (`src/middleware.ts:29-31`) — desatualizado |
| chamadas reais de `requireAdmin()` | **81** = 79 handlers + `admin/layout.tsx:9` + `admin/mural/page.tsx:20` (2 ocorrências extras em `celeiro/route.ts:76,79` são comentário) | — | — |
| páginas sem chamada própria | 3 (`admin/page.tsx`, `area/[area]/page.tsx`, `area/[area]/[painel]/page.tsx`) — cobertas só pelo layout | — | ver AUTH-06 |
| `logAdminAction` | 10 chamadas em 7 handlers; **26 de 33 POST** sem nenhuma | "best effort" | confirmado |
| handlers com checagem de `Origin`/CSRF | **0 de 79** (as 2 ocorrências de "origin" — `audit-bench`, `pro-piscinas` — não são checagem de CSRF) | — | — |
| rate limit em `/admin/api` | 0 de 79 | — | — |
| `auth.users` · `auth.identities` · `auth.mfa_factors` · `auth.sessions` · `auth.sso_providers` | **0 · 0 · 0 · 0 · 0** | `auth.users` = 0 | igual; Supabase Auth nunca foi usado |
| `platform_admins` | **1** | 1 | igual |
| `tier_cache.source='admin'` | **4** (1 também em `platform_admins`; 1 vista nos últimos 90 dias) · `source='concessao'` = 0 | não citado | = medição de 14/09 em `0047_…sql:13-14` |
| `admin_audit_log` | **54** linhas, 2 atores distintos, último registro 2026-08-31 (killswitch.* 40 · ai_circuit.reset 12 · tier.grant 1 · admin.grant 1) | 54 | igual |
| `admin_kv` | **680** | 680 | igual |
| eventos `security` em `platform_events` | **1** no total (`admin_granted`, 2026-08-11); `admin_access_denied`/`admin_sem_sessao`/`admin_sem_banco` = **0** | — | ver AUTH-08 |
| schemas existentes | `auth`, `extensions`, `vault` — **não existe** schema `private`/`admin_private` | — | — |
| extensões | `pgcrypto`, `supabase_vault`, `uuid-ossp` | — | — |
| `ADMIN_WALLETS` | **não lido** (variável Vercel; não decifrada, por regra) | — | — |

### 1.2 As três fontes de admin

`requireAdmin()` (`src/lib/admin/require.ts:28-89`) — qualquer uma basta, nesta ordem:

| # | fonte | leitura | concessão / revogação | caixa (maiúsc./minúsc.) | efeitos FORA do `/admin` |
|---|---|---|---|---|---|
| 1 | env `ADMIN_WALLETS` (CSV) | `isEnvAdmin` `require.ts:55,92-97`, sem banco | só redeploy; o painel mostra como fixo (`admins/route.ts:41,86-87`) | insensível (`toLowerCase`) | piloto de automação CEX/DCA com dinheiro real (`src/lib/autopilot/liberacao.ts:254`); excluída do tráfego (`traffic/route.ts:34-40`) |
| 2 | tabela `platform_admins` (`0016_platform_admins.sql:13-20`, PK `wallet_address text`) | `.eq("wallet_address", wallet)` `require.ts:68-73` | `POST /admin/api/admins` grava `target` **como digitado** (`admins/route.ts:54,64-67`); revoga com `ilike` (`:133`) | **sensível** na leitura | nenhum (de propósito: `liberacao.ts:185-188`) |
| 3 | legado `tier_cache.source='admin'` | `.eq(...).eq("source","admin")` `require.ts:76-82` | não se concede mais (`0047_concessao_de_plano_nao_e_admin.sql`); some por `POST /admin/api/admins` (revoke, `:134`) **ou como efeito colateral** de `POST /admin/api/tier` (upsert `source:"concessao"` `tier/route.ts:59-91`; delete sem filtro de `source` e sem ler erro `:106`) | sensível | ignora todos os gates de plano (`src/lib/tier/flags.ts:6`, `check.ts:16`); troca o próprio plano sem pagar (`src/app/api/tier/select/route.ts:41-59`) |

A sessão que prova "quem é" é a mesma nas três: `session.sub` = endereço normalizado (EVM com checksum via
`getAddress`, `src/lib/auth/siwe.ts:12-15`).

### 1.3 Sessão atual (`zswap_session`)

| atributo | valor | evidência |
|---|---|---|
| nome | `zswap_session` (constante duplicada no middleware) | `src/lib/auth/session.ts:12`; `src/middleware.ts:58` |
| formato | JWT HS256 com `AUTH_JWT_SECRET` (mín. 16 caracteres), `iss=z-swap`, `aud=z-swap-app`, `sub`=carteira, `chain` | `session.ts:20-21,29-33,40-51` |
| TTL | 30 dias com "manter sessão" (cookie com `maxAge`); senão cookie de sessão do navegador + JWT de **12 h** (W4) | `session.ts:13,19,49,86-89` |
| atributos | `HttpOnly`, `Secure` só em produção, `SameSite=Lax`, `Path=/`, sem `Domain` (host-only) | `session.ts:76-83` |
| propósito | provar que a carteira assinou o desafio SIWE/SIWS (nonce de uso único por `DELETE … RETURNING`) | `src/app/api/auth/verify/route.ts:83-134` |
| revogação | **nenhuma no servidor**: logout só apaga o cookie; um JWT copiado vale até expirar. Única revogação global = trocar `AUTH_JWT_SECRET` (derruba todos os clientes) | `src/app/api/auth/logout/route.ts:7-12` |
| painel admin | não tem logout próprio; sair da carteira é sair do Admin | `src/components/admin/AdminShell.tsx` (sem logout) |

Deriva menor: o comentário de `verify/route.ts:17` ainda diz "issues a 30-day JWT" (padrão é 12 h desde W4).

### 1.4 Como o Admin é protegido hoje

| camada | o que faz | evidência |
|---|---|---|
| borda (`middleware.ts`, matcher `/admin/:path*`) | só confere se há `zswap_session` válido; sem ele → `404` vazio. Não lê permissão (correção de 11/08) | `src/middleware.ts:40-52,67-84` |
| layout | `admin/layout.tsx` chama `requireAdmin()` e passa `SUPABASE_ANON_KEY` ao navegador só para realtime | `src/app/admin/layout.tsx:9,14-19` |
| páginas | `mural` chama por conta própria; as outras 3 dependem do layout | `src/app/admin/mural/page.tsx:20` |
| handlers | 79/79 chamam `requireAdmin()` como 1ª instrução (verificação AST da Fase A) | `ADMIN-COMMAND-CENTER-INVENTARIO.md` § Contagens |
| teste | `portao.test.ts` exige chamada no arquivo **ou** num `layout.tsx` ancestral | `src/lib/admin/portao.test.ts:98-118` |

### 1.5 Como funciona o "404, nunca 403"

1. Sem sessão: o middleware responde `new NextResponse(null, { status: 404 })` (`middleware.ts:43-45`) — inclusive para `/admin/api/*`.
2. Com sessão, mas não admin (ou sem banco): `requireAdmin` chama `notFound()` de `next/navigation` (`require.ts:50,64,86`), que **lança**; em route handler o Next converte em 404, em página renderiza o not-found. Por isso nenhum handler pode tratar o retorno como "negado" (`celeiro/route.ts:76-88` documenta o erro antigo).
3. Antes de cada `notFound()` há `logSecurity` (`admin_sem_sessao` low · `admin_sem_banco` high · `admin_access_denied` high), **sem `await`** (`src/lib/admin/track.ts:48-53` → `recordEvent` `:15-38`, cujo próprio comentário `:19-22` diz que escrita não aguardada se perde quando a função serverless congela).
4. Diferenças observáveis que sobram: 404 do middleware tem corpo vazio; o de `notFound()` renderiza página; o caminho com sessão faz 1–2 consultas a mais (tempo). Ambos dizem 404 — é ofuscação, não controle.

### 1.6 Postura de CSRF hoje

- Única defesa: `SameSite=Lax` no `zswap_session`. Bloqueia POST cross-site, mas:
  - **7 GET com efeito** recebem o cookie numa navegação de topo vinda de outro site: `GET /aprendizado`, `/arbiter-cohort` (grava `arb_denylist` em `admin_kv`), `/derrapagem`, `/descartadas`, `/lab` (sincroniza `lab_strategies`), `/taxa-cex`, `/venue-truth` (Fase A); e `GET /early-access/export` gera export + registro.
  - Nenhum handler confere `Origin`, `Sec-Fetch-Site` ou `Content-Type`; o corpo é lido com `req.json()` sem checar tipo (ex.: `admins/route.ts:53`).
  - O Admin divide **a mesma origem** com o app público, cujo CSP permite `script-src 'unsafe-inline'` (`next.config.mjs:43`): qualquer XSS no app faz chamadas same-origin ao Admin com o cookie da carteira admin.
- Existe peça reutilizável: `origemPermitida()` (rejeita `Origin` ausente) e `ehJson()` em `src/lib/early-access/request.ts:56-70`.
- Server Actions (que têm checagem de origem embutida) não são usadas (`"use server"` não aparece em `src/`).
- Clickjacking coberto: `frame-ancestors 'none'` + `X-Frame-Options: DENY` (`next.config.mjs:68,88`); HSTS com `includeSubDomains; preload` (`:112`).

### 1.7 `logAdminAction` — semântica de falha

`src/lib/admin/require.ts:110-123`: sem banco → `return` silencioso (`:118`); o `insert` é aguardado (`:119`) mas o
`{ error }` que o `supabase-js` **resolve** (não lança) nunca é lido; exceções são engolidas (`:120-122`). Assinatura
`Promise<void>`: quem chama não tem como saber se gravou. Consequências medidas na Fase A: 4 das 10 chamadas vêm
depois de escrita conferida e 6 depois de escrita **não** conferida (o log pode registrar ação que não aconteceu);
nenhum ato fica bloqueado por falta de trilha. Contraexemplo correto já no repo: `registrarExport`
(`src/lib/early-access/store.ts:440-452`, devolve `!error`) e a rota recusa o arquivo sem registro
(`early-access/export/route.ts:82`); e a RPC transacional `early_access_transicionar` (`store.ts:371-398`).

### 1.8 Achados (identidade/autorização)

| ID | sev. | achado | evidência | consequência |
|---|---|---|---|---|
| AUTH-01 | P0 | Sessão admin = sessão da carteira, até 30 dias, sem revogação no servidor | `session.ts:13,86-89`; `logout/route.ts:7-12` | cookie roubado de um admin vale dias; "revogar" um admin só funciona tirando a carteira das fontes ou girando `AUTH_JWT_SECRET` |
| AUTH-02 | P0 | Autorização binária: qualquer admin faz tudo (grant/revoke admin, kill switches, export, liberação de automação) | `require.ts:28-89`; matriz R2 | sem segregação; um admin "para olhar métricas" pode conceder admin |
| AUTH-03 | P1 | Concessão por painel grava o endereço como digitado; a leitura é `.eq` sensível à caixa e a sessão traz checksum | `admins/route.ts:54,64-67`; `require.ts:71`; `siwe.ts:14` | colar um endereço EVM em minúsculas grava, mostra sucesso e **nunca autoriza** (mesma família do defeito de 11/08). Formato real das linhas não verificado (consulta negada) |
| AUTH-04 | P1 | A fonte 3 some como efeito colateral de `POST /admin/api/tier` | `tier/route.ts:59-91,106` | revogação de admin sem `admin.revoke` no log; dá também acesso a plano sem pagamento fora do Admin |
| AUTH-05 | P1 | `portao.test.ts` não detecta `route.ts` novo sem guarda: o `layout.tsx` raiz "cobre" route handlers (que layouts não protegem) e a checagem é por arquivo, não por método | `portao.test.ts:98-118`; simulação `scratchpad/admin-cc2/sim-portao.cjs` com 2 rotas falsas (sem guarda; GET guardado + POST sem guarda) → **ambas aprovadas** | uma rota nova fica aberta a qualquer carteira com sessão, e o CI passa |
| AUTH-06 | P2 | 3 páginas dependem só do layout; o Next 16 avisa que layout não re-roda na navegação e não controla se o segmento aparece no payload RSC | `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1356-1362` | exposição limitada a estrutura (rótulos dos módulos) — os dados vêm de APIs guardadas — mas contraria "404 não revela" |
| AUTH-07 | P2 | Erro de leitura de `platform_admins`/`tier_cache` é ignorado; admin legítimo com banco instável leva 404 **registrado como intrusão** | `require.ts:68-87` | alerta `high` falso; diagnóstico errado (o caso de 13/09) |
| AUTH-08 | P2 | Sinais de negação não são aguardados | `require.ts:49,63,85`; `track.ts:48-53` | 0 eventos de negação em produção não distingue "ninguém tentou" de "escrita perdida" |
| AUTH-09 | P1 | Sem CSRF além de `SameSite=Lax`; 7 GET com efeito; mesma origem do app público com `'unsafe-inline'` | §1.6 | ver §4.6 |
| AUTH-10 | P1 | `logAdminAction` não é conferível; 26/33 POST sem trilha | §1.7 | ADM-005 impossível hoje |
| AUTH-11 | P2 | Constantes da sessão duplicadas no middleware (edge) | `middleware.ts:56-58` vs `session.ts:12,20-21` | mudar uma e não a outra = 404 para todos os admins (ou o contrário) |
| AUTH-12 | info | Next 16 deprecia `middleware.ts` (renomeado `proxy`, runtime Node por padrão) | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11,806` | migrar é item separado; este desenho não depende disso |

---

## 2. Decisões de arquitetura

| ID | decisão | alternativa descartada e por quê |
|---|---|---|
| D-1 | Identidade corporativa **separada** da carteira; nenhuma carteira vira admin por estar autenticada | reaproveitar `zswap_session` com claim de papel — mistura cliente e funcionário (plano R1) |
| D-2 | **Supabase Auth OAuth** (`google`, `azure`) no mesmo projeto, já pago/existente | SAML SSO do Supabase e IdP SaaS — dependem de plano pago; `signInWithSSO` fica fora |
| D-3 | **PKCE no servidor** com `supabase-js` puro: cliente por requisição, `flowType:'pkce'`, armazenamento em memória; o verificador viaja num cookie selado | `@supabase/ssr` — não instalado; seu papel (sessão Supabase em cookie no navegador) é exatamente o que não queremos |
| D-4 | Tokens do Supabase **nunca chegam ao navegador**; o navegador só tem a sessão admin opaca | guardar `access_token` em cookie — viraria JWT `authenticated` utilizável no PostgREST |
| D-5 | **TOTP do Supabase** (aal2, `amr` com `totp`) é a prova de MFA aceita; MFA do IdP é desejável, não suficiente | confiar em "o Workspace exige 2SV" — o Google OAuth não informa MFA ao app (plano invariante 3) |
| D-6 | Allowlist por **convite** vinculada a `provider + issuer/tenant + sub` no 1º login; e-mail/domínio são só sinais | autorizar por domínio — qualquer conta do domínio viraria admin |
| D-7 | Sessão admin **opaca** (256 bits), hash no banco, checada **a cada requisição** | JWT assinado — não revoga na hora (plano R1: "não confiar em claims long-lived") |
| D-8 | Papéis e permissões **no código** (matriz testada); só atribuições no banco | tabela de permissões editável — cria um caminho de autoelevação por SQL/painel |
| D-9 | Um único ponto de decisão por ação (`authorizeAdmin`), chamado no handler **e** na página | checagem no layout/middleware — não protege handler nem segmento (AUTH-05/06) |
| D-10 | Tudo parametrizado; **ausência de configuração = comportamento atual** | ligar por padrão — risco de trancar o dono |

---

## 3. Ameaças cobertas

| ameaça | controle no desenho |
|---|---|
| cookie de sessão roubado | sessão opaca curta (8 h abs., 30 min ociosa), revogável; step-up TOTP para ação sensível; rotação no login e no step-up |
| conta desprovisionada no IdP ainda logada | revogação no painel derruba na próxima requisição; teto de 8 h; `ban_duration` no Supabase impede nova sessão |
| e-mail falsificado/mutável no IdP (ex.: Entra) | vínculo por `sub`/tenant após o 1º login; app single-tenant/Internal; código de ativação fora de banda no 1º login |
| login CSRF / injeção de `code` | PKCE com verificador preso ao navegador (cookie selado, uso único) + nonce no `redirectTo` |
| fixação de sessão | id novo após callback, após MFA e após step-up; sessão pré-MFA não serve para nada além do MFA |
| CSRF | `SameSite=Strict` no cookie admin + `Origin`/`Sec-Fetch-Site` + `application/json` em todo método não-GET; GET sem efeito |
| XSS no app público (mesma origem) | step-up nas ações sensíveis (o XSS não tem o TOTP); host dedicado como endurecimento opcional (D-adm-host, §11) |
| força bruta de TOTP | contador de falhas no banco (falha fechada) + limite do próprio Supabase |
| autoelevação / conluio | sem self-grant (CHECK no banco + regra no código); papéis altos e recuperação exigem 2 pessoas |
| trancar o dono para fora | modo `legacy` por padrão, `dual` antes de `corp`, ≥2 superadmins como gate, break-glass com janela |
| auditoria perdida | comando sensível só confirma com auditoria gravada na mesma transação (falha fechada, ADM-005) |
| Preview/produção misturados | redirect URLs exatas; Preview com projeto Supabase separado; nenhum `*.vercel.app` curinga |

---

## 4. Arquitetura proposta

### 4.1 Peças (todas já disponíveis)

| peça | uso | evidência de que existe em 2.108 |
|---|---|---|
| `signInWithOAuth({ provider, options: { redirectTo, scopes, queryParams, skipBrowserRedirect: true } })` | monta a URL de `/authorize` com `code_challenge` | `node_modules/@supabase/auth-js/dist/main/GoTrueClient.js:984-990,4545-4568` |
| verificador PKCE em `storage[\`${storageKey}-code-verifier\`]` | lido no `start`, devolvido no `callback` | `GoTrueClient.js:1514-1528` |
| `exchangeCodeForSession(code)` | troca no servidor (`/token?grant_type=pkce`) | `GoTrueClient.js:1163,1513-1546` |
| `mfa.enroll({ factorType:'totp', issuer, friendlyName })`, `challenge`, `verify`, `listFactors`, `getAuthenticatorAssuranceLevel` | MFA e prova de aal2 (`aal`, `amr` com timestamp) | `GoTrueClient.js:187-188,4599-4613,4762-4811`; `lib/types.d.ts:266,301` (`FactorTypes = totp, phone, webauthn`) |
| `getClaims(jwt)` / `getUser(jwt)` | validar o access token no servidor | `GoTrueClient.js:5072` |
| admin API: `createUser`, `updateUserById({ ban_duration })`, `deleteUser`, `signOut(jwt, 'global'\|'local'\|'others')`, `mfa.listFactors/deleteFactor` | convite, bloqueio, logout global, reset de MFA | `dist/main/GoTrueAdminApi.js:67,393,685-689,737,755,773`; `lib/types.js:22` |
| provedores `google` e `azure` (e `custom:*`) | IdPs | `lib/types.d.ts:9-13` |
| `jose` (`EncryptJWT`/`jwtDecrypt`, A256GCM) | selar o cookie do fluxo | já usado em `session.ts:1` e `middleware.ts:2` |
| `node:crypto` (`randomBytes`, `createHash`, AES-256-GCM) | token opaco, hash, cifrar refresh token | runtime Node (as rotas já são `runtime = "nodejs"`) |
| `rateLimitDurable` | limitar `start`/`callback`/MFA | `src/lib/rate-limit.ts:92-113` (falha ABERTA para o limitador em memória — por isso o contador de falhas de MFA fica no banco) |

`SUPABASE_ANON_KEY` (já existe, `docs/RUNBOOK.md:15`) é a chave do cliente de Auth; a service key fica só no
`getSupabaseAdmin()` (`src/lib/supabase/server.ts:27-38`) para a admin API e as tabelas.

### 4.2 Fluxo de login (PKCE no servidor)

Rotas novas **fora** de `src/app/admin` (o layout de lá chama `requireAdmin` e o middleware 404-a sem sessão):
páginas em `src/app/(admin-acesso)/admin-acesso/…` (URL `/admin-acesso`, `noindex`) e handlers em
`src/app/api/admin-auth/*`. Todas respondem 404 enquanto `ADMIN_AUTH_MODE` não for `dual`/`corp`.

1. **`GET /admin-acesso`** — página neutra com dois links (âncoras, não formulário: o CSP tem `form-action 'self'`,
   `next.config.mjs:67`, e o Chrome aplica isso também ao redirect): "Google Workspace" e "Microsoft".
2. **`GET /api/admin-auth/start?provider=google|azure`** — rate limit; provedor na lista habilitada; cliente
   `createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType:'pkce', persistSession:true, autoRefreshToken:false, detectSessionInUrl:false, storage:<Map desta requisição> } })`;
   `signInWithOAuth` com `redirectTo=<ORIGEM_ADMIN>/api/admin-auth/callback?f=<nonce>`, `scopes='openid email profile'`,
   `queryParams` = `{ hd:'<DOMINIO_WORKSPACE>', prompt:'select_account' }` (Google; `hd` é só dica de UI) ou
   `{ prompt:'select_account' }` (Entra). Lê o verificador do `Map`, grava `__Host-zswap_admin_flow` (selado
   A256GCM: verificador, provedor, nonce, criado_em, `returnTo` relativo validado) e responde 302 para a URL do Supabase.
3. **IdP → Supabase → `GET /api/admin-auth/callback?code=…&f=…`** — exige o cookie de fluxo, apaga-o (uso único),
   confere nonce e idade; cliente novo com o `Map` pré-carregado com o verificador; `exchangeCodeForSession(code)`.
   Erro do IdP (`?error=`) ou troca falha → página genérica "não foi possível entrar" (mesma resposta para todo motivo).
4. **Vínculo/allowlist** (transação, §4.8): `getUser(access_token)` → procura `admin_identities` por `auth_user_id`;
   se não vinculado, aceita só identidade `invited` do mesmo provedor, e-mail normalizado igual, e-mail verificado,
   issuer/tenant esperado, e então grava `auth_user_id` + `idp_subject`. Já vinculada: `provider` + `sub` têm de bater.
   Qualquer falha → `auth.admin.signOut(access_token,'global')`, auditoria `login.denied` com código, página genérica.
5. **Sessão pré-MFA** — linha em `admin_sessions` com `state='mfa_pending'` (10 min), refresh token cifrado; cookie
   `__Host-zswap_admin_pre` (`SameSite=Lax`, porque chega por redirect cross-site) → 302 `/admin-acesso/mfa`.
6. **MFA** (§4.3) via `fetch` same-origin; no sucesso a linha pré-MFA é revogada (`rotated`), nasce a sessão
   `active` com **id novo**, o servidor grava `__Host-zswap_admin` (`SameSite=Strict`) e apaga o `_pre`; o cliente
   navega para `/admin` — navegação same-site, então o cookie Strict vai junto.
7. **`POST /api/admin-auth/logout`** — revoga a linha (escrita conferida), `signOut(…, 'global')` no Supabase
   (best-effort, resultado auditado), apaga o cookie.

### 4.3 MFA (TOTP do Supabase, aal2)

| momento | regra |
|---|---|
| 1º acesso (identidade `invited`, sem fator) | exige **código de ativação** de uso único (gerado no convite, entregue fora de banda por quem convidou; hash + validade 72 h em `admin_identities`). Só então `mfa.enroll({ factorType:'totp' })` → QR (`data.totp.qr_code`) → `challenge` + `verify` do 1º código → identidade `active`, `mfa_factor_id` gravado, auditoria `identity.mfa_enrolled` |
| logins seguintes | `challenge` + `verify` com o fator verificado; o servidor usa a sessão Supabase do passo 3 (refresh se preciso) |
| prova aceita | novo access token com `aal='aal2'` **e** `amr` contendo `totp`/`mfa/totp` com `timestamp` recente, validado no servidor (`getClaims`/`getUser`); `mfa_verified_at` = esse timestamp. Nada vindo do cliente é aceito como prova |
| tentativas | contador de falhas em `admin_sessions`/`admin_identities` no banco; 5 falhas / 15 min → bloqueio + alerta `high`; sem conseguir gravar a falha → recusa (falha fechada) |
| fatores | máx. 2 TOTP por identidade (principal + reserva cadastrada no mesmo ato, guardada offline). Phone MFA não (complemento pago no Supabase; SMS fraco). WebAuthn: o SDK tem a API (`lib/types.d.ts:301`); habilitar só depois de confirmar suporte no projeto |
| reset | só por recuperação com 2 pessoas (§7) — `auth.admin.mfa.deleteFactor` + identidade volta a `invited` + novo código |

### 4.4 Sessão admin

| item | proposta (valores = decisão do dono, D-ttl) |
|---|---|
| cookie | `__Host-zswap_admin` (prefixo exige `Secure`, `Path=/`, sem `Domain`) · `HttpOnly` · `SameSite=Strict` · sem `Max-Age` (morre com o navegador). Em dev: `localhost` é contexto seguro; se o navegador recusar, nome sem prefixo só quando `NODE_ENV!=='production'` |
| valor | `za1_` + 32 bytes aleatórios base64url. Banco guarda só `sha256`. O prefixo permite checagem de formato na borda e varredura de segredo |
| audience/escopo | `audience='zswap-admin'` na linha; nunca aceito por `verifySession` (`aud=z-swap-app`) e o `zswap_session` nunca é aceito como sessão corporativa |
| TTL absoluto | 8 h |
| ociosidade | 30 min (`last_seen_at` atualizado no máximo 1×/min para não gerar escrita por requisição) |
| step-up | MFA nos últimos 5 min (§4.5) |
| pré-MFA / fluxo | 10 min cada |
| concorrência | até 3 sessões ativas por identidade; a 4ª revoga a mais antiga |
| checagem por requisição | 1 leitura (sessão + identidade + papéis ativos); revogado, expirado, ocioso, identidade não `active` ou sem aal2 → nega |
| revogação | `revoked_at` na linha (logout, revogação de identidade, troca de papel, reset de MFA, rotação). Efeito na próxima requisição |
| desprovisionamento | revogar identidade = sessões revogadas + papéis revogados + `updateUserById(uid, { ban_duration })` + fatores apagados, numa operação auditada |
| sem banco | nega (404 + `admin_sem_banco` aguardado), como hoje |

### 4.5 Step-up

- Exigido nas permissões marcadas `step_up` na matriz (14 handlers hoje): `POST /admins`, `/ai-circuit`, `/audit-bench`,
  `/autopilot-liberacao`, `/early-access/transition`, `/killswitch`, `/margin`, `/paper-recap`, `/paper-repair`,
  `/paper-reset`, `/tier`, `/ulfhednar`; `GET /early-access/export`, `/ledger/export`; mais as rotas novas de
  identidade/papéis/break-glass.
- Sem MFA recente → `401 {"error":"step_up_required"}` (só para quem já tem sessão admin válida; o painel abre um
  modal no padrão de `useAdminConfirm`) → `POST /api/admin-auth/step-up {code}` → `challenge`/`verify` com o refresh
  token cifrado da sessão → `step_up_at=now`, **id de sessão novo** → o cliente repete a chamada.
- Refresh token inutilizável (revogado no Supabase) → step-up exige login completo de novo.
- O step-up vale para a sessão, não para "um comando": dupla autorização (§7) é outra coisa.

### 4.6 CSRF

| camada | regra |
|---|---|
| 1. cookie | `SameSite=Strict` no `__Host-zswap_admin` (corta inclusive navegação de topo vinda de fora) |
| 2. método | GET/HEAD nunca alteram estado: os 7 GET com efeito (§1.6) passam a POST ou perdem o efeito (telemetria pode ficar) — mesma conclusão da matriz |
| 3. origem | todo não-GET exige `Origin` igual à origem canônica do Admin (reusar a lógica de `origemPermitida`, que já recusa `Origin` ausente) **e**, quando presente, `Sec-Fetch-Site: same-origin` |
| 4. tipo | todo não-GET exige `Content-Type: application/json` (`ehJson`) — força preflight em qualquer tentativa cross-origin |
| 5. exports por GET | aceitos só com `Sec-Fetch-Site` `same-origin`/`none` + step-up |
| 6. double-submit | **não** na 1ª entrega. Só se a telemetria mostrar requisições sem `Origin`/`Sec-Fetch-Site` de navegadores suportados: cookie `__Host-zswap_admin_csrf` (não-HttpOnly, HMAC do id da sessão) + cabeçalho `x-zswap-csrf`, exigindo um wrapper de `fetch` nos ~76 pontos que chamam `/admin/api` (31 com POST) |

### 4.7 Ponto único de decisão

Proposta (não é código existente):

```ts
// src/lib/admin/authz.ts
export type ActionId = keyof typeof ACTIONS;            // "security.killswitch.write", "finance.read", …
export type Principal =
  | { kind: "corp"; identityId: string; sessionId: string; roles: Role[]; mfaAt: Date; stepUpAt: Date | null }
  | { kind: "legacy"; wallet: string; source: "env" | "panel" | "tier" }      // só em legacy/dual
  | { kind: "breakglass"; wallet: string; until: Date };                        // só com janela ativa
export type AuthzResult =
  | { ok: true; ctx: { principal: Principal; requestId: string; mode: AdminAuthMode; audit: DurableAudit } }
  | { ok: false; response: Response };
export async function authorizeAdmin(req: Request, action: ActionId): Promise<AuthzResult>;
export async function requireAdminPage(action: ActionId): Promise<Principal>; // páginas: notFound() como hoje
```

Ordem fixa: modo (env) → principal (cookie admin; ou `zswap_session` + fontes legadas se o modo permitir) → CSRF
(não-GET) → permissão da ação (mapa no código) → MFA/step-up → resultado. Negações para quem **não** tem sessão admin
válida: `notFound()`/404, como hoje. Para quem tem: `403 {"error":"forbidden","action"}` ou `401
{"error":"step_up_required"}` — o operador já sabe que o Admin existe, e "403 mudo como 404" atrasaria diagnóstico.
Toda negação grava evento **aguardado** (com teto de tempo), corrigindo AUTH-08.

Compatibilidade: `requireAdmin()` continua existindo como `authorizeAdmin(…, "admin.view")` e devolve `{ wallet }`
(no corporativo, `wallet = "corp:<identity_id>"` para os 10 handlers que usam o ator). A troca dos 79 handlers para
`authorizeAdmin(req, "<ação>")` é mecânica e gerada da matriz.

Teste de completude (ADM-011, substitui a parte de rotas de `portao.test.ts:98-118`): para cada método exportado de
cada `route.ts` sob `src/app/admin/api`, exige uma chamada `authorizeAdmin(req, "<ação>")` **no corpo do próprio
handler**, ação existente em `ACTIONS` cuja rota+método batem com o arquivo; páginas exigem `requireAdminPage`; layout
não conta. Rota ou método sem linha na matriz → falha.

Comando sensível com auditoria durável: a ação e o registro em `admin_audit` acontecem **numa RPC/transação**
(padrão de `early_access_transicionar`) que também re-confere, dentro do banco, que a sessão não foi revogada
(fecha a janela entre decisão e execução) e aplica a `idempotency_key`. Efeito externo (Telegram, CEX) = linha
`intent` antes; sem `intent` gravada, não executa.

### 4.8 Modelo de dados (schema privado)

Schema **`admin_private`** (não existe hoje; nome explícito para não colidir com um `private` genérico). Acesso só
pelo servidor: `revoke all on schema admin_private from public, anon, authenticated; grant usage … to service_role`;
`alter default privileges in schema admin_private revoke all on tables from public, anon, authenticated` e o mesmo
para `execute on functions` (funções nascem executáveis por `PUBLIC` no Postgres). Para o `supabase-js`
(`.schema('admin_private')`) o schema precisa entrar em "Exposed schemas" — com `USAGE` só para `service_role`, o
PostgREST nega `anon`/`authenticated`. Decisão final e testes com papéis reais ficam em R4
(`docs/ADMIN-SECURITY-DB-ACL.md`). RLS habilitada sem policies, como o resto do repo.

**`admin_identities`** — a allowlist.

| coluna | tipo / regra |
|---|---|
| `id` | uuid PK |
| `status` | `invited` \| `active` \| `suspended` \| `revoked` |
| `email_normalized` | text; único entre não-revogados (necessário para o convite; PII mínima) |
| `display_label` | text curto (ex.: função), opcional |
| `provider` | `google` \| `azure` |
| `expected_issuer` | ex.: `https://accounts.google.com` · `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/v2.0` |
| `expected_tenant` | domínio Workspace ou tenant id do Entra (placeholders na config) |
| `auth_user_id` | uuid → `auth.users(id)`, único, gravado no 1º login |
| `idp_subject` | text; único por `provider`; gravado no 1º login |
| `mfa_factor_id` · `mfa_enrolled_at` | fator TOTP verificado |
| `activation_code_hash` · `activation_expires_at` | código de uso único do 1º acesso |
| `failed_mfa_count` · `locked_until` | contador de força bruta |
| `legacy_wallet` | text opcional, **só** para correlacionar observação em R5; nunca concede nada |
| `invited_by` · `invited_at` · `activated_at` · `suspended_at` · `revoked_at` · `revoked_by` · `reason_code` | trilha; CHECK `invited_by <> id` |

**Papéis e permissões — no código** (`src/lib/admin/rbac.ts`): `ROLES` (`superadmin`, `security_admin`,
`operations`, `finance`, `support`, `analyst`, `auditor`, `growth`), `PERMISSIONS` e `ACTIONS` (rota+método →
permissão, `min_mfa`, `audit_required`) gerados da matriz (`docs/ADMIN-API-AUTHORIZATION-MATRIX.md`). Um teste
confere que o CHECK de `role` no banco é igual a `ROLES`. Permissões novas desta frente: `identity.read`,
`identity.invite`, `identity.revoke`, `identity.mfa_reset`, `roles.grant`, `roles.revoke`, `breakglass.use`.
Invariantes: `auditor` nunca recebe escrita; ninguém concede papel a si; `superadmin` e `security_admin` só com
aprovação de uma segunda pessoa; nada deriva de `tier_cache` ou de carteira.

**`admin_role_assignments`**

| coluna | regra |
|---|---|
| `id` uuid PK · `identity_id` → identities | — |
| `role` | CHECK igual a `ROLES` |
| `granted_by` · `granted_at` · `approved_by` (null se o papel não exige) | CHECK `granted_by <> identity_id`, `approved_by <> granted_by`, `approved_by <> identity_id` |
| `expires_at` | opcional (papel temporário) |
| `revoked_at` · `revoked_by` · `reason_code` | revogar = marcar; nunca apagar |
| índice | único (`identity_id`, `role`) onde `revoked_at is null` |

**`admin_sessions`**

| coluna | regra |
|---|---|
| `id` uuid PK · `token_hash` bytea único | sha256 do valor do cookie |
| `kind` | `corp` \| `breakglass` |
| `state` | `mfa_pending` \| `active` |
| `identity_id` (corp) · `breakglass_wallet` (break-glass) | um dos dois |
| `audience` | `'zswap-admin'` |
| `created_at` · `last_seen_at` · `absolute_expires_at` · `idle_timeout_s` | §4.4 |
| `aal` · `mfa_verified_at` · `step_up_at` | prova de MFA |
| `sb_user_id` · `sb_session_id` · `sb_refresh_token_enc` | refresh token cifrado AES-256-GCM (chave `ADMIN_SESSION_ENC_KEY`, AAD = `id`), só para step-up e logout global |
| `ua_hash` · `ip_prefix` | sinais grosseiros (/24, /48), não usados para negar sozinhos |
| `rotated_from` · `revoked_at` · `revoked_by` · `revoke_reason` | rotação e revogação |

**`admin_audit`** (append-only) — campos do plano §6 "Auditoria mínima": `id`, `occurred_at`, `request_id`,
`idempotency_key` (único com `action` quando presente), `actor_kind` (`corp`/`legacy`/`breakglass`/`system`),
`actor_identity_id`, `actor_session_id`, `actor_wallet_redacted` (legado/break-glass), `actor_roles` (no momento),
`action`, `target_type`, `target_ref_redacted`, `authz_decision`, `outcome` (`intent`/`succeeded`/`failed`/`denied`),
`failure_code`, `before_redacted`, `after_redacted`, `origin`, `evidence_ref`, `prev_hash`/`row_hash` (cadeia de hash,
opcional). Proteção: só `INSERT` para `service_role`; `UPDATE`/`DELETE`/`TRUNCATE` revogados de todos os papéis do app
+ gatilho `BEFORE UPDATE OR DELETE` e `BEFORE TRUNCATE` que levantam erro. `public.admin_audit_log` (54 linhas) fica
intacta e legível; em `dual`, `logAdminAction` continua gravando lá (compatibilidade) e o caminho novo grava em
`admin_audit`.

**`admin_approvals`** (dupla autorização; opcional até haver 2 superadmins): `id`, `action`, `payload_hash`,
`requested_by`, `approved_by`, `expires_at` (≤ 30 min), `used_at`, `state`; CHECK `approved_by <> requested_by`. A
ação só executa com aprovação válida, não usada, de `payload_hash` igual.

---

## 5. Modos e compatibilidade

`ADMIN_AUTH_MODE` (env do servidor). **Ausente = `legacy`** (hoje). Valor presente e inválido = Admin fechado (404)
+ alerta `high` + indicador no Health — erro de operador visível no deploy, sem abrir nada.

| modo | `zswap_session` + fontes legadas | sessão corporativa | break-glass | uso |
|---|---|---|---|---|
| `legacy` | aceita como hoje (3 fontes); cada admissão grava `admin_legacy_admit{fonte}` (observação R5.3, sem mudar decisão) | rotas `/admin-acesso` e `/api/admin-auth/*` → 404 | — | padrão; produção hoje |
| `dual` | aceita só as fontes de `ADMIN_LEGACY_SOURCES` (padrão `env,panel,tier`); principal legado tem todas as permissões **menos** identidade/papéis, exceto bootstrap (abaixo) | aceita, com RBAC + MFA + step-up aplicados | — | testes com 2 contas reais; transição |
| `corp` | recusa (404) | só ela | permitido na janela | alvo |

- **Bootstrap**: em `dual`, um principal legado de fonte **`env`** (só ela) pode `identity.invite` e `roles.grant
  superadmin` **enquanto houver menos de 2 superadmins ativos com MFA**; depois disso só corporativos gerenciam.
  Alternativa equivalente: seed por SQL do dono (runbook).
- `POST /admin/api/admins` (concessão por carteira) vira somente-leitura em `corp`; não se cria `platform_admins` novo
  a partir de `dual`.
- A borda (`middleware.ts`) continua sem decidir permissão (trava de `portao.test.ts:36-58`): em `dual`/`corp` aceita
  presença de `zswap_session` válido **ou** cookie admin com formato `za1_…`; em `corp` só o segundo. Quem decide é
  `authorizeAdmin`.

---

## 6. Break-glass

| item | regra |
|---|---|
| quando | SSO/Supabase Auth fora, ou ninguém com MFA disponível, e só em `corp` |
| pré-requisitos (guardados offline pelo dono) | acesso de admin ao projeto Vercel; carteira listada em `ADMIN_WALLETS` (de preferência hardware); este procedimento impresso |
| ativar | `ADMIN_BREAKGLASS_UNTIL=<instante ISO UTC>` no ambiente Production + redeploy. Vale só se estiver no futuro e a **≤ 24 h** de agora; inválido = desligado + alerta |
| entrar | login normal da carteira (`/api/auth/verify`) → `/admin-acesso/breakglass` → sessão `kind='breakglass'` (mesmo cookie admin, TTL = menor entre 1 h e a janela) |
| pode | `identity.read/invite/revoke/mfa_reset`, `roles.grant/revoke`, `security.read`, `security.killswitch.write`, `audit.read` — dupla autorização dispensada **só** aqui, com auditoria `breakglass.*` |
| não pode | exports, configuração financeira, liberação de automação, instruções a agentes |
| sinalização | alerta `high` na ativação e a cada uso (dedup 15 min); faixa vermelha no painel |
| desativar | apagar a variável + redeploy; revisão pós-incidente com o `admin_audit` do período |
| último recurso | SQL do dono no painel do Supabase (conta com MFA) para corrigir `admin_identities`/`admin_role_assignments` — roteiro pronto no runbook, registrado em `admin_audit` com `actor_kind='system'` na sequência |

Um `AUTH_JWT_SECRET` vazado permite forjar sessão de carteira; em `corp` isso só vale dentro de uma janela de
break-glass aberta pelo dono.

## 7. Recuperação com duas pessoas

| caso | procedimento |
|---|---|
| admin perdeu o TOTP | pedido fora de banda → superadmin A abre `identity.mfa_reset` (step-up) → B (≠ A, ≠ alvo; `superadmin` ou `security_admin`) aprova (step-up) → servidor apaga fatores, revoga sessões, volta a `invited` e gera código de ativação **mostrado só a B**, que entrega ao alvo |
| conta do IdP comprometida | **uma** pessoa revoga (contenção rápida); restaurar exige duas |
| superadmin sai da empresa | revogar no painel no mesmo dia + desprovisionar no IdP |
| só 1 superadmin disponível | ações de 2 pessoas ficam bloqueadas; usar break-glass. Por isso o gate de `corp` exige **≥ 2 superadmins + 1 `security_admin`** com MFA testado |
| último superadmin (ADM-009) | RPC recusa revogar/rebaixar o último `superadmin` ativo e o próprio acesso, com trava de linha; evento auditado |

---

## 8. Rollout e rollback (nunca tranca o dono)

| fase | o que muda | gate para seguir | rollback |
|---|---|---|---|
| F0 código | tudo entra com `ADMIN_AUTH_MODE` ausente; testes unitários e de rota; migration **local** (Postgres isolado) | CI verde; `legacy` idêntico ao atual (testes de regressão de `portao.test.ts`) | reverter commit |
| F1 observação | sem env nova; só a telemetria `admin_legacy_admit` em produção (após autorização de deploy) | 7+ dias de dados: quais fontes ainda são usadas | reverter commit |
| F2 config do dono | §9 num projeto Supabase de **teste**; depois produção: provedores, signups off, migration `admin_private` (autorizada), envs | `dual` num Preview com projeto de teste; 2 contas reais entram, MFA, revogação e conta não convidada recusada (ADM-013, ADM-008) | desligar provedores; remover env |
| F3 `dual` em produção | `ADMIN_AUTH_MODE=dual`; bootstrap de 2 superadmins + 1 `security_admin` | as 3 contas fazem login, step-up e um comando auditado; ensaio de revogação e de reset de MFA com 2 pessoas | `ADMIN_AUTH_MODE` removido (volta a `legacy`) |
| F4 encolher legado | `ADMIN_LEGACY_SOURCES=env,panel` → depois `env`; em seguida commit que **remove** o caminho `tier_cache` de `requireAdmin` (dados mantidos) | nenhuma admissão por fonte removida nos logs; ADM-002 | env anterior (antes do commit de remoção) |
| F5 `corp` | `ADMIN_AUTH_MODE=corp`; break-glass ensaiado com janela curta | ADM-012 ensaiado; `CURRENT-STATE`/ledger atualizados só depois das provas | `corp` → `dual` (env + redeploy); após F4 o `dual` só reabre `env` — nunca o legado universal |

O dono mantém em todas as fases: acesso ao Vercel, a carteira de `ADMIN_WALLETS` e a conta do Supabase. Mudança de
env no Vercel exige redeploy (minutos) — contar isso no tempo de rollback.

---

## 9. Configuração pelo dono (passo a passo, com placeholders)

Placeholders: `<SITE_URL>` (origem pública do app), `<SUPABASE_PROJECT_REF>`, `<DOMINIO_WORKSPACE>`,
`<ENTRA_TENANT_ID>`, `<NOME_APP>`, `<EMAIL_SUPORTE_ADMIN>`. Nomes de menu mudam com o tempo — conferir na
documentação vigente de cada fornecedor. **Fazer primeiro num projeto Supabase de teste.**

### 9.1 Supabase (painel do projeto)

1. Authentication → Sign In / Providers → **"Allow new users to sign up": OFF** (só usuários criados pelo convite entram).
2. Desligar Email (senha/magic link), Phone, Anonymous e Web3 como métodos de login, salvo uso decidido em outra frente. Conferir em conta de teste que o OAuth de usuário pré-criado continua funcionando.
3. Providers → **Google**: habilitar; colar Client ID e Client Secret (§9.2). Copiar a "Callback URL" mostrada (`https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`).
4. Providers → **Azure**: habilitar; Application (client) ID, Secret **Value** (§9.3); **Azure Tenant URL** `https://login.microsoftonline.com/<ENTRA_TENANT_ID>` (single-tenant).
5. Authentication → URL Configuration: Site URL `<SITE_URL>`; Redirect URLs **exatas**: `<SITE_URL>/api/admin-auth/callback` (produção) e, no projeto de teste, a URL do Preview/localhost usada. Sem curinga de `*.vercel.app`.
6. Authentication → Multi-Factor: TOTP habilitado; máximo de fatores por usuário = 2. Phone MFA desligado.
7. Sessões/JWT: manter padrões (a sessão admin própria governa). Recursos de time-box/inatividade/sessão única do Supabase não são necessários (conferir se dependem de plano pago antes de cogitar).
8. Data API → Exposed schemas: incluir `admin_private` **somente depois** da migration com grants aplicada e testada (R4).
9. Não criar Auth Hooks nem SAML SSO.

### 9.2 Google Cloud (projeto dentro da organização do Workspace)

1. Criar/escolher um projeto GCP **da organização** `<DOMINIO_WORKSPACE>`.
2. Google Auth Platform → Branding/Audience (tela de consentimento): tipo **Internal** (só contas da organização); nome `<NOME_APP> Admin`; e-mail de suporte `<EMAIL_SUPORTE_ADMIN>`; domínios autorizados incluindo o de `<SITE_URL>` e `<SUPABASE_PROJECT_REF>.supabase.co` (conforme a doc do Supabase para Google).
3. Escopos: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (não sensíveis).
4. Clients → Create client → **Web application**; Authorized JavaScript origins: `<SITE_URL>`; Authorized redirect URIs: **exatamente** a Callback URL do passo 9.1.3.
5. Colar Client ID/Secret **só** no Supabase (nunca no repositório nem no Vercel).
6. Admin Console do Workspace: exigir verificação em 2 etapas para a unidade organizacional dos admins (complementar ao TOTP; conferir a edição do Workspace).
7. No 1º teste, registrar se `identity_data` traz `hd` (ou `custom_claims.hd`); se trouxer, o servidor também confere; se não, valem app Internal + convite + `sub`.

### 9.3 Microsoft Entra ID (tenant `<ENTRA_TENANT_ID>`)

1. App registrations → New registration: `<NOME_APP> Admin`; **Accounts in this organizational directory only (single tenant)**; Redirect URI (Web) = Callback URL do passo 9.1.3.
2. Certificates & secrets → New client secret (validade ≤ 12 meses; agendar a rotação) → copiar o **Value** para o Supabase.
3. Token configuration → optional claims do ID token: `email` e `xms_edov` (a doc do Supabase para Azure o recomenda para tratar o e-mail como verificado — conferir a versão vigente). O desenho não depende do e-mail depois do 1º vínculo.
4. API permissions: Microsoft Graph delegadas `openid`, `email`, `profile` (e `User.Read` padrão); conceder consentimento de administrador.
5. Enterprise applications → este app → Properties: **Assignment required = Yes**; Users and groups: atribuir **usuários** admin individualmente (atribuição por grupo e Conditional Access exigem licença Entra ID P1 — não necessárias aqui).
6. Opcional sem custo: Security defaults do tenant exigem registro de MFA no IdP (complementar).

### 9.4 Vercel (variáveis novas; nomes propostos, valores do dono)

| variável | conteúdo | padrão se ausente |
|---|---|---|
| `ADMIN_AUTH_MODE` | `legacy` \| `dual` \| `corp` | `legacy` |
| `ADMIN_LEGACY_SOURCES` | subconjunto de `env,panel,tier` (só em `dual`) | `env,panel,tier` |
| `ADMIN_SESSION_ENC_KEY` | 32 bytes aleatórios (base64) — sela o cookie de fluxo e cifra refresh tokens | rotas corporativas desligadas |
| `ADMIN_ORIGIN` | origem canônica do Admin para a checagem de `Origin` (ou reutilizar `NEXT_PUBLIC_SITE_URL`) | `NEXT_PUBLIC_SITE_URL` |
| `ADMIN_BREAKGLASS_UNTIL` | instante ISO UTC ≤ 24 h à frente | desligado |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem (`docs/RUNBOOK.md:14-15`). Segredos dos
IdPs ficam no Supabase, não no Vercel.

### 9.5 Primeiras contas

1. Em `dual`, o dono (carteira em `ADMIN_WALLETS`) convida a si mesmo e a uma 2ª pessoa (`identity.invite`) e recebe os códigos de ativação.
2. Cada um entra pelo IdP, digita o código, cadastra o TOTP (+ reserva offline).
3. O dono concede `superadmin` à 2ª pessoa; a 2ª aprova o `superadmin` do dono (dupla autorização já valendo).
4. Ensaios obrigatórios antes de `corp`: revogação de sessão, reset de MFA com 2 pessoas, conta não convidada recusada, break-glass com janela de 30 min.

---

## 10. Testes de aceite deste desenho

| ID (plano §7) | cenário | como provar |
|---|---|---|
| ADM-001 | sem sessão em qualquer rota/página Admin | 404 em `legacy`/`dual`/`corp`; evento aguardado |
| ADM-002 | carteira `pilot` sem papel | 404 em `corp`; em `dual` sem fonte legada → 404 |
| ADM-003 | `auditor` faz POST no kill switch | 403; `admin_kv` inalterado; `admin_audit` `denied` |
| ADM-005 | auditoria falha numa escrita sensível | RPC aborta a transação; resposta de erro; estado inalterado |
| ADM-008 | identidade revogada com sessão aberta | próxima requisição nega; Supabase com `ban_duration` não emite nova sessão |
| ADM-009 | último superadmin remove a si | recusado; evento |
| ADM-011 | `route.ts`/método novo sem `authorizeAdmin` ou sem linha na matriz | CI falha (inclui os 2 casos da simulação AUTH-05) |
| ADM-012 | SSO indisponível | break-glass com janela funciona; fora da janela, não |
| ADM-013 | 2 contas Google/Entra reais | login + aal2 + step-up + revogação documentados com evidência |
| A-PKCE | `code` sem cookie de fluxo, cookie reutilizado, nonce trocado, verificador de outro navegador | todos recusados |
| A-VINC | mesmo e-mail com outro `sub`, outro tenant, e-mail não verificado | recusado; `signOut` global chamado |
| A-CSRF | POST sem `Origin`, com `Origin` alheio, `text/plain`, `Sec-Fetch-Site: cross-site` | 403 antes de qualquer efeito |
| A-FIX | id de sessão muda após callback, MFA e step-up; id antigo não vale | — |
| A-W4 | login de carteira de cliente, W4 e assinaturas inalterados | regressão dos testes atuais de `src/app/api/auth/**` |
| A-MODO | env ausente = comportamento atual byte a byte; valor inválido = fechado + alerta | — |

---

## 11. Decisões pendentes do dono

| ID | decisão | proposta |
|---|---|---|
| D-idp | Google Workspace, Entra ou ambos; domínios/tenant reais | ambos suportados; habilitar só o que existir |
| D-ttl | TTL absoluto / ociosidade / janela de step-up | 8 h / 30 min / 5 min |
| D-papeis | envelopes dos 8 papéis e quem precisa de 2 pessoas | matriz R2 + §4.8 |
| D-contas | as 2 (+1) pessoas iniciais e o canal fora de banda dos códigos | — |
| D-404 | 403/401 explícitos para quem já tem sessão admin | sim (§4.7) |
| D-adm-host | Admin em host dedicado (`<ADMIN_HOST>`, ex. subdomínio próprio) para isolar o cookie de XSS do app público | depois de `corp`; sem custo de SaaS, exige DNS + domínio no Vercel |
| D-schema | nome `admin_private` e exposição no Data API | decidir em R4 |
| D-retencao | retenção de `admin_sessions` (metadados) e `admin_audit` | sessões 90 dias após expirar; auditoria sem purga até política LGPD |

## 12. Fora de escopo

Login de carteira dos clientes, W1/W3/W4, swaps, tiers, Founder Pass, CEX/autopilot/DCA (nada é religado); migrar
`middleware.ts` → `proxy.ts`; SAML/SCIM ou qualquer SaaS pago; apagar `platform_admins`, `tier_cache` ou
`admin_audit_log`; aplicar migration ou env em produção sem autorização explícita.

## Apêndice — evidências

- `scratchpad/admin-cc2/auth/scan-auth.cjs` → `auth-scan.json`: chamadas de `requireAdmin`/`logAdminAction`, referências a `platform_admins`, `tier_cache`, `ADMIN_WALLETS`, cookie e superfícies por método.
- `scratchpad/admin-cc2/sim-portao.cjs <repo>`: reproduz `portao.test.ts:98-118` com 2 rotas falsas → `descobertos: []`.
- `scratchpad/admin-cc2/auth/db-auth-agregados.json`: as 3 consultas agregadas (sem PII) e a 4ª negada.
- `node_modules/@supabase/auth-js/dist/main/{GoTrueClient,GoTrueAdminApi}.js` e `lib/types.d.ts` (2.108.0): linhas citadas em §4.1.
- `node_modules/next/dist/docs/01-app/02-guides/authentication.md:1356-1362` (layout e auth), `…/server-actions.md:82` (checagem de origem só em Server Actions), `…/forbidden.md:4` (`forbidden()`/`unauthorized()` ainda experimentais — não usados aqui).
