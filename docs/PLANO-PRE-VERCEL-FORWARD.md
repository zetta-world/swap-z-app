# PRE-VERCEL FORWARD — trabalho local enquanto a Vercel está bloqueada · 🟡 EM EXECUÇÃO (lane B)

> **Aberto em:** 03/10/2026 · ledger **L-031** (neste branch).
> **Lane B** = `pre-vercel-forward-20261003T234200Z`, worktree
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/pre-vercel-forward-20261003T234200Z`,
> base `d896ce29c68b5c298d8146b72f06722d0e9d7db1` (tree `aa5fdecdec20da1a67a7dd1ba01d286ab2365cc9`).
> **Não é** release candidate, **não é** produção. Nada daqui vai para a lane A
> (`early-access-phase2-email-double-optin-20261001`, release congelado em `53cd85a`) sem decisão do dono.
> Commits deste branch são `COMMITTED_FEATURE_CHECKPOINT` (não CERTIFIED).
> Proibido aqui: push, merge, deploy, escrita hospedada, Vercel, email real, transação on-chain, dinheiro real.

## 1. Inventário mestre (Stage 3)

Fontes lidas: `CURRENT-STATE.md` (revisão 9), `AUDIT-RECONCILIATION.md` §5, `RELEASE-RUNBOOK.md` revisão 2,
`LAUNCH-READINESS-LEDGER.md` L-028…L-030, `NFT-BRIEFING.md` §7–§8, `POLISH-PLAN.md` 5.4,
`WHITELIST-FUNDRAISING-DISCOVERY.md`, `PLANO-STRATEGY-INTELLIGENCE-FORENSIC-LEARNING.md`, evidência do ensaio (RR-O-*).

Categorias: **A** CAN_DO_NOW_LOCAL · **B** NEEDS_OWNER_DECISION · **C** NEEDS_EXTERNAL_PROVIDER ·
**D** NEEDS_HOSTED_WRITE · **E** NEEDS_REAL_MONEY_OR_MAINNET · **F** ALREADY_COMPLETE.
"Bytes" = muda bytes de produto (fora de `docs/`).

| ID | item | fonte | status atual | cat. | dependência | risco | bytes | validação |
|---|---|---|---|---|---|---|---|---|
| R-01 | desbloqueio da conta/pagamento Vercel | L-029 | BLOCKED | C | dono + Vercel | release | não | GET público ≠ 402 |
| R-02 | instalar `CEX_RECOVERY_HMAC_KEY` na Vercel | L-029 | ABSENT | C | R-01; autorização do dono | release | não | presença do nome (`vercel env ls`) |
| EG-02 | re-medição ao vivo pós R-01/R-02 | runbook R2.3 | READY (03/10) | C | R-01, R-02 | — | não | mesmas consultas da L-029 |
| EG-03 | PITR/backup hospedado | runbook R2.4 | NOT_PROVABLE | C | painel Supabase | rollback B | não | leitura do painel |
| EG-05 | mecanismo e nomes das versões de migration no hospedado | runbook R2.5 | OPEN | B | — | release | não | decisão registrada |
| EG-13 | seleção do RC | runbook R2.9 | NONE | B | R-01, R-02, EG-02 | release | não | ledger |
| EG-18 | push/PR/CI de C1–C2 (e destino do PR #447) | L-029 | LOCAL ONLY | B | — | release | não | CI verde no SHA |
| EG-23 | P0 `creds_cipher` em produção | L-029 | dormente | D | deploy do alvo | baixo (0 sessões) | não | smoke S7 hospedado |
| MIG-HOSTED | aplicar 0059…0069 no hospedado | runbook R2.5 | NOT_STARTED | D | EG-05, EG-13 | release | não | fp `1118\|1933…` |
| AP-LOCK | prova do PostgREST hospedado (INV-10) | AUDIT §5 | OWNER_AUTH_REQUIRED | B | autorização de leitura | autopilot | não | sonda read-only |
| STAGING-RB | rollback/rebuild em staging hospedado | AUDIT §5 | OPEN_NONBLOCKING | D | staging | release | não | — |
| EA-LEGAL | Termos/Privacidade aprovados (inclui D-9) | AUDIT §5, EG-14 | UNAPPROVED | B | jurídico | abertura EA | sim (constantes → novo C1) | recert |
| EA-SENDER | escolher domínio remetente (D-2) | EG-08 | undecided | B | — | abertura EA | não | — |
| EA-RESEND | conta Resend, sa-east-1, SPF/DKIM/DMARC, webhook | EG-08…EG-12 | NOT_CONFIGURED | C | EA-SENDER | abertura EA | não | DNS + painel |
| EA-SECRETS | `EARLY_ACCESS_*` na Vercel | EG-12 | absent | C | R-01, EA-RESEND | abertura EA | não | presença |
| EA-CRON | agendar `/api/early-access/cron` (D-8) | EG-16 | NOT_SCHEDULED | C | release | abertura EA | não | cron 200 |
| EA-OPEN | `disable_early_access=false` | EG-17 | BLOCKED | D | tudo acima | abertura EA | não | smoke EA |
| EA-EMAIL-SMOKE | smoke de email real | EG-15 | BLOCKED | C | EA-RESEND | abertura EA | não | — |
| F-13 | exclusão/anonimização × append-only | AUDIT §5 | OWNER_DECISION | B | jurídico | privacidade | sim | — |
| EXT-D1…D5 | decisões da auditoria externa (carteiras legadas, TOCTOU de cota, `liquidoCompostoPct`, venue do maker, braço de IA) | AUDIT §5 | OWNER_DECISION | B | — | vários | sim | — |
| UNKNOWN-4 | A08/A09/A10/A17 sem fonte | AUDIT §5 | UNKNOWN_REQUIRES_REVIEW | B | dono fornecer a fonte | desconhecido | ? | — |
| DOC-PC-DIVERGE | docs só em `origin/platform-closure` | AUDIT §5.6 | OPEN_NONBLOCKING | B | decisão de branch | docs | não | — |
| HOST-CRED-001 / AUTOLOGIN | hardening do host Acer (LUKS/TPM2, bloqueio de tela) | AUDIT §5.4 | DEFERRED_ACCEPTED | B | sudo + dono | lab | não | — |
| OD-06 | limpeza da pilha/volumes do ensaio | L-029 | OWNER_PENDING | B | revisão independente | — | não | — |
| FSL-A…G | executar as fases da trilha Strategy Intelligence (inclui leitura hospedada) | L-030 | NOT_STARTED | B | autorização do dono para iniciar / acesso só-leitura | estratégia | sim (depois) | walk-forward |
| NFT-DEC | decisões do Founders NFT (chain, preço, moeda, alocação por carteira, fases, horário, royalties, utilidade, elegibilidade, tesouraria, reveal/transfer) | NFT-BRIEFING §7 | OPEN (supply decidido) | B | dono | venda | — | — |
| NFT-MINT | contrato/coleção e mint em rede real | POLISH 5.4 | BLOCKED | E | NFT-DEC | dinheiro | sim | — |
| MONEY-REAL | DCA/Pilot/Autopilot reais, canário | runbook R2.9 | NO-GO | E | gates finais | dinheiro | — | — |
| R8-CORRIDA | cron↔navegador pode fechar o dia 1 trade acima do teto | AUDIT §5.3 | OPEN_NONBLOCKING | E | vira bloqueador só antes de autopilot real | dinheiro | sim | — |
| SEC-LOG-001 | senha no log do postgres de laboratório | RUNBOOK rev1 §5 | corrigido (`log_statement=none`) | F | — | — | — | — |
| INC-REBOOT-001 / EGRESS-001 | resiliência a reboot e egress do lab | AUDIT §5.4 | FIXED_LAB_ENV_VERIFIED | F | — | — | — | — |
| GOV-ENTRY | entrada pelo `START-HERE.md` | AUDIT §5.6 | `CLAUDE.md` já aponta | F | — | — | — | — |
| F-05/F-15/F-16, EA2-A03…A06 | resíduos aceitos | AUDIT §5 | ACCEPTED | F | — | — | — | — |
| RR-O-05 | migrations não reexecutáveis | L-028 | coberto pelo driver com pulo | F | — | — | — | — |
| **PV-A01** | catálogo de env obrigatória do alvo + check de auditoria admin (presença por nome) + CLI de pré-voo por nomes + trava | L-029 (R-02, RB-01) | NOT_STARTED | A | — | baixo | sim | testes + type-check/lint/build |
| **PV-A02** | trava: todo controle citado no runbook existe no código (classe RB-02) | L-029 | NOT_STARTED | A | — | baixo | sim (teste) | teste |
| **PV-A03** | ferramentas de release no repo: fp_v1, resumo estrutural, comparador de histórico, driver de forward com pulo, verificação de estado | L-028 | só fora do repo | A | — | baixo | sim (scripts) | testes + execução em PG descartável |
| **PV-A04** | RR-O-01 (T16.17h por delta) e RR-O-02 (aviso de modo commit no teste 02) | L-028 | OPEN | A | — | baixo | sim (testes SQL) | T16 em banco vazio **e** povoado |
| **PV-A05** | HARNESS-001 (`docker top -eo pid,args`) | AUDIT §5.4 | OPEN_NONBLOCKING | A | — | baixo | sim (script) | `bash -n` + leitura |
| **PV-A06** | INC-RR-01: build pesado com limite de memória (script + runbook) | L-028/L-029 | regra só na evidência | A | — | baixo | sim (script) | execução capada |
| **PV-A07** | preparo dos gates externos sem aplicar (Vercel, R-02, Resend, DNS, webhook, cron, jurídico, segredos) | Stage 6 | NOT_STARTED | A | — | baixo | não | revisão |
| **PV-A08** | Founders NFT: fundações independentes de decisão (máquina de estados da venda, allowlist versionada, Merkle com hash injetado, alocação sem oversell, idempotência, provedor de mint falso, testes de corrida/replay) | NFT-BRIEFING, Stage 5 | NOT_STARTED | A | sem chain/preço | baixo | sim | testes |
| PV-A09 | F-09: `portao.test.ts` aceita import como chamada | AUDIT §5.5 | OPEN_NONBLOCKING | A | — | baixo | sim (teste) | teste |
| PV-A10 | DOC-STALE-EA: `WHITELIST-FUNDRAISING-DISCOVERY.md` ainda diz "Fase 1 não iniciada" | CURRENT-STATE lacunas | OPEN | A | — | nenhum | não | leitura |
| PV-A11 | F-14: ACL de `admin_kv`, `rate_limits`, `admin_audit_log` (migration nova) | AUDIT §5.5 | OPEN_NONBLOCKING | A | — | médio (caminhos do app) | sim (migration) | SQL + suíte |
| PV-A12 | EA-BUILD-NEXT-WARN: convenção `middleware`→`proxy` do Next 16 | AUDIT §5.5 | INFO | A | — | médio | sim | build + E2E |
| PV-A13 | SUPPLY-REST: 36 moderate / 1 low do `npm audit` | AUDIT §5.4 | OPEN_NONBLOCKING | A | — | médio (lock) | sim | suíte + build |
| PV-A14 | RR-O-04: latência de até ~20 s para falhar fechado com o banco fora | L-028 | INFO | A | — | médio | sim | chaos X05 |
| PV-A15 | ZION-PLAYBOOK-TIMEOUT-LOCAL (sensível a carga) | AUDIT §5.5.4 | KNOWN_EXISTING | A | — | baixo | sim (teste) | suíte sob carga |
| PV-A16 | HARNESS-002 (C4 atrás do Caddy → 429) | AUDIT §5.4 | OPEN_NONBLOCKING | A | — | baixo | sim (script) | — |

## 2. O que esta rodada executa

Prioridade do dono (1 preflight … 13 confiabilidade de build) aplicada às linhas A: **PV-A01…A08** e **PV-A10**
nesta rodada; **PV-A09, PV-A11…A16** ficam para a próxima (cada uma toca caminho de app/lock/migration e merece
rodada própria com validação completa). Status de cada item: §3 (atualizado a cada entrega).

## 3. Status de execução

| item | status |
|---|---|
| PV-A01 | 🟢 feito: `src/lib/release/server-env{.ts,.catalog.json}`, check de auditoria `required_server_env`, `scripts/release/check-env-names.mjs` (contra os nomes vivos: só `CEX_RECOVERY_HMAC_KEY` ausente), testes + mutação |
| PV-A02 | 🟢 feito: `src/lib/release/runbook-controls.test.ts` (mutação provou que pega RB-02) |
| PV-A03 | 🟡 parcial: `scripts/release/sql/{fp_v1,structural-summary,history-rows}.sql` + `expected.json`; faltam comparador, driver de forward, verificação de estado e a execução em PG descartável |
| PV-A04 | 🔴 não iniciado |
| PV-A05 | 🔴 não iniciado |
| PV-A06 | 🔴 não iniciado |
| PV-A07 | 🔴 não iniciado |
| PV-A08 | 🔴 não iniciado |
| PV-A10 | 🔴 não iniciado |
