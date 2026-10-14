# RELEASE RUNBOOK — Z-SWAP

> **Revisão 2 (03/10/2026, ledger L-029) — VIGENTE.** Alvo: produto do
> `CERTIFIED_FEATURE_SHA=53cd85a2a86cc2f34d4234965ef3cf519ce7adc1` (Early Access Fase 2).
> Ensaiado num PROD-CLONE local (`release-rehearsal-20261003T194816Z`, CLOSED_PASS) e
> reconciliado com o estado AO VIVO (`live-readonly-reconciliation-20261003T221654Z`, CLOSED).
> **Nada aqui autoriza deploy.** (Estado de 03/10: `RELEASE_CANDIDATE=NONE` · `RC_SELECTION_READY=NO`.)
> A revisão 1 (candidato `0d21874`, 01/10) está preservada abaixo como **HISTÓRICO**, com errata.
>
> Evidência (fora do repo, máquina do laboratório, cada pacote com `MANIFEST.sha256`):
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/zswap-final-release-readiness-prodclone-20261003T213142Z.tar.gz`
> (sha256 `5196f1dab46dbb769ad32e4f7dc98cc0c78cf1fa272f808962600583223dd983`) e
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/zswap-live-readonly-reconciliation-20261003T221654Z.tar.gz`
> (sha256 `248acd987259ace36850fede4b979aac40e05d03d87277f2a8fca3c337086480`).

## R2.0 Registro de execução (14/10/2026, L-053 — escrito DEPOIS do release)

Esta revisão 2 foi a base do release de produção de 13–14/10, executado com o código
`6d1295bf43f4967b7e15498f1496c132fc09fa7a` (descendente de `53cd85a`; não o próprio `53cd85a`).
R2.1 e a coluna de estado de R2.2 descrevem **03/10** e ficam como histórico. Diferenças da execução em relação ao texto:

- **R-01 e R-02: CLOSED** (Vercel ativa; `CEX_RECOVERY_HMAC_KEY` presente por nome desde 13/10 23:50 UTC, valor nunca exibido).
- **Migrations 0059–0076** (não só 0059–0069) aplicadas, uma transação por arquivo com a linha de histórico, pela API de
  gerenciamento do Supabase; versões gravadas em timestamp (`20261014002533`…`20261014002550`) com `name` = nome do arquivo,
  como as linhas anteriores do hospedado (EG-05 decidido na execução). Histórico final: 73 linhas.
- **R2.3 item 2 (SHA marcado `RELEASE_CANDIDATE` antes)** e **item 6 (backup + restauração validada)**: **não cumpridos**.
  Não houve `pg_dump` do hospedado; só o rollback A (redeploy de `25fc4b0`) foi provado sobre o schema novo. Lacunas registradas.
- **R2.7 M1:** sem sessão, `POST /api/cex/order` com `{}` responde 401 `unauthenticated` (o gate de plano vem antes da
  confirmação, igual ao app anterior). O 400 `missing_confirmation` só vale para requisição autenticada — não exercitada.
- Evidência: `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/release/production-20261013/` (MANIFEST 60/60) e
  `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/post-release-governance-*`.

## R2.1 Estado medido ao vivo (03/10/2026 ~22:20 UTC, só leitura)

| item | valor | fonte |
|---|---|---|
| App em produção | `25fc4b0fa55db72472c7ae00af42596209d7c362` · deployment `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ` (READY) | Vercel CLI (inspect) |
| Borda da Vercel | **HTTP 402 `DEPLOYMENT_DISABLED`** em todas as URLs (`swap-z-app.vercel.app` e a do deployment); check do PR #447: "Account is blocked" | GET públicos + `gh pr checks 447` |
| Banco de produção | 55 linhas em `supabase_migrations.schema_migrations` (máx. `20260916101528`, nível 0058), 0059–0069 **ausentes**, fp_v1 `864\|74e742469c9088012d87caa88468dc9e` — **idêntico** à captura congelada de 28/09 (55/55 linhas iguais) | Supabase, transações `read only` |
| RLS / policies | 41/41 tabelas com RLS, 0 policies | idem |
| Atividade de dinheiro real | 0 sessões de autopilot, 0 conexões CEX, 0 intents; 1 plano DCA **simulado** (completo) | idem (agregados) |
| Par app+banco | `SAFE_KNOWN_SKEW` (P0 `creds_cipher`: o app pede a coluna, o banco não tem; dormente) | reconciliação |

## R2.2 BLOQUEADORES DO RELEASE (gate fechado) — estado de 03/10; R-01 e R-02 **CLOSED** em 13–14/10 (R2.0)

| id | bloqueio | escopo | quem resolve |
|---|---|---|---|
| **R-01** | Conta/pagamento da Vercel bloqueados: produção responde **402 `DEPLOYMENT_DISABLED`**; nenhum deploy é possível | **bloqueia o release com gate fechado** (e é uma indisponibilidade ao vivo hoje) | dono + provedor (Vercel billing) |
| **R-02** | **`CEX_RECOVERY_HMAC_KEY` ausente na Vercel** (produção). O alvo **exige** essa variável: `src/lib/cex/fingerprint.ts` lança `server_configuration_error` sem ela, e ela é usada por `/api/cex/order`, `/api/cex/order/status` e `src/lib/cex/conexoes.ts` | **bloqueia o release com gate fechado**: o deploy **NÃO** pode prosseguir sem ela presente no ambiente hospedado de destino | dono (autorização de alteração de env); valor aleatório forte, **estável** (as impressões de credencial dependem dele), nunca impresso nem versionado |

**Não** são bloqueadores do release com gate fechado (a aplicação sobe e funciona sem eles;
o gate continua fechado): Resend, domínio remetente, SPF/DKIM/DMARC, webhook, cron do early access,
textos jurídicos e os segredos `EARLY_ACCESS_*`. São **pré-requisitos de ABERTURA do early access**
(§R2.8). A seleção do RC também depende do §R2.9.

## R2.3 PRÉ-CONDIÇÕES

1. Autorização explícita do dono para esta janela e este SHA (`AI-OPERATING-RULES.md` §6.1).
2. SHA marcado `RELEASE_CANDIDATE` com certificação PASS **naquele SHA** (`docs/RELEASE-CHAIN.md`). Hoje: **NONE**.
3. R-01 resolvido (a Vercel serve e aceita deploy).
4. R-02 resolvido: `CEX_RECOVERY_HMAC_KEY` presente no ambiente de produção da Vercel (verificar só a **presença do nome**, nunca o valor).
5. **Re-medição ao vivo** depois de R-01/R-02 (mesmas consultas da reconciliação): fp_v1 `864|74e742…`, 55 linhas iguais, deployment `25fc4b0`. Qualquer drift → PARAR e re-ensaiar.
6. Backup do banco tomado e restauração validada num banco descartável (§R2.4).
7. Decisão do dono sobre o mecanismo e a nomenclatura das versões de migration no hospedado (EG-05, §R2.5).
8. Gate CLOSED antes e depois (§R2.7, linhas G1–G4).

## R2.4 PRÉ-CORTE

1. `git fetch origin --tags --prune`; identidade: `git rev-parse <SHA> <SHA>^{tree}`; a árvore de produto (fora de `docs/`, `CLAUDE.md`, `AGENTS.md`) tem de ser a do C1 (`010a448c774247406cc9cc80cba34e8744426557` no próprio C1).
2. Snapshot só-leitura do banco: `fp_v1`, resumo estrutural, `schema_migrations` linha a linha.
3. Backup: `pg_dump -Fc -n public -n supabase_migrations` + sha256; confirmar PITR/backup no painel (EG-03, hoje NOT_PROVABLE por ferramenta só-leitura).
4. Restaurar o backup num banco descartável e conferir fp `864|74e742…` + 55 linhas.
5. Ler (sem alterar) `admin_kv`: `disable_cex`, `disable_swap`, `maintenance_mode`, `pause_dca`, `dca_real_liberado`, `autopilot_cex_liberado`.

## R2.5 ORDEM E COMANDOS DE MIGRATION (banco primeiro, app depois)

1. **Banco:** aplicar `0059`…`0069`, em ordem, **uma transação por arquivo**, com a linha de histórico
   **na mesma transação** e pulo se a versão já existir (driver ensaiado:
   `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/state/release-rehearsal-20261003T194816Z/forward.sh`):
   `{ cat <arquivo>; printf '\n;\ninsert into supabase_migrations.schema_migrations(version, statements, name) values (<v>, array[]::text[], <nome>);\n'; } | psql -X -v ON_ERROR_STOP=1 --single-transaction`.
   Esperado: exit 0 em cada um (60–160 ms no ensaio); depois **66 linhas**, as 55 anteriores intactas,
   fp_v1 **`1118|1933659149a0cf3489ea8de56c848388`**, `admin_kv.disable_early_access='true'`, RLS 48/48, 0 policies.
   0061, 0062, 0063 e 0069 **não** são reexecutáveis à mão ("already exists"); uma falha reverte o arquivo inteiro
   (provado no ensaio, X14). **EG-05 (decisão do dono):** o ensaio gravou versões `0059`…`0069`; produção mistura
   `0001`/`0002` com versões em timestamp — se o mecanismo hospedado for a CLI do Supabase, as asserções de versão mudam;
   o fp alvo não muda.
2. **Janela de versões mistas é segura:** o app `25fc4b0` serviu sobre o schema 0069 no ensaio (rotas 200, P0 inalterado).
3. **App:** deploy do SHA RC. PostgREST recarrega o cache de schema sozinho (fallback: `NOTIFY pgrst, 'reload schema';`).
4. **Saúde + smoke** (§R2.7) → **estado do gate** (G1–G4).

## R2.6 CONTROLES DE DINHEIRO E DE PLATAFORMA (só os que existem no código)

Verificado por busca no código do alvo `53cd85a` (L-029). **Não existem** variáveis de ambiente de
pausa/kill-switch para DCA ou autopilot (`DCA_PAUSE_GLOBAL` e `AUTOPILOT_GLOBAL_KILL_SWITCH` não são lidas
por nenhum código — errata RB-02).

| controle | onde mora | efeito | origem no código |
|---|---|---|---|
| `disable_cex`, `disable_swap`, `maintenance_mode` | `admin_kv` | kill-switches de plataforma; `/api/cex/order` e `/api/autopilot/session` recusam com `disable_cex`/`maintenance_mode`; falha de leitura **bloqueia** no caminho de dinheiro | `src/lib/admin/kill-switches.ts` (`PLATFORM_KILL_KEYS`) |
| `pause_dca` | `admin_kv` (gate do flywheel) | pausa o cron do DCA | `src/lib/admin/gate-keys.ts`, `src/app/api/dca/cron/route.ts` |
| `dca_real_liberado` (+ `:motivo`) | `admin_kv` | capacidade de DCA **real**; ausente = FECHADO (estado ao vivo: ausente) | `src/lib/dca/capacidade.ts` |
| `dca_simulado_liberado` / legado `dca_liberado` | `admin_kv` | só DCA **simulado**; o legado nunca abre o real | `src/lib/dca/capacidade.ts` |
| `autopilot_cex_liberado` (+ `:motivo`, `autopilot_cex_pilotos`) | `admin_kv` | liberação do autopilot CEX; ausente = FECHADO (estado ao vivo: ausente) | `src/lib/autopilot/liberacao.ts` |
| `disable_early_access` | `admin_kv` (seed `true` pela 0068) | 1ª das 5 condições do gate do early access | `src/lib/early-access/gate.ts` |
| `CRON_SECRET` | env (Vercel; presente) | autenticação dos crons | rotas `*/cron` |
| `CEX_RECOVERY_HMAC_KEY` | env (Vercel; **ausente**, R-02) | impressão de credencial CEX; obrigatória no alvo | `src/lib/cex/fingerprint.ts` |

## R2.7 MATRIZ DE SMOKE (pós-deploy; ensaiada no PROD-CLONE)

| linha | requisição | esperado |
|---|---|---|
| R1 | `GET /`, `/portfolio`, `/bridge`, `/cex`, `/dca`, `/early-access` | 200 |
| G1 | `POST /api/early-access` | 503 `{"error":"closed"}` |
| G2 | `POST /api/early-access/verify` | 503 `closed` (415/413 para tipo errado/excesso) |
| G3 | `GET /api/early-access/verify` | 405 |
| G4 | `admin_kv.disable_early_access` | `true` |
| C1 | `POST /api/autopilot/cron`, `/api/dca/cron`, `/api/early-access/cron` sem segredo | 401 |
| A1 | `/admin`, `/admin/api/early-access`, `/admin/api/early-access/export` sem sessão | 404 |
| W1 | `POST /api/early-access/webhook/resend` sem assinatura válida | 401 |
| M1 | `POST /api/cex/order` com `{}` | 400 `missing_confirmation` (com R-02 resolvido; sem ele, caminhos de credencial falham fechado) |
| M2 | cron DCA com segredo | `processed: 0` enquanto não houver plano ativo (não é pausa por env) |
| M3 | cron autopilot com segredo | `processed: 0` enquanto não houver sessão ativa |

## R2.8 CONDIÇÕES DE ABORTO, ROLLBACK E OBSERVAÇÃO

- **Abortar:** qualquer pré-condição falhando; migration com exit ≠ 0 (banco fica na última migration commitada);
  fp pós-forward ≠ `1118|1933659149…` ou histórico ≠ 55+11; build/boot do app falhando.
- **Rollback A (preferido, sem perda de dados):** redeploy de `25fc4b0` (compatível com schema 0069, provado).
- **Rollback B (só se o schema for o defeito):** restaurar o backup + redeploy de `25fc4b0`. No ensaio: 53 s,
  volta **exata** ao baseline. **Toda escrita posterior ao backup se perde.** Tempo de restauração hospedado: NOT_PROVABLE (EG-03).
  `ROLLBACK FIDELITY=PROVED` (local); serviço volta ao nível de **antes** do release, incluindo o P0.
- **Observação:** rotas públicas do early access falham **fechado** com o banco fora (≈20 s no pior caso);
  o webhook devolve 500 para o provedor reentregar.

## R2.9 PONTOS DE ESPERA (cada um exige decisão explícita do dono)

| ponto | hoje |
|---|---|
| **OWNER HOLD** | antes do backup, antes das migrations, antes do deploy |
| **RC HOLD** | a seleção do RC fica pendente até, no mínimo: (1) R-01 resolvido; (2) `CEX_RECOVERY_HMAC_KEY` presente com segurança; (3) estado hospedado **re-medido** depois dessas mudanças; (4) o dono selecionar o RC. Recomendação (≠ seleção): feature `53cd85a2a86cc2f34d4234965ef3cf519ce7adc1`. Um SHA de deploy diferente de `53cd85a` precisa de certificação no SHA exato antes de ser RC (`AI-OPERATING-RULES.md` §5.1/§6.1) |
| **PUBLIC-GATE HOLD** | gate CLOSED; abrir exige: Termos/Privacidade aprovados (inclui D-9) → mudança de código → novo C1 + recert; segredos `EARLY_ACCESS_*`; 0068/0069 aplicadas; cron (D-8); gravar `disable_early_access=false` |
| **REAL-EMAIL HOLD** | conta Resend + domínio remetente (D-2, região `sa-east-1`), SPF/DKIM/DMARC, webhook, smoke de email real — nada disso existe ao vivo (DMARC ausente até para o email atual) |
| **MONEY-MODE HOLD** | DCA, Pilot e Autopilot reais: NO-GO; `dca_real_liberado` e `autopilot_cex_liberado` ausentes ao vivo |

## R2.10 Incidente operacional do ensaio

**INC-RR-01** — reboot do host Acer durante o ensaio local (03/10 21:05:45 UTC): `HOST_OPERATIONAL_REBOOT`,
`AGENT_INDUCED_OOM` (build de imagem sem limite de memória com as 4 stacks preservadas no ar),
`PRODUCT_DEFECT=NO`, ensaio recuperado. Reconhecido pelo dono (OD-01). Regra derivada: build pesado no
laboratório só com `docker run --memory=2g --memory-swap=5g` e heap de 1792 MB.

---

## HISTÓRICO — Revisão 1 (01/10/2026), candidato `0d21874` (SUPERSEDED pela revisão 2)

> Conteúdo preservado literalmente; só mudaram o nível dos títulos (`## X` → `### R1 · X`, para aninhar sob este histórico) e a nota de errata RB-02 inserida no item 4 do §6.

#### (título original) RELEASE RUNBOOK — candidato pré-produção `0d21874`

> **O que é:** o pacote de release do candidato certificado em laboratório local,
> com o que foi provado, o que NÃO foi, e o que só o dono pode autorizar.
> Nada aqui é autorização de deploy. Evidência bruta fica fora do repo, em
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/{evidence,reports}` (máquina do
> laboratório), sempre com `MANIFEST.sha256` verificável por `sha256sum -c`.
>
> **Atualizado:** 01/10/2026.

### R1 · 1. Identidade

| item | valor |
|---|---|
| SHA certificado (runtime) | `0d21874b4147bb8a0b232aa0abc2302471a720e5` |
| Tree | `62ad70e36a8bcc57331297d8ce929f232fadad2c` |
| Pai | `16e4000` → `c230b92` → `56b06bd` → `691bfdc` (linha de `main`/`25fc4b0`) |
| `package-lock.json` | sha256 `8e9b522771c06ba6415c025ca363cb5015f8c3dc221b31dd191ab014766dd38a` |
| Imagem local | `zswap-app:recert-0d21874b4147bb8a0b232aa0abc2302471a720e5-20261001T010514Z`, id `sha256:5b4593b753ca92f62fa9dfd7213ce71dde121e1303322d4601b16b1be7baea37` |
| Campanha | `recert-0d21874-20261001T010514Z` (evidência 607 arquivos, manifest verificado) |

Este documento chega num commit **separado** de docs, filho de `0d21874`: o
código certificado é o do `0d21874`; o commit de docs não toca código.

### R1 · 2. O que o `0d21874` muda

Só `package.json` e `package-lock.json`, contra `16e4000`:

- remove `@solana/spl-token` (sem nenhum import no repo; leva 28 entradas do lock);
- `next` `^16.3.6` — RCE em `next/og` (GHSA-vcvr-r3jv-pc5j), alcançável por
  `src/app/opengraph-image.tsx`;
- override `axios` `^1.20.0` (vários HIGH < 1.20.0; limpa `@coinbase/cdp-sdk`);
- override `image-size` `2.0.4` (Metro usa `default(Buffer)`, verificado);
- 10 transitivos pontuais. Sem `npm audit fix` amplo, sem `--force`.

Audit ao vivo: `16e4000` = 1 critical / 9 high · `0d21874` = **0 critical / 0 high**
(full: 36 moderate, 1 low; `--omit=dev`: 34 moderate, 0 low).

### R1 · 3. Gates — resultado da campanha final

| gate | resultado |
|---|---|
| npm ci (Node 24.21.0 / npm 11.19.0, tentativa única) | PASS — lock byte-idêntico |
| build de produção | PASS (Next 16.3.6) |
| lint / type-check | PASS — 0 erros, 145 warnings (= baseline) |
| alvo `mesa-real` + `market-indicators` ×5 | PASS 5/5 (37 testes cada) |
| playbook | PASS 29/29 |
| T13 original | **FAIL — evidência histórica válida** (nunca reclassificado) |
| T13 estável (PG 17.6 descartável) | PASS 20/20, A58 PASS |
| C1 / C4 / C2 / C3 (stack descartável) | PASS 10/10 · 10/10 · 3/3 · 5/5 |
| suíte completa ×2 | PASS — 264 arquivos / 3971 testes, conjuntos idênticos |
| secret leak audit | PASS (2ª tentativa; ver SEC-LOG-001) |
| demo smoke `/ /portfolio /bridge /cex /dca` | PASS (HTTP + Chrome headless) |
| egress da stack de recert | PASS sob o desenho de gateway |
| AP-LOCK (PostgREST 14.17 local) | PASS local · hospedado **não provado** |

Todas as falhas intermediárias ficaram preservadas na evidência, cada uma com
causa e correção (harness, fixture, log do Postgres) — nenhuma virou PASS por
retry.

### R1 · 4. Capacidade de disco do laboratório

| gate | limite |
|---|---|
| bootstrap completo do LAB | `/srv/docker` livre ≥ **25 GiB** |
| recertificação incremental | `/srv/docker` livre ≥ **20 GiB** (21474836480 B) |
| piso duro durante trabalho Docker pesado | **2 GiB** (2147483648 B) |

⚠️ `/srv/docker` é **partição própria** (`nvme0n1p6`); o gate NÃO se mede em `/`.
O cache npm verificado mora em disco de usuário (bind), não em volume Docker.

### R1 · 5. Achados abertos desta campanha

| id | severidade | resumo |
|---|---|---|
| SEC-LOG-001 | HIGH (lab) | a imagem `supabase/postgres` loga `ALTER USER … PASSWORD` no init (`log_statement='ddl'`). Presente nos logs das stacks preservadas DEMO e PRODCLONE. Corrigido na stack de recert com `-c log_statement=none`. |
| INC-REBOOT-001 | HIGH (ops) | secrets só em tmpfs + bind curto: o reboot de 30/09 derrubou as quatro stacks preservadas em silêncio (app "healthy"). Pacote durável preparado, não instalado. |
| EGRESS-001 | MEDIUM | na topologia padrão o app alcança qualquer host, inclusive exchanges reais. O gateway com allowlist foi provado na imagem final. |
| HARNESS-001 | LOW | `scripts/preprod/chaos-c4-recovery.sh` usa `docker top -eo args`; o Docker exige `pid`. Correção: `-eo pid,args`. |
| HARNESS-002 | LOW | o C4 atrás do Caddy perde a identidade por rodada (XFF substituído) → 429 na 9ª. Rodar contra a porta direta do app. |

### R1 · 6. Pacote de deploy de produção (NÃO executar sem o dono)

1. **CI:** push da branch → `ci.yml` (lint, type-check, test, `npm audit --audit-level=high`) verde no SHA exato.
2. **Migrations:** o repo traz 0050–0067 relativo a `25fc4b0`; o baseline do clone de
   produção estava em **58**. Antes de aplicar, uma leitura autorizada do
   `supabase_migrations.schema_migrations` de produção. Delta esperado: **0059–0067**,
   na ordem, conforme `LEDGER-MESTRE-RELEASE.md`.
3. **Escritas em produção:** só as migrations do passo 2 — nenhuma carga de dados.
4. **Ações financeiras:** nenhuma. `DCA_PAUSE_GLOBAL`, kill-switch do autopilot e
   `dca_real_liberado` permanecem como estão; abrir qualquer um é decisão separada.
   > ⚠️ **ERRATA RB-02 (03/10/2026, L-029):** `DCA_PAUSE_GLOBAL` **não existe** no código (nem em `25fc4b0`, nem em `0d21874`, nem em `53cd85a`); não há "kill-switch do autopilot" por variável de ambiente. Os controles reais estão na revisão 2 acima (§R2.6). `dca_real_liberado` existe (`src/lib/dca/capacidade.ts`).
5. **Canário:** deploy de preview Vercel no SHA → smoke das 5 rotas + `/api/telemetry/error`
   → promoção.
6. **Pós-deploy:** rotas 200, ausência de erro novo em runtime logs, crons (cron-job.org)
   respondendo, `admin_kv` inalterado.
7. **Rollback:** promover de volta o deployment `25fc4b0`. Migrations 0059–0067 são
   aditivas/ACL; a reversão de schema segue o ledger, nunca improvisada.

### R1 · 7. Só o dono pode autorizar

- push, PR e merge desta branch;
- deploy de produção, migration ou escrita no Supabase hospedado;
- leitura do PostgREST hospedado (versão) para fechar o AP-LOCK;
- recuperação das stacks preservadas: os secrets originais se perderam, e regenerar exige `ALTER ROLE` ou re-init do banco;
- instalação dos secrets duráveis (sudo, `/etc/credstore.encrypted`, systemd) e o teste de reboot;
- aplicar a política de egress e o patch fail-closed do compose às stacks preservadas;
- liberar Tailscale Serve para a demo privada (Funnel segue desligado).

### R1 · 8. Relação com outras branches

`docs/PLANO-PROD-CLONE-LAB.md` vive em `origin/platform-closure`, que saiu de `691bfdc`
e não é ancestral deste candidato. Ela deve ser mesclada à parte: não foi recriada
aqui para não bifurcar o documento.
