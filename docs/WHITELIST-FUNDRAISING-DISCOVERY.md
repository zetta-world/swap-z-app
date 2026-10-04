# WHITELIST + FUNDRAISING READINESS — FASE 0 · DISCOVERY

> ⚠️ **STATUS ATUAL (banner de 04/10/2026, DOC-STALE-EA, L-031) — o cabeçalho abaixo é HISTÓRICO.**
> A "lista pública" desta discovery virou o **Early Access**: Fase 1 `CERTIFIED_EXACT_SHA`
> `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` (L-019) e Fase 2 (email double opt-in) `CERTIFIED_EXACT_SHA`
> `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (L-027); **não** deployadas; gate público **CLOSED**.
> Fundraising (`fundraising_*`) segue **não iniciado** (decisão G abaixo). Estado vigente: `docs/START-HERE.md`
> e `docs/CURRENT-STATE.md`. O texto original segue intacto.

> **Status:** 🟢 Fase 0 (discovery, somente leitura) concluída · 🔴 Fase 1 não iniciada
> **Data:** 2026-10-01 · **Branch/worktree:** `whitelist-fundraising-readiness-20261001`
> **Natureza:** inventário + proposta. **Nada aqui é migration, rota ou código.**
> Nenhum arquivo além deste foi criado ou alterado. Nenhum banco foi consultado.
> A fonte do schema é **exclusivamente** `supabase/migrations/*.sql` versionado —
> o estado do banco hospedado **não foi inferido nem verificado**.

## 0. Correções autoritativas (auditoria externa: PASS WITH CORRECTIONS)

> Estas decisões **prevalecem** sobre qualquer trecho abaixo que diga o
> contrário. As seções afetadas foram ajustadas, mas em caso de dúvida vale
> esta lista. Implementação: `docs/PLANO-EARLY-ACCESS.md`.

| # | Decisão final |
|---|---|
| A | `display_name` é **obrigatório** (NFC, trim, 2–80 code points, Unicode humano permitido; controles, bidi overrides e zero-width problemáticos rejeitados). |
| B | `country` é **obrigatório**: ISO 3166-1 alpha-2, maiúsculo, validado contra **lista fechada real**. É **autodeclarado**, não geolocalização. |
| C | Estados reais: `pending`, `approved`, `rejected`, `blocked`. **VERIFIED não é status** (`email_verified_at`). **CONVERTED não é status** (`converted_at`). |
| D | Email: `trim` → NFC → minúsculas, ASCII, ≤254. **Sem** dot folding do Gmail, **sem** plus stripping, **sem** canonicalização por provedor. |
| E | Captcha **fora da Fase 1**. Defesas iniciais: honeypot, tempo mínimo, rate limit por IP-HMAC, rate limit por email-HMAC, teto global, gate fail-closed. |
| F | Formulários `localStorage` (`TeaserShell`, `PricingView`): **não alterar** nesta fase, **não migrar** dados, **não enviar** dados antigos ao servidor. |
| G | Fundraising: namespace **reservado** `fundraising_*`. Schema **não entra** na Fase 1. Depende de instrumento jurídico, risk disclosure, compliance e gate explícito posterior. |
| H | Versões legais: **não existe placeholder aceitável**. Enquanto não houver texto jurídico aprovado, `TERMS_VERSION = PRIVACY_VERSION = "UNAPPROVED"` e a rota pública **falha fechada**. |

Convenção de classificação usada no documento inteiro:

- **EXISTE** — implementado e em uso no código/schema versionado.
- **EXISTE PARCIALMENTE** — há peça reaproveitável ou vestígio, mas não cobre o requisito.
- **NÃO EXISTE** — nenhum objeto, rota, tabela ou texto encontrado.

---

## 1. Identidade da base

| Item | Valor |
|---|---|
| `git rev-parse HEAD` | `43c484bd1fdc24cdbd8182914514d80d769deeb2` ✅ = HEAD esperado |
| `git rev-parse HEAD^{tree}` | `1c6505a6c6bd12ac06d2d3ef6eb9f9a0598814d7` |
| `git status --short` (início) | vazio (árvore limpa) |
| `git merge-base --is-ancestor 0d21874b… HEAD` | exit 0 ✅ — runtime certificado é ancestral |
| Migrations no repositório | 67 arquivos, `0001_auth.sql` … `0067_acl_tabelas_financeiras.sql` |
| Stack observada | `next ^16.3.6`, `@supabase/supabase-js ^2.108.0`, `vitest ^4.1.9` (`package.json`) |

> ⚠️ O `CLAUDE.md` diz "Next.js 14"; o `package.json` diz `^16.3.6`. O código
> já usa `await cookies()` (`src/lib/auth/session.ts:81`), compatível com 15+.
> Irrelevante para esta fase, registrado para quem for escrever rotas.

Identidade **confere** → discovery prosseguiu.

---

## 2. Inventário do schema atual (fonte: `supabase/migrations/`)

### 2.1 Visão agregada

| Objeto | Quantidade | Observação |
|---|---|---|
| Tabelas | **42** (41 criadas + 1 renomeada: `einherjar_mensagens` → `ulfhednar_mensagens`, `0030`) | todas em `public` |
| RLS habilitada | **42/42** | `rate_limits` só a partir de `0014_rls_rate_limits.sql` |
| Policies (`create policy`) | **0** | default-deny proposital (`0014`, `0037` explicam por quê) |
| Views / materialized views | **0** | |
| Triggers | **0** | `0061` menciona e **rejeita** trigger de imutabilidade ("seria excesso") |
| Tipos enum | **1** | `public.cex_intent_state` (`0050`) |
| Funções | ~30 assinaturas | 3 `SECURITY INVOKER` antigas (`consume_rate_limit`, `apply_session_pnl`, `bump_session_trades`, com `search_path` fixado em `0026`); o resto `SECURITY DEFINER` com `search_path` fixo e `revoke … from public, anon, authenticated` + `grant execute … to service_role` (`0055`, `0057`, `0059`–`0066`) |
| `revoke` em **tabela** | 5 tabelas | só as financeiras: `cex_execution_intents`, `cex_fills`, `cex_conexoes`, `autopilot_positions`, `autopilot_position_effects` (`0064:2456`, `0067:42-46`) |
| Objetos ligados a `auth.*` do Supabase | **0** | `0037:18-27` explica: a sessão é JWT próprio, `auth.jwt()` devolveria NULL |

> ⚠️⚠️ **Achado relevante para toda tabela nova** (`0067:8-25`): sob os
> DEFAULT PRIVILEGES do Supabase, **toda tabela criada em `public` nasce com ALL
> para `anon` e `authenticated`**. RLS sem policy bloqueia SELECT/INSERT/UPDATE,
> mas **não bloqueia TRUNCATE, REFERENCES nem TRIGGER**. Só as 5 tabelas
> financeiras receberam `revoke`. Consequência para a Fase 1: **toda tabela
> `early_access_*` / `fundraising_*` tem de nascer com
> `revoke all on table … from public, anon, authenticated` explícito**, no
> padrão de `0064`/`0067`, e ganhar prova no arnês SQL (padrão
> `supabase/tests/14_acl_tabelas_financeiras.sql`).
>
> Fora do escopo desta fase, mas registrado: `users`, `admin_audit_log`,
> `platform_events`, `rate_limits`, `admin_kv`, `platform_admins`,
> `auth_nonces`, `tier_cache` **não** têm esse `revoke` no repositório. Se os
> default privileges de produção forem os medidos em `0067`, `anon` poderia
> `TRUNCATE` `admin_audit_log`. **Não verificado no banco hospedado** (proibido
> nesta fase). Recomenda-se um finding próprio, separado deste trabalho.

### 2.2 Tabelas — colunas, chaves, constraints

Legenda: PK = chave primária · FK = estrangeira · U = unique · CK = check.

#### Identidade / auth / admin

| Tabela | Migration | Colunas | Chaves / constraints | Índices |
|---|---|---|---|---|
| `users` | `0001` | `id uuid`, `wallet_address text`, `wallet_chain text`, `email text`, `email_verified_at timestamptz`, `created_at`, `last_seen_at` | PK `id`; U `wallet_address` **NOT NULL**; CK `wallet_chain in ('evm','solana')` **NOT NULL** | `idx_users_wallet` |
| `auth_nonces` | `0001` | `wallet_address`, `nonce`, `issued_at`, `expires_at` | PK `wallet_address` (1 desafio vivo por carteira) | — |
| `tier_cache` | `0001`, `0022`, `0047` | `wallet_address`, `tier`, `source`, `checked_at`, `expires_at` | PK `wallet_address`; CK `tier in (free,pro,trader,pilot)`; CK `source in (nft,subscription,admin,concessao,sem_pass,nao_checado)` (`0047`) | `idx_tier_expires` |
| `platform_admins` | `0016` | `wallet_address`, `granted_by`, `note`, `granted_at` | PK `wallet_address` | — |
| `admin_audit_log` | `0005` | `id`, `actor_wallet`, `action`, `target`, `payload jsonb`, `created_at` | PK `id` | `(actor_wallet, created_at desc)`, `(action, created_at desc)` |
| `admin_kv` | `0006` | `key`, `value text`, `updated_at` | PK `key`; seed `disable_swap`, `disable_cex`, `maintenance_mode` = `false` | — |
| `ulfhednar_mensagens` | `0029`, `0030` | `id`, `de`, `para`, `assunto`, `corpo`, `criado_em`, `lido_em`, `resposta`, `respondido_em` | PK `id` | parcial por `para` não lidas; `criado_em desc` |

#### Telemetria / abuso

| Tabela | Migration | Colunas | Chaves | Índices |
|---|---|---|---|---|
| `platform_events` | `0006` | `id`, `event_type`, `wallet_address` (nullable), `path`, `metadata jsonb`, `created_at` | PK `id` | por tipo, path, wallet (parcial), created |
| `rate_limits` | `0008`, `0014` | `bucket text`, `count int`, `reset_at` | PK `bucket` | `reset_at` |

Função: `consume_rate_limit(p_bucket, p_max, p_window_secs) returns boolean` —
upsert atômico sob lock de linha (`0008:20-37`), `SECURITY INVOKER`,
`search_path = public, pg_temp` (`0026`). **Sem `revoke execute`** — mas, sendo
INVOKER sobre tabela com RLS sem policy, `anon` não consegue gravar por ela.

#### Domínio de produto (sem relação com early access / fundraising)

Inventariadas, nenhuma relevante para os novos sistemas além de servirem de padrão:

`autopilot_sessions`, `autopilot_runs` (`0004`) · `autopilot_positions` (`0009`) ·
`market_brain` (`0011`) · `zion_suggestions` (`0012`) · `operations` (`0013`, `0024`;
U `ref`) · `paper_accounts`, `paper_positions` (`0015`) · `agent_lessons` (`0018`) ·
`lab_strategies`, `lab_runs`, `lab_results`, `lab_capital_log` (`0020`, `0023`) ·
`celeiro_fluxos`, `celeiro_genoma`, `celeiro_mutacoes` (`0027`) · `celeiro_posicoes`
(`0028`) · `cex_conexoes` (`0031`, `0063`) · `dca_planos`, `dca_ciclos` (`0032`–`0034`) ·
`pro_piscina_medicao`, `pro_piscina_veredito` (`0035`) · `mercado_vela`,
`mercado_cobertura` (`0036`) · `bancada_estrategia`, `bancada_rodada`,
`bancada_resultado`, `bancada_posicao` (`0037`+), `bancada_operacao` (`0041`) ·
`cex_execution_intents`, `cex_fills` (`0050`+) · `strategy_certificates` (`0052`) ·
`autopilot_position_effects` (`0064`).

**Padrões maduros reaproveitáveis encontrados nelas:**

| Padrão | Onde | Uso futuro |
|---|---|---|
| Máquina de estados em SQL como função `immutable` | `public.cex_transicao_permitida(de, para)` (`0051:26-56`) | transições de `early_access` e `fundraising_*` |
| Toda mudança de estado passa por **uma** RPC `SECURITY DEFINER` com ACL fechada | `cex_transicionar`, `0055` | RPC de transição + audit no mesmo commit |
| Append-only com dedupe por chave | `cex_fills` `unique (intent_id, dedupe_key)` (`0062`) | `fundraising_payment_events` |
| CHECK de coerência temporal / motivo obrigatório | `cert_revogacao_tem_motivo`, `cert_janela_coerente` (`0052`) | `reason` obrigatório em rejeição/bloqueio |
| `revoke all on table … from public, anon, authenticated` | `0064:2456`, `0067` | **toda** tabela nova |
| Prova contra Postgres real com default privileges do Supabase | `supabase/tests/02_*.sql`, `14_*.sql`, `README.md` | arnês das tabelas novas |

### 2.3 Classificação dos temas pedidos

| Tema | Classificação | Evidência |
|---|---|---|
| Tabelas service-role-only | **EXISTE** (todas) | 42/42 RLS sem policy; acesso só via `getSupabaseAdmin()` (`src/lib/supabase/server.ts:27`) |
| Objetos ligados a Supabase Auth | **NÃO EXISTE** | `0037:18-27` |
| Objetos de users | **EXISTE** | `users` (`0001`) |
| Objetos de admin | **EXISTE** | `platform_admins`, `admin_audit_log`, `admin_kv`, `ulfhednar_mensagens` |
| Audit log | **EXISTE PARCIALMENTE** | `admin_audit_log` é global, best-effort (ver §4.4), sem imutabilidade de banco |
| Rate limit | **EXISTE** | `rate_limits` + `consume_rate_limit` |
| Eventos / analytics | **EXISTE** | `platform_events` (page_view, dwell, security, error…) |
| Referrals | **NÃO EXISTE** | zero tabela/coluna; `referral` só em `src/lib/tier/fees.ts:130-137` = `referralFee` de agregador DEX (outro conceito) |
| Consentimentos | **NÃO EXISTE** no schema | consentimento do DCA é só de UI (`src/components/cex/DcaPanel.tsx:24,258`) |
| Email | **EXISTE PARCIALMENTE** | colunas `users.email`, `users.email_verified_at` existem e **nenhum código as escreve ou lê** |
| Dados pessoais | **EXISTE PARCIALMENTE** | wallet (pseudônimo), geo cidade + `cid` em `platform_events.metadata` (`src/app/api/beacon/route.ts:98-111`); **IP cru como chave** em `rate_limits.bucket` (ver §8.3) |
| Attribution / UTM | **NÃO EXISTE** | só `referrer` (hostname externo) no `page_view` |

---

## 3. Auth / users atual

### 3.1 Modelo de identidade (comprovado pelo código)

| Aspecto | Como é hoje | Onde |
|---|---|---|
| Identidade | **a carteira**. `users` = "one row per wallet that has ever signed in" | `0001:9-10` |
| EVM | SIWE/EIP-191 via `viem.verifyMessage`; normaliza para **EIP-55 checksum** (`getAddress`) | `src/lib/auth/siwe.ts:12-35` |
| Solana | SIWS ed25519 via `tweetnacl`; normaliza via `new PublicKey(a).toBase58()` | `src/lib/auth/siws.ts:14-51` |
| Mensagem assinada | texto fixo com nonce + `Issued At` | `src/lib/auth/challenge.ts:23-34` |
| Anti-replay | nonce 16 bytes, TTL 5 min, 1 por carteira (upsert), **consumido por `DELETE … RETURNING` antes de verificar** (A01) | `challenge.ts:47-67`, `src/app/api/auth/verify/route.ts:83-117`, teste `src/app/api/auth/desafio-de-uso-unico.test.ts` |
| Criação do user | `upsert {wallet_address, wallet_chain, last_seen_at}` `onConflict wallet_address`, **erro ignorado** (best-effort) | `verify/route.ts:125-130` |
| Sessão | JWT HS256 próprio (`AUTH_JWT_SECRET` ≥16 chars), `sub` = carteira, `chain`, iss `z-swap`, aud `z-swap-app`, 30 dias | `src/lib/auth/session.ts:12-60` |
| Cookie | `zswap_session`, `httpOnly`, `sameSite=lax`, `secure` em produção, `path=/` | `session.ts:70-83` |
| Middleware | só `/admin/:path*`; confere **sessão válida**, não permissão; 404 sem sessão | `src/middleware.ts:40-52` |
| Rate limit de auth | durável, `auth-nonce:<ip>` e `auth-verify:<ip>`, 20/min | `nonce/route.ts:19`, `verify/route.ts:21` |
| Email atual | coluna existe; **nunca escrita** (comentário "email stays null until captured") | `verify/route.ts:124` |
| Email verification | coluna existe; **NÃO EXISTE fluxo, provedor de email, nem token** (`package.json` sem resend/sendgrid/nodemailer/smtp/postmark/mailgun) | — |
| Supabase Auth | **não usado** | `0037:18-27` |

### 3.2 Perguntas obrigatórias

**"Uma pessoa sem wallet consegue existir hoje como usuário?"**

**Não.** `users.wallet_address` é `text unique not null` e `users.wallet_chain`
é `not null check in ('evm','solana')` (`0001:20-23`). O único caminho que cria
linha é `/api/auth/verify` após assinatura válida (`verify/route.ts:125`). A
sessão (`SessionClaims.sub`) **é** a carteira (`session.ts:17-21`). Não há
rota, RPC ou tela que crie `users` de outra forma.

**"Adicionar signup por email à tabela `users` é semanticamente correto ou
criaria mistura entre identidade de produto e lead/early-access?"**

**Criaria mistura — não é semanticamente correto.** Evidências, não preferência:

1. **Invariante de esquema.** Exigiria tornar `wallet_address`/`wallet_chain`
   nuláveis — quebra o contrato de `0001` e o tipo `UserRow`
   (`src/lib/supabase/types.ts:210-218`), usado como `Insert` obrigatório
   (`types.ts:721`).
2. **Métricas de produto seriam contaminadas.** `users` é contado como
   usuário/cadastro real em **5 lugares**:
   `src/app/admin/api/growth/route.ts:33-38` (rotula `signups.new1d/new7d` e
   funil "signed up → traded → autopilot → paid"),
   `src/app/admin/api/stats/route.ts:30-33`,
   `src/app/admin/api/command/route.ts:33-34`,
   `src/lib/admin/watchdog.ts:375-376` (digest diário no Telegram),
   `src/app/admin/api/users/route.ts:83`. Um lead por email viraria "signup" e
   "usuário total" sem nunca ter conectado carteira — exatamente a mistura de
   categorias que `src/lib/admin/modules.ts` (bloco "dashboard — DINHEIRO E
   USUÁRIO REAIS") existe para impedir.
3. **Semântica do campo `last_seen_at`/`created_at`** = momento em que a
   carteira assinou; não tem significado para um lead.
4. **Ciclo de vida diferente.** Lead tem estados de triagem (pendente,
   aprovado, bloqueado) e consentimento versionado; usuário de produto não.
5. O comentário de `0001:10` ("email … only captured for receipts / waitlist")
   é **intenção histórica nunca implementada** — não há escrita de `email` em
   lugar nenhum. Não deve ser lido como autorização de design.

**Decisão recomendada:** early access vive em tabelas próprias
(`early_access_*`). A ponte com `users` é **um vínculo opcional e tardio**
(estado CONVERTED, §14) quando a mesma pessoa assina com a carteira — nunca
uma linha de `users` sem carteira. As colunas `users.email` /
`users.email_verified_at` **não devem ser reaproveitadas** nem removidas nesta
iniciativa (remover = migration destrutiva fora do escopo).

### 3.3 Implicações para cadastro público SEM wallet obrigatória

- A rota pública de inscrição **não terá sessão** → identificador de abuso é
  o IP (padrão já aceito em `src/app/api/bancada/vitrine-publica.test.ts:29`:
  "a chave é o IP — numa rota ANÔNIMA é o único identificador que existe").
- Carteira informada no formulário é **declarada, não provada**. Só vira
  "verificada" quando a pessoa assinar SIWE/SIWS e o `sub` da sessão casar
  (reuso de `normalizeEvmAddress`/`normalizeSolanaAddress`).
- Normalização obrigatória: reusar `normalizeEvmAddress` (checksum) e
  `normalizeSolanaAddress` — **nunca** `toLowerCase()` em Solana (base58 é
  case-sensitive). Comparação EVM case-insensitive como em
  `src/app/admin/api/admins/route.ts:39` / `require.ts:95`.

---

## 4. Infraestrutura reutilizável

### 4.1 Mapa

| Peça | Arquivo | Reusar? | Nota |
|---|---|---|---|
| Cliente service-role | `src/lib/supabase/server.ts` | ✅ | guarda contra import no browser; trava `src/lib/supabase/nao-vaza-para-o-cliente.test.ts` percorre a árvore de imports |
| Rate limit durável | `src/lib/rate-limit.ts:92` `rateLimitDurable` | ✅ | **falha ABERTA** para o limitador em memória |
| `getClientId` | `src/lib/rate-limit.ts:127` | ✅ com ressalva | devolve IP cru → **hash antes de usar como bucket** (§8.3) |
| Normalização de carteira | `src/lib/auth/siwe.ts:12`, `siws.ts:14` | ✅ | |
| Sessão | `src/lib/auth/session.ts:92` `getSession` | ✅ | para vincular carteira verificada / CONVERTED |
| `requireAdmin` | `src/lib/admin/require.ts:28` | ✅ obrigatório | 404 nunca 403; trava `src/lib/admin/portao.test.ts` exige em toda superfície `/admin` |
| `logAdminAction` | `src/lib/admin/require.ts:110` | ✅ complementar | best-effort, engole erro → **não serve como audit imutável** (§4.4) |
| `logSecurity` / `recordEvent` | `src/lib/admin/track.ts:15,48` | ✅ | sinal de abuso (`early_access_rate_limited`, etc.); `event-durability.test.ts` exige `await` ou marcador `// telemetria:` |
| CSV seguro | `src/lib/admin/csv.ts` `csvCell` | ✅ obrigatório | neutraliza `= + - @ \t \r` sem quebrar números (A29) |
| Export CSV | `src/app/admin/api/ledger/export/route.ts` | ✅ como molde | `requireAdmin` + `Content-Disposition` + `no-store` |
| Paginação total | `src/lib/supabase/paginate.ts:38` `selectAllRows` | ✅ | falha alto em vez de truncar (A30) |
| Kill-switch / KV | `admin_kv` + `src/lib/admin/kill-switches.ts` | ✅ | nova chave para fechar inscrições |
| Realtime admin | `src/lib/admin/realtime.ts` `broadcastAdminRefresh` | ✅ | |
| Validação de entrada | `src/lib/validate.ts` (`sanitizePromptText`, `validateAddress`…) | ⚠️ parcial | não há zod/valibot no `package.json`; validação é manual — seguir o estilo |
| Pseudonimização de visitante | `src/app/api/beacon/route.ts:61-63` (`cid = sha256(ip|ua)[:16]`) | ⚠️ padrão a **melhorar** | SHA-256 **sem segredo** de IPv4 é reversível por força bruta (2³² entradas). Para dados novos: HMAC com segredo server-side |
| Formulários "waitlist" existentes | `src/components/teaser/TeaserShell.tsx:72-89`, `src/components/pricing/PricingView.tsx:263-282` | ❌ não reusar a lógica | gravam **só em `localStorage`**; ver §6.1 |
| Teste de rota com mocks | `src/app/api/cex/order/a127-binding.test.ts:74-97` (`vi.hoisted` + `vi.mock` de rate-limit, session, supabase, track) | ✅ molde | |
| Teste de fonte (regex sobre o arquivo) | `desafio-de-uso-unico.test.ts`, `csv.test.ts`, `portao.test.ts` | ✅ molde | |
| Arnês SQL real | `supabase/tests/README.md`, `02_*.sql`, `14_*.sql` | ✅ molde | rodar com default privileges do Supabase reproduzidos |
| Tipos do `Database` | `src/lib/supabase/types.ts` | ⚠️ **não registrar tabelas novas** | teto de inferência (ESTADO-ATUAL §5.3); seguir o contorno `const TABELA = "…" as never` de `src/lib/ulfhednar/mensagens.ts:43` / `src/lib/cex/conexoes.ts:68` |

### 4.2 Admin — o que já está maduro

| Necessidade | Existe? | Padrão a seguir |
|---|---|---|
| Lista de inscrições | **NÃO EXISTE** | modelo de `src/app/admin/api/users/route.ts` (lista + `?id=` detalhe) |
| Filtros / busca | **EXISTE PARCIALMENTE** | `?wallet=` em users; `?source=` com regex whitelist em `src/app/admin/api/backtest/route.ts:24`; `limit/offset` em `src/app/admin/api/audit/route.ts:14-21` |
| Mudança de estado | **EXISTE** (outros domínios) | grant/revoke em `src/app/admin/api/admins/route.ts:48-175`: valida, grava, **confere `error` e linhas afetadas** antes de auditar, nunca mente "feito" |
| Métricas | **EXISTE** | `growth/route.ts`, `sample.ts` (`gradeSample`, limiar de ruído 30) |
| Audit trail | **EXISTE PARCIALMENTE** | `admin_audit_log` + painel `AuditLogPanel.tsx` + `GET /admin/api/audit` |
| CSV export | **EXISTE** | `csvCell` + `ledger/export` |
| Registro de painel | **EXISTE** | `ModuleId` + `MODULE_REGISTRY` (`src/lib/admin/modules.ts`), `src/components/admin/panel-map.tsx`, área via `AREA_DA_CATEGORIA` (`src/lib/admin/areas.ts:148`); travas `painel-desenhado.test.ts` e `areas.test.ts` falham se faltar um dos três |

### 4.3 `requireAdmin` — propriedades garantidas

Três origens de permissão (`ADMIN_WALLETS`, `platform_admins`, legado
`tier_cache.source='admin'`), 404 com log em todas as negações
(`require.ts:48-87`), coberto por `portao.test.ts`. **Reusar sem alteração.**

### 4.4 Por que `admin_audit_log` não basta como audit de early access

- `logAdminAction` **engole qualquer erro** e nem lê o `{ error }` do insert
  (`require.ts:116-122`) — perda silenciosa possível.
- É chamado **depois** da mudança, em outra ida ao banco → não atômico.
- Sem `revoke`/trigger, "append-only" é só convenção (tipo `Update: never` em
  `types.ts:724`).

**Requisito proposto:** transição de estado + linha de auditoria de domínio no
**mesmo statement/RPC** (padrão `cex_transicionar`), em tabela com
`UPDATE/DELETE/TRUNCATE` revogados também de `service_role`. `logAdminAction`
continua sendo chamado como espelho no log global.

---

## 5. Colisões de namespace

### 5.1 "whitelist" já tem **três** significados no produto

| # | Significado | Onde |
|---|---|---|
| W1 | **Admin allowlist** = env `ADMIN_WALLETS` (read-only) | `src/app/admin/api/whitelist/route.ts`, `src/components/admin/panels/WhitelistPanel.tsx`, módulo `"whitelist"` (`modules.ts:533`, título "WHITELIST", "allowlist management") |
| W2 | **Allowlist de NFT do Founder** ("Whitelist automática em toda coleção futura") | i18n `pricing.founderWhitelist` (`messages.ts:1296`, `3227`, `5145`, `7063`), `FounderBenefits.tsx:17`, `docs/NFT-BRIEFING.md:80,150`; "allowlist 48h → público" do mint em `docs/PLANO-MESTRE.md` Fase E |
| W3 | **IP whitelist de corretora** | `src/lib/cex/errors.ts:41-42` (`ip_not_whitelisted`), `transak-server.ts:19` |

Mais usos técnicos genéricos (lista de símbolos/chains) em
`src/lib/zion/card-mapping.ts:20`, `src/lib/api/cex-spot.ts:19`,
`src/app/api/zion/route.ts:280`. E há `"swap-allowlist"` como módulo admin.

> ⚠️ Nota lateral (não alterar agora): o texto de `WhitelistPanel.tsx`
> ("Wallets with tier_cache.source='admin' bypass this list") está
> desatualizado — não menciona `platform_admins` (`0016`) nem a 0047.

### 5.2 "waitlist" já existe — e é ilusório

`TeaserShell.tsx` (usado por `/buy`, `/otc`, `/p2p`, `/nft` via
`OnrampView`, `OtcView`, `P2pView`, `NftView`) e o `MintModal` de
`PricingView.tsx` (`WAITLIST_KEY = "zswap_pricing_mint_waitlist"`, l.68)
**gravam o email apenas no `localStorage` do navegador** e mostram "você está na
lista". Nada chega ao servidor. `docs/PITCH-DECK.md:86,152` já descreve isso
como "Teasers with waitlists (localStorage)".

### 5.3 "funding" e vizinhos

| Termo | Já significa | Onde |
|---|---|---|
| `funding` | funding rate de perp | `src/lib/zion/funding.ts`, `src/app/admin/api/funding/route.ts`, `FundingPanel.tsx`, módulo `"funding"` ("FUNDING / BASIS"), `celeiro_fluxos.causa = 'funding'` (`0027`) |
| `founder` / Founder | **status vitalício do NFT Access Pass** | `FounderBenefits.tsx`, `PricingView.tsx:39-50,222`, `NormalPlansView.tsx`, `src/app/(plataforma)/pricing/page.tsx:8-12`, `src/lib/pricing/plans.ts:20` |
| `aporte` | capital entrando/saindo de agente simulado | `celeiro_fluxos.causa` (`0027:39`), `src/lib/celeiro/fluxo.test.ts` |
| `subscription` | origem de tier | `tier_cache.source` (`0001`, `0047`) |
| `allocation` | alocação de portfólio na UI | `DashboardView.tsx`, `useTrackedHoldings.ts` |
| `round` / rodada | rodada de bancada, round-trip | `bancada_rodada`, `docs/RUNBOOK.md:63,68` |
| `intent` | intent de ordem CEX | `cex_execution_intents`, enum `cex_intent_state` |
| `launch*` | Launchpad (token launch, teaser) e "barra de lançamento" (lab) | `src/app/(plataforma)/launchpad/`, módulo `"launch-gate"` |
| `campaign`, `fundrais*`, `investor`, `accredited`, `aml`, `payment_intent/event`, `risk disclosure`, `affiliate`, `utm_*`, `gclid/fbclid`, `x_username`, `early access` | **livres** | busca em `src`, `supabase`, `scripts` sem resultado relevante |

### 5.4 Recomendação de namespace (depois do inventário)

| Sistema | Prefixo DB | Pasta lib | Rota pública | Rota admin | Módulo admin |
|---|---|---|---|---|---|
| Early access | **`early_access_*`** | `src/lib/early-access/` | `/early-access`, `POST /api/early-access` | `/admin/api/early-access` | `"early-access"` |
| Fundraising | **`fundraising_*`** (inclusive pagamentos: `fundraising_payment_intents`, não `payment_intents`) | `src/lib/fundraising/` | `/fundraising` (só depois do gate jurídico) | `/admin/api/fundraising` | `"fundraising"` |

Por que **não** os outros candidatos:

- `whitelist_*` — W1/W2/W3 (§5.1).
- `waitlist_*` — colide com os formulários `localStorage` e com o comentário de
  `0001`; convidaria a "ligar" esses formulários direto na tabela sem consentimento.
- `launch_access_*` — ambíguo com `launchpad` e `launch-gate`.
- `/founders`, `founders_*` — **Founder já é um status de produto pago (NFT)**;
  uma página `/founders` para investidores confundiria comprador de NFT com
  investidor, o que é também um risco regulatório (§18).
- `funding_*`, `payment_intents` sem prefixo — colidem com funding rate e com o
  vocabulário de `intent` do executor CEX.

---

## 6. Gaps — public early-access list

### 6.1 O que existe

| Item | Classificação | Evidência |
|---|---|---|
| UI de captura de email | **EXISTE PARCIALMENTE** | `TeaserShell.tsx`, `PricingView.tsx` `MintModal` — só `localStorage`, regex `^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$` |
| Persistência servidor | **NÃO EXISTE** | |
| Dedup / normalização | **NÃO EXISTE** (só `trim().toLowerCase()` no cliente) | |
| Verificação de email / provedor | **NÃO EXISTE** | |
| Consentimento / versões legais | **NÃO EXISTE** | §9 |
| Referral / UTM | **NÃO EXISTE** | §10 |
| Admin de inscrições | **NÃO EXISTE** | |
| Anti-bot (captcha/honeypot) | **NÃO EXISTE** | nenhum Turnstile/hCaptcha/reCAPTCHA no repo; CSP em `next.config.mjs:58-67` (`form-action 'self'`, `connect-src 'self' https: wss:`) precisaria ser revista para um widget |

### 6.2 Gaps a fechar

1. Tabela de inscrições + tabela de eventos (audit de domínio) + consentimentos.
2. Rota pública `POST` com rate limit, anti-enumeração, idempotência.
3. Validação/normalização em módulo puro testável (`src/lib/early-access/`).
4. Admin: lista, filtros, transição auditada, métricas, CSV.
5. Formulários `localStorage` existentes: **fora da Fase 1** — não alterar,
   não migrar, não enviar dados antigos ao servidor (correção F).
6. Verificação de email depende de escolher um provedor (decisão do dono).

---

## 7. Gaps — fundraising readiness

### 7.1 Separação explícita

"Funding" no código = **funding rate de perpetual futures** (§5.3). Nada do
namespace `funding` será tocado ou reaproveitado.

### 7.2 Classificação

| Conceito | Classificação | Evidência |
|---|---|---|
| fundraising / investor / investment (captação) | **NÃO EXISTE** | `investment` só em prompt de ZION (`src/lib/zion/mode-prompts.ts`) |
| Campanha / rodada de captação | **NÃO EXISTE** | `campaign` sem ocorrência |
| Allocation de investidor | **NÃO EXISTE** | |
| Payment intent / payment event | **NÃO EXISTE** | Stripe ausente do `package.json`; Mercado Pago só em docs (`PLANO-MESTRE.md` Fase E) |
| KYC | **NÃO EXISTE (próprio)** | KYC de onramp é da **Transak**, terceiro (`src/app/(plataforma)/buy/page.tsx:5`); P2P "KYC tier" como roadmap (`P2pView.tsx:24`) |
| AML, accredited, jurisdiction | **NÃO EXISTE** | `jurisdiction` só em geo-routing de IA (`src/lib/ai/registry.ts`) |
| Risk disclosure | **NÃO EXISTE** | há disclaimers de produto (`AboutView`, `SwapCard`, `ExecuteSwap`, `RiskScanner`), nenhum documento versionado |
| Documentos de investidor / storage | **NÃO EXISTE** | nenhum uso de Supabase Storage em `src` |
| Contexto de negócio | **EXISTE em docs** | `docs/PLANO-MESTRE.md` Fase C ("Seed ~R$20k", "DECIDIR O INSTRUMENTO primeiro"), "GATE JURÍDICO … trava marketing público até fechar"; `docs/NFT-BRIEFING.md:95,111` (CVM, framing) |

> ⚠️ O repositório **não registra** que o gate jurídico foi fechado. Nada nesta
> fase afirma conformidade. Qualquer superfície de fundraising deve nascer
> **sandbox-only e atrás de flag desligada** (§13.3, §18).

---

## 8. Segurança

### 8.1 Padrão correto para a futura rota pública de inscrição (requisitos)

Derivado de `nonce/route.ts`, `verify/route.ts`, `vitrine-publica.test.ts`,
`rate-limit.ts`:

| Requisito | Desenho |
|---|---|
| Runtime | `export const runtime = "nodejs"; dynamic = "force-dynamic"`; respostas `Cache-Control: no-store` (como `nonce/route.ts:56-60`) |
| Bucket por cliente | `rateLimitDurable("ea:ip:" + hmac(ip), {windowMs: 3_600_000, max: ~5})` + rajada `{60_000, ~3}` |
| Bucket por email | `rateLimitDurable("ea:em:" + hmac(email_normalizado), {windowMs: 86_400_000, max: ~3})` — **estouro aqui NÃO devolve 429** (devolveria oráculo "este email foi tentado"); devolve a mesma resposta genérica e registra `logSecurity` |
| Teto global | `ea:global:hour` (padrão `q:global` em `quote/route.ts:157`) — proteção contra mass signup distribuído; estouro → 503 genérico + alerta |
| Persistência do limite | `rate_limits` (durável). Ele **falha aberto** para memória (`rate-limit.ts:88-91`); aceitável aqui porque sem DB o insert também falha |
| Anti-enumeração | **mesma resposta** (`202 {ok:true}`, mesmo corpo, mesmos headers) para: novo, duplicado, bloqueado, email-bucket estourado. Insert `on conflict (email_normalized) do nothing`; nunca `select` antes para decidir resposta |
| Idempotência | unicidade em `email_normalized`; reenvio = no-op silencioso; não atualizar campos de uma inscrição existente pela rota pública (impede sobrescrever UTM/carteira de outra pessoa) |
| Deduplicação | `unique(email_normalized)`; carteira **não** é única enquanto não verificada (§13.1) |
| Limite de payload | rejeitar `Content-Length` > 4 KB antes do `req.json()`; aceitar só `application/json`; allowlist estrita de campos (desconhecido → 400 genérico) |
| Origem | rejeitar `Origin` diferente do site (POST cross-site); `sameSite=lax` não protege rota sem cookie |
| Kill-switch | chave nova em `admin_kv` (ex.: `disable_early_access`), lida a cada request; padrão `src/lib/admin/kill-switches.ts` |
| Erros | nunca vazar `error.message` do Postgres na rota pública (contraste: `admin/api/audit/route.ts:23` vaza, mas é admin) |
| Telemetria | `recordEvent("early_access_submit", …)` sem email/IP crus; `await` ou marcador `// telemetria:` (`event-durability.test.ts`) |

### 8.2 Validação e normalização de campos

| Campo | Regra proposta |
|---|---|
| `email` | `trim` → NFC → minúsculas → máx. 254 chars, local ≤ 64; **fase 1: só ASCII** (rejeita homoglifos/IDN); regex estrutural + domínio com ponto. **Sem** dot folding, **sem** plus stripping, **sem** canonicalização por provedor (correção D) |
| `display_name` | **obrigatório** (correção A): NFC, trim, 2–80 code points, ao menos uma letra; rejeita `\p{Cc}`, bidi overrides, zero-width problemáticos |
| `country` | **obrigatório** (correção B), autodeclarado: ISO 3166-1 alpha-2 maiúsculo, validado contra lista fechada real no código; CHECK `~ '^[A-Z]{2}$'` no banco |
| `wallet` + `chain` | ambos ou nenhum; `normalizeEvmAddress` / `normalizeSolanaAddress`; CHECK `wallet_chain in ('evm','solana')` |
| `telegram` | opcional, `^@?[A-Za-z0-9_]{5,32}$`, armazenar sem `@` |
| `x_username` | opcional, `^@?[A-Za-z0-9_]{1,15}$` |
| `referral_code` (entrada) | opcional, alfabeto fechado (base32 Crockford), tamanho fixo |
| `utm_*` | cada um ≤ 100 chars, charset `[A-Za-z0-9._~\-+ ]`, NFC, sem controle |
| Texto livre (se houver) | NFC; rejeitar `\p{Cc}` exceto `\n`, bidi overrides U+202A–202E / U+2066–2069, zero-width U+200B–200D/U+FEFF; limite de tamanho; espelhar `sanitizePromptText` |
| Honeypot / tempo mínimo | campo oculto deve vir vazio; tempo entre render e submit ≥ ~2 s (sinal, não bloqueio absoluto) |

### 8.3 Achados laterais de privacidade (não corrigir nesta iniciativa)

- **IP cru em `rate_limits.bucket`**: todas as rotas usam
  `` `prefixo:${getClientId(req.headers)}` `` (ex.: `auth/nonce/route.ts:19`),
  então o IP literal fica persistido no banco até a linha ser sobrescrita.
  Contradiz parcialmente a postura "não guardamos o IP cru" de
  `docs/PLANO-ADMIN-INTEL.md:49-55`. A rota nova **não** deve repetir isso.
- `cid` do beacon = SHA-256 sem segredo (`beacon/route.ts:63`) — pseudônimo
  fraco. Para os dados novos, HMAC-SHA256 com segredo de env dedicado.
- `getClientId` confia no primeiro item de `x-forwarded-for`
  (`rate-limit.ts:128-129`); seguro na Vercel (que sobrescreve o header),
  falsificável fora dela. Já documentado como "defense-in-depth only".

### 8.4 Bot/spam — decisões em aberto

Captcha **NÃO EXISTE**. Turnstile seria o menos invasivo, mas exige: novo
segredo, mudança de CSP (`script-src`/`frame-src`) e um terceiro processando
dado do visitante (implicação de privacidade). **Decisão (correção E):
captcha não entra na Fase 1.** Defesas iniciais: honeypot, tempo mínimo, rate
limit por IP-HMAC, rate limit por email-HMAC, teto global e gate fail-closed.

---

## 9. Privacidade / consentimento

### 9.1 Inventário

| Item | Classificação | Evidência |
|---|---|---|
| `/terms` | **NÃO EXISTE** | nenhuma rota em `src/app` |
| `/privacy` | **NÃO EXISTE** | "privacy" no código = **modo de UI** que borra saldos (`ModeSwitcher.tsx:10`, `SettingsView.tsx:188`) — outro conceito |
| Risk disclosure versionado | **NÃO EXISTE** | só disclaimers inline |
| Cookie consent | **NÃO EXISTE** | beacon declara "no new cookies" (`beacon/route.ts:20`) |
| Marketing consent | **NÃO EXISTE** | |
| Terms acceptance / versionamento legal | **NÃO EXISTE** | |
| Texto jurídico | **NÃO EXISTE** e **não será inventado** | gate jurídico em `PLANO-MESTRE.md` |

### 9.2 Requisitos técnicos mínimos para coletar

**Fatos técnicos (implementáveis):**

| Campo | Requisito |
|---|---|
| `terms_version` | string não vazia, igual à constante publicada no servidor (rejeitar versão desconhecida/antiga). **`"UNAPPROVED"` nunca é aceito** — enquanto for o valor, a rota fica fechada (correção H) |
| `privacy_version` | idem |
| `accepted_at` | `timestamptz` do **servidor**, nunca do cliente |
| `source` | superfície que coletou (`early_access_page`, `teaser_nft`…), lista fechada |
| Flags de consentimento | `terms` e `privacy` **obrigatórios** (sem eles → 400 genérico); `marketing` **opcional, default false**, nunca pré-marcado |
| IP | **não armazenar cru**. `ip_hmac` = HMAC-SHA256(segredo, ip) truncado, se a auditabilidade exigir; política de retenção definida |
| User agent | **não armazenar** o UA cru; no máximo classe grossa (bot/navegador/SO) como `classifyUA` de `beacon/route.ts:24` |
| Auditabilidade | consentimento em tabela **append-only** (`early_access_consents`), uma linha por concessão/revogação, com versão — revogar marketing = nova linha, não `update` |
| Direitos do titular | rota/admin para exclusão/anonimização (LGPD art. 18) — requisito técnico de existir; prazos e base legal são decisão jurídica |

**Decisões jurídicas (NÃO tomadas aqui):** texto dos termos e da política; base
legal (consentimento vs legítimo interesse); retenção; se `country` e
handles sociais são necessários (minimização); idade mínima; transferência
internacional (Supabase/Vercel); se fundraising exige termos distintos;
jurisdições excluídas.

---

## 10. Attribution / referral

### 10.1 Inventário

| Item | Classificação | Evidência |
|---|---|---|
| Referral code / referrer de usuário | **NÃO EXISTE** | `referralFee`/`referralAccount` = taxa de integrador no agregador DEX (`src/lib/tier/fees.ts:130-137`; `quote/route.ts:484-507`) |
| Referrer HTTP | **EXISTE PARCIALMENTE** | hostname externo no primeiro `page_view` (`Beacon.tsx:45`, `beacon/route.ts:82-91`); painel `TrafficPanel.tsx:204` |
| UTM / click ids / affiliate / campaign | **NÃO EXISTE** | busca sem matches de `utm_`, `gclid`, `fbclid`, `affiliate`, `campaign` |

**Não há sistema reaproveitável de referral.** O referrer do beacon é
telemetria agregada, não atribuição por pessoa.

### 10.2 Requisitos (não implementar)

- **Código de referral:** gerado no servidor (CSPRNG, base32 Crockford, 8–10
  chars), `unique`; colisão → retry limitado; nunca derivado do email/carteira.
- **`referred_by`:** FK para a própria tabela, resolvida pelo código no
  momento da inscrição; código inexistente → ignorar silenciosamente (sem
  oráculo de "código válido").
- **Self-referral:** CHECK `referred_by_signup_id <> id`; e no servidor: mesmo
  `ip_hmac`, mesma carteira declarada ou email canônico igual ao do dono do
  código → aceitar a inscrição mas **não** creditar (marca `referral_flag`),
  sem revelar o motivo.
- **Ciclos / cadeias:** só 1 nível é registrado; nenhuma recompensa calculada
  na Fase 1 (recompensa por referral pode ter implicação jurídica).
- **UTM:** `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
  `utm_term` + `landing_path` + `referrer_host` — **first-touch**, gravados uma
  vez na criação e imutáveis. Captura no cliente: ler da URL de entrada e
  guardar em `sessionStorage` até o submit (sem cookie novo).
- **Last-touch:** desnecessário na Fase 1; se vier, em tabela de eventos
  separada, nunca sobrescrevendo first-touch.

---

## 11. Admin / dashboard / export

Proposta de superfície (padrões da §4.2):

| Peça | Comportamento |
|---|---|
| `GET /admin/api/early-access` | `requireAdmin`; lista paginada (`limit ≤ 200`, `offset ≥ 0` validados — o `audit/route.ts` atual aceita `NaN`), filtros `status`, `country`, `has_wallet`, `verified`, `source`, `utm_source`, intervalo de datas; busca por prefixo de email **normalizado**; `?id=` detalhe com histórico de eventos |
| `POST /admin/api/early-access/transition` | `requireAdmin`; corpo `{id, to, reason}`; chama RPC única que valida transição + grava evento atomicamente; responde com o que **de fato** mudou (padrão `admins/route.ts:152-173`) |
| `GET /admin/api/early-access/export` | `requireAdmin`; CSV via `csvCell`; colunas explícitas; email exportado só se o admin pedir (minimização); registra `logAdminAction("early_access.export", …)` |
| Métricas | totais por status, por dia, por país, por `utm_source`, taxa de verificação/conversão; `gradeSample` para não ler ruído como tendência |
| Painel | `EarlyAccessPanel.tsx`, `ModuleId "early-access"`, categoria `crescimento` → área `pessoas` |

Separação explícita: o módulo `"whitelist"` existente (W1) **não é tocado**;
o novo painel tem outro id, título e rota.

---

## 12. Proposta de arquitetura

```
                  PÚBLICO (sem sessão)                         ADMIN (requireAdmin, 404)
 ┌──────────────────────────────────────┐        ┌──────────────────────────────────────────┐
 │ /early-access (page, (plataforma))   │        │ EarlyAccessPanel → /admin/api/early-access│
 │   form → POST /api/early-access      │        │   lista · filtros · transição · CSV       │
 └────────────────┬─────────────────────┘        └───────────────────┬──────────────────────┘
                  │ valida (lib/early-access/validate.ts, puro)       │
                  │ rate limit ip/email/global (rateLimitDurable)     │
                  │ kill-switch admin_kv                              │
                  ▼                                                   ▼
        RPC early_access_inscrever(...)                RPC early_access_transicionar(id, para, ator, motivo)
                  │  SECURITY DEFINER, ACL service_role only          │
                  ▼                                                   ▼
  early_access_signups ──< early_access_events (append-only) >── early_access_consents (append-only)
                  │
                  └── converted_user_wallet ⇢ users.wallet_address (vínculo lógico, sem FK obrigatória)

  FUNDRAISING (sandbox, flag OFF, só admin na Fase 4)
  fundraising_campaigns ──< fundraising_applications ──< fundraising_allocations
                                    │
                                    └──< fundraising_payment_intents ──< fundraising_payment_events
  fundraising_documents (metadados + hash; sem storage)
```

Princípios:

1. **Sistemas independentes.** Nenhuma FK de `fundraising_*` para
   `early_access_*` é obrigatória; quando existir, é opcional (`on delete set null`).
2. **Uma porta por mudança de estado** (RPC), audit no mesmo commit.
3. **Tabelas fora do `Database` tipado** (contorno `as never`, §4.1) para não
   estourar o teto de inferência.
4. **ACL de tabela fechada** desde o nascimento + RLS sem policy.
5. **Best-effort em volta, fail-closed no que é decisão**: telemetria não
   derruba a rota; transição sem audit gravado **não acontece**.

---

## 13. Proposta de schema — ainda NÃO é migration

> Nomes e tipos são proposta para revisão. A numeração da migration só será
> escolhida na Fase 1, depois de conferir o mural e o último número
> (`migrations-ordenadas.test.ts`).

### 13.1 `early_access_signups`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK `gen_random_uuid()` | |
| `email_normalized` | `text not null` | **U**; CK `length ≤ 254`; CK `= lower(email_normalized)` |
| `display_name` | `text not null` | CK 2–80 chars, sem controle (correção A) |
| `status` | `text not null default 'pending'` | CK `in ('pending','approved','rejected','blocked')` |
| `status_reason` | `text` | CK: `status in ('rejected','blocked')` ⇒ `not null` (padrão `cert_revogacao_tem_motivo`) |
| `email_verified_at` | `timestamptz` | derivado "verificado"; só sai de NULL uma vez |
| `country` | `text not null` | CK `~ '^[A-Z]{2}$'`; autodeclarado (correção B) |
| `wallet_address` | `text` | declarada; normalizada na app |
| `wallet_chain` | `text` | CK `in ('evm','solana')`; CK ambos-ou-nenhum |
| `wallet_verified_at` | `timestamptz` | preenchido só com sessão SIWE/SIWS cujo `sub` = `wallet_address` |
| `telegram_handle`, `x_handle` | `text` | CK de tamanho |
| `referral_code` | `text not null` | **U** |
| `referred_by_signup_id` | `uuid` FK → `early_access_signups(id)` `on delete set null` | CK `<> id` |
| `referral_flag` | `text` | motivo de não-crédito (self-referral etc.), interno |
| `utm_source`/`utm_medium`/`utm_campaign`/`utm_content`/`utm_term` | `text` | CK `length ≤ 100`; first-touch, imutáveis |
| `landing_path` | `text` | CK `length ≤ 300` |
| `referrer_host` | `text` | CK `length ≤ 255` |
| `source` | `text not null` | lista fechada |
| `terms_version`, `privacy_version` | `text not null` | |
| `accepted_at` | `timestamptz not null` | relógio do servidor |
| `marketing_opt_in` | `boolean not null default false` | espelho do último consentimento |
| `ip_hmac` | `text` | nunca IP cru |
| `converted_at` | `timestamptz` | CONVERTED derivado |
| `converted_wallet` | `text` | carteira de `users` no momento da conversão |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Índices: `unique(email_normalized)`, `unique(referral_code)`,
`(status, created_at desc)`, `(created_at desc)`, parcial
`unique(wallet_address) where wallet_verified_at is not null` (carteira
**provada** só pode pertencer a uma inscrição; declarada pode repetir — evita
que alguém "ocupe" a carteira de outro), `(referred_by_signup_id)`,
`(utm_source, created_at desc)`.

ACL: `enable row level security`; `revoke all on table … from public, anon, authenticated`.

### 13.2 `early_access_events` (audit de domínio, append-only)

`id uuid PK`, `signup_id uuid not null FK on delete restrict`, `kind text not null`
(`created`, `status_changed`, `email_verified`, `wallet_verified`, `converted`,
`consent_changed`, `exported`, `erased`), `from_status`, `to_status`,
`actor text not null` (`public`, `system`, ou carteira admin), `reason text`,
`meta jsonb`, `created_at`.

ACL: `revoke all … from public, anon, authenticated`; para `service_role`
**apenas** `select, insert` (revogar `update, delete, truncate`). Imutabilidade
por **privilégio**, sem trigger (o repo não tem triggers; `0061:55` rejeitou
trigger por excesso — privilégio é a forma coerente com a casa).

> ⚠️ Tensão com LGPD: log imutável com PII. Proposta: o evento referencia
> `signup_id` e **não copia email**; o "apagamento" anonimiza a linha de
> `early_access_signups` (email → hash irreversível, handles/carteira → NULL) e
> registra evento `erased`. Validação jurídica necessária.

### 13.3 `early_access_consents` (append-only)

`id`, `signup_id FK`, `kind in ('terms','privacy','marketing')`, `version text not null`,
`granted boolean not null`, `source text not null`, `ip_hmac`, `created_at`.
Mesma ACL de 13.2.

### 13.4 Funções

- `early_access_transicao_permitida(de text, para text) returns boolean immutable`
  — espelho de `cex_transicao_permitida`.
- `early_access_inscrever(...)` — `SECURITY DEFINER`, `search_path = public, pg_temp`,
  insere signup + consents + evento `created` em uma transação, `on conflict do nothing`.
- `early_access_transicionar(p_id, p_para, p_ator, p_motivo)` — `FOR UPDATE`,
  valida pela função acima, exige motivo onde aplicável, grava evento; devolve
  linhas afetadas.
- Todas: `revoke all … from public, anon, authenticated; grant execute … to service_role`.

### 13.5 Fundraising (MOCK/SANDBOX)

> **Correção G:** namespace `fundraising_*` **reservado**; este schema **não
> entra na Fase 1** e depende de instrumento jurídico, risk disclosure,
> compliance e um gate explícito posterior. O desenho abaixo é hipótese.

Todas com `mode text not null default 'sandbox' check (mode = 'sandbox')` —
**registrar dinheiro real exige migration nova e consciente**, não uma flag.
Valores em **unidades menores inteiras** (`bigint`) + `currency text` (ISO 4217
ou símbolo de token em lista fechada) — sem `numeric` livre nem float.

| Tabela | Colunas-chave | Estados |
|---|---|---|
| `fundraising_campaigns` | `slug U`, `title`, `instrument text` (decisão jurídica pendente: NFT presale / equity / SAFE / convertível — `PLANO-MESTRE.md` Fase C), `currency`, `target_minor`, `min_ticket_minor`, `max_ticket_minor`, `opens_at`, `closes_at` (CK coerência), `terms_version`, `risk_disclosure_version`, `allowed_countries text[]`, `created_by` | `draft → open → closed`, `draft/open → cancelled` |
| `fundraising_applications` | `campaign_id FK`, `early_access_signup_id FK null`, `email_normalized`, `country`, `indicative_amount_minor` (**indicação de interesse, não compromisso**), `investor_type_self_declared`, `accredited_self_declared bool` (autodeclaração, **sem valor de verificação**), `risk_disclosure_version`, `accepted_at`, U `(campaign_id, email_normalized)` | `submitted → under_review → invited / declined`; `submitted/under_review/invited → withdrawn` |
| `fundraising_allocations` | `application_id FK U`, `amount_minor`, `expires_at` | `proposed → accepted / declined / expired`; `accepted → released` (cancelamento) |
| `fundraising_payment_intents` | `allocation_id FK`, `provider text check (provider = 'mock')`, `amount_minor`, `currency`, `idempotency_key U` | `created → pending → succeeded / failed / cancelled` (mock) |
| `fundraising_payment_events` | `intent_id FK on delete restrict`, `kind`, `payload jsonb`, `dedupe_key`, U `(intent_id, dedupe_key)` | append-only |
| `fundraising_documents` | `campaign_id FK`, `kind` (`terms`, `risk_disclosure`, `deck`…), `version`, `sha256`, `published_at`, `storage_path null` | imutável por versão |
| `fundraising_events` | audit de domínio, como 13.2 | append-only |

**Fora de qualquer fase técnica até decisão jurídica:** KYC/AML reais, wallet
de depósito, integração Stripe/Mercado Pago/cripto real, registro de
investimento real, afirmação de conformidade.

---

## 14. State machines

### 14.1 Early access — avaliação dos estados propostos

| Proposto | Veredito | Motivo |
|---|---|---|
| PENDING | **Necessário** (status) | estado inicial de triagem |
| VERIFIED | **Derivado** (`email_verified_at is not null`) | verificação é ortogonal à decisão: uma inscrição pode ser verificada E pendente, ou aprovada antes de verificar. Como status, forçaria uma ordem que não existe e perderia informação. E **não há provedor de email** hoje — o estado não seria atingível |
| APPROVED | **Necessário** | decisão humana |
| REJECTED | **Necessário** | decisão humana, reversível com motivo |
| BLOCKED | **Necessário**, distinto de REJECTED | abuso/fraude; mantém o email "ocupado" para impedir re-inscrição e sinaliza segurança; REJECTED é só "não agora" |
| CONVERTED | **Derivado** (`converted_at is not null`) | evento de sistema quando a carteira assina; ortogonal ao status (só faz sentido se `approved`) |

### 14.2 Transições permitidas (status)

| De \ Para | pending | approved | rejected | blocked |
|---|---|---|---|---|
| **pending** | — | admin | admin + motivo | admin + motivo |
| **approved** | ✗ | — | admin + motivo, **só se não convertido** | admin + motivo |
| **rejected** | admin + motivo (reconsiderar) | ✗ (passa por pending) | — | admin + motivo |
| **blocked** | admin + motivo + `logSecurity` high (desbloqueio) | ✗ | ✗ | — |

Marcos derivados:

| Marco | Quem | Condição | Reversível? |
|---|---|---|---|
| `email_verified_at` | sistema (token de verificação) | status ≠ blocked | **Não** (re-verificação = novo evento) |
| `wallet_verified_at` | sistema (sessão SIWE/SIWS com `sub` = carteira) | status ≠ blocked | Não |
| `converted_at` | sistema | status = approved e carteira verificada | **Não — irreversível**; depois disso status só pode ir a `blocked` |

**Quem muda:** rota pública só **cria** `pending`. Admin (`requireAdmin`) faz
todas as transições de status. Sistema faz os três marcos.
**Audit:** **toda** transição e todo marco gravam `early_access_events` no
mesmo commit; mudanças de admin espelham em `admin_audit_log`; desbloqueio e
export também geram `logSecurity`.

### 14.3 Fundraising — idem

Transições em função `fundraising_transicao_permitida(entidade, de, para)`;
terminais: campanha `closed/cancelled`; aplicação `declined/withdrawn`;
alocação `declined/expired/released`; intent `succeeded/failed/cancelled`.
Toda transição auditada em `fundraising_events`.

---

## 15. Proposta de rotas / API

| Rota | Método | Auth | Fase |
|---|---|---|---|
| `/api/early-access` | POST | pública + rate limit + origin + kill-switch | 1 |
| `/api/early-access/verify` | POST (token) | pública | 2 (depende de provedor de email) |
| `/api/early-access/link-wallet` | POST | `getSession()` | 2 |
| `/admin/api/early-access` | GET | `requireAdmin` | 1 |
| `/admin/api/early-access/transition` | POST | `requireAdmin` | 1 |
| `/admin/api/early-access/export` | GET | `requireAdmin` | 1 |
| `/admin/api/fundraising/*` | GET/POST | `requireAdmin` | 4 (sandbox) |
| `/api/fundraising/*` | — | — | **bloqueado** até gate jurídico |

Conflitos verificados: nenhum dos caminhos acima existe hoje em `src/app/api`
nem em `src/app/admin/api` (listagem completa conferida). `/admin/api/whitelist`
e `/admin/api/funding` **permanecem intocados**. `/api/risk` existe (scanner de
token, `src/app/api/risk/route.ts`) — por isso a página legal deve ser
`/risk-disclosure`, nunca `/risk`.

---

## 16. Proposta de UI

| Página | Local | Padrão | Fase | Conflito |
|---|---|---|---|---|
| `/early-access` | `src/app/(plataforma)/early-access/page.tsx` | página fina + `*View.tsx` client (como `launchpad/page.tsx`), `metadata` como `pricing/page.tsx` | 1 | nenhum |
| `/terms`, `/privacy`, `/risk-disclosure` | `src/app/(plataforma)/…` | página estática server, versão exibida | 3 (texto jurídico) | `/privacy` ≠ modo "privacy" da UI; não confundir chaves i18n |
| `/fundraising` | `src/app/(plataforma)/fundraising/` | — | 5+ | **não** usar `/founders` (Founder = NFT) nem `/funding` |

Requisitos de UI:

- i18n **sempre 4 locales** (`src/lib/i18n/messages.ts`, `en/pt/es/zh`;
  trava `quatro-idiomas.test.ts`) — namespace novo `earlyAccess` (livre).
- Nav: entrada única em `src/components/layout/nav-items.ts` se o dono quiser
  link (decisão de produto).
- Checkbox de termos/privacidade **não pré-marcado**; marketing separado.
- Mensagem de sucesso **idêntica** para novo/duplicado.
- **Formulários `localStorage` existentes (correção F):** **não alterados na
  Fase 1**, sem migração de dados e sem envio silencioso dos emails antigos ao
  servidor (não houve consentimento). Uma eventual troca por link para
  `/early-access` fica para fase futura e é **decisão do dono**.

---

## 17. Matriz de testes

### 17.1 Padrões existentes

| Tipo | Exemplo no repo |
|---|---|
| Rota com mocks (comportamento) | `src/app/api/cex/order/a127-binding.test.ts` (`vi.hoisted`/`vi.mock` de rate-limit, session, supabase, track) |
| Guarda de fonte (regex no arquivo) | `src/app/api/auth/desafio-de-uso-unico.test.ts`, `src/lib/admin/csv.test.ts` |
| Auth / admin | `src/lib/admin/portao.test.ts`, `src/app/admin/api/admins/*.test.ts`, `src/lib/admin/plano-nao-e-admin.test.ts` |
| Rate limit em rota pública | `src/app/api/bancada/vitrine-publica.test.ts` |
| CSV | `src/lib/admin/csv.test.ts` |
| Registro de painel | `src/lib/admin/painel-desenhado.test.ts`, `areas.test.ts` |
| Migrations | `src/lib/supabase/migrations-ordenadas.test.ts` |
| Vazamento server→client | `src/lib/supabase/nao-vaza-para-o-cliente.test.ts` |
| Durabilidade de evento | `src/lib/admin/event-durability.test.ts` |
| i18n | `src/lib/i18n/quatro-idiomas.test.ts` |
| SQL real (ACL, RLS, concorrência) | `supabase/tests/02_acl_rls_substituicao.sql`, `14_acl_tabelas_financeiras.sql`, `*.sh` de concorrência |

`vitest.config.ts`: ambiente `node`, `src/**/*.test.ts` — sem DOM; testes de UI
seguem sendo de fonte/lógica pura.

### 17.2 Matriz futura — early access

| # | Caso | Camada | Esperado |
|---|---|---|---|
| 1 | duplicate email | rota (mock) + SQL | 202 idêntico; 1 linha |
| 2 | mixed-case email | validate + SQL | `A@X.com` = `a@x.com`; 1 linha |
| 3 | Unicode (NFC/NFD, homoglifo, zero-width, bidi) | validate | NFD≡NFC; não-ASCII no email rejeitado (fase 1); controle/bidi rejeitado em texto |
| 4 | oversized fields / payload | rota | `Content-Length` > 4 KB → 413/400 genérico; cada campo no limite passa, +1 falha |
| 5 | invalid country | validate + SQL CK | `"BR"` ok; `"br"`, `"XX"`, `"BRA"` rejeitados |
| 6 | invalid wallet | validate | EVM inválido / Solana inválido / só um dos dois → 400 |
| 7 | same wallet on duplicate signup | SQL | duas inscrições com a mesma carteira **declarada** ok; ao **verificar** a 2ª, unique parcial impede |
| 8 | referral collision | lib + SQL | colisão de código gerado → retry; unique garante |
| 9 | self-referral | SQL CK + lib | `referred_by = id` impossível; mesmo ip_hmac/carteira → `referral_flag`, resposta idêntica |
| 10 | UTM limits | validate | 100 chars ok, 101 truncado/rejeitado (definir), charset fora → rejeitado |
| 11 | consent missing | rota | sem `terms`/`privacy` → 400 genérico, nada gravado |
| 12 | terms version | rota | versão ≠ atual → 400 |
| 13 | privacy version | rota | idem |
| 14 | rate limiting | rota (mock `rateLimitDurable`) | IP estourado → 429 + `Retry-After`; email estourado → **202** idêntico + `logSecurity` |
| 15 | enumeration | rota | corpo/headers/status idênticos para novo, duplicado, bloqueado |
| 16 | admin unauthorized | fonte + rota | toda rota `/admin/api/early-access*` chama `requireAdmin` (coberto por `portao.test.ts`) e responde 404 |
| 17 | CSV injection | export | email/utm começando com `= + - @ \t \r` saem com apóstrofo (`csvCell`) |
| 18 | state transition validation | SQL + lib | matriz 14.2 inteira: permitidas passam, proibidas falham, motivo obrigatório |
| 19 | immutable audit | SQL | `service_role` não consegue `update/delete/truncate` em `early_access_events`/`consents` (SQLSTATE 42501) |
| 20 | RLS default-deny | SQL (com default privileges do Supabase) | `anon`/`authenticated` sem nenhum privilégio de tabela; RLS on; 0 policies (padrão T14.1–T14.6) |
| 21 | kill-switch | rota | `disable_early_access=true` → 503 genérico, nada gravado |
| 22 | origin | rota | `Origin` estranho → 403/400 genérico |
| 23 | não vaza service key | fonte | page client não importa `lib/early-access/store.ts` (`nao-vaza-para-o-cliente.test.ts`) |
| 24 | conversão | rota (mock session) | sessão com `sub` ≠ carteira declarada não verifica; converted só com approved |
| 25 | IP nunca cru | fonte | bucket e coluna usam HMAC; regex proíbe `getClientId(...)` concatenado cru na rota nova |
| 26 | i18n | i18n | namespace `earlyAccess` nos 4 locales |
| 27 | painel registrado | admin | `painel-desenhado` / `areas` passam com o módulo novo |
| 28 | fail-closed de audit | rota (mock RPC erro) | transição sem evento gravado → resposta de erro, nunca "ok" |

### 17.3 Matriz futura — fundraising readiness (sandbox)

| Caso | Esperado |
|---|---|
| `mode <> 'sandbox'` | CK recusa em todas as tabelas |
| `provider <> 'mock'` | CK recusa |
| valores negativos / float | CK `> 0`, tipo `bigint` |
| campanha fechada / fora da janela | aplicação recusada |
| aplicação duplicada por email/campanha | unique |
| alocação > max_ticket ou soma > target | recusada pela RPC |
| replay de payment event | dedupe |
| transições inválidas (todas as entidades) | recusadas |
| audit imutável | igual a #19 |
| ACL/RLS | igual a #20 |
| nenhuma rota pública `/api/fundraising` | teste de fonte garante ausência até flag/gate |
| namespace | nenhum import de `src/lib/zion/funding.ts` em `src/lib/fundraising/**` e vice-versa |

---

## 18. Riscos

| # | Risco | Severidade | Mitigação proposta |
|---|---|---|---|
| R1 | Captação/coleta pública sem texto jurídico; `PLANO-MESTRE.md` trava marketing público até o gate jurídico | **Alta** | Fase 1 pode ser construída e testada, mas **publicação** depende de termos/privacidade aprovados; kill-switch default fechado |
| R2 | Fundraising sem enquadramento (CVM/valores mobiliários — `NFT-BRIEFING.md:95`) | **Crítica** | sandbox por CHECK de banco; nenhuma rota pública; nada de dinheiro real |
| R3 | Confundir Founder (NFT) com investidor | Alta | não usar `/founders`; textos distintos; tabelas sem FK para `tier_cache` |
| R4 | Tabelas novas nascerem com grant para `anon` (`0067`) | Alta | `revoke` explícito + teste SQL com default privileges reais |
| R5 | Enumeração de emails | Média | resposta idêntica, bucket de email silencioso |
| R6 | Mass signup / bots | Média | rate limits em 3 níveis + honeypot + teto global + kill-switch; captcha como decisão |
| R7 | Audit perdido (padrão best-effort) | Média | audit de domínio atômico na RPC |
| R8 | Estouro do teto de tipos do `Database` | Média | não registrar tabelas novas no `Database` (contorno `as never`) |
| R9 | Colisão de migration com outra sessão | Média | mural antes; `migrations-ordenadas.test.ts`; conferir último número na hora |
| R10 | Formulários `localStorage` prometem lista inexistente | Média (confiança) | decisão do dono sobre substituir por link |
| R11 | PII em log imutável vs direito de exclusão | Média | eventos sem email; anonimização da linha principal; validação jurídica |
| R12 | IP cru já persistido em `rate_limits.bucket` (todas as rotas) | Média (privacidade, pré-existente) | finding separado; rota nova usa HMAC |
| R13 | Tabelas antigas sem `revoke` (`admin_audit_log` etc.) | Média (pré-existente, **não verificado no banco**) | finding separado com prova em ambiente descartável |
| R14 | Verificação de email impossível sem provedor | Baixa (bloqueia só a Fase 2) | VERIFIED derivado; provedor é decisão |

---

## 19. Plano de implementação em fases

| Fase | Escopo | Pré-requisito | Status |
|---|---|---|---|
| **0** | Este discovery | — | 🟢 |
| **1** | Early access: plano `docs/PLANO-EARLY-ACCESS.md`; migration (`early_access_signups/events/consents` + RPCs + ACL); lib pura (validate/normalize/referral/hmac); store server-only; `POST /api/early-access`; admin (lista, transição, CSV) + painel; página `/early-access` atrás de gate dedicado **fail-closed** (`disable_early_access=true` semeado + versões legais `UNAPPROVED` + segredo HMAC ausente ⇒ fechado); i18n 4 locales; testes 17.2 (exceto Fase 2); arnês SQL | aviso no mural; decisão sobre segredo HMAC (nome de env) | 🔴 |
| **2** | Verificação de email + vínculo de carteira (`wallet_verified_at`, `converted_at`) | **decisão do dono:** provedor de email | ⏸️ |
| **3** | `/terms`, `/privacy`, `/risk-disclosure` com versões; abrir o kill-switch | **texto jurídico aprovado** | ⏸️ |
| **4** | (correção G: só depois de instrumento jurídico + risk disclosure + compliance + gate explícito) Fundraising **sandbox** só no admin (schema 13.5, RPCs, painel) | decisão do instrumento (PLANO-MESTRE Fase C) para nomear campos; flag OFF | ⏸️ |
| **5** | Qualquer superfície pública de fundraising / dinheiro real | gate jurídico fechado + nova migration consciente removendo o CHECK sandbox | ⏸️ fora do escopo |

---

## 20. Arquivos da Fase 1 (lista exata proposta)

> Numeração da migration é **provisória** (`0068`): conferir o último número e
> o mural na hora de criar.

**Criar:**

| Arquivo | Conteúdo |
|---|---|
| `docs/PLANO-EARLY-ACCESS.md` | plano com status (regra "documentar antes") |
| `supabase/migrations/0068_early_access.sql` | 3 tabelas, índices, CKs, 3 funções, `revoke`/`grant`, RLS |
| `supabase/tests/15_early_access_acl_estado.sql` | ACL/RLS (T14-like), imutabilidade, matriz de transição, CKs |
| `src/lib/early-access/types.ts` | tipos de linha e status (sem import de servidor) |
| `src/lib/early-access/validate.ts` | normalização/validação pura (email, país, carteira, handles, UTM, Unicode) |
| `src/lib/early-access/validate.test.ts` | casos 2–6, 10, 26 parcial |
| `src/lib/early-access/estados.ts` | matriz de transição espelhada do SQL (para UI/admin) |
| `src/lib/early-access/estados.test.ts` | caso 18 (lado TS) + paridade com o SQL por leitura de fonte |
| `src/lib/early-access/referral.ts` | geração de código CSPRNG + regras de self-referral |
| `src/lib/early-access/referral.test.ts` | casos 8–9 |
| `src/lib/early-access/hmac.ts` | HMAC de IP/email para bucket e coluna |
| `src/lib/early-access/store.ts` | acesso server-only via `getSupabaseAdmin` (`as never` no nome da tabela) |
| `src/lib/early-access/legal-versions.ts` | `TERMS_VERSION = PRIVACY_VERSION = "UNAPPROVED"` — **não é placeholder aceitável**: o gate fecha a rota enquanto for este o valor (correção H) |
| `src/app/api/early-access/route.ts` | POST público |
| `src/app/api/early-access/route.test.ts` | casos 1, 4, 11–15, 21–22, 25 |
| `src/app/admin/api/early-access/route.ts` | GET lista/detalhe |
| `src/app/admin/api/early-access/transition/route.ts` | POST transição |
| `src/app/admin/api/early-access/export/route.ts` | GET CSV |
| `src/app/admin/api/early-access/early-access-admin.test.ts` | casos 16, 17, 28 |
| `src/components/admin/panels/EarlyAccessPanel.tsx` | painel |
| `src/app/(plataforma)/early-access/page.tsx` | página + `metadata` |
| `src/components/early-access/EarlyAccessView.tsx` | formulário client |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `src/lib/admin/modules.ts` | `ModuleId` `"early-access"` + entrada no `MODULE_REGISTRY` (categoria `crescimento`) |
| `src/components/admin/panel-map.tsx` | import + mapeamento do painel |
| `src/lib/i18n/messages.ts` | namespace `earlyAccess` em en/pt/es/zh |
| `src/lib/admin/kill-switches.ts` | chave `disable_early_access` (ou leitor dedicado) — decidir na Fase 1 |
| `docs/RUNBOOK.md` | env do segredo HMAC + playbook de abuso |
| `docs/ESTADO-ATUAL.md` | ponteiro da entrega |

**Explicitamente NÃO modificar na Fase 1:** `src/app/admin/api/whitelist/route.ts`,
`WhitelistPanel.tsx`, `src/app/admin/api/funding/route.ts`, `FundingPanel.tsx`,
`src/lib/zion/funding.ts`, migrations existentes, `users`/`0001`,
`src/lib/supabase/types.ts` (`Database`), `TeaserShell.tsx`/`PricingView.tsx`
(salvo decisão do dono, §16), qualquer coisa de PR #447.

---

## Decisões que dependem do dono (resumo)

1. Provedor de email (destrava VERIFIED / Fase 2).
2. Captcha (Turnstile?) e mudança de CSP — **fora da Fase 1** (correção E); decisão futura.
3. Formulários `localStorage` atuais — **intocados na Fase 1** (correção F); destino futuro é decisão do dono.
4. ~~Coletar `country`?~~ **Decidido:** obrigatório, autodeclarado (correção B). Telegram/X seguem opcionais.
5. ~~Canônico de email~~ **Decidido:** sem canonicalização por provedor (correção D).
6. Instrumento de captação (define o schema final de fundraising).
7. Textos jurídicos e versões; retenção; base legal.
