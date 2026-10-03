# PLANO / ESPECIFICAÇÃO FINAL — EARLY ACCESS FASE 2: EMAIL DOUBLE OPT-IN (F-01, F-11)

> **CURRENT AUTHORITY: `docs/START-HERE.md`** · **CLASSIFICATION: ACTIVE_PLAN**
> (só para a Fase 2 do early access).
>
> | campo | valor |
> |---|---|
> | PHASE_BASE_SHA | `74f37f50d12dae698f14b620914bc0ce5b0c639a` (C2 da Fase 1, só docs, **não** CERTIFIED) · tree `5c93c0512b74777724aae62f665b10feaa95f760` |
> | CERTIFIED_FEATURE_SHA (Fase 1) | `f1b4ec1874ee41f7a7494c0d1b03c19e400cf71e` · tree `ab814e3ba6369a8b66218a9accc76a18ca6f14f6` |
> | branch / worktree | `early-access-phase2-email-double-optin-20261001` · `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/early-access-phase2-email-doubleoptin-20261001` |
> | STATUS | **FECHADA — CERTIFIED_EXACT_SHA no C1 `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`** (recert `recert-c1-53cd85a-v31-20261003T182216Z` PASS) e atestada no C2 (ledger L-027). Não deployada; gate CLOSED |
> | RELEASE_CANDIDATE | NONE · gate público **CLOSED** |
>
> **Este documento descreve o comportamento FINAL implementado** (0069, código,
> testes). Ele foi reescrito na rodada de fechamento (L-025, achado EA2-IA08)
> para não conter mais trechos do desenho inicial que o código superou. As
> versões anteriores ficam preservadas, byte a byte, dentro dos pacotes de
> auditoria (`PHASE2-DOCS.tar.gz`):
> `phase2-independent-audit-20261003T141825Z.tar.gz` (sha256 `991199db…331086a`) e
> `phase2-second-independent-audit-20261003T164829Z.tar.gz` (sha256 `d6695b78…f282b40`).
> O histórico de decisões e rodadas está no ledger L-020…L-025 e em
> `AUDIT-RECONCILIATION.md` §5.5.1–§5.5.3.

---

## 1. Escopo

**Fecha (em código, com o gate CLOSED):** F-01 (prova de posse do email) e
F-11 (código de indicação só para o titular verificado).

**Não abre nada.** No fim da fase: `disable_early_access=true`, versões legais
`UNAPPROVED`, nenhum segredo HMAC nem provider de email configurado em ambiente
nenhum. Abrir o gate é passo do dono, depois desta fase (`RUNBOOK.md`).

**Decisões da Fase 1 preservadas:** identidade do early access separada da auth
wallet-first (sem Supabase Auth, sem `users`); email canônico = trim + NFC +
minúsculas (sem dot folding nem plus stripping); `country` ISO alpha-2 e
`display_name` obrigatórios; `status` continua `pending|approved|rejected|blocked`
— VERIFIED e CONVERTED são marcos de tempo; nada de whitelist de admin,
`fundraising_*` nem automação financeira; a **0068 não é editada** (toda mudança
de schema está na **0069**).

## 2. Decisões do dono (vigentes)

| id | decisão | onde está no código |
|---|---|---|
| D-1 | provider **Resend**, região de **envio** `sa-east-1` (armazenamento do provider nos EUA → D-9) | `src/lib/early-access/email/{config,provedor,resend}.ts` |
| D-2 | domínio remetente, SPF, DKIM, DMARC, verificação no Resend: **EXTERNAL_SETUP_REQUIRED** | `RUNBOOK.md` (pré-requisitos do envio real) |
| D-3 | **TTL 24 h**; **retenção de não verificado 7 dias**; só hash; uso único; reenvio cria token novo e invalida os anteriores; nada estende TTL | 0069: `eav_ttl_24h`, unique parcial de token ativo, `ea_interno_emitir`, `early_access_purgar_nao_verificados` |
| D-4 | **aprovar exige email verificado**, invariante de banco | 0069: CHECK `ea_aprovado_exige_email` + erro `early_access_email_nao_verificado` |
| D-5 | nada revela existência/verificação; sem reenvio sem necessidade legítima | rota pública (resposta única) + `early_access_inscrever` |
| D-6 | na confirmação só `display_name` e `country` são corrigíveis; email nunca | `validarConfirmacao`, `early_access_confirmar_email` |
| D-7 | "não fui eu" autenticado pelo token; purga imediata; lápide mínima | `early_access_recusar_email`, `ea_interno_purgar` |
| D-8 | endpoint de cron preparado, **não agendado** | `/api/early-access/cron` |
| D-9 | Política de Privacidade nomeia o Resend e a transferência antes de abrir; texto legal não muda automaticamente | fora do código (versões seguem `UNAPPROVED`) |
| D-10 | webhooks de bounce/complaint autenticados, idempotentes, auditáveis | `/api/early-access/webhook/resend`, `early_access_registrar_webhook` |
| D-11 | envio real **fora da certificação**; nenhum envio real | nenhum teste toca a rede |
| EA2-A02 | marketing do formulário é **PROVISÓRIO**; só a escolha explícita do titular verificado vale; sem escolha = nenhuma permissão | §6 |

## 3. Fluxo

```
POST /api/early-access         (resposta pública sempre 202 {"ok":true}, Cache-Control: no-store)
  validação → limite por IP → robô → limite por email → teto global
  → token = 32 bytes CSPRNG (base64url, 43); só sha256("zswap-ea:verify\0"+token) vai à RPC
  → early_access_inscrever: novo = inscrição + 3 consentimentos do FORMULÁRIO + token;
    existente pendente/não verificado/não suprimido = token novo se cooldown/cap/teto/retenção deixarem;
    qualquer outro existente = só evento duplicate_attempt. Nunca altera dados de um existente.
  → se a RPC aceitou o hash: waitUntil(enviarConfirmacao) — DEPOIS da resposta

Email: link = EARLY_ACCESS_PUBLIC_BASE_URL + "/early-access/confirm#t=" + token   (fragmento: não vai ao servidor)

GET /early-access/confirm      página inerte (noindex, no-referrer); lê e APAGA o fragmento
POST /api/early-access/verify  { token, action: "preview" }  → nome, país, versões (não consome nada)
                               { token, action: "confirm", accept_terms_version, acknowledge_privacy_version,
                                 display_name?, country?, marketing_opt_in? } → confirma (uso único)
                               { token, action: "decline" }  → "não fui eu": purga imediata
POST /api/early-access/cron    (Bearer CRON_SECRET) purga por retenção (sempre) + retry (só com gate aberto)
POST /api/early-access/webhook/resend  (assinatura Svix) bounce/complaint → supressão
```

## 4. Token e ciclo de vida

| propriedade | implementação |
|---|---|
| geração | `randomBytes(32)` → base64url (`token.ts`); formato `^[A-Za-z0-9_-]{43}$` conferido antes de qualquer acesso ao banco |
| repouso | só `token_hash` = sha256 com separação de domínio, hex 64 (`eav_hash_formato`); o cru nunca vai a banco, log, evento ou `logSecurity` |
| transporte | fragmento `#t=`; a página apaga o fragmento antes de qualquer requisição; nenhum script de terceiro (Beacon e ErrorReporter mandam só `pathname`) |
| link | só a partir de `EARLY_ACCESS_PUBLIC_BASE_URL` (https, sem caminho); nunca de `Host`/`X-Forwarded-Host` (trava de fonte) |
| TTL | CHECK `eav_ttl_24h`: `expires_at = created_at + 24 h`; nada estende |
| ativos | no máximo **um** token ativo (nem consumido nem revogado) por inscrição — unique parcial |
| reenvio | `ea_interno_emitir` revoga os ativos **só depois** de todas as checagens passarem e insere o novo, na mesma transação (EA2-IA02). Suprimido (cooldown 10 min / 5 por 24 h por inscrição / teto global 600 por hora / retenção) = **nada muda** + evento `verification_suppressed` |
| retenção | não se emite token para inscrição com mais de 6 dias (nenhum link sobrevive à purga de 7 dias — EA2-A01) |
| uso único | `confirmar_email` trava inscrição → token (mesma ordem de lock de inscrever/reemitir), consome; repetição = `ja_confirmado` sem código; concorrência provada com duas sessões (16b) |
| `revoked_reason` | `superseded` (reenvio pedido pelo usuário), `send_failed` (retry do cron substituiu o token que não chegou), `confirmed` (confirmação revogou outro ativo) |

## 5. Estado de envio e retry

`early_access_verificacoes.send_status`:

| estado | significa | volta à fila automática? |
|---|---|---|
| `pending` | emitido, envio em curso (o `waitUntil`) | sim, se continuar `pending` por mais de 5 min (a função morreu) |
| `sent` | o provider aceitou (`provider_message_id` gravado) | não |
| `failed` | falha **transitória** (429, 5xx, rede/timeout, configuração ausente na hora) | **sim**, até a 3ª tentativa, enquanto o token valer |
| `dead` | falha **permanente** (400, 401, 403, 422, 2xx sem id válido) — **terminal** | **nunca** |

A classificação vem **explícita** do adaptador Resend (`transitorio`) e é
obrigatória numa falha: `early_access_registrar_envio(hash, ok, erro,
provider_id, p_transitorio)` recusa falha sem classificação (EA2-IA01).
`early_access_pendentes_de_envio` e `early_access_reemitir` aceitam exatamente
`failed` ou `pending` há > 5 min, tentativa < 3, inscrição pendente, não
verificada e não suprimida. Reenvio pedido pelo **próprio usuário** pelo
formulário depois de um `dead` é reenvio legítimo (D-3, sob cooldown/cap), não
retry automático.

## 6. Confirmação: o que o titular declara

A página mostra nome e país (corrigíveis), as versões vindas da preview, e o
botão **"Confirmar e aceitar os Termos"** com o texto: confirma que o email é
seu, **aceita** os Termos de Uso (versão X) e **declara ter recebido** a
Política de Privacidade (versão Y). O POST devolve exatamente essas versões; a
RPC recusa (`early_access_versao_divergente`, nada gravado) se faltarem ou
diferirem das da inscrição (EA2-IA05). Confirmar **não aprova** (status
inalterado).

Registro (`early_access_consents`, append-only; `declaracao` com CHECK
`ea_consent_declaracao`):

| origem (`source`) | terms | privacy | marketing |
|---|---|---|---|
| formulário (`early_access_page`) — declaração de quem enviou, possivelmente terceiro | `aceite` | `aceite` (o formulário diz "Aceito") | `provisoria` (**nunca** vale para envio) |
| confirmação (`email_confirmation`) — o titular verificado | `aceite` | `ciencia` (recebimento, não "consentimento") | `opt_in` \| `opt_out` \| `sem_escolha`, com `granted = (declaracao = 'opt_in')` |

Cada linha guarda a versão apresentada, `created_at` (momento), `source`
(contexto) e o HMAC do IP. O evento `email_verified` leva `meta.marketing`.

**Marketing tri-estado (EA2-A02, EA2-IA06, EA2-IA09):** rádio "sim"/"não" sem
seleção inicial; intocado = campo omitido.

| escolha | `marketing_efetivo` | `marketing_escolhido_em` | consentimento |
|---|---|---|---|
| opt_in | `true` | momento | `opt_in`, granted |
| opt_out | `false` | momento | `opt_out` |
| sem escolha | `false` | **NULL** | `sem_escolha` |

Invariantes de banco: `ea_marketing_escolha_exige_email` (momento só com
verificação), `ea_marketing_efetivo_exige_escolha` (efetivo só com momento). A
**única** escrita de `marketing_efetivo` no SQL inteiro é
`coalesce(p_marketing_opt_in, false)` dentro da confirmação (trava de fonte).

**Consentimento ≠ elegibilidade (EA2-IA04):** `marketing_elegivel` é coluna
**gerada** = `marketing_efetivo AND email_suppressed_at IS NULL`. Bounce ou
complaint posterior não reescreve o consentimento histórico, mas tira a
elegibilidade. Envio de marketing (que não existe nesta fase) só pode usar
`marketing_elegivel`.

## 7. Webhook, supressão e purga

- **Webhook:** sem `EARLY_ACCESS_RESEND_WEBHOOK_SECRET` válido, assinatura Svix
  inválida ou timestamp fora de ±5 min → 401, nada muda; o corpo só é lido
  depois da assinatura. `early_access_webhook_eventos` guarda **só**
  `evento_hash` (sha256 de mão única do svix-id), `tipo`, `resultado`,
  `recebido_em` — idempotência sem nada resolvível pelo provider (EA2-IA03).
  `email.bounced`/`email.complained` com alvo → `email_suppressed_at` +
  `email_suppression_reason` + evento `email_bounced`/`email_complained`;
  suprimido não recebe mais token.
- **"Não fui eu":** token ativo e válido de inscrição pendente não verificada →
  purga imediata (`declined`). Sem token válido, nada é apagado.
- **Retenção:** cron purga não verificadas com `created_at` > 7 dias
  (`unverified_retention`). Verificada nunca é purgada nesta fase (exclusão de
  verificada = F-13).

**O que sobrevive a uma purga, e por quê:**

| sobra | por quê | identifica a pessoa? |
|---|---|---|
| `early_access_purges` (id, `signup_id`, motivo, status no momento, `purged_at`) | prova auditável de que a purga ocorreu e por qual regra | não: uuid aleatório sem nenhum outro registro ligado a email, nome ou mensagem |
| `early_access_webhook_eventos` (`evento_hash`, tipo, resultado, `recebido_em`) | idempotência do webhook | não: hash de mão única; nenhum id de mensagem ou evento em claro |
| `admin_audit_log` de transições feitas antes da purga: ator (carteira do admin), ação, alvo (uuid), `{de, para, motivo_codigo}` | trilha do operador | não: só uuid + **código controlado**; texto livre não chega ali (EA2-IA07) |
| `rate_limits` com HMAC de email/IP (≤ 24 h) | anti-abuso da Fase 1 | não sem o segredo HMAC; expira sozinho |

Some: a inscrição (email, nome, país, handles, carteira declarada, UTM,
`status_reason`), eventos (inclusive a nota livre do operador), consentimentos
e tokens (inclusive `provider_message_id`). Não há invariante de bloquear
recriação: a mesma pessoa pode se inscrever de novo, do zero.

## 8. Admin

- Todas as rotas `requireAdmin()` (404, nunca 403).
- **Transição (EA2-IA07):** corpo `{ id, to, reason_code, note? }`.
  `reason_code` ∈ `approved_verified | rejected_policy | duplicate | abuse |
  owner_request | administrative_correction | other` (obrigatório); `note` ≤
  400, opcional. A RPC recebe `código` ou `código — nota` e grava em
  `early_access_events.reason`/`status_reason` (apagados na purga). O
  `admin_audit_log` (persistente) recebe **só** `{de, para, motivo_codigo}`. O
  campo antigo `reason` e qualquer campo extra são recusados. Nenhuma RPC da
  0069 escreve em `admin_audit_log`.
- Aprovar sem email verificado: 409 `early_access_email_nao_verificado`; o
  painel nem oferece o botão.
- **Export (CSV):** padrão sem PII; `?email=1` / `?identidade=1` deliberados e
  auditados. Colunas de marketing: `marketing_efetivo` (consentimento histórico),
  `marketing_escolhido_em`, `marketing_elegivel` (**o único que autoriza envio**),
  `email_suppressed_at`, `email_suppression_reason`. A declaração provisória
  `marketing_opt_in` não sai no export.
- Lista: filtro `verified=1|0`; métricas `verificados`, `suprimidos`.

## 9. Anti-enumeração e privacidade

Resposta pública idêntica para novo, duplicado, verificado, bloqueado, robô e
limite de email; envio depois da resposta. Em `/verify`, nenhuma resposta
depende de o token existir: inexistente, expirado, consumido, revogado ou de
inscrição bloqueada → sempre `invalid_or_expired`; erros de forma (campo,
versão ausente) são decididos antes de o token ser consultado. Para **envio**,
o email só sai do banco por `early_access_reemitir` (retry) — no servidor, só
para o provider; fora disso, só as rotas de admin o leem. Nenhum log/evento leva email,
token, hash de token ou valores corrigidos (`self_corrected` guarda só nomes de
campo). O email de confirmação não leva nome nem dado da inscrição.

## 10. Banco (0069) — objetos

Tabelas novas (RLS ligada, zero policies, `REVOKE ALL` inclusive de
`service_role`, só `SELECT` de volta): `early_access_verificacoes`,
`early_access_webhook_eventos`, `early_access_purges`. Colunas novas em
`early_access_signups`: `locale`, `email_suppressed_at`,
`email_suppression_reason`, `marketing_efetivo`, `marketing_escolhido_em`,
`marketing_elegivel` (gerada). Coluna nova em `early_access_consents`:
`declaracao` (NOT NULL + CHECK). CHECK de `kind` dos eventos refeito
(`ea_evento_kind_v2`).

RPCs (DEFINER, `search_path = public, pg_temp`, EXECUTE só `service_role`):
`early_access_inscrever` (23 args, substitui a da 0068), `early_access_registrar_envio`,
`early_access_pendentes_de_envio`, `early_access_reemitir`, `early_access_token_preview`,
`early_access_confirmar_email` (7 args), `early_access_recusar_email`,
`early_access_purgar_nao_verificados`, `early_access_registrar_webhook`,
`early_access_transicionar` (mesma assinatura + D-4). Internas (sem EXECUTE para
nenhum papel da aplicação): `ea_interno_emitir`, `ea_interno_purgar`.

## 11. Configuração (só nomes; nada configurado)

`EARLY_ACCESS_EMAIL_PROVIDER=resend` · `EARLY_ACCESS_RESEND_API_KEY` ·
`EARLY_ACCESS_EMAIL_FROM` · `EARLY_ACCESS_PUBLIC_BASE_URL` (as quatro: sem elas
o gate fecha — 5ª condição) · `EARLY_ACCESS_RESEND_WEBHOOK_SECRET` (sem ele o
webhook recusa tudo) · `CRON_SECRET` (existente). Detalhe: `RUNBOOK.md`.
`.env.example` não foi tocado (instrução do dono).

## 12. Testes

- **SQL** (Postgres descartável, cadeia 0001→0069): `16_early_access_email_optin.sql`
  (T16.1–T16.27 + 7b/9c/10a/3b; índice no cabeçalho do arquivo),
  `16b_early_access_confirm_concorrencia.sh` (confirmação concorrente; retries
  concorrentes), `15_early_access_acl_estado.sql` (adaptado à 0069: helper,
  contagem de funções, verificação antes de aprovar — nenhuma asserção
  removida), `02_*`, `14_*`.
- **TS:** `token.test.ts` (formato, hash, travas de fonte da 0069),
  `email/email.test.ts` (config, templates ×4, adaptador com `fetch` mockado,
  classificação ×9, webhook Svix), rota pública, `verify/route.test.ts`,
  `fase2-rotas.test.ts` (cron, webhook), `validate.test.ts`,
  `gate-hmac-referral.test.ts` (5ª condição), `estados.test.ts`,
  `early-access-admin.test.ts` (D-4, export, IA07), travas do repo
  (`rpcs-acl`, `conexoes-0063`, `nao-vaza-para-o-cliente`, `quatro-idiomas`, painel).

## 13. Rollback

Operacional: `disable_early_access=true` fecha inscrição e confirmação na hora;
remover `EARLY_ACCESS_EMAIL_PROVIDER` também fecha. Código: reverter o commit.
Banco: a 0069 é aditiva; desfazer exige migration **nova** (`0070_…`) que
recria `early_access_inscrever` de 21 args e `early_access_transicionar` da 0068,
restaura o CHECK de `kind` (depois de tratar os eventos novos), remove
`declaracao`, as colunas novas e as tabelas novas. **Nunca editar a 0069 depois
de aplicada.**

## 14. Ciclo de vida (`AI-OPERATING-RULES.md` §5)

| passo | estado |
|---|---|
| plano + `PHASE_BASE_SHA` (L-020) | 🟢 |
| decisões do dono (L-021, L-023) | 🟢 |
| implementação | 🟢 working tree |
| auditoria adversarial própria (L-022) | 🟢 |
| 1ª auditoria independente → EA2-IA01…IA06 corrigidos (L-024) | 🟢 |
| 2ª auditoria independente → EA2-IA07…IA09 corrigidos + auto-auditoria final (L-025) | 🟢 |
| verificação independente final (EA2-IA10 corrigido, L-026) → PASS | 🟢 |
| C1 `53cd85a` → recert completa no SHA exato (inclui **build**) PASS → C2 | 🟢 (L-027) |
