# Admin API — Matriz de autorização (proposta R2)

Status: 🔴 PROPOSTA — nada disto está aplicado. Hoje **todas** as rotas usam a mesma decisão binária `requireAdmin()` (carteira com sessão + `ADMIN_WALLETS` | `platform_admins` | `tier_cache.source='admin'`). Papéis, MFA e step-up dependem de R1 e de decisões do dono (plano §10).

Gerada de `routes.json` (79 linhas = 66 `route.ts` × métodos exportados) no baseline `ec63cb9` (src = `10ebd12`). Inventário e evidências: `docs/ADMIN-COMMAND-CENTER-INVENTARIO.md` § Rotas /admin/api. Não editar à mão: regenerar do código.

## Legenda

| coluna | valores |
|---|---|
| `risk_class` | `read` leitura · `write` grava dado operacional/laboratório ou telemetria, ou chama fonte externa · `sensitive_write` altera controle/configuração/livro simulado ou **exporta** dados em massa (mesmo via GET) · `financial` altera gate de dinheiro real · `identity` concede/revoga acesso ou plano |
| `authn` | `corp_session` = sessão corporativa admin separada da carteira (R1). Hoje: `zswap_session` + `requireAdmin` em todas |
| `permission` | permissão atômica exigida (`a \| b` = depende do campo do corpo) · `min` = papel funcional primário proposto (o RBAC proposto não é hierárquico: `min_role` é o dono funcional da permissão, não um piso de hierarquia); lista completa em `roles_allowed` do `routes.json` |
| `min_mfa` | `mfa_login` = MFA comprovado no login da sessão · `step_up` = MFA recente (reautenticação; janela a decidir) |
| `data_class` | `identity` · `security` · `financial` · `financial_agg` · `pii` · `pii_pseudonimo` (carteira, cid, cidade/lat-lon) · `operational` · `lab` · `simulated` (paper) |
| `read/write` | `R` · `W` · `R+W` (GET que grava) · `R+telemetria` / `W(telemetria)` (só `platform_events`) · `R(export)` |
| `audit_required` | `nao` · `acesso` (registrar leitura de PII/identidade) · `telemetria` (best-effort aceitável) · `duravel_fail_closed` (sem registro confirmado o comando não é confirmado — ADM-005) |
| `on_db_failure` | comportamento **atual** (ver legenda do inventário); alvo para todas: estado explícito `unavailable`/`partial`, nunca 0/vazio |
| `rate_limit` | hoje `nenhum` em todas; classe proposta: `RL-leitura`, `RL-escrita`, `RL-externo` (custo/quota de terceiros), `RL-sensivel`, `RL-export` — valores a definir com medição |
| `tests` | teste que cita a rota (`executa` = importa o handler; `fonte` = lê o código). Todas estão também na varredura `portao.test.ts`, que hoje **não** detecta rota nova sem guarda (inventário R-01) |

## Papéis × permissões (proposta)

`superadmin` tem todas. Permissões sem papel além de `superadmin` ficam restritas a ele (dupla autorização recomendada para `trading.automation.release`, `identity.*`, `tiers.manage`, `users.export`, `agents.instruct`). `auditor` nunca recebe permissão de escrita.

| permissão | origem | papéis (além de superadmin) | handlers |
|---|---|---|---|
| `admin.view` | plano | `auditor`, `growth`, `support`, `analyst`, `operations`, `finance`, `security_admin` | 2 |
| `security.read` | plano | `security_admin`, `operations`, `auditor` | 4 |
| `security.killswitch.write` | plano | `security_admin` | 1 |
| `identity.invite` | plano | — | 1 |
| `identity.revoke` | plano | — | 1 |
| `finance.read` | plano | `finance`, `auditor` | 5 |
| `finance.export` | plano | `finance` | 1 |
| `ops.read` | plano | `operations`, `security_admin`, `auditor` | 5 |
| `ops.control` | plano | `operations`, `security_admin` | 1 |
| `paper.manage` | plano | `analyst` | 3 |
| `ai.read` | plano | `operations`, `finance`, `analyst`, `security_admin`, `auditor` | 1 |
| `audit.read` | plano | `security_admin`, `auditor` | 1 |
| `users.support.read` | plano | `support`, `security_admin` | 3 |
| `analytics.read` | plano | `growth`, `analyst`, `auditor` | 4 |
| `identity.read` | extensão (plano cita `identity.read` no §5) | `security_admin`, `auditor` | 2 |
| `ai.control` | extensão (plano §5: ai-circuit POST ≠ acesso ao painel) | `operations`, `security_admin` | 1 |
| `security.scan.run` | extensão | `security_admin` | 1 |
| `security.probe.run` | extensão | `security_admin`, `operations` | 2 |
| `finance.config.write` | extensão | `finance` | 1 |
| `tiers.manage` | extensão | — | 1 |
| `trading.automation.release` | extensão | — | 1 |
| `lab.read` | extensão (plano: `strategy.*`) | `analyst`, `operations`, `auditor` | 15 |
| `lab.run` | extensão (plano: `strategy.manage`) | `analyst` | 19 |
| `users.access.manage` | extensão | `support` | 1 |
| `users.export` | extensão | — | 1 |
| `agents.read` | extensão | `operations`, `security_admin`, `auditor` | 1 |
| `agents.instruct` | extensão | — | 1 |
| `roles.grant`, `roles.revoke`, `ai.budget.write` | plano | — | 0 (nenhuma rota atual; reservadas para R2) |

## Matriz

| route | method | action_id | risk_class | authn | min_mfa | permission | data_class | read/write | source | audit_required | on_db_failure | rate_limit | tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/admin/api/admins` | GET | `identity.admins.list` | `read` | corp_session | mfa_login | `identity.read` · min `security_admin` | identity | R | L: platform_admins, tier_cache | acesso | `mascara_vazio` | nenhum → RL-leitura | caixa.test.ts (fonte), revogar-nao-pode-mentir.test.ts (fonte), plano-nao-e-admin.test.ts (fonte) |
| `/admin/api/admins` | POST | `identity.admins.grant \| identity.admins.revoke` | `identity` | corp_session | step_up | `identity.invite \| identity.revoke` · min `superadmin` | identity | W | E: platform_admins, tier_cache | duravel_fail_closed | `escrita_conferida` | nenhum → RL-sensivel | caixa.test.ts (fonte), revogar-nao-pode-mentir.test.ts (fonte), plano-nao-e-admin.test.ts (fonte) |
| `/admin/api/ai-circuit` | GET | `ai.circuit.read` | `read` | corp_session | mfa_login | `ai.read` · min `operations` | operational | R | L: admin_kv | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/ai-circuit` | POST | `ai.circuit.reset` | `sensitive_write` | corp_session | step_up | `ai.control` · min `operations` | operational | W | E: admin_kv | duravel_fail_closed | `escrita_nao_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/alert-test` | POST | `ops.alert.test` | `write` | corp_session | mfa_login | `ops.control` · min `operations` | operational | W | E: platform_events · ext: api.telegram.org | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/alerts` | GET | `ops.alerts.read` | `read` | corp_session | mfa_login | `ops.read` · min `operations` | operational | R | L: platform_events | nao | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/analytics` | GET | `analytics.events.read` | `read` | corp_session | mfa_login | `analytics.read` · min `growth` | pii_pseudonimo | R | L: platform_events | acesso | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/aprendizado` | GET | `lab.flywheel.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R+telemetria | L: agent_lessons, zion_suggestions · E: platform_events | nao | `500_excecao` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/arbiter-cohort` | GET | `lab.arbiter.cohort` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | R+W | L: paper_accounts, paper_positions, platform_events · E: admin_kv | telemetria | `mascara_vazio` | nenhum → RL-escrita | — (só varredura) |
| `/admin/api/arbiter-median` | POST | `lab.arbiter.median` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: 8 CEX spot | telemetria | `n/a` | nenhum → RL-externo | venue-scope.test.ts (fonte) |
| `/admin/api/audit-bench` | POST | `security.bench.run` | `sensitive_write` | corp_session | step_up | `security.scan.run` · min `security_admin` | security | W | E: admin_kv, operations, platform_events · ext: própria origem (Host), LLM | duravel_fail_closed | `n/a` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/audit` | GET | `audit.log.read` | `read` | corp_session | mfa_login | `audit.read` · min `security_admin` | security | R | L: admin_audit_log | nao | `erro_explicito` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/autopilot-liberacao` | GET | `trading.automation.read` | `read` | corp_session | mfa_login | `ops.read` · min `operations` | financial | R | L: admin_kv, lab_strategies | nao | `estado_explicito` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/autopilot-liberacao` | POST | `trading.automation.release \| trading.pilot.authorize \| trading.pilot.remove` | `financial` | corp_session | step_up | `trading.automation.release` · min `superadmin` | financial | W | E: admin_kv | duravel_fail_closed | `escrita_nao_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/backtest` | GET | `lab.backtest.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R | L: zion_suggestions | nao | `500_excecao` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/calibration` | POST | `lab.calibration.run` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: candles CEX | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/celeiro` | GET | `lab.celeiro.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: celeiro_fluxos, celeiro_posicoes · ext: preços | nao | `erro_explicito` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/combinacao` | POST | `lab.study.combinacao` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: DefiLlama | telemetria | `best_effort` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/command` | GET | `exec.summary.read` | `read` | corp_session | mfa_login | `admin.view` · min `qualquer_papel` | financial_agg | R | L: admin_kv, autopilot_positions, autopilot_sessions, operations, platform_events, users, zion_suggestions | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/depth-census` | POST | `lab.census.depth` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: orderbooks CEX | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/derrapagem` | GET | `lab.slippage.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R+telemetria | E: platform_events · ext: Gate.io | nao | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/descartadas` | GET | `lab.discarded.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R+telemetria | E: platform_events · ext: orderbooks CEX | nao | `erro_explicito` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/dex-cex` | POST | `lab.study.dexcex` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: Binance, LI.FI (cotação) | telemetria | `estado_explicito` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/early-access/export` | GET | `users.early_access.export` | `sensitive_write` | corp_session | step_up | `users.export` · min `superadmin` | pii | R(export) | L: early_access_signups · E: admin_audit_log | duravel_fail_closed | `erro_explicito` | nenhum → RL-export | early-access-admin.test.ts (executa) |
| `/admin/api/early-access` | GET | `users.early_access.read` | `read` | corp_session | mfa_login | `users.support.read` · min `support` | pii | R | L: admin_kv, early_access_consents, early_access_events, early_access_signups | acesso | `erro_explicito` | nenhum → RL-leitura | early-access-admin.test.ts (executa) |
| `/admin/api/early-access/transition` | POST | `users.early_access.transition` | `sensitive_write` | corp_session | step_up | `users.access.manage` · min `support` | pii | W | E: early_access_events, early_access_signups (via RPC) · rpc: early_access_transicionar | duravel_fail_closed | `escrita_conferida` | nenhum → RL-sensivel | early-access-admin.test.ts (executa), token.test.ts (fonte) |
| `/admin/api/finance` | GET | `finance.summary.read` | `read` | corp_session | mfa_login | `finance.read` · min `finance` | financial | R | L: operations, platform_events, tier_cache · ext: CoinGecko | nao | `mascara_zero` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/funding` | POST | `lab.study.funding` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: funding CEX | telemetria | `best_effort` | nenhum → RL-externo | tabela-com-amostra.test.ts (fonte) |
| `/admin/api/growth` | GET | `analytics.growth.read` | `read` | corp_session | mfa_login | `analytics.read` · min `growth` | pii_pseudonimo | R | L: autopilot_sessions, operations, tier_cache, users | acesso | `estado_explicito` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/health` | GET | `ops.health.read` | `read` | corp_session | mfa_login | `ops.read` · min `operations` | operational | R | L: admin_kv · ext: deps externas, provedores IA | nao | `mascara_zero` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/killswitch` | GET | `security.killswitch.read` | `read` | corp_session | mfa_login | `security.read` · min `security_admin` | security | R | L: admin_kv | nao | `mascara_vazio` | nenhum → RL-leitura | escritas-conferidas.test.ts (fonte) |
| `/admin/api/killswitch` | POST | `security.killswitch.set` | `sensitive_write` | corp_session | step_up | `security.killswitch.write` · min `security_admin` | security | W | E: admin_kv | duravel_fail_closed | `escrita_conferida` | nenhum → RL-sensivel | escritas-conferidas.test.ts (fonte) |
| `/admin/api/lab` | GET | `lab.registry.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R+W | L: lab_results, lab_runs · E: lab_strategies | nao | `500_excecao` | nenhum → RL-leitura | espelho.test.ts (fonte) |
| `/admin/api/lab` | POST | `lab.registry.sync` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | L: lab_results, lab_runs · E: lab_strategies | telemetria | `500_excecao` | nenhum → RL-escrita | espelho.test.ts (fonte) |
| `/admin/api/lab/ultima` | GET | `lab.runs.last` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R | L: lab_runs, lab_strategies | nao | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/launch-gate` | GET | `ops.launch_gate.read` | `read` | corp_session | mfa_login | `ops.read` · min `operations` | simulated | R | L: paper_accounts, paper_positions, zion_suggestions | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/ledger/export` | GET | `finance.ledger.export` | `sensitive_write` | corp_session | step_up | `finance.export` · min `finance` | financial | R(export) | L: operations | duravel_fail_closed | `mascara_vazio` | nenhum → RL-export | csv.test.ts (fonte) |
| `/admin/api/ledger` | GET | `finance.ledger.read` | `read` | corp_session | mfa_login | `finance.read` · min `finance` | financial | R | L: operations | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/liquidez` | POST | `lab.study.liquidez` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: DefiLlama, LI.FI (cotação), Binance | telemetria | `best_effort` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/logs` | GET | `security.logs.read` | `read` | corp_session | mfa_login | `security.read` · min `security_admin` | security | R | L: platform_events | nao | `mascara_zero` | nenhum → RL-leitura | contador-24h.test.ts (fonte) |
| `/admin/api/maker-backtest` | POST | `lab.maker.run` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: candles CEX | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/margin` | GET | `finance.margin.read` | `read` | corp_session | mfa_login | `finance.read` · min `finance` | financial | R | L: admin_kv, platform_events, tier_cache | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/margin` | POST | `finance.margin.set` | `sensitive_write` | corp_session | step_up | `finance.config.write` · min `finance` | financial | W | E: admin_kv | duravel_fail_closed | `escrita_nao_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/mural` | GET | `exec.mural.read` | `read` | corp_session | mfa_login | `admin.view` · min `qualquer_papel` | financial_agg | R | L: operations, platform_events, tier_cache | nao | `mascara_zero` | nenhum → RL-leitura | atribuicao.test.ts (fonte), legibilidade.test.ts (fonte) |
| `/admin/api/operations` | GET | `trading.positions.read` | `read` | corp_session | mfa_login | `ops.read` · min `operations` | financial | R | L: autopilot_positions, autopilot_runs | nao | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/paper-recap` | GET | `paper.recap.plan` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: admin_kv, paper_accounts, paper_positions | nao | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/paper-recap` | POST | `paper.recap.execute` | `sensitive_write` | corp_session | step_up | `paper.manage` · min `analyst` | simulated | W | E: admin_kv, paper_accounts, paper_positions | duravel_fail_closed | `escrita_nao_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/paper-repair` | GET | `paper.repair.plan` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: admin_kv, paper_accounts, paper_positions | nao | `500_excecao` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/paper-repair` | POST | `paper.repair.execute` | `sensitive_write` | corp_session | step_up | `paper.manage` · min `analyst` | simulated | W | L: paper_positions · E: admin_kv, paper_accounts | duravel_fail_closed | `escrita_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/paper-reset` | GET | `paper.reset.plan` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: admin_kv, paper_accounts, paper_positions | nao | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/paper-reset` | POST | `paper.reset.execute` | `sensitive_write` | corp_session | step_up | `paper.manage` · min `analyst` | simulated | W | E: admin_kv, paper_accounts, paper_positions | duravel_fail_closed | `escrita_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/paper` | GET | `paper.desks.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: paper_accounts, paper_positions, platform_events · ext: Gate.io spot | nao | `erro_explicito` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/perp-census` | POST | `lab.census.perp` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: perp books CEX | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/playbook-backtest` | POST | `lab.playbook.run` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: admin_kv · ext: candles CEX | telemetria | `estado_explicito` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/pro-piscinas` | POST | `lab.pools.measure` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: platform_events, pro_piscina_medicao, pro_piscina_veredito · ext: GeckoTerminal | telemetria | `estado_explicito` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/ragnarok` | GET | `lab.ragnarok.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: paper_accounts, paper_positions, platform_events, zion_suggestions | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/receita` | GET | `finance.revenue.read` | `read` | corp_session | mfa_login | `finance.read` · min `finance` | financial | R | L: operations | nao | `estado_explicito` | nenhum → RL-leitura | arrecadacao.test.ts (fonte), atribuicao.test.ts (fonte) |
| `/admin/api/rendimento` | POST | `lab.study.rendimento` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: DefiLlama, LI.FI (cotação) | telemetria | `best_effort` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/rotacao-grade` | POST | `lab.study.rotacao` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: Binance diário | telemetria | `best_effort` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/stats` | GET | `analytics.stats.read` | `read` | corp_session | mfa_login | `analytics.read` · min `growth` | financial_agg | R | L: autopilot_runs, autopilot_sessions, tier_cache, users | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/swap-allowlist` | GET | `security.swap_targets.read` | `read` | corp_session | mfa_login | `security.read` · min `security_admin` | security | R | L: platform_events | nao | `500_excecao` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/swap-allowlist` | POST | `security.swap_targets.probe` | `write` | corp_session | mfa_login | `security.probe.run` · min `security_admin` | security | W(telemetria) | E: platform_events · ext: 0x, LI.FI (cotação, carteira BURNER) | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/swap-guard` | GET | `security.swap_guard.read` | `read` | corp_session | mfa_login | `security.read` · min `security_admin` | security | R | L: platform_events | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/swap-guard` | POST | `security.swap_guard.probe` | `read` | corp_session | mfa_login | `security.probe.run` · min `security_admin` | security | R(sonda externa) | ext: Jupiter | nao | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/taxa-cex` | GET | `lab.cex_fee.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R+telemetria | E: platform_events · ext: Gate.io | nao | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/tendencia` | POST | `lab.study.tendencia` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: Binance diário | telemetria | `best_effort` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/tier-hub` | GET | `finance.tiers.read` | `read` | corp_session | mfa_login | `finance.read` · min `finance` | financial_agg | R | L: tier_cache | nao | `500_excecao` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/tier` | GET | `users.tier.read` | `read` | corp_session | mfa_login | `users.support.read` · min `support` | pii | R | L: tier_cache, users | acesso | `mascara_vazio` | nenhum → RL-leitura | plano-nao-e-admin.test.ts (fonte) |
| `/admin/api/tier` | POST | `users.tier.grant \| users.tier.revoke` | `identity` | corp_session | step_up | `tiers.manage` · min `superadmin` | financial | W | E: tier_cache | duravel_fail_closed | `escrita_nao_conferida` | nenhum → RL-sensivel | plano-nao-e-admin.test.ts (fonte) |
| `/admin/api/tournament` | GET | `lab.tournament.read` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | simulated | R | L: paper_accounts, paper_positions, zion_suggestions | nao | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/traffic` | GET | `analytics.traffic.read` | `read` | corp_session | mfa_login | `analytics.read` · min `growth` | pii_pseudonimo | R | L: platform_admins, platform_events, tier_cache | acesso | `mascara_zero` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/ulfhednar` | GET | `agents.mailbox.read` | `read` | corp_session | mfa_login | `agents.read` · min `operations` | operational | R | L: platform_events, ulfhednar_mensagens | nao | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/ulfhednar` | POST | `agents.mailbox.write` | `sensitive_write` | corp_session | step_up | `agents.instruct` · min `superadmin` | operational | W | E: platform_events, ulfhednar_mensagens | duravel_fail_closed | `escrita_conferida` | nenhum → RL-sensivel | — (só varredura) |
| `/admin/api/users` | GET | `users.profile.read` | `read` | corp_session | mfa_login | `users.support.read` · min `support` | pii | R | L: autopilot_positions, autopilot_sessions, operations, platform_events, tier_cache, users | acesso | `mascara_vazio` | nenhum → RL-leitura | — (só varredura) |
| `/admin/api/variancia` | POST | `lab.study.variancia` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W | E: lab_results, lab_runs, lab_strategies, platform_events · ext: Deribit DVOL, Binance | telemetria | `best_effort` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/venue-probe` | POST | `lab.venue.probe` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: venues CEX | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/venue-truth` | GET | `lab.venue.truth` | `read` | corp_session | mfa_login | `lab.read` · min `analyst` | lab | R+telemetria | E: platform_events · ext: venues CEX | nao | `n/a` | nenhum → RL-externo | venue-scope.test.ts (fonte) |
| `/admin/api/what-worked` | POST | `lab.benchmarks.run` | `write` | corp_session | mfa_login | `lab.run` · min `analyst` | lab | W(telemetria) | E: platform_events · ext: candles CEX | telemetria | `n/a` | nenhum → RL-externo | — (só varredura) |
| `/admin/api/whitelist` | GET | `identity.env_admins.read` | `read` | corp_session | mfa_login | `identity.read` · min `security_admin` | identity | R | — (env/sem banco) | acesso | `n/a` | nenhum → RL-leitura | — (só varredura) |

## Fora da matriz: privilégio admin aceito fora de /admin/api

R2/R5 precisam cobrir estes pontos (detalhe e linhas no inventário): `POST /api/tier/select` (`tier_cache.source='admin'` escolhe plano sem pagamento, `src/app/api/tier/select/route.ts:50,59`); `POST /api/cex/order` (ramo autopilot), `POST /api/autopilot/session`, `POST /api/autopilot/cron`, `POST /api/dca/cron` (`ADMIN_WALLETS` é piloto de automação com dinheiro real, `src/lib/autopilot/liberacao.ts:254`). Proposta: substituir por permissão explícita (`trading.automation.release` para pilotos; nenhum privilégio comercial derivado de papel admin).

## Resumo

- risk_class: read 44 · write 21 · sensitive_write 11 · identity 2 · financial 1.
- min_mfa: mfa_login 65 · step_up 14.
- audit_required: nao 36 · telemetria 21 · duravel_fail_closed 14 · acesso 8; hoje só `early-access/export` cumpre `duravel_fail_closed` (e `early-access/transition` via RPC transacional).
- min_role proposto: analyst 37 · security_admin 11 · operations 9 · finance 7 · superadmin 5 · growth 4 · support 4 · qualquer_papel 2.
- Rotas que leem um campo do corpo para escolher a ação (`admins` POST `action`, `tier` POST `action`, `autopilot-liberacao` POST `liberar`/`piloto`/`remover`) precisam de decisão por ação, não só por rota+método.
- Requisito de completude (ADM-011): o teste novo deve falhar se um `route.ts` exportar método sem linha nesta matriz, e deve checar a guarda **no próprio handler**, não no layout nem por arquivo.
- GET que grava (`GET /aprendizado`, `GET /arbiter-cohort`, `GET /derrapagem`, `GET /descartadas`, `GET /lab`, `GET /taxa-cex`, `GET /venue-truth`): com `auditor` só leitura, a escrita real de `GET /lab` (sincroniza `lab_strategies`) e de `GET /arbiter-cohort` (grava `arb_denylist`, já proposto como `lab.run`) tem de sair do GET ou exigir permissão de escrita; telemetria `recordEvent` pode ficar.
- `min` = `qualquer_papel` quando a permissão é dada a todos os papéis (`admin.view`).
