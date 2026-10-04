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
| PV-A12 | EA-BUILD-NEXT-WARN: convenção `middleware`→`proxy` do Next 16 | AUDIT §5.5 | INFO | **B** (reclassificado 04/10) | o `proxy` do Next 16 roda em runtime **Node**, não Edge: o portão de sessão do admin sai de todas as regiões da borda para a região da função — mudança de topologia/latência de produção, decisão do dono | médio | sim | build + E2E |
| PV-A13 | SUPPLY-REST: `npm audit` | AUDIT §5.4 | **mudou em 04/10** (ver R-03) | **B** (reclassificado) | correções restantes são MAJOR (wagmi, tailwindcss, eslint-config-next, wallet-adapter-solflare) ou inexistentes | médio (lock) | sim | suíte + build |
| **R-03** (novo, 04/10) | **SUPPLY-BRACES:** advisory novo `braces <=3.0.3` (GHSA-vfj7-8cjw-p6xm, DoS por padrão aninhado) via `tailwindcss@3.4.19` → `chokidar`/`micromatch`; `npm audit` = 25 high (20 em deps de produção); **não existe versão corrigida** (3.0.3 é a última); o passo `npm audit --audit-level=high` do `ci.yml` **sai 1** no lockfile certificado (sha `8e9b5227…`, inalterado desde `0d21874`) → o CI do GitHub do C1/C2 **falharia hoje** | evidência `08-supply-braces-ci-audit.txt` | NEW | **B** | escolher: migrar Tailwind para v4 (MAJOR, risco visual, novo C1 + recert) **ou** política de exceção documentada no CI para este advisory (alcance: ferramenta de build, sem entrada de usuário em runtime) | release via GitHub (EG-18) | sim (lock ou CI) | CI verde no SHA |
| PV-A14 | RR-O-04: latência de até ~20 s para falhar fechado com o banco fora | L-028 | INFO | A | — | médio | sim | chaos X05 |
| PV-A15 | ZION-PLAYBOOK-TIMEOUT-LOCAL (sensível a carga) | AUDIT §5.5.4 | KNOWN_EXISTING | A | — | baixo | sim (teste) | suíte sob carga |
| PV-A16 | HARNESS-002 (C4 atrás do Caddy → 429) | AUDIT §5.4 | OPEN_NONBLOCKING | A | — | baixo | sim (script) | — |

## 2. O que esta rodada executa

Prioridade do dono (1 preflight … 13 confiabilidade de build) aplicada às linhas A.
**1ª parte (L-032):** PV-A01…A08 e PV-A10. **2ª parte (L-033):** PV-A09, A11, A14, A15, A16.
**Reclassificados para B com motivo:** PV-A12 (mudança de runtime Edge→Node do portão) e PV-A13 (só correções
MAJOR ou inexistentes; gerou o achado novo **R-03**). Nenhuma linha A ficou sem tratamento nesta lane.

## 3. Status de execução

| item | status |
|---|---|
| PV-A01 | 🟢 feito: `src/lib/release/server-env{.ts,.catalog.json}`, check de auditoria `required_server_env`, `scripts/release/check-env-names.mjs` (contra os nomes vivos: só `CEX_RECOVERY_HMAC_KEY` ausente), testes + mutação |
| PV-A02 | 🟢 feito: `src/lib/release/runbook-controls.test.ts` (mutação provou que pega RB-02) |
| PV-A03 | 🟢 feito: `scripts/release/{forward-migrations.sh,verify-state.sh,compare-history.mjs,lib/history.mjs,sql/*,expected.json}` + testes; provado em PG descartável a partir do B0 (baseline CONFERE, 55/55 linhas = captura congelada, 11/11 PASS, alvo CONFERE, reexecução só SKIP, exit 1 em divergência) |
| PV-A04 | 🟢 feito: T16.17h por delta; aviso de modo commit no teste 02. Provado: T16 31/31 em banco vazio **e** povoado; os bytes do C1 falham no povoado (20/31, T16.17h); T15 22/22; O2 7/7 |
| PV-A05 | 🟢 feito: `-eo pid,args` (erro original reproduzido: "Couldn't find PID field in ps output") |
| PV-A06 | 🟢 feito: `scripts/preprod/capped-build.sh` (recusa com MemAvailable < 1024 MiB; container com --memory/--memory-swap/heap fixos); usado no build desta rodada |
| PV-A07 | 🟢 feito: `docs/EXTERNAL-GATES-PREP.md` (R-01, R-02 com geração/instalação/validação/rotação/rollback, re-medição, segredos EA, Resend/DNS, webhook, cron, jurídico) + `CEX_RECOVERY_HMAC_KEY` no catálogo de env do `docs/RUNBOOK.md` |
| PV-A08 | 🟢 feito (fundações): `src/lib/founders-sale/*` + `docs/PLANO-FOUNDERS-NFT-SALE-READINESS.md`; 24 testes (corrida/oversell, teto, replay, pausa, esgotado, Merkle com 2 hashes, isolamento de rede/rotas). UI, telemetria e persistência: próximos |
| PV-A10 | 🟢 feito: banner de status atual em `WHITELIST-FUNDRAISING-DISCOVERY.md` (original intacto) |
| PV-A09 | 🟢 feito: `portao.test.ts` exige CHAMADA de `requireAdmin(` em código sem comentários; auto-teste prova que import/comentário não contam; todas as superfícies `/admin` reais chamam (nenhuma lacuna revelada) |
| PV-A11 | 🟢 feito: migration `0070_acl_tabelas_operacionais.sql` (revoke de `anon`/`authenticated`/PUBLIC em `admin_kv`, `rate_limits`, `admin_audit_log`) + teste 17. Na linhagem de produção: T17 0/6 ANTES (anon tinha TRUNCATE), 6/6 DEPOIS; service_role lê/escreve; T14/T15/T16/T16b/O2 PASS; reexecutável; fp com 0070 `1118\|5346e57d…` (só lane B) |
| PV-A12 | 🔵 reclassificado para B (ver inventário) |
| PV-A13 | 🔵 reclassificado para B; gerou **R-03** (SUPPLY-BRACES) |
| R-03 | 🟡 spike medido (L-034, branch `spike-tailwind-v4-20261004T113734Z`): Tailwind v4 = remediação **PARTIAL** (braces segue via `@solana/wallet-adapter-react` em produção e `eslint-config-next`), risco **MEDIUM**, recomendação **TEMPORARY_CI_EXCEPTION** — decisão do dono |
| PV-A14 | 🟢 feito: `lerChaveGate` com orçamento de 3 s (estouro = `lido:false` = FECHADO); testes provam fechamento < 1 s com banco pendurado e leitura normal inalterada |
| PV-A15 | 🟢 feito: timeouts explícitos de 30 s nos dois testes pesados de `playbook-backtest` (asserções inalteradas; a de 20 s volta a ser o guarda real) |
| PV-A16 | 🟢 feito (diagnóstico): 429 no C4 para com `HARNESS-002` explícito (exit 4) e instrução de porta direta; a correção comportamental exigiria mudar confiança de XFF (F-15, resíduo aceito) |
