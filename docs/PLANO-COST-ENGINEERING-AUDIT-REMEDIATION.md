# COST ENGINEERING — AUDIT REMEDIATION ROUND · 🟢 ENTREGUE PARA RE-AUDITORIA (lane B, local)

> **Aberto em:** 05/10/2026, pelo mandato do dono após a auditoria independente do round anterior.
> **Branch/worktree:** `cost-engineering-audit-remediation-20261005` ·
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/cost-engineering-remediation-20261005`.
> **Início:** HEAD auditado `14e5a2089a1f03c1726847089c7ad5f1d7f65dad` (tree `58df60bf…`), conferido limpo
> antes do primeiro byte. O branch auditado `cost-engineering-round-20261005` NÃO foi tocado.
> **Base do round anterior:** `0afa8414636ec6eb73bf9e1d600272aff9367228`.
> **Não é** release candidate, **não é** produção. Proibido: push, merge, deploy, Vercel, Supabase
> hospedado, migration hospedada, Lane A, preço/supply/referral/reserva definitivos, dinheiro real.
> Relatório final: `docs/COST-ENGINEERING-AUDIT-REMEDIATION-REPORT.md`.

## 1. Itens

Status: 🔴 não iniciado · 🟡 em execução · 🟢 feito com evidência · ⏸️ bloqueado/externo.

| ID | Achado da auditoria | Prioridade | Status |
|---|---|---|---|
| RM-01 | Trava do tique do papel: SELECT → decide → UPSERT (não exclusiva) | P0 | 🟢 `4cac776` — lease 0076; 2/10/30 → 1 |
| RM-02 | Posição de papel duplicada (sem identidade canônica nem UNIQUE) | P0 | 🟢 `4cac776` — chave canônica + UNIQUE + RPC; 2/10/30 → 1 posição |
| RM-03 | Última vela avaliada derivada só das posições ABERTAS (reabre a mesma vela depois de fechar) | P0 | 🟢 `4cac776` — `ultima_vela_aberta`; mesma vela após fechar não reabre |
| RM-04 | `fecharRodada` com retorno ignorado (sucesso falso, rodada presa em `rodando`) | P0 | 🟢 `e8f31bd` — confirmado; rota 503/500 |
| RM-05 | 0073/0074/0075 sem semântica de release (estado 0073 sem 0075 silencioso) | P0 | 🟢 `357b458` + 0076 — matriz A–E; unidade atômica provada |
| RM-06 | `{ data, error }` ignorado: fallback 0074, `gravarUltimoTique`, `marcarTiqueAdiado`, `gravarCursor`, leituras do tique | P1 | 🟢 `4cac776` — desfecho lido em toda escrita do tique |
| RM-07 | Growth: erro/truncamento vira 0 | P1 | 🟢 `d465cde` — `null` + estado; resumo 'indisponível' |
| RM-08 | Cache-write do provedor OpenAI-compatível gravado como 0 | P1 | 🟢 `79b7ad5` — Kimi/DeepSeek; preços de lista (conferência real NOT EXERCISED) |
| RM-09 | ZION `ask` sem fatos comerciais autoritativos | P0 | 🟢 `73d47ba` — fatos derivados no `ask`; gabarito Founders corrigido (modelo real NOT EXERCISED) |
| RM-10 | Pilot 5.000 "backtests padrão" (3 ativos × 1 ano × 4h) dentro de 1/16 — provar ou declarar NO | P0 | 🟢 `009079d` — YES (estratégia própria) / NO (modo mesa); decisão do CEO/auditor |
| RM-11 | Suporte humano: definição explícita no modelo (sem concierge invisível) | P1 | 🟢 `802939c` — definição + sensibilidade no modelo |
| RM-12 | Paginação admin por offset: declarar o que não é ledger-grade; corrigir rota tocada que viole | P2 | 🟢 `d465cde` — paginação por chave; não ledger-grade declarado |

## 2. Desenho decidido antes do código

**RM-01 — trava.** Arrendamento (lease) atômico no banco: `bancada_tique_arrendar(escopo, dono_do_lease, ttl)`
faz `INSERT … ON CONFLICT DO UPDATE … WHERE vencido` numa instrução só (a linha conflitante é travada pelo
próprio Postgres — duas chamadas não passam juntas) e devolve se ganhou. `bancada_tique_liberar` só apaga se o
lease ainda é do mesmo dono (token aleatório por passagem). Queda/crash: o lease vence pelo TTL. As DUAS entradas
do tique (rota dedicada e cron do backtest) usam o MESMO escopo. Sem a função no banco, o tique NÃO roda
(falha fechada) — rodar sem exclusão é exatamente o defeito.

**RM-02/RM-03 — identidade canônica e estado do sinal.** Estratégias são IMUTÁVEIS depois de salvas
(`params`, `simbolos`, `intervalo` e `mesa` só são escritos no INSERT; editar = nova estratégia), então a versão
da estratégia é o próprio `estrategia_id`. A regra de produto já escrita no tique é "uma posição por mesa por vez"
e "cada vela é avaliada UMA vez por mesa". Portanto uma oportunidade de abertura é
`(estrategia_id, intervalo da decisão, vela_em)` — o dono é implicado pelo `estrategia_id` (conferido na RPC);
o lado é função da estratégia; o símbolo NÃO entra, porque a mesa abre no máximo uma posição por vela, qualquer
que seja o símbolo (incluí-lo permitiria abrir ETH na vela em que BTC já abriu e fechou — a inflação de amostra
que a guarda existe para impedir). Chave: `v1:<estrategia_id>:<intervalo>:<vela_em>`, coluna `chave_entrada`
com UNIQUE parcial (linhas legadas ficam NULL — nada a reescrever no hospedado). A abertura passa a ser a RPC
`bancada_abrir_posicao_papel`, que numa transação: trava a linha da estratégia (`FOR UPDATE`), confere dono,
recusa se há posição aberta, recusa se `vela_em <= ultima_vela_aberta`, insere com a chave e grava
`bancada_estrategia.ultima_vela_aberta`. Conflito = `{ok:true, criada:false, motivo:"ja_registrada"}`, nunca erro
fatal. `ultima_vela_aberta` é o estado autoritativo de "já processei esta vela" — sobrevive a posição fechada,
restart, outro worker, replay; a migração o preenche com o maior `vela_em` histórico de cada estratégia.
Fechamento: `UPDATE … WHERE status='aberta'` — o segundo fechamento (replay/concorrente) não reescreve o primeiro.

**RM-04 — fecharRodada.** Só `rodando → terminal` (UPDATE condicionado, conferido pela linha devolvida);
replay com o mesmo desfecho = sucesso idempotente; erro transitório = 1 nova tentativa; coluna de métrica
ausente (0075 não aplicada) = fecha SEM métricas e declara. Se o fechamento não persistir, a rota responde
**503 `rodada_nao_persistida`** com o `rodadaId` — nunca `ok:true`.

**RM-05 — migrations.** Nova 0076 (lease + abertura idempotente + estado do sinal). Matriz de estados testada
localmente: até 0072 · 0073 · 0073+0074 · 0073+0074+0075 · + 0076. Cada estado é declarado SUPPORTED,
SUPPORTED-DEGRADED (declarado), FAIL-CLOSED ou UNSUPPORTED, com teste.

**RM-08 — cache-write.** Documentação oficial do Kimi (05/10/2026): `usage.prompt_tokens_details`
traz `cached_tokens` E `cache_write_tokens`, mutuamente exclusivos, somando `prompt_tokens` com o resto.
DeepSeek: `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` (sem escrita). Normalizar os três formatos.
Achado colateral: a tabela de preço do repo para Kimi (0,60/2,50, cache 0,06) diverge da lista pública atual
do kimi-k2.6 (0,95 miss / 0,16 hit / 4,00 saída, sem preço de escrita separado na série K2) — corrigir e
recalcular o modelo de 36 meses, declarando o impacto.

**RM-09 — fatos.** Um módulo DERIVADO (`zion/fatos-da-plataforma.ts`) monta o bloco de fatos a partir das
constantes que o produto já usa (`chains.ts`, `tier/fees.ts`, `tier/types.ts`, `pricing/plans.ts`,
`founders-sale/config.ts` + `beneficios.ts`, `bancada/cotas.ts`). Nenhum fato digitado à mão. Injetado no
sistema do modo `ask`. Regressão: cada fato obrigatório do gabarito (`regressao-qualidade.ts`) tem de estar no
contexto; afirmações proibidas não. Modelo real: NOT EXERCISED (credencial não autorizada).

**RM-10 — Pilot.** Prova pela fórmula de `cotas.ts` + amostra real pelo caminho da reserva no banco.
Resultado objetivo `STANDARD_5000_FITS = YES/NO`. NÃO alterar o 1/16.

## 3. Execução

Testes em container capado (2 GB / 5 GB swap, heap 1792 MB), sem rede, `npm ci --offline`. Banco: Postgres
`supabase/postgres:17.6.1.127` + PostgREST 14.17 descartáveis (`zswap-local/bin/rm-stack`), rede `--internal`.

## 4. Entrega

Último commit de código **C1b `7aa021d`** (a recertificação do C1 `802939c` FALHOU 1 teste de tempo de relógio — corrigido o
método, limites mantidos, recertificado do zero). Recert no SHA exato: suíte 311/4.630 PASS, type-check 0, lint 0/145, build PASS,
SQL 19/19, 20b/23b/16b/13-estável PASS, integração 19 + 1 SKIP. Relatório: `docs/COST-ENGINEERING-AUDIT-REMEDIATION-REPORT.md`.

