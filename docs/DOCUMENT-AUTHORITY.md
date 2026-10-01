# DOCUMENT AUTHORITY — em qual documento confiar

> Função: **classificar**. Cada documento em `docs/` recebe uma classe e uma
> resposta direta: **pode ser usado como instrução atual?**
>
> Classificado em 01/10/2026 sobre `9f2ddcbe45f9f93c9a33c331e31e32c45d410019`.
> Critério: commit, data, conteúdo e ancestralidade. **Não** o nome do arquivo
> e **não** o selo de status que o próprio documento se dá.
>
> Revisão 3 (01/10/2026): `CERTIFIED` reservado para SHA com recert exata em
> PASS; `9f2ddcb` é COMMITTED_FEATURE_CHECKPOINT (CP-03). `docs/README.md`
> ganhou banner LEGACY (CP-07).

## Classes

| classe | significa |
|---|---|
| **AUTHORITATIVE** | descreve o estado real atual; deve ser lido |
| **ACTIVE_PLAN** | trabalho ainda em execução |
| **SUPPORTING_REFERENCE** | correto e útil para o tema dele, mas **não** define o estado atual |
| **SUPERSEDED** | valeu, e outro documento posterior o substituiu |
| **HISTORICAL_EVIDENCE** | registro do passado; **não executar como plano atual**, mesmo que tecnicamente correto |
| **UNKNOWN** | sem base para classificar (hoje: nenhum) |

> ⚠️ **Selo "🟢 vivo" ou "Status: 🟢" dentro de um PLANO não é prova de
> atualidade.** `PLANO-DCA-AUTOMATICO.md` ainda diz "🔴 nada implementado",
> mas o DCA existe desde #348. `PLANO-MURAL-DE-AGENTES.md` diz o mesmo, e
> `scripts/mural.mjs` existe desde #351. Confira no código.

## 1. Control plane (criado em 01/10/2026)

| PATH | CLASSIFICATION | VALID_FROM | VALID_UNTIL / SUPERSEDED_BY | SUBJECT | CAN_BE_USED_AS_CURRENT_INSTRUCTION? |
|---|---|---|---|---|---|
| `docs/START-HERE.md` | AUTHORITATIVE | 01/10 (base `9f2ddcb`) | current | porta de entrada | **SIM** |
| `docs/CURRENT-STATE.md` | AUTHORITATIVE | idem | current (substituído a cada mudança de estado) | onde estamos agora | **SIM** |
| `docs/AI-OPERATING-RULES.md` | AUTHORITATIVE | idem | current | método e regras para IA e humano | **SIM** |
| `docs/RELEASE-CHAIN.md` | AUTHORITATIVE | idem | current | ancestralidade e status de cada SHA | **SIM** |
| `docs/LAUNCH-READINESS-LEDGER.md` | AUTHORITATIVE | idem | current (append-only) | fases, evidência, próxima dependência | **SIM** |
| `docs/AUDIT-RECONCILIATION.md` | AUTHORITATIVE | idem | current (§5 append-only) | prova das correções + registro único de findings | **SIM** |
| `docs/GIT-AND-WORKTREE-MAP.md` | AUTHORITATIVE | idem | current | worktrees, branches e refs | **SIM** |
| `docs/DOCUMENT-AUTHORITY.md` | AUTHORITATIVE | idem | current | este arquivo | **SIM** |
| `CLAUDE.md` (raiz) | AUTHORITATIVE (só o bloco "Claude Code Entry Point"); o resto é SUPPORTING_REFERENCE (mapa do código) | 01/10, revisão 2 (sem commit) | current | entrada automática do Claude Code → START-HERE | **SIM** (o bloco de entrada) |
| `AGENTS.md` (raiz) | AUTHORITATIVE | 01/10, revisão 2 (sem commit) | current | entrada vendor-neutral para outros agentes → START-HERE | **SIM** |

## 2. Documentos existentes em `docs/` (87 arquivos)

`VALID_FROM` = o último commit que tocou o arquivo na linha atual
(`git log -1 9f2ddcb -- <arquivo>`).

| PATH | CLASSIFICATION | VALID_FROM | VALID_UNTIL / SUPERSEDED_BY | SUBJECT | CAN_BE_USED_AS_CURRENT_INSTRUCTION? |
|---|---|---|---|---|---|
| `docs/ADMIN-COMMAND-CENTER.md` | HISTORICAL_EVIDENCE | 51be982 2026-06-27 | — | rodada/relatório datado | NÃO |
| `docs/ANALISE-AUDITORIA-OPERACIONAL-08-07.md` | HISTORICAL_EVIDENCE | b7f088f 2026-07-09 | — | rodada/relatório datado | NÃO |
| `docs/ANALISE-DADOS-01.md` | HISTORICAL_EVIDENCE | 5a052d7 2026-07-02 | — | rodada/relatório datado | NÃO |
| `docs/ANALISE-DADOS-02.md` | HISTORICAL_EVIDENCE | 6d5aef4 2026-07-03 | — | rodada/relatório datado | NÃO |
| `docs/ARQUITETURA-IA.md` | SUPPORTING_REFERENCE | 4403fb0 2026-07-02 | — | arquitetura dos agentes/IA | SIM — referência técnica, conferir no código |
| `docs/AUDITORIA-AGENTES-25-07.md` | HISTORICAL_EVIDENCE | bff4e0d 2026-07-27 | — | rodada/relatório datado | NÃO |
| `docs/AUDITORIA-CELEIRO-29AGO.md` | HISTORICAL_EVIDENCE | daea83a 2026-08-31 | — | rodada/relatório datado | NÃO |
| `docs/AUDITORIA-GERAL.md` | HISTORICAL_EVIDENCE | 70a0b09 2026-07-02 | achados absorvidos por planos posteriores | auditoria de 02/07 | NÃO |
| `docs/AUDITORIA-MESAS-19-08.md` | HISTORICAL_EVIDENCE | e55a250 2026-08-20 | — | rodada/relatório datado | NÃO |
| `docs/AUDITORIA-PERDA-DINHEIRO.md` | HISTORICAL_EVIDENCE | 55e1b8b 2026-08-02 | — | rodada/relatório datado | NÃO |
| `docs/CONTEXTO-ZETTAWORD.md` | HISTORICAL_EVIDENCE | b66ead7 2026-07-05 | — | rodada/relatório datado | NÃO |
| `docs/DEMO-VIDEO-SCRIPT.md` | HISTORICAL_EVIDENCE | 3d2e9c9 2026-06-07 | — | rodada/relatório datado | NÃO |
| `docs/ESTADO-ATUAL.md` | SUPPORTING_REFERENCE | 9f2ddcb 2026-10-01 | estado atual → `START-HERE.md` + `CURRENT-STATE.md` (01/10, base `9f2ddcb`) · **banner no topo em 01/10 (CURRENT AUTHORITY → START-HERE; regra de 31/08 SUSPENSA)** | diário de retomada, lições, armadilhas da máquina | PARCIAL — NÃO para estado (topo diz "sem commit"; §1 diz main `5863b04`; regra de 31/08 suspensa); SIM para lições/armadilhas |
| `docs/GOLDEN-SET.md` | SUPPORTING_REFERENCE | 4403fb0 2026-07-02 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/IDEIAS-ESTACIONADAS.md` | SUPPORTING_REFERENCE | 96875ef 2026-06-30 | — | ideias paradas e o que destrava cada uma | NÃO — backlog |
| `docs/INVARIANTES-DE-MEDICAO.md` | SUPPORTING_REFERENCE | e4c8fe5 2026-08-16 | — | 23 regras de medição (flywheel/backtest) | SIM — para trabalho de medição |
| `docs/LEDGER-MESTRE-RELEASE.md` | SUPPORTING_REFERENCE | 6fded4c 2026-09-26 | "código certificado" → `RELEASE-CHAIN.md` (`0d21874`); §Z/§ZB só em `origin/platform-closure` | cadeia R1→PC-B2, migrations 0001→0066 × produção, leitura de produção 26/09 | PARCIAL — SIM para §N (migrations) e §Y (produção em 26/09); NÃO para "SHA certificado" |
| `docs/LEITURA-SEGURA-DO-BANCO.md` | SUPPORTING_REFERENCE | b21823a 2026-08-03 | — | truncagem do PostgREST e método de leitura | SIM — método |
| `docs/LIGHTHOUSE-BASELINE.md` | HISTORICAL_EVIDENCE | 78c40c3 2026-06-05 | — | rodada/relatório datado | NÃO |
| `docs/MANUAL_TEST_PLAN.md` | HISTORICAL_EVIDENCE | 7aa8a87 2026-05-20 | — | rodada/relatório datado | NÃO |
| `docs/MEDICAO-TEM-BORDA.md` | SUPPORTING_REFERENCE | 0d75311 2026-08-29 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/NFT-BRIEFING.md` | SUPPORTING_REFERENCE | 6039e3a 2026-06-30 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/OBSERVACAO-CELEIRO-23AGO.md` | SUPPORTING_REFERENCE | daea83a 2026-08-31 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PENTEST-28-07.md` | HISTORICAL_EVIDENCE | 8cafbd3 2026-07-28 | — | rodada/relatório datado | NÃO |
| `docs/PITCH-DECK.md` | HISTORICAL_EVIDENCE | b9e8852 2026-06-07 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-ACAO-REVIEWS.md` | HISTORICAL_EVIDENCE | 155286b 2026-07-01 | — | P0/P1/P2 dos reviews de julho | NÃO |
| `docs/PLANO-ADMIN-INTEL.md` | HISTORICAL_EVIDENCE | 40da033 2026-07-12 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-AGENTE-SNIPER.md` | HISTORICAL_EVIDENCE | fc58ad1 2026-07-14 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-ALAVANCADO.md` | SUPPORTING_REFERENCE | a6142df 2026-08-30 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-ANALISTA-PROFUNDO.md` | HISTORICAL_EVIDENCE | 88af5af 2026-07-25 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-ARBITER-REAL.md` | SUPPORTING_REFERENCE | ddea2bb 2026-08-04 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-ARQUIVO-RODADAS.md` | HISTORICAL_EVIDENCE | 048fb8e 2026-07-17 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-ATRASO-DE-EXECUCAO.md` | SUPPORTING_REFERENCE | 6bb2fe7 2026-08-29 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-BANCADA-DO-CLIENTE.md` | SUPPORTING_REFERENCE | aed31b1 2026-09-07 | — | bancada do cliente (em produção 06/09) | NÃO — trilha de produto |
| `docs/PLANO-BARRA-DE-LANCAMENTO.md` | SUPPORTING_REFERENCE | db9b7eb 2026-08-01 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-CELEIRO-AMBICIOSO.md` | HISTORICAL_EVIDENCE | 1733d5f 2026-08-22 | entregue | plano entregue | NÃO |
| `docs/PLANO-CUSTO-UNIFICADO.md` | HISTORICAL_EVIDENCE | 63501b8 2026-08-16 | entregue | plano entregue | NÃO |
| `docs/PLANO-DCA-AUTOMATICO.md` | HISTORICAL_EVIDENCE | d8883d5 2026-09-15 | "🔴 nada implementado" superado por #348 `628089e` e PC-B2 · **banner HISTORICAL_EVIDENCE em 01/10** | desenho do DCA automático | NÃO — o DCA real segue NO-GO |
| `docs/PLANO-DE-ACAO-ZION.md` | HISTORICAL_EVIDENCE | e78cdd4 2026-06-28 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-DERRAPAGEM.md` | HISTORICAL_EVIDENCE | f1c0b38 2026-08-17 | entregue | plano entregue | NÃO |
| `docs/PLANO-DESCARTADAS.md` | HISTORICAL_EVIDENCE | f04f654 2026-08-17 | entregue | plano entregue | NÃO |
| `docs/PLANO-DESKTOP.md` | HISTORICAL_EVIDENCE | ed412d3 2026-07-07 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-EARLY-ACCESS.md` | ACTIVE_PLAN | 9f2ddcb 2026-10-01 | cabeçalho "branch whitelist…/sem commit" desatualizado desde `9f2ddcb` · **banner + status operacional corrigido em 01/10 (Fase 1 COMMITTED_FEATURE_CHECKPOINT `9f2ddcb`, recert BLOCKED; Fase 2 BLOCKED_NOT_STARTED, sem código)** | early access Fase 1 (feita) + escopo da Fase 2 (§13–§15) | SIM — só para early access |
| `docs/PLANO-ESCOLA-DE-TRADERS.md` | SUPPORTING_REFERENCE | 3c683f4 2026-08-02 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-FORA-DA-AMOSTRA.md` | SUPPORTING_REFERENCE | 8ca6f67 2026-08-14 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-HIBRIDO-MULTI-MODEL.md` | HISTORICAL_EVIDENCE | ae1e9f6 2026-07-01 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-HIRD-REDESIGN.md` | HISTORICAL_EVIDENCE | f2db708 2026-07-06 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-LABORATORIO-DE-ESTRATEGIAS.md` | SUPPORTING_REFERENCE | c63ed9e 2026-08-12 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-LUCRATIVIDADE.md` | SUPPORTING_REFERENCE | 7579a86 2026-07-17 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-MELHORIAS-AUDITORIA.md` | HISTORICAL_EVIDENCE | 8e53bee 2026-07-05 | — | M1–M8 de julho | NÃO |
| `docs/PLANO-MESA-AGENTES.md` | SUPPORTING_REFERENCE | a32a13b 2026-07-14 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-MESTRE.md` | SUPERSEDED | 96875ef 2026-06-30 | sequência de lançamento → `LAUNCH-READINESS-LEDGER.md` (01/10) | roadmap de 30/06 (fases A–E, NFT, Colosseum) | NÃO — visão de produto apenas |
| `docs/PLANO-MIDGARD-TRAFEGO.md` | HISTORICAL_EVIDENCE | 34af8e5 2026-07-06 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-MURAL-DE-AGENTES.md` | HISTORICAL_EVIDENCE | af886d7 2026-08-23 | "🔴 nada implementado" superado por #351/#352 (`scripts/mural.mjs`) · **banner HISTORICAL_EVIDENCE em 01/10** | mural entre sessões | NÃO |
| `docs/PLANO-NEXT-16.md` | HISTORICAL_EVIDENCE | baaf19c 2026-09-06 | entregue 06/09; next agora ^16.3.6 (`0d21874`) | migração Next 14→16 | NÃO |
| `docs/PLANO-O-CELEIRO.md` | HISTORICAL_EVIDENCE | e55a250 2026-08-20 | entregue | plano entregue | NÃO |
| `docs/PLANO-ORACULO-ANALISTA.md` | HISTORICAL_EVIDENCE | 0ebf6b2 2026-07-17 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-PAINEL-CONTROLE-TORNEIO.md` | HISTORICAL_EVIDENCE | 155286b 2026-07-01 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-PAINEL-POR-AREA.md` | SUPPORTING_REFERENCE | e4c8fe5 2026-08-16 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-PAINEL-SINCRONIZADO.md` | SUPPORTING_REFERENCE | a685194 2026-08-14 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-PAPER-GATEIO.md` | HISTORICAL_EVIDENCE | 399077f 2026-07-11 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-POLISH-FLYWHEEL.md` | HISTORICAL_EVIDENCE | 236d227 2026-07-17 | — | rodada/relatório datado | NÃO |
| `docs/PLANO-RAGNAROK.md` | SUPPORTING_REFERENCE | e7db648 2026-07-29 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-RESERVA-DE-MODELO.md` | HISTORICAL_EVIDENCE | 64af97f 2026-08-29 | entregue | plano entregue | NÃO |
| `docs/PLANO-RUMO-AO-10.md` | HISTORICAL_EVIDENCE | 5a052d7 2026-07-02 | — | rodadas 1–3 pós-auditoria de julho (não são os Rounds R1–R9) | NÃO |
| `docs/PLANO-STOP-E-ORFAOS.md` | HISTORICAL_EVIDENCE | 0187acc 2026-08-23 | entregue | plano entregue | NÃO |
| `docs/PLANO-TAMANHO-E-REGIME.md` | SUPPORTING_REFERENCE | 51465a6 2026-08-21 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-TERMINAL-PRO.md` | SUPPORTING_REFERENCE | f722941 2026-08-31 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLANO-TORNEIO-HONESTO.md` | HISTORICAL_EVIDENCE | 63501b8 2026-08-16 | entregue | plano entregue | NÃO |
| `docs/PLANO-ULFHEDNAR.md` | HISTORICAL_EVIDENCE | 08c4f82 2026-08-24 | entregue 24/08 | aba ÚLFHÉÐNAR | NÃO |
| `docs/PLANO-VOLANTE-RELIGADO.md` | SUPPORTING_REFERENCE | 618f1b2 2026-08-16 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/PLATFORM-PROGRESS.md` | HISTORICAL_EVIDENCE | cd96654 2026-06-23 | — | rodada/relatório datado | NÃO |
| `docs/POLISH-PLAN.md` | HISTORICAL_EVIDENCE | 86039bf 2026-06-28 | — | rodada/relatório datado | NÃO |
| `docs/README.md` | SUPPORTING_REFERENCE | afe2665 2026-09-26 | classificação vivo/histórico → `DOCUMENT-AUTHORITY.md` (01/10) · **bloco "START HERE" no topo em 01/10** · **banner "LEGACY INDEX — HISTORICAL SNAPSHOT" antes do índice antigo (revisão 3)** | índice de docs | NÃO para autoridade; SIM como índice |
| `docs/RELATORIO-27-07.md` | HISTORICAL_EVIDENCE | 334e8ae 2026-07-27 | — | rodada/relatório datado | NÃO |
| `docs/RELATORIO-27-07.zh.md` | HISTORICAL_EVIDENCE | 2a5e4b3 2026-07-27 | — | rodada/relatório datado | NÃO |
| `docs/RELATORIO-TECNICO-27-07.md` | HISTORICAL_EVIDENCE | 4357e97 2026-07-27 | — | rodada/relatório datado | NÃO |
| `docs/RELATORIO-TECNICO-27-07.zh.md` | HISTORICAL_EVIDENCE | 32535dc 2026-07-27 | — | rodada/relatório datado | NÃO |
| `docs/RELEASE-RUNBOOK.md` | AUTHORITATIVE | 43c484b 2026-09-30 | vigente para o candidato `0d21874` | pacote de release do runtime certificado, gates, achados, o que só o dono autoriza | SIM — para o release de `0d21874`; não autoriza deploy |
| `docs/RUNBOOK.md` | SUPPORTING_REFERENCE | 9f2ddcb 2026-10-01 | — | env vars, crons, playbooks de incidente (+ config futura do early access) | SIM — para operação/env; não para estado |
| `docs/SPEC-round9.md` | HISTORICAL_EVIDENCE | e4f6027 2026-09-20 | Round 9 fechado em `798fe27`; release → `RELEASE-RUNBOOK.md` | SPEC do Round 9 (A131–A133+) | NÃO |
| `docs/TESTE-DA-TAXA-EVM.md` | SUPPORTING_REFERENCE | a188c27 2026-08-11 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/TESTE-DINHEIRO-REAL.md` | SUPPORTING_REFERENCE | 3ba41e8 2026-06-27 | — | trilha de produto/flywheel (fora da cadeia de release) | NÃO para estado de lançamento; reconferir no código antes de usar |
| `docs/TROCAR-DE-PROVEDOR.md` | SUPPORTING_REFERENCE | fe991d6 2026-08-21 | — | Kimi ↔ Anthropic | SIM — como fazer; não diz o provedor atual |
| `docs/WHITELIST-FUNDRAISING-DISCOVERY.md` | SUPPORTING_REFERENCE | 9f2ddcb 2026-10-01 | status "Fase 1 não iniciada" desatualizado desde `9f2ddcb` | discovery; §0 = decisões autoritativas A–H | SIM — só §0, só para early access/fundraising |
| `docs/entrega-round9.md` | HISTORICAL_EVIDENCE | 798fe27 2026-09-22 | idem (diz HEAD `3b39e08`, real `798fe27`) | entrega do Round 9 ao auditor | NÃO |
| `docs/retest-independente-batch2-3123fb4.md` | HISTORICAL_EVIDENCE | afe2665 2026-09-26 | — (verbatim, não editar) | retest independente do PC-B2 em `3123fb4` | NÃO — prova histórica |

## 3. Documentos que existem só fora da linha atual

| PATH | onde | CLASSIFICATION | nota |
|---|---|---|---|
| `docs/PLANO-MESTRE-AUDITORIA.md` | só em `origin/platform-closure` (`5dee152`, 28/09) | SUPPORTING_REFERENCE | escopo da auditoria mestre, FASE 0→33. Leitura: `git show origin/platform-closure:docs/PLANO-MESTRE-AUDITORIA.md` |
| `docs/PLANO-PROD-CLONE-LAB.md` | só em `origin/platform-closure` (`4cf073a`, 28/09) | SUPPORTING_REFERENCE | desenho do laboratório de clone de produção; `RELEASE-RUNBOOK.md` §8 o cita |
| `docs/LEDGER-MESTRE-RELEASE.md` §Z/§ZB | só em `origin/platform-closure` | HISTORICAL_EVIDENCE | Release Phases 1–3B, staging hospedado `nvbrzifyurslegudlhaz` |
| relatórios do laboratório | `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/reports/` | HISTORICAL_EVIDENCE | evidência bruta. Fica **fora do repo** de propósito |

## 4. Mapa de substituição

| documento antigo | → substituído por | motivo | desde |
|---|---|---|---|
| `ESTADO-ATUAL.md` como "leia primeiro" (estado) | `START-HERE.md` + `CURRENT-STATE.md` | o topo mistura 3 linhas (main, platform-closure, preprod/EA) e já tem fato desatualizado | `9f2ddcb`, 01/10 |
| `README.md` como classificação vivo/histórico | `DOCUMENT-AUTHORITY.md` | o índice não reflete a linha de release nem o control plane | `9f2ddcb`, 01/10 |
| `LEDGER-MESTRE-RELEASE.md` §0.4 "código certificado = `3123fb4`" | `RELEASE-RUNBOOK.md` §1 + `RELEASE-CHAIN.md` (`0d21874`) | vieram depois o Batch 3, o preprod e o supply chain | `43c484b`, 30/09 |
| `LEDGER-MESTRE-RELEASE.md` §O (findings) | `AUDIT-RECONCILIATION.md` §5 | o registro único agora inclui preprod, supply chain, laboratório e EA | `9f2ddcb`, 01/10 |
| `PLANO-MESTRE.md` (roadmap de lançamento) | `LAUNCH-READINESS-LEDGER.md` | o roadmap de 30/06 não conhece a linha R1→preprod→EA | `9f2ddcb`, 01/10 |
| `SPEC-round9.md` / `entrega-round9.md` | `LEDGER-MESTRE-RELEASE.md` §K → `RELEASE-CHAIN.md` | round fechado em `798fe27` | `798fe27`, 22/09 |
| `WHITELIST-FUNDRAISING-DISCOVERY.md` (corpo, fora do §0) | o próprio §0 + `PLANO-EARLY-ACCESS.md` | o §0 diz que prevalece sobre o resto | `9f2ddcb`, 01/10 |
| `PLANO-EARLY-ACCESS.md` cabeçalho ("sem commit", branch whitelist) | `CURRENT-STATE.md` | a Fase 1 foi commitada (`9f2ddcb`) e a Fase 2 tem branch própria | `9f2ddcb`, 01/10 |
| regra "tudo vai para produção sempre" (`ESTADO-ATUAL.md`, 31/08) | `AI-OPERATING-RULES.md` §6.1 (**política formal de deploy**) | **FORMALMENTE SUSPENSA por decisão do dono.** Deploy só com SHA explícito + `RELEASE_CANDIDATE` + certificação PASS + autorização explícita do dono | 01/10/2026 (ledger L-012) |
| `CLAUDE.md` "Retomada: `ESTADO-ATUAL.md` primeiro" | `CLAUDE.md` bloco "Claude Code Entry Point" → `START-HERE.md` | entrada única e canônica | 01/10/2026 (ledger L-015) |
| `README.md` seção "🟢 Vivos — fonte de verdade operacional" | `DOCUMENT-AUTHORITY.md` + `START-HERE.md` (banner LEGACY no próprio README) | contradizia a autoridade atual para leitor novo | 01/10/2026 (ledger L-016) |
| `CLAUDE.md` "escreva no mural" (uso automático de `scripts/mural.mjs`) | `CLAUDE.md` revisão 3 + `AI-OPERATING-RULES.md` §6.2 | o script usa Supabase hospedado com credencial real; só com autorização do dono | 01/10/2026 (ledger L-016) |
| `CLAUDE.md` "Best-effort em volta de dinheiro" | `CLAUDE.md` revisão 3 (best-effort só para telemetria não crítica; fail-closed em dinheiro/permissão) | a frase antiga podia ser lida como licença para fail-open | 01/10/2026 (ledger L-016) |
| `PLANO-DCA-AUTOMATICO.md` status 🔴 | código `src/lib/dca/*` (#348 `628089e`, PC-B2 `3123fb4`) | o status no arquivo nunca foi atualizado | 24/08 |
| `PLANO-MURAL-DE-AGENTES.md` status 🔴 | `scripts/mural.mjs` (#351 `2e6271b`, #352 `6dce334`) | idem | 24/08 |

## 5. Regra de manutenção

- Doc novo entra nesta tabela **no mesmo commit** em que nasce.
- Quando um doc deixa de valer, ele **não é apagado nem renomeado**. Muda a
  classe dele aqui e entra uma linha no mapa de substituição.
- Na revisão 1 os documentos antigos **não foram editados**. Na revisão 2
  (01/10, Control Plane Closure), só foram acrescentados **banners curtos no
  topo** de `ESTADO-ATUAL.md`, `PLANO-EARLY-ACCESS.md` (+ status operacional),
  `PLANO-DCA-AUTOMATICO.md` e `PLANO-MURAL-DE-AGENTES.md`, e o bloco START HERE
  em `README.md`. O conteúdo histórico foi preservado. As lacunas restantes
  estão em `CURRENT-STATE.md` e `AUDIT-RECONCILIATION.md` §5.6.
