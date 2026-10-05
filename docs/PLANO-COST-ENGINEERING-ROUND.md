# COST ENGINEERING ROUND — reduzir o custo de 36 meses por engenharia · 🟢 ENTREGUE PARA AUDITORIA (lane B)

> **Aberto em:** 05/10/2026 · ledger **L-040** (neste branch).
> **Branch/worktree:** `cost-engineering-round-20261005` ·
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/cost-engineering-20261005`.
> **Base autorizada pelo dono:** `0afa8414636ec6eb73bf9e1d600272aff9367228` (L-039, HEAD de
> `pre-vercel-forward-20261003T234200Z`) · tree `26198edd6896a767bc6bbea09a1874c5593eb1b3`.
> **Não é** release candidate, **não é** produção. Commits = `COMMITTED_FEATURE_CHECKPOINT`.
> Proibido: push, merge, deploy, Vercel, escrita/migration hospedada, Lane A, preço/supply/política
> comercial, treasury, referral/reserve definitivos, dinheiro real.
> Relatório final: `docs/COST-ENGINEERING-ROUND-REPORT.md`.

## 0. Identidade medida antes do código

- `/home/zetta/swap-z-app` está em `kimi/round2-audit-fixes` = `d7741bb` (15/09), que é **ancestral**
  da base (127 commits atrás); ele **não** é o estado atual (START-HERE §4). Nada foi mexido lá.
- A base `0afa841` é o HEAD da worktree `pre-vercel-forward-20261003T234200Z` (limpa). Para não mover
  aquela branch, este round tem branch e worktree próprias criadas **a partir** de `0afa841`.
- Execução de testes: container capado (`--memory=2g --memory-swap=5g`, heap 1792 MB — regra do
  INC-RR-01), imagem com git, sem rede, `npm ci --offline`.

## 1. Itens

Status: 🔴 não iniciado · 🟡 em execução · 🟢 feito com evidência · ⏸️ bloqueado/externo.

| ID | Prioridade | Item | Status |
|---|---|---|---|
| CE-01 | P0 | Workbench próprio: RSI recalculado vela a vela (O(N²)); média/canal; cópias por operação | 🟢 `2b91e7a` `77a915f` — linear, idêntico (mutação), 2.308× HEAVY RSI |
| CE-02 | P0 | Workbench modo mesa: `computeIndicators` sobre o prefixo inteiro a cada barra (O(N²)) | 🟢 `d570d62` — `RetratoPorPrefixo`, idêntico barra a barra, 15× HEAVY |
| CE-03 | P0 | Benchmark end-to-end reprodutível (SMALL/MEDIUM/LARGE/HEAVY/MULTI-SYMBOL, antes/depois) | 🟢 `062daae` `e885ae1` — SMALL→HEAVY, antes×depois na mesma execução |
| CE-04 | P0 | Cota do Workbench: `consumoDaJanela` conta no app (max_rows 1000 < Pilot 5000) e TOCTOU | 🟢 `22a27da` `d445042` — reserva atômica no banco (0073), T20/T20b, PostgREST real |
| CE-05 | P0 | Orçamento sensível a computação (custo por rodada além de "1 backtest") | 🟢 `d445042` `037d3a6` — unidades × peso; ¼ (Pilot 1/16) — revisão do dono recomendada |
| CE-06 | P1 | Cache/deduplicação do Workbench (dados públicos de mercado; nunca estado privado) | 🟢 `39a2bb6` — série fechada em memória (só completa, só janela fechada) |
| CE-07 | P1 | ZION: custo de tokens (prefixo estável, cache, teto de saída dinâmico, roteamento) | 🟢 `7838493` `b8f9142` — contabilidade de cache corrigida; cache exato público |
| CE-08 | P1 | ZION: regressão mínima de qualidade | 🟢 `a2d83fd` — gabarito do código, prompts inalterados; ao vivo ⏸️ (credencial) |
| CE-09 | P1 | Paper desks: capacidade real provada (fórmula) e arquitetura de escala | 🟢 `0196494` `a1fe480` `fc59805` `72638a7` — fila justa, leituras compartilhadas, rota dedicada |
| CE-10 | P1 | Paper desks: teste de carga 200/500/1.000/2.000/3.250 | 🟢 `8caeb8c` — 200→3.250 desks, antes×depois em PostgREST real |
| CE-11 | P2 | Market data: chamadas duplicadas e centralização | 🟢 `cbe1d40` — paginação de velas (defeito de resultado, não só custo) |
| CE-12 | P2 | Banco: N+1, contagem no app, índices (migration só local) | 🟢 `0e9c3ca` — varredura estática + correções materiais; 2 `.in()` não verificados (LOW) |
| CE-13 | P2 | Storage/retenção | ⏸️ analisado e modelado (§19 do relatório); política de retenção PROPOSTA — apagar dado de cliente é decisão do dono |
| CE-14 | P2 | Observabilidade econômica | 🟢 `0e9c3ca` `0bda6f4` — admin paginado; métricas na linha da rodada (0075) |
| CE-15 | P1 | Remodelagem de 36 meses (cash/humano/fixo/econômico × tier × cenário) | 🟢 `564239f` `037d3a6` — `docs/COST-ENGINEERING-36M-MODEL.md` reprodutível |
| CE-16 | — | Relatório final + tabelas de evidência e de mudanças | 🟢 `docs/COST-ENGINEERING-ROUND-REPORT.md` |

## 2. Regras de equivalência (Workbench)

- Otimização tem de produzir **o mesmo resultado** onde a semântica anterior era correta. Prova por
  teste diferencial: implementação antiga preservada em teste × nova, sobre séries determinísticas
  e aleatórias, comparando operação por operação (igualdade exata, não tolerância).
- Mudança de semântica: parar, documentar, só prosseguir com prova de que a nova é a correta.
- Flywheel honesto (CLAUDE.md): expectancy líquida, `expirada` ≠ ganho/perda, stop-first — intocados.

## 3. Registro de execução

- 05/10: base medida e registrada (L-040); baseline 296/4.490 PASS.
- 05/10: CE-01…CE-16 executados; 22 commits de produto/teste/docs + o de entrega; validação final em `037d3a6`:
  304 arquivos / 4.547 testes PASS, type-check 0, lint 0 erros (145 avisos = baseline), SQL em cadeia nova 0001→0075 PASS.
- Relatório: `docs/COST-ENGINEERING-ROUND-REPORT.md`. Ledger L-041.
