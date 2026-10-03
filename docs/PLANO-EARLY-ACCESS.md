# PLANO — EARLY ACCESS (Fase 1)

> **CURRENT AUTHORITY: `docs/START-HERE.md`** · **CLASSIFICATION:
> ACTIVE_PLAN** (só para early access). Não execute este documento como
> estado atual sem consultar `docs/DOCUMENT-AUTHORITY.md`.
>
> **Status operacional ATUAL (03/10/2026, ledger L-026):**
> - **Phase 1:** inalterada — CERTIFIED_EXACT_SHA em
>   `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`.
> - **Phase 2:** implementação **CLOSED_IN_WORKING_TREE**, sem commit, C1 NÃO
>   criado, recert NÃO rodada, **NOT_CERTIFIED**; gate CLOSED. Especificação e
>   estado: `docs/PLANO-EARLY-ACCESS-FASE2.md`, `docs/CURRENT-STATE.md`. O F-01
>   do §15 abaixo está implementado no working tree (FIXED_NOT_RECERTIFIED).
>
> **Status operacional de 02/10/2026 (atestação C2) — HISTÓRICO, superado pelo de cima:**
> - **Phase 1: CERTIFIED_EXACT_SHA /
>   `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e`** (C1b; gate CLOSED, nada
>   deployado). `CERTIFIED_FEATURE_SHA=f1b4ec1…`, RECERT(C1b)=PASS
>   (`recert-c1b-f1b4ec1-20261002T095819Z`, ledger L-019). O C1 `f4af976`
>   teve RECERT FAIL (L-018). O C2 (atestação só docs) é
>   `CONTROL_PLANE_ATTESTATION_COMMIT`, **não** é CERTIFIED; é o commit que
>   traz este bloco (`CONTROL_PLANE_HEAD=THIS_ATTESTATION_COMMIT`). `RELEASE_CANDIDATE=NONE`. Ver `docs/CURRENT-STATE.md`.
> - **Phase 2: BLOCKED_NOT_STARTED / `PHASE2_CODE_EXISTS=NO`.** É a
>   NEXT_PHASE e parte do C2 (`PHASE_BASE_SHA` = SHA do C2). Branch
>   `early-access-phase2-email-double-optin-20261001`.
>
> **Status operacional anterior (01/10/2026), histórico e superado pelo de cima:**
> - **Phase 1: COMMITTED_FEATURE_CHECKPOINT /
>   `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`** (gate CLOSED, nada
>   deployado). `PHASE1_RECERT=BLOCKED` (teste não determinístico do F-10,
>   §15; correção no working tree, revisão 3). `CERTIFIED_FEATURE_SHA=NONE`.
>   Ver `docs/CURRENT-STATE.md`.
> - **Phase 2: BLOCKED_NOT_STARTED / `PHASE2_CODE_EXISTS=NO`.** É a
>   NEXT_PHASE; o trabalho corrente é `CONTROL_PLANE_REVIEW_AND_PHASE1_RECERT`.
>   Branch `early-access-phase2-email-double-optin-20261001`.
>
> O cabeçalho abaixo é o registro original da Fase 1.

> **Status geral:** 🟡 Fase 1 implementada **localmente**, nada deployado.
> **Base:** `43c484bd1fdc24cdbd8182914514d80d769deeb2` (runtime certificado
> `0d21874` é ancestral) · branch `whitelist-fundraising-readiness-20261001`.
> **Fonte de decisões:** `docs/WHITELIST-FUNDRAISING-DISCOVERY.md` §0
> (correções autoritativas A–H da auditoria externa).
>
> ⚠️ **NÃO FOI DEPLOYADO.** Nenhuma migration foi aplicada em banco hospedado,
> nenhuma variável foi configurada na Vercel, nada foi publicado. A rota pública
> nasce e termina esta fase **FECHADA** de propósito.

## 1. Objetivo

Uma lista pública de early access **independente** da identidade de produto
(`users`), sem colidir com a whitelist administrativa (`ADMIN_WALLETS`) nem com
o funding rate de perp, com:

- inscrição pública anti-enumeração, rate-limited, sem IP cru persistido;
- consentimento versionado e auditável;
- triagem administrativa com máquina de estados e audit **atômico**;
- export CSV seguro.

## 2. Escopo × fora de escopo

| Dentro | Fora (não fazer nesta fase) |
|---|---|
| migration `0068_early_access.sql` (3 tabelas, 3 funções, ACL, seed do gate) | qualquer tabela/rota `fundraising_*` (namespace reservado) |
| lib `src/lib/early-access/*` | pagamento, KYC/AML, wallet de depósito |
| `POST /api/early-access` | verificação de email (sem provedor), vínculo de carteira, conversão |
| admin: lista, detalhe, filtros, transição, métricas, CSV, painel | captcha |
| página `/early-access` (estado "em breve" enquanto fechado) | texto jurídico; páginas `/terms` `/privacy` `/risk-disclosure` |
| i18n `earlyAccess` (en/pt/es/zh) | `TeaserShell.tsx` / `PricingView.tsx` (formulários `localStorage`) |
| arnês SQL `supabase/tests/15_early_access_acl_estado.sql` | `users`/`0001`, migrations antigas, `Database` em `types.ts` |
| testes TS | whitelist admin, funding rate, PR #447, nav |

## 3. Schema (`0068_early_access.sql`)

| Tabela | Papel | ACL |
|---|---|---|
| `early_access_signups` | uma linha por email normalizado | RLS on, 0 policies; `REVOKE ALL` de `public, anon, authenticated, service_role`; `GRANT SELECT` a `service_role`. **Escrita só pelas RPCs.** |
| `early_access_events` | audit de domínio append-only (sem email) | RLS on, 0 policies; `REVOKE ALL` inclusive `service_role`; `GRANT SELECT` a `service_role` (F-04: sem INSERT) |
| `early_access_consents` | consentimentos append-only | idem events |

Constraints-chave: email já minúsculo/ASCII/≤254; `display_name` 2–80 sem
controle; `country ~ '^[A-Z]{2}$'`; carteira e chain ambos-ou-nenhum, chain
`evm|solana`; `status_reason` obrigatório em `rejected|blocked`;
`referred_by_signup_id <> id`; `wallet_verified_at ⇒ wallet_address`;
`converted_at ⇒ wallet_verified_at`; `converted_wallet ⇔ converted_at`;
**`terms_version`/`privacy_version` ≠ `'UNAPPROVED'`** (gate legal também no
banco). Carteira **declarada** não é única; unique parcial
`(wallet_chain, wallet_address) where wallet_verified_at is not null` — sem
`lower()` (Solana é case-sensitive; EVM chega checksummed da app).

Seed: `admin_kv('disable_early_access','true') on conflict (key) do nothing`.

## 4. RPCs (todas `SECURITY DEFINER`, `search_path = public, pg_temp`, EXECUTE só `service_role`)

| Função | Faz |
|---|---|
| `early_access_transicao_permitida(de, para)` | matriz pura (`immutable`) |
| `early_access_inscrever(...)` | insere signup + 2–3 consents + evento `created` na mesma transação; duplicado = evento `duplicate_attempt` **sem tocar** a linha existente; resolve referral sem oráculo; tenta candidatos de código (CSPRNG da app) até achar livre |
| `early_access_transicionar(id, para, ator, motivo)` | `FOR UPDATE` → valida → `UPDATE` → `INSERT` evento, uma transação; sem evento, sem mudança |

Matriz: `pending→approved|rejected|blocked` · `approved→rejected` (só se
`converted_at is null`) · `approved→blocked` · `rejected→pending` ·
`rejected→blocked` (abuso descoberto depois da rejeição) · `blocked→pending`
(desbloqueio). Proibidas: `blocked→approved`, `rejected→approved`, e qualquer
outra. Motivo obrigatório para `→rejected`, `→blocked`, `rejected→pending`,
`blocked→pending`.

Referral: sem recompensa nesta fase. IP igual **só sinaliza**
(`referral_flag='sinal_mesmo_ip'`), nunca bloqueia nem desfaz o vínculo
(NAT/IP compartilhado). Mesma carteira declarada → `referral_flag =
'sinal_mesma_carteira'`. Código inexistente → ignorado sem sinal externo.

## 5. Gate (`src/lib/early-access/gate.ts`) — fail-closed

Aberto **só se todos**: linha `disable_early_access` lida com sucesso e valor
exatamente `"false"`; `TERMS_VERSION ≠ "UNAPPROVED"`; `PRIVACY_VERSION ≠
"UNAPPROVED"`; `EARLY_ACCESS_HMAC_SECRET` em base64 canônico de ≥ 32 bytes não triviais (F-10). Linha ausente,
banco indisponível, erro de leitura, valor inválido → **fechado**. Não usa
`src/lib/admin/kill-switches.ts` (que tem caminho fail-open por desenho).

**A Fase 1 termina fechada:** seed `true` + versões `UNAPPROVED` + segredo
não configurado.

## 6. HMAC (`src/lib/early-access/hmac.ts`)

HMAC-SHA256 com `EARLY_ACCESS_HMAC_SECRET`, separação de domínio (`ip`,
`email`), hex truncado em 32. Sem segredo ⇒ `null` ⇒ rota não aceita.
Buckets: `ea:ip:<ip_hmac>`, `ea:em:<email_hmac>`, `ea:global:h`. **Nenhum IP
cru** em `rate_limits` nem na tabela.

## 7. API pública — `POST /api/early-access`

Ordem: content-type JSON → corpo ≤ 4 KiB (leitura com teto) → parse →
**gate** → origem → validação → RL IP (429) → honeypot/tempo mínimo (202
genérico, sem RPC, **sem consumir** RL email nem teto global — F-02) → RL email
(estouro = **202 genérico**, sem RPC) → teto global (503) → RPC. Sucesso, duplicado, bloqueado, email já tentado:
**sempre `202 {"ok":true}`**, `Cache-Control: no-store`. Erro de banco: 503
genérico, sem mensagem do Postgres. Não existe GET público.

## 8. API admin (todas `requireAdmin()`, 404 nunca 403)

| Rota | |
|---|---|
| `GET /admin/api/early-access` | lista com filtros (`status`, `country`, `has_wallet`, `q` prefixo de email, `limit ≤ 200`, `offset`), `?id=` detalhe com eventos e consentimentos, métricas por status, estado do gate com motivos |
| `POST /admin/api/early-access/transition` | `{id, to, reason}` → RPC atômica; espelho `logAdminAction` só **depois** do sucesso |
| `GET /admin/api/early-access/export` | CSV via `csvCell` em toda célula; padrão **sem PII** (id, status, país, origem, UTM, marcos, datas); `?email=1` e `?identidade=1` (nome/carteira) deliberados; conta antes e acima de 100 000 responde 413 `export_too_large` sem CSV parcial; **registrado em `admin_audit_log` com verificação de erro — sem registro, sem arquivo** |

Painel: `EarlyAccessPanel` (`ModuleId "early-access"`, categoria
`crescimento` → área `pessoas`). Não toca o módulo `whitelist`.

## 9. i18n

Namespace `earlyAccess` em en/pt/es/zh (trava `quatro-idiomas.test.ts`). Nenhum
texto jurídico: os rótulos de aceite citam "Termos de Uso"/"Política de
Privacidade" e a versão, sem conteúdo.

## 10. Threat model (resumo)

| Ameaça | Defesa |
|---|---|
| enumeração de email | resposta idêntica; bucket de email silencioso; sem GET |
| mass signup / bots | RL IP-HMAC, RL email-HMAC, teto global, honeypot, tempo mínimo, gate |
| PII em logs / rate_limits | HMAC; eventos sem email; `logSecurity` sem PII |
| escrita direta indevida | ACL: `anon`/`authenticated` sem nada; `service_role` sem `UPDATE/DELETE/TRUNCATE` em events/consents e sem escrita em signups |
| audit perdido | transição + evento na mesma função |
| CSV injection | `csvCell` |
| abertura acidental | 4 condições AND, cada uma fail-closed; CHECK no banco contra `UNAPPROVED` |
| sobrescrita por duplicado (UTM, carteira, referral) | `on conflict do nothing`; nenhum `UPDATE` no caminho público |
| canal lateral de tempo (novo vs duplicado) | **residual**: o duplicado faz menos escrita; mitigado por RL; registrado |

## 11. Testes

TS (vitest): validação, gate, HMAC, referral, rota pública (mocks), rotas
admin (mocks), CSV, matriz de estados com paridade TS↔SQL, fonte (sem IP cru,
sem import de servidor no cliente), i18n e registro de painel pelas travas
existentes. SQL: `supabase/tests/15_early_access_acl_estado.sql` contra
Postgres **descartável** com a imagem `supabase/postgres:17.6.1.127` (default
privileges reais da plataforma).

## 12. Rollback lógico

Nada foi aplicado fora daqui. Se for preciso desfazer depois de aplicado:
manter `disable_early_access='true'` (fecha a rota sem deploy); reverter o
código do PR; a migration é aditiva — remover exige migration nova
(`drop function …; drop table early_access_consents, early_access_events,
early_access_signups; delete from admin_kv where key='disable_early_access'`),
**nunca** editar a `0068`.

## 13. Depende do dono

1. **Fase 2 — double opt-in de email (BLOQUEADOR, ver §15).**
2. Texto jurídico aprovado de Termos e Privacidade → trocar `UNAPPROVED`
   (formato `^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`).
3. Gerar `EARLY_ACCESS_HMAC_SECRET` com `openssl rand -base64 48` e configurar.
4. Aplicar a `0068` no banco (fluxo normal de migrations).
5. Gravar `disable_early_access=false` quando quiser abrir — **só depois de 1–4**.
6. Link na navegação (`nav-items.ts`) — não adicionado.
7. Captcha (futuro), destino dos formulários `localStorage` (futuro).

## 14. Status por entrega (medido em 01/10/2026, local)

| Entrega | Status | Evidência |
|---|---|---|
| Discovery corrigido (§0 A–H) | 🟢 | `docs/WHITELIST-FUNDRAISING-DISCOVERY.md` §0 |
| Este plano | 🟢 | — |
| Migration 0068 | 🟢 local | cadeia 0001→0068 aplicada limpa em Postgres descartável (`supabase/postgres:17.6.1.127`, rede isolada, removido depois) |
| Arnês SQL | 🟢 local | `15_early_access_acl_estado.sql`: T15.1–T15.17 OK; `02_*` e `14_*` seguem OK na mesma cadeia |
| Lib (validate, gate, hmac, referral, estados, filtros, store, request) | 🟢 local | testes em `src/lib/early-access/*.test.ts` |
| Rota pública | 🟢 local, **fechada** | `src/app/api/early-access/route.test.ts` |
| Admin (rotas + painel) | 🟢 local | `src/app/admin/api/early-access/early-access-admin.test.ts`; travas `painel-desenhado`, `areas`, `portao` |
| Página `/early-access` | 🟢 local, estado "em breve" | gate lido no servidor; formulário só com gate aberto |
| i18n | 🟢 | `quatro-idiomas.test.ts` |
| Type-check / lint / suíte | 🟢 | `tsc` 0 erros; `npm run lint` 0 erros / **145 avisos = baseline certificado**, 0 nos arquivos novos/alterados; vitest 269 arquivos / 4073 testes (+1 arquivo de trava do painel) |
| Deploy / migração hospedada | ⏸️ | depende do dono (§13) |

### Arquivos existentes tocados (fora `early-access`)

| Arquivo | Por quê |
|---|---|
| `src/lib/admin/modules.ts`, `src/components/admin/panel-map.tsx` | registro do módulo `early-access` |
| `src/lib/i18n/messages.ts` | namespace `earlyAccess` ×4 |
| `src/lib/cex/execucao/rpcs-acl.test.ts` | catálogo A116: as duas RPCs DEFINER novas, com a 0068 como ACL — a trava as achou na primeira rodada da suíte |
| `src/lib/cex/conexoes-0063.test.ts` | lista explícita de migrations > 0062 ganhou a 0068 — mesma trava, mesmo motivo |
| `docs/ESTADO-ATUAL.md`, `docs/RUNBOOK.md` | ponteiro e configuração **futura** |

### Correção de regressão de lint (mesmo dia)

A primeira entrega reportou "146 avisos, todos pré-existentes" — **errado**. O
146º era desta fase: `EarlyAccessPanel` chamava `load()` (que faz setState) no
corpo de um `useEffect` (`react-hooks/set-state-in-effect`), e a conferência
"nenhum aviso nos meus arquivos" usava `eslint -f unix`, formatador que não
existe mais no ESLint atual — com stderr descartado, o grep vazio pareceu
limpo. Correção sem bypass: a leitura mora no efeito, todo setState no
callback da promessa, `AbortController` por execução (resposta velha não
sobrescreve a nova; nada escreve depois de desmontar), releitura por contador
para realtime e transição, busca de email aplicada no envio. Trava:
`src/components/admin/panels/early-access-panel.test.ts`. Contagem por arquivo
agora vem de `eslint -f json`.

### Armadilha registrada nesta entrega

Na ferramenta de edição usada nesta sessão, sequências `\uXXXX` escritas no
texto de um arquivo chegaram ao disco como o **caractere literal** — inclusive
U+2028, que termina linha em JavaScript e quebrou o `tsc` num regex. Corrigido
gerando a barra por código; varredura de caracteres invisíveis nos arquivos
novos limpa. Quem editar `validate.ts` deve conferir com `cat -A`.

## 15. Auditoria adversarial e hardening (01/10/2026)

Relatório: `zswap-local/reports/early-access-phase1-adversarial-audit-20261001.txt`
(fora do repo). Veredito original: PASS WITH FINDINGS (0 critical, 0 high,
1 medium, 9 low).

### PUBLIC_OPEN_BLOCKER=EMAIL_DOUBLE_OPT_IN (F-01, aberto) — *registro da auditoria de 01/10 (histórico); estado atual: implementado no working tree da Fase 2, FIXED_NOT_RECERTIFIED, ver `docs/PLANO-EARLY-ACCESS-FASE2.md`*

Sem prova de posse do email, quem envia primeiro grava nome, país, carteira,
handles, UTM e **consentimento** em nome do titular, e o titular não corrige
(o duplicado não altera nada, por desenho). Nada foi "corrigido" com mock:
não há token falso, `email_verified_at` nunca é gravado, e consentimento não
verificado **não** é tratado como prova do titular. Antes de abrir:

- escolher o provider de email;
- token de uso único, guardado só como hash, com expiração;
- rota de verificação que grava `email_verified_at`;
- consentimento confirmado pelo titular no ato da verificação;
- expiração e limpeza de inscrições não verificadas;
- fluxo para o titular verificado corrigir os próprios dados;
- anti-enumeração preservada (mesma resposta pública em todos os casos).

### Status dos findings

| ID | Situação | O que mudou / por quê |
|---|---|---|
| F-01 | **OPEN — bloqueia abrir o gate** | Fase 2 (acima) |
| F-02 | FIXED | filtro de robô antes do limite por email e do teto global; limite por IP continua cedo |
| F-03 | FIXED | sentinela `upper(trim)` = `UNAPPROVED` em TS, CHECK e RPC + formato explícito de versão |
| F-04 | FIXED | `service_role` só SELECT em events/consents (e signups) |
| F-05 | ACCEPTED_FOR_CLOSED_PHASE1 | residual de tempo (~0,3 ms no banco, novo × duplicado); sem sleep artificial |
| F-06 | FIXED | unique parcial por `(chain, lower() se evm)`; Solana sensível à caixa |
| F-07 | FIXED | `UltimaRequisicao`: só a última leitura de eventos escreve; cancelada ao fechar/desmontar |
| F-08 | FIXED | export conta antes; > 100 000 → 413 `export_too_large`, nunca CSV parcial |
| F-09 | REPO_WIDE_ADMIN_GUARD_FINDING | `portao.test.ts` aceita import como chamada — trabalho separado |
| F-10 | FIXED | segredo = base64 canônico de ≥ 32 bytes, não trivial; a chave são os bytes |
| F-11 | PHASE2 | entrega do código de indicação só ao titular verificado |
| F-12 | FIXED (parcial pedido) | export padrão sem PII; `?email=1` e `?identidade=1` deliberados e auditados; motivo do admin não deve ter PII |
| F-13 | LEGAL/PRIVACY PHASE | exclusão/anonimização com append-only |
| F-14 | SEPARATE SECURITY WORK | ACL de tabelas pré-existentes (`admin_kv`, `rate_limits`, `admin_audit_log`) |
| F-15 | PREEXISTING DOCUMENTED | confiança em `x-forwarded-for` fora da Vercel |
| F-16 | DOCUMENTED | dono das RPCs DEFINER; sem SQL dinâmico |

### Ordem final da rota pública (F-02)

tipo/tamanho → parse → gate → origem → validação → limite por IP → robô →
limite por email → teto global → RPC. O IP vem cedo (barato, protege a rota);
o robô vem antes das cotas compartilhadas (não as consome, e o veredito não
depende de estado de email nenhum).

### Regra para o motivo administrativo (F-12)

O motivo de rejeitar/bloquear/reverter vai para o audit **imutável** e para o
`admin_audit_log`. É texto operacional ("spam", "perfil incompleto") — nunca
nome, documento, contato ou outro dado do titular.
