# EXTERNAL GATES — preparação (NADA aplicado) · PV-A07

> ⚠️ **Registro posterior (14/10/2026, L-053):** R-01 (Vercel) e R-02 (`CEX_RECOVERY_HMAC_KEY`) foram **fechados** no
> release de 13–14/10 (código `6d1295b`). A chave já existe na Vercel (production + preview, tipo `sensitive`) e precisa ser
> **estável**: **não** executar de novo as instruções de instalação da seção R-02 nem recriar/sobrescrever a variável.
> Este documento descreve a preparação de 03–04/10; o estado atual está em `docs/CURRENT-STATE.md`.

> **Criado em:** 03–04/10/2026, lane B (`pre-vercel-forward-20261003T234200Z`), ledger L-031.
> **Este documento não altera nenhum provedor.** Cada seção diz o estado exigido, o estado conhecido
> (medido ao vivo em 03/10, L-029, salvo indicação), o preparo, quem age, como validar **só lendo**,
> como reverter, que evidência guardar e o **escopo**:
> **REL** = bloqueia o release com gate fechado · **EA** = só a abertura do early access ·
> **$** = só modos de dinheiro real.
> Nenhum valor de segredo aparece aqui. Comandos que **escrevem** em provedor estão marcados
> ⚠️ OWNER-ONLY e só rodam com autorização explícita do dono na conversa corrente.

## Resumo

| gate | escopo | estado conhecido | quem destrava |
|---|---|---|---|
| R-01 Vercel (conta/pagamento) | REL | 402 `DEPLOYMENT_DISABLED` em todas as URLs | dono + Vercel |
| R-02 `CEX_RECOVERY_HMAC_KEY` | REL | ausente na Vercel (nome) | dono (instalação) |
| Re-medição pós-desbloqueio | REL | feita em 03/10; repetir depois de R-01/R-02 | agente (só leitura) |
| Segredos `EARLY_ACCESS_*` | EA | 0 de 6 nomes presentes | dono |
| Resend (conta, região sa-east-1) | EA | NOT_PROVABLE (sem acesso) | dono + Resend |
| Domínio remetente | EA | não decidido (D-2) | dono |
| SPF / DKIM / DMARC | EA | SPF só Google; sem DKIM do Resend; **sem DMARC** | dono + DNS |
| Webhook do Resend | EA | rota não existe no app vivo | dono + Resend (depois do deploy) |
| Cron do early access | EA | não agendado (D-8) | dono + cron-job.org |
| Jurídico (Termos/Privacidade, D-9) | EA | `UNAPPROVED` no código | jurídico → novo C1 + recert |
| DCA/Pilot/Autopilot reais | $ | NO-GO; capacidades ausentes ao vivo | fora de escopo |

---

## R-01 — Vercel: conta/pagamento (REL)

- **Exigido:** URLs de produção respondendo pela aplicação (não 402); deploy permitido; checks de PR sem "Account is blocked".
- **Conhecido (03/10):** deployment `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ` (`25fc4b0`) READY, servido como HTTP 402 `x-vercel-error: DEPLOYMENT_DISABLED`; produção **fora do ar**.
- **Preparo:** nenhum técnico; a aplicação não muda para isto.
- **Dono / provedor:** regularizar a cobrança/conta na Vercel.
- **Validar (só leitura):**
  `curl -s -o /dev/null -D - https://swap-z-app.vercel.app/ | grep -iE '^HTTP|x-vercel-error'` → esperado `HTTP/2 200` e nenhum `x-vercel-error`.
  `gh pr checks 447` → check "Vercel" sem "Account is blocked".
- **Rollback:** n/a.
- **Evidência:** cabeçalhos antes/depois, data, ID do deployment servido.
- ⚠️ Ao desbloquear, a Vercel volta a servir `25fc4b0` (código atual de produção, com o P0 `creds_cipher` dormente). Isso **não** é release.

## R-02 — `CEX_RECOVERY_HMAC_KEY` (REL)

**Por que:** o alvo `53cd85a` lança `server_configuration_error` sem ela em `/api/cex/order`,
`/api/cex/order/status` e `cex/conexoes` (`src/lib/cex/fingerprint.ts`). O deploy do alvo **não** pode
prosseguir sem ela (runbook revisão 2, R-02).

**O que ela protege (para entender a rotação):** é a chave do HMAC que grava
(a) `credential_fingerprint` dos intents **manuais reais** — o recovery por `intentId` exige que a
credencial apresentada gere a mesma impressão — e (b) `credential_identity` das conexões em
`cex_conexoes`. Estado ao vivo em 03/10: **0 intents, 0 conexões** → instalar agora custa zero.

### Geração segura (⚠️ OWNER-ONLY, na máquina do dono, nunca no repositório)

```bash
umask 077
openssl rand -base64 48 | tr -d '\n' > /dev/shm/zswap-cex-key      # 48 bytes aleatórios, base64
# guardar uma cópia no cofre de senhas do dono ANTES de apagar (rotação/recuperação)
vercel env add CEX_RECOVERY_HMAC_KEY production < /dev/shm/zswap-cex-key   # lê do stdin, não ecoa
shred -u /dev/shm/zswap-cex-key
```

- Nunca colar o valor em chat, ticket, log, commit, `.env` versionado ou `NEXT_PUBLIC_*`.
- **Preview** (decisão do dono): se deployments de preview usam o **mesmo** banco de produção, usar o mesmo
  valor (as impressões gravadas precisam bater); se usam outro banco, valor próprio.
- Só depois disso o deploy do alvo faz sentido; a variável sozinha não muda nada em `25fc4b0`
  (o código atual não a lê).

### Validação de presença (só nomes, nunca valor)

```bash
vercel env ls production | awk 'NR>2 && $1 ~ /^[A-Z][A-Z0-9_]+$/ {print $1}' \
  | node scripts/release/check-env-names.mjs          # exit 0 = as 7 exigidas presentes
```

Medição de 03/10 com a lista viva: 6/7 presentes, **só `CEX_RECOVERY_HMAC_KEY` ausente**
(evidência `pre-vercel-forward-20261003T234200Z/01-*`).
Depois do deploy do alvo: painel admin → auditoria → check **`required_server_env`** (nomes presentes/ausentes,
nunca valor). Não existe "fingerprint" público da chave: compará-la exigiria ler o valor.

### Rotação (só se a chave vazar; ⚠️ OWNER-ONLY)

1. Pausar caminhos CEX: `admin_kv.disable_cex='true'` (kill-switch real; falha de leitura bloqueia).
2. Conferir que **não há intents manuais reais não terminais** (o recovery deles passaria a responder
   `recovery_not_bound`/divergência — fail-closed, mas o usuário perderia o recovery automático).
3. Gerar e instalar a nova chave (procedimento acima) e redeployar.
4. Conexões salvas passam a ter identidade diferente: o usuário recadastra a credencial (o versionamento da
   0063 registra a nova conexão; a antiga não é apagada).
5. `disable_cex='false'` só depois do smoke M1 (runbook R2.7).

### Rollback

- Antes do deploy do alvo: remover a variável não tem efeito (o código vivo não a lê).
- Depois do deploy: **não** remover — sem ela as rotas CEX falham fechado (é o comportamento seguro, mas
  é indisponibilidade). Voltar ao valor anterior só se ele estiver no cofre e não tiver vazado.

**Evidência:** saída de `check-env-names.mjs` (só nomes), data/hora, quem instalou; nunca o valor.

## Re-medição ao vivo pós R-01/R-02 (REL)

Mesmas consultas da L-029, todas em `begin transaction read only … rollback` (Supabase) e só leitura na Vercel:
`scripts/release/sql/fp_v1.sql` (esperado `864|74e742…` antes do forward), `scripts/release/sql/history-rows.sql`
comparado com a captura congelada por `scripts/release/compare-history.mjs` (esperado: 55 linhas íntegras),
deployment de produção = `25fc4b0`, nomes de env (acima). Qualquer drift → re-ensaiar antes de RC.

## Segredos do early access (EA)

`EARLY_ACCESS_HMAC_SECRET` (`openssl rand -base64 48`, base64 canônico ≥ 32 bytes — `docs/RUNBOOK.md`),
`EARLY_ACCESS_EMAIL_PROVIDER=resend`, `EARLY_ACCESS_RESEND_API_KEY` (`re_…`, do painel do Resend),
`EARLY_ACCESS_EMAIL_FROM`, `EARLY_ACCESS_PUBLIC_BASE_URL` (https, sem caminho),
`EARLY_ACCESS_RESEND_WEBHOOK_SECRET` (`whsec_…`, do painel do Resend).
- **Instalação:** ⚠️ OWNER-ONLY, mesmo padrão de stdin sem eco. **Não** abrem o gate sozinhos (versões legais
  `UNAPPROVED` e `disable_early_access='true'` continuam fechando).
- **Validar:** `check-env-names.mjs --escopo public_gate` (6/6) e, depois do deploy, o check `required_server_env`
  ("abertura do early access: 6/6").
- **Rollback:** remover as variáveis → gate fecha (condições 4/5).

## Resend, domínio remetente, SPF, DKIM, DMARC (EA)

- **Exigido (D-1, D-2):** conta Resend com domínio remetente verificado, região de envio `sa-east-1`; SPF com
  include do Resend no subdomínio de envio; DKIM `resend._domainkey`; DMARC publicado.
- **Conhecido (03/10, DNS público de `zettaword.global`, candidato presumido):** MX `smtp.google.com`;
  SPF `v=spf1 include:_spf.google.com ~all`; **nenhum** `resend._domainkey`, `send.*` ou `_dmarc`.
- **Preparo:** decidir o domínio (D-2); o painel do Resend gera os registros exatos — copiá-los literalmente.
  DMARC inicial recomendado em modo observação (`p=none` com `rua`), endurecendo depois (decisão do dono).
- **Validar:** `dig +short TXT resend._domainkey.<domínio>`, `dig +short TXT _dmarc.<domínio>`,
  `dig +short TXT send.<domínio>`, `dig +short MX send.<domínio>`; status "verified" no painel.
- **Rollback:** remover os registros (o envio do Resend para; o email Google atual não depende deles, exceto DMARC).
- **Evidência:** saídas de `dig` antes/depois.

## Webhook do Resend (EA)

- **Exigido:** endpoint `POST https://<base>/api/early-access/webhook/resend` cadastrado no Resend
  (eventos `email.bounced`, `email.complained`), segredo `whsec_…` em `EARLY_ACCESS_RESEND_WEBHOOK_SECRET`.
- **Conhecido:** a rota não existe no app vivo (`25fc4b0`); existe no alvo e foi provada no ensaio
  (assinatura Svix, ±5 min, idempotência, 401 sem segredo).
- **Validar:** sem assinatura → 401; evento de teste do painel → 200 `processado`/`ignorado`.
- **Rollback:** desativar o endpoint no Resend.

## Cron do early access (EA)

- **Exigido (D-8):** cron-job.org chamando `POST /api/early-access/cron` com `Authorization: Bearer <CRON_SECRET>`
  a cada 5 min (purga + retry). **Agendar só depois do deploy do alvo** (antes disso a rota não existe).
- **Conhecido:** não agendado; os crons existentes no cron-job.org não puderam ser inspecionados (NOT_PROVABLE)
  e hoje batem num 402.
- **Validar:** resposta 200 com `gate_aberto:false` enquanto fechado (só purga roda).
- **Rollback:** desativar o job.

## Jurídico — Termos e Privacidade (EA)

- **Exigido:** textos aprovados, com a Política nomeando o Resend e a transferência (D-9); versões aprovadas
  nas constantes `TERMS_VERSION`/`PRIVACY_VERSION` (`src/lib/early-access/legal-versions.ts`).
- **Conhecido:** `UNAPPROVED`.
- **Preparo:** nenhum código antes da aprovação. Depois: mudança das duas constantes → **novo C1** →
  recert no SHA exato → atestação.
- **Validar:** a versão aprovada aparece em `/api/early-access/verify` (preview) e nos consentimentos gravados.

## Modos de dinheiro real ($)

Fora deste preparo. Controles reais (runbook revisão 2, R2.6): `dca_real_liberado` e
`autopilot_cex_liberado` (ausentes ao vivo = FECHADO), `pause_dca`, `disable_cex`, `maintenance_mode`.
Nenhuma variável de ambiente controla isso.
