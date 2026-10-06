# COST ENGINEERING — AUDIT REMEDIATION ROUND — RELATÓRIO

> Lane B, desenvolvimento local. **Não é** release candidate, **não é** produção. Nada foi aplicado em banco hospedado,
> nada foi publicado, nenhum push. Evidência: `zswap-local/evidence/cost-engineering-remediation-20261005/`.

## 1. EXECUTIVE VERDICT

**READY FOR INDEPENDENT RE-AUDIT.** Os 10 achados da auditoria independente (e as 2 dependências diretas do mandato) estão
corrigidos e testados localmente, com prova contra Postgres 17.6 + PostgREST 14.17 reais e descartáveis:

- o tique do papel tem **exclusão real no banco** (lease atômico): 2/10/30 tiques simultâneos → 1 roda;
- a abertura é **idempotente por identidade canônica** (chave + UNIQUE + trava da linha): 2/10/30 aberturas simultâneas da mesma
  oportunidade → 1 posição; **a mesma vela não reabre depois de a posição fechar**; a vela seguinte abre;
- `fecharRodada` só declara fechada a rodada que o banco confirmou; a rota responde **503** em vez de `ok:true` falso;
- 0073–0076 têm **semântica de release provada**: cada estado intermediário é SUPPORTED, SUPPORTED-DEGRADED (declarado) ou
  FAIL-CLOSED; a 0076 **recusa** aplicar sem 0073–0075; aplicadas numa transação, a unidade é **tudo ou nada**;
- erro do Supabase não vira sucesso nas escritas do tique; **erro/truncamento não vira zero** no Growth nem no resumo diário;
- a contabilidade do provedor OpenAI-compatível separa **leitura e escrita de cache** (formato documentado do Kimi e do DeepSeek);
- o ZION `ask` recebe **fatos oficiais derivados** das constantes do produto;
- **STANDARD_5000_FITS = YES** (estratégia própria, definição proposta) — e **NO no modo mesa** com a mesma definição.

Recertificação completa no SHA exato do último commit de código (**C1b `7aa021d`**): type-check 0 · lint 0 erros / 145 avisos (=
auditado) · **suíte 311 arquivos / 4.630 testes PASS, 0 FAIL, 0 SKIP** · build PASS · SQL 19/19 · 20b/23b/16b/13-estável PASS ·
integração 19 PASS + 1 SKIP (ZION ao vivo, credencial). ⚠️ A recertificação do primeiro C1 (`802939c`) **FALHOU** um teste
(trava de complexidade por tempo de relógio) — corrigido o MÉTODO de medida (limites mantidos) e recertificado do zero como C1b;
nenhuma reexecução para "virar PASS" (§19).

Abertos e declarados (§22): regressão de qualidade do ZION contra o modelo real NÃO EXERCIDA; a definição comercial do Pilot e o
modo mesa são decisão do CEO/auditor; HEAVY/STRESS continuam negativos no modelo (premissa de suporte humano); 4 achados LOW novos.

## 2. BASE SHA

| | SHA |
|---|---|
| Base do round anterior | `0afa8414636ec6eb73bf9e1d600272aff9367228` |
| **Início desta remediação (HEAD auditado)** | `14e5a2089a1f03c1726847089c7ad5f1d7f65dad` (tree `58df60bf…`), conferido limpo antes do primeiro byte |
| Branch | `cost-engineering-audit-remediation-20261005` (local, sem upstream), worktree própria. O branch auditado `cost-engineering-round-20261005` não foi tocado. |

## 3. FINAL HEAD

- **Último commit de código (C1b, recertificado): `7aa021d032a4ba706a9447663a8daf7e67431ca1`** (tree `fbf1c279…`).
- **Final HEAD:** o commit docs-only que contém este relatório (C2), filho direto de `7aa021d`; o SHA está no pacote de auditoria
  (`git/identity.txt`). `7aa021d..C2` = só `docs/`.

## 4. COMMITS

| SHA | tipo | conteúdo |
|---|---|---|
| `2611307` | docs | plano da remediação (desenho decidido antes do código) |
| `4cac776` | fix | RM-01/02/03/06 — lease do tique, abertura idempotente, estado do sinal, escritas do tique conferidas (0076, T23, T23b, integração) |
| `e8f31bd` | fix | RM-04 — `fecharRodada` confirmado; rota 503 / 500 com `registrada` |
| `357b458` | test | RM-05 — matriz de compatibilidade A–E |
| `d465cde` | fix | RM-07/RM-12 — Growth e resumo: não-medido ≠ zero; paginação por chave |
| `79b7ad5` | fix | RM-08 — escrita/leitura de cache (Kimi, DeepSeek) e preços de lista |
| `009079d` | test | RM-10 — prova Pilot 5.000 padrão (fórmula + amostra real) |
| `73d47ba` | feat | RM-09 — fatos oficiais no ZION `ask`; gabarito Founders corrigido (RM-09b) |
| `802939c` | docs/cost | RM-11, §20/§21 — modelo de 36 meses recalculado; suporte; categorias (**C1 — recert FALHOU**) |
| `7aa021d` | test | **C1b** — trava de complexidade mede mínimos intercalados (mesmos limites) |
| (C2) | docs | este relatório, status do plano, ledger L-042 |

Cada commit foi verificado numa worktree git isolada (type-check + suítes afetadas) antes do seguinte. A suíte completa rodou no
C1 (falhou 1, §19) e no C1b (PASS).

## 5. FILES CHANGED

`14e5a20..7aa021d`: **44 arquivos, +3.507 / −534.** Produção: `supabase/migrations/0076_*`, `src/lib/bancada/{store,tique,cotas}.ts`,
`src/app/api/bancada/{backtest,tique}/route.ts`, `src/app/api/zion/{route,backtest/route}.ts`, `src/lib/ai/provider.ts`,
`src/lib/admin/{ai-cost,growth,watchdog}.ts`, `src/app/admin/api/{growth,receita}/route.ts`,
`src/components/admin/panels/GrowthPanel.tsx`, `src/lib/supabase/paginar.ts`, `src/lib/zion/{fatos-da-plataforma,regressao-qualidade}.ts`.
Testes novos: `remediacao-auditoria`, `fechamento` (rota), `pilot-padrao`, `growth`, `digest`, `paginar-chave`, `fatos-da-plataforma`,
SQL `23` / `23b`, integração `papel-concorrencia`, `compatibilidade-migrations`, `pilot-padrao`. Testes ajustados (intenção mantida,
justificativa no arquivo): `store.test` (contratos novos), `taxa-e-janela` ③④ (guardas textuais do tique), `provider-uso`,
`ai-cost`, `regressao-qualidade` (Founders), `motor.complexidade` (método de medida), guardas `conexoes-0063` e `rpcs-acl` (0076).
Lista completa: `git/changed-files.txt` no pacote.

## 6. AUDITOR FINDINGS MATRIX

| ID | Finding | Before (14e5a20) | Fix | Test | Status |
|---|---|---|---|---|---|
| A-1 | Paper Tick sem lock atômico | SELECT → decide → UPSERT em `admin_kv` | lease `INSERT … ON CONFLICT DO UPDATE … WHERE vencido` (0076), mesmo escopo nas duas entradas, falha fechada sem 0076 | T23 · T23b (2/10/30) · integração (2/10/30 tiques) · unit (sem lease não lê nada) | **PASS** |
| A-2 | Posição paper duplicada | INSERT comum, sem identidade | identidade canônica `v1:<estrategia>:<intervalo>:<vela>` + UNIQUE parcial + RPC com `FOR UPDATE`; conflito = `ja_registrada` | T23 · T23b · integração (2/10/30 aberturas) · unit (sem fallback de INSERT) | **PASS** |
| A-3 | Última vela derivada só das abertas | reabria a mesma vela depois do fechamento | `bancada_estrategia.ultima_vela_aberta` (backfill histórico) conferida no banco e lida pelo tique | T23.27/28/40/41 · integração RM-03 | **PASS** |
| A-4 | `fecharRodada` ignorado | `ok:true` com rodada presa `rodando` | UPDATE só `rodando→`, linha contada, replay idempotente, 1 retry, degradação declarada; rota 503 / 500 | 9 casos de contrato + 5 de rota (mutação conferida) | **PASS** |
| A-5 | 0073/0074/0075 sem semântica de release | 0073 sem 0075 = rodadas presas (PF-04) | 0076 com pré-condição; código tolera estados parciais de forma declarada; unidade aplicável numa transação | matriz A–E · unidade atômica (incompleta → 0/0/0; completa → 1/1/2) | **PASS** |
| A-6 | `{ data, error }` ignorado (fallback/cursor/adiado/tique) | falha contada como gravada; leituras com erro = listas vazias | desfecho lido em toda escrita do tique; leitura com erro = `null` e o tique PARA | unit (fallback parcial, exceção, zero linhas) · matriz (fallback real A/B) | **PASS** |
| A-7 | Growth: erro vira zero | `count ?? 0`, `linhas: []` | `montarGrowth`: `null` + `estado` + motivo; 503 se nada medido; resumo diário "indisponível" | `growth.test` · `digest.test` | **PASS** |
| A-8 | Cache-write do provedor | `cacheWriteTokens: 0` | normaliza Kimi (`cache_write_tokens`) e DeepSeek (`prompt_cache_hit/miss_tokens`); preços de lista | fixtures no formato documentado, dois caminhos (chat e streaming) | **PASS** (conferência contra resposta real: NOT EXERCISED, §14) |
| A-9 | ZION sem fatos comerciais | bloco ausente | `fatos-da-plataforma.ts` derivado das constantes; injetado no `ask` | 19 testes determinísticos; gabarito atendível a partir do contexto | **PASS** (modelo real: NOT EXERCISED) |
| A-10 | Pilot 5.000 comercial | "até 5.000" com segundo limite escondido | definição padrão PROPOSTA; prova pela fórmula + 5.000 reservas reais | `pilot-padrao.test` · integração | **YES** (estratégia própria) / **NO** (modo mesa) — decisão do CEO/auditor |
| A-11 | Paginação admin não snapshot-safe | offset sobre UUID | paginação por chave na receita, Growth e resumo; "não ledger-grade" declarado | `paginar-chave.test` (offset repete/pula; chave não) | **PASS** + limitação declarada |
| A-12 | Suporte humano invisível | horas sem escopo | definição provisória no modelo + sensibilidade | modelo regenerado, determinístico | **PASS** (hipótese, não contrato) |
| PF-04 | (round anterior) 0073 sem 0075 | rodadas presas | coberto por A-4/A-5 | matriz estado B/C | **PASS** |
| PF-05 | (round anterior) fallback 0074 sem teste | 0 testes | coberto por A-6 | unit + matriz | **PASS** |
| RM-09b | **novo** — gabarito Founders exigia preço provisório | contradizia OD-NFT-02 / `/pricing` | gabarito segue `precoPublicoUsd` | `regressao-qualidade.test` | **PASS** |
| NF-01 | **novo** — subcobrança de 1 vela por ativo | janela inclusiva lê ⌈span/dur⌉+1 | — | integração `pilot-padrao` (2.191 lidas × 2.190 cobradas) | **OPEN (LOW)** — mexeria na régua da cota |
| NF-02 | **novo** — trava de complexidade instável sob carga | mediana sequencial | mínimos intercalados, mesmos limites | recert C1 FAIL → C1b PASS; medidor separa 4,06× de 2,03× | **PASS** |
| NF-03 | **novo** — tabela de preço Kimi/DeepSeek abaixo da lista | 0,60/2,50 (Kimi); 0,27/1,10 (DeepSeek) | lista publicada 05/10/2026 | `ai-cost.test` | **PASS**; fatura real não conferida (externo) |
| NF-04 | **novo** — `outTokens` soma `reasoning_tokens` sempre no caminho não-streaming | possível dupla contagem onde o provedor já inclui o raciocínio em `completion_tokens` | — | — | **OPEN (LOW)** — superestima (lado conservador); exige verificação por provedor |
| NF-05 | **novo** — rodada com fechamento não persistido fica `rodando` | — | estado recuperável, mas sem varredura de reconciliação | — | **OPEN (LOW)** — conta só na janela de 24h |

## 7. PAPER LOCK

`bancada_tique_arrendar(escopo, dono, ttl)`: uma instrução `INSERT … ON CONFLICT (escopo) DO UPDATE … WHERE ate <= clock_timestamp()
RETURNING dono` — quem chega segundo espera a linha e reavalia o WHERE na versão nova; não ganha. Semântica escolhida: **recusa**
(não espera) — a passagem seguinte do cron chega em 30 min. `bancada_tique_liberar(escopo, dono)` só apaga o lease do mesmo token
(uma passagem atrasada não solta o lease de quem a substituiu). Crash: o lease vence pelo TTL (3 min, > `maxDuration` 60 s).
O lease é tomado **dentro** de `tiqueDoPapelAdiante` — nenhum chamador o esquece — com o mesmo escopo para `/api/bancada/tique` e o
cron de `/api/zion/backtest`. Sem a RPC (0076 ausente): `exclusividade: "indisponivel"`, o tique **não lê nem escreve nada**, a rota
dedicada responde 503. A marca "rota dedicada viva" só é gravada depois de uma passagem que rodou.

Prova: T23.01–T23.12 (livre, ocupado, dono errado não libera, liberar, crash/vencido, passagem atrasada, escopos, entradas
inválidas); T23b: **N=2 → 1/1, N=10 → 1/9, N=30 → 1/29**, 0 erros; integração com o tique real em clientes HTTP diferentes:
**N=2/10/30 → tomada=1, ocupado=N−1, abertas=1**; crash (lease válido segura, vencido é retomado e liberado no fim).

## 8. PAPER IDEMPOTENCY

**Identidade canônica de uma abertura = (estratégia, intervalo da decisão, vela do sinal).** Investigado:
estratégias são **imutáveis** depois de salvas (`params`, `simbolos`, `intervalo`, `mesa` só são escritos no INSERT) → o
`estrategia_id` já é a versão; o **dono** é o da estratégia (conferido na RPC, `dono_divergente`); o **lado** é função da estratégia
(direção fixa; agente long-only); o **símbolo NÃO entra** — a regra escrita do tique é "uma posição por mesa" e "cada vela avaliada
uma vez por mesa": incluí-lo permitiria abrir ETH na vela em que BTC já abriu (a inflação de amostra que a guarda existe para impedir).
Chave `v1:<estrategia_id>:<intervalo>:<vela_em>` em `bancada_posicao.chave_entrada`, **UNIQUE parcial** (linhas legadas NULL —
nada a reescrever no hospedado). Conflito = `{ok:true, criada:false, motivo:"ja_registrada", id}` — sucesso idempotente, nunca erro;
`unique_violation` capturada como última defesa. Fechamento: `UPDATE … WHERE status='aberta'` — o segundo fechamento não reescreve o
primeiro. Sem a 0076, abrir **falha** (sem fallback de INSERT).

Prova: T23.20–T23.37 (primeira cria; replay devolve o mesmo id; mesma vela outro símbolo = já registrada; vela seguinte com posição
aberta recusa; outra estratégia na mesma vela abre; dono errado e estratégia inexistente recusam; identidade incompleta = erro;
UNIQUE barra por fora da RPC; legadas aceitas); T23b B/C (N=2/10/30 → 1 criada, N−1 já registradas, 1 linha; N mesas diferentes →
N aberturas); integração: N=2/10/30 aberturas simultâneas **por fora do lease** (o caso em que o TTL venceria no meio) → 1 criada.

## 9. PAPER PROCESSED-SIGNAL STATE

`bancada_estrategia.ultima_vela_aberta` é o estado autoritativo de "esta mesa já abriu nesta vela": só anda para frente, é gravado na
mesma transação da abertura, sobrevive a posição fechada, restart, outro worker, replay e atraso. A 0076 o preenche com o **maior
`vela_em` histórico** (abertas e fechadas). O tique lê o valor do banco (e as abertas por cima, para linha legada); a RPC confere
de novo (`vela_ja_avaliada`).

Prova: T23.27 (posição fecha → mesma vela → não reabre), T23.28 (vela anterior recusa), T23.30 (vela seguinte abre), T23.40/41
(backfill usa o maior histórico, inclusive fechado); integração RM-03 com o tique real: abre na vela T0−1h → fecha → tique na mesma
vela: **0 aberturas** → novo cruzamento na vela T0+1h: **abre** (2 posições, velas corretas).

## 10. WORKBENCH fecharRodada

Regra: a rodada só é declarada fechada se o estado autoritativo persistiu. `fecharRodada` agora: UPDATE `… WHERE status='rodando'`
com `.select("id")` (zero linhas ≠ sucesso); zero linhas + mesmo desfecho = replay idempotente (`fechou:false`); outro desfecho ou
inexistente = erro; erro transitório ou exceção do cliente (timeout) = 1 nova tentativa; coluna de métrica ausente (`PGRST204`/`42703`,
0075 não aplicada) = fecha sem métricas e devolve `metricasGravadas:false`. A rota: fechamento não persistido → **503
`rodada_nao_persistida`** com o id e sem apresentar o resultado como registrado; exceção entre reserva e fechamento → fecha como
`falhou` com o motivo e responde 500 com `registrada`; recusa do pedágio diz se o registro persistiu; métricas não gravadas
aparecem em `naoMedidoTexto`. Estado recuperável: a linha fica `rodando` e o resultado (se gravado) está em `bancada_resultado`.

Prova: `remediacao-auditoria.test` — sucesso, `{error}` persistente (2 tentativas), transitório + sucesso, Promise rejeitada
(timeout) + sucesso / duas vezes, replay, outro desfecho, não encontrada, coluna ausente, coluna ausente + transitório + sucesso, sem
métricas; `fechamento.test` (rota real com store roteirizado) — 200, **503**, degradado, exceção → `falhou`, exceção + fechamento
recusado; mutação: desligar a checagem na rota faz o teste do 503 falhar. Contra PostgREST real: matriz estados B–E.

## 11. MIGRATION 0073-0075 COMPATIBILITY

| estado do schema (código deste branch) | Workbench | Tique do papel | último tique | classificação |
|---|---|---|---|---|
| A — até 0072 | reserva `desconhecido` → **503** | não roda (lease indisponível) | fallback por mesa, conta só o confirmado | **FAIL-CLOSED** |
| B — 0073 | fecha **sem** métricas, declarado | não roda | fallback | **SUPPORTED-DEGRADED** (Workbench) / FAIL-CLOSED (tique) |
| C — 0073+0074 | idem B | não roda | lote | SUPPORTED-DEGRADED / FAIL-CLOSED |
| D — 0073+0074+0075 | completo | não roda | lote | SUPPORTED (Workbench) / FAIL-CLOSED (tique) |
| E — 0073…0076 | completo | roda | lote | **SUPPORTED** (alvo de release) |
| 0076 sem 0073–0075 | — | — | — | **UNSUPPORTED — e impossível de criar**: a 0076 recusa (pré-condição, `55000`) e não deixa resíduo |

A janela silenciosa do PF-04 (0073 sem 0075 → rodadas presas) **não existe mais**: o fechamento degrada declarado. Recomendação de
release (documentada, NÃO executada): aplicar 0073→0076 **numa transação** (`psql -1 -v ON_ERROR_STOP=1 -f 0073 -f 0074 -f 0075 -f
0076`) — provado localmente: unidade incompleta → tudo desfeito (0/0/0 objetos); completa → aplicada (1/1/2). Rollback da 0076
(documentado no cabeçalho, não executado): drop das 3 funções, do índice, das 2 colunas e da tabela — nenhuma posição apagada.
Prova: `zswap-local/bin/rm-matriz` (A–E, 3 testes por estado, + 0076 recusada em A/B/C) e `recert-c1b/09-unidade-atomica.txt`.

## 12. SUPABASE ERROR HANDLING

`supabase-js` resolve com `{ data, error }` e não lança; `try/catch` sozinho não trata nada. Agora, no escopo do tique e da rodada:
`gravarUltimoTique` → `Escrita` (erro e **zero linhas** = falha); `gravarUltimosTiques` → `{viaLote, gravados, falhas}` (no fallback,
`gravados` conta só o confirmado; lote parcial declarado; lote que lança cai para o fallback); `marcarTiqueAdiado`, `gravarCursor`,
`lerCursor` (erro ≠ "sem cursor"), `liberarTique` → desfecho explícito, declarado em `problemas`; `mesasLigadasParaOCron` e
`posicoesAbertasParaOCron` → `null` em erro (antes `[]`: com posições lidas como vazias, toda mesa com posição aberta pareceria livre e
abriria uma segunda) e o tique **para**; `mesasDasPosicoesParaOCron` conta lotes com falha. Prova: `remediacao-auditoria.test`
(fallback com `{error}` + zero linhas + sucesso = 1 gravado e 2 falhas; exceções; leituras → `null`; tique para e libera o lease),
matriz estados A/B (fallback real).

## 13. GROWTH ERROR SEMANTICS

"Não sei" não é "zero". `montarGrowth` (puro): cada métrica cuja leitura falhou ou foi cortada sai `null` com o motivo em
`indisponiveis`; conversões só com numerador e base medidos; `estado: completo | parcial | indisponivel` (503 quando nada foi medido);
`natureza: "indicativo_nao_ledger"`. Painel: "—" e faixa INCOMPLETO com os motivos. Mesma regra no resumo diário do watchdog
(`textoDoDigest`: "indisponível" em vez de $0). Paginação: receita, Growth e resumo passaram a ler **por chave** (`id > último`):
cada linha presente do início ao fim da leitura é lida exatamente uma vez — o offset repetia ou pulava linha com inserção/remoção
concorrente (provado no teste). **Ainda não é ledger-grade** (não é retrato num instante): a receita diz isso na resposta; número
de tesouraria/contabilidade/receita oficial/conciliação tem de sair de uma agregação SQL única.

## 14. ZION CACHE ACCOUNTING

Formato real, pela documentação oficial (consultada em 05/10/2026, sem credencial): **Kimi** — `usage.prompt_tokens_details.
{cached_tokens, cache_write_tokens}` (+ `cached_tokens` legado no topo); leitura, escrita e o resto são mutuamente exclusivos e somam
`prompt_tokens`; no streaming o detalhe vem no último chunk. **DeepSeek** — `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens` =
`prompt_tokens`, sem escrita (antes ignorados: todo prompt a preço cheio). `entradaOpenAICompat` devolve `{inTokens, cachedTokens,
cacheWriteTokens}` para os três formatos (limitado, nunca negativo); `openaiCompatChat` e `openaiCompatStream` gravam a escrita.
Preço: a série K2 do Kimi **não publica preço de escrita** → escrita a preço de entrada (`lista()` com leitura/escrita explícitas;
a regra 0,1×/1,25× fica só para a Anthropic). Lista do `kimi-k2.6`: 0,95 miss / 0,16 hit / 4,00 saída (a tabela do repo estava em
0,60/2,50/0,06 — NF-03). DeepSeek: preço de pico (conservador), flash e pro separados. Fixtures no formato documentado (não
inventado). **Conferência contra uma resposta real: NOT EXERCISED** (exige credencial).

## 15. PILOT 5.000 STANDARD PROOF

Definição PROPOSTA (não aprovada): até 3 ativos × 1 ano × velas de 4h, estratégia própria. Fórmula da rota: 3 × ⌈8.760 h / 4 h⌉ =
**6.570 unidades**. Orçamento Pilot (1/16, **não alterado**): 54.750.000.

- **STANDARD_5000_FITS = YES** — 5.000 × 6.570 = 32.850.000 ≤ 54.750.000 (folga 1,67×; cabem 8.333 pelo orçamento, a cota limita em
  5.000). Toda combinação dentro da definição (1–3 ativos, 1–365 dias, 4h ou 1d) também cabe 5.000×. Limite exato: rodada média até
  10.950 unidades; 10.951 já não cabe.
- **Amostra real** (PostgREST + 0073, limites reais do Pilot): **5.000 reservas aceitas; a 5.001ª recusada por COTA** (`rodadas
  5000, unidades 32.850.000`; saldo 21.900.000); velas que a rota lê para 1 × 365 d × 4h: 2.191 (cobradas 2.190 — NF-01).
- **Modo mesa com a mesma definição = NO**: 3 × 1 ano custa 67.890 unidades (lê 1h+4h+1d, peso 2) → **806/dia**; amostra real: 806
  aceitas, a 807ª recusada por ORÇAMENTO. O que cabe 5.000× no modo mesa: 1 ativo × 90 dias.

Nada foi alterado na oferta, na fração ou nas cotas. A redação comercial precisa dizer "estratégia própria" (ou definir um padrão
próprio do modo mesa) — decisão do CEO/auditor.

## 16. COMPUTE BUDGET

`unidades = símbolos × ⌈janela/intervalo⌉` (estratégia própria) ou `símbolos × (⌈janela/1h⌉+⌈janela/4h⌉+⌈janela/1d⌉) × 2` (mesa);
`orçamento/24h = backtestsPorDia × (símbolosPorTeste × janelaMaxDias × 24) × fração` (¼ free/pro/trader, 1/16 pilot); decidido no
banco (0073) com a contagem de rodadas, janela móvel de 24 h.

| backtest | ativos | velas lidas | intervalo | horizonte | unidades | Pro (de 100) | Trader (de 500) | Pilot (de 5.000) | saldo Pilot após 1 |
|---|---|---|---|---|---|---|---|---|---|
| 1 × 30 d × 1d | 1 | 30 | 1d | 30 d | 30 | 100 | 500 | 5.000 | 54.749.970 |
| 3 × 365 d × 4h | 3 | 6.570 | 4h | 365 d | 6.570 | 100 | 500 | 5.000 | 54.743.430 |
| 10 × 90 d × 1h | 10 | 21.600 | 1h | 90 d | 21.600 | 100 | 500 | **2.534** | 54.728.400 |
| 10 × 365 d × 1h | 10 | 87.600 | 1h | 365 d | 87.600 | **50** | **250** | **625** | 54.662.400 |
| 10 × 730 d × 1h | 10 | 175.200 | 1h | 730 d | 175.200 | **25** | **125** | **312** | 54.574.800 |

Consumo diário = unidades × rodadas; orçamentos: Pro 4.380.000 · Trader 21.900.000 · Pilot 54.750.000. Tudo travado em
`pilot-padrao.test.ts`. A resposta da rota NÃO expõe o saldo de unidades (mostrar "consumo e saldo" no painel é parte da direção
comercial ainda não aprovada; não implementado).

## 17. ZION OFFICIAL FACTS

`src/lib/zion/fatos-da-plataforma.ts` monta o bloco SÓ a partir de constantes que o produto já usa: redes e "em breve" (`CHAINS`),
taxa EVM por plano (`TIER_FEE_BPS`) e Solana sem taxa (`CONTA_TAXA_SOLANA`, `MOTIVOS_SOLANA_SEM_TAXA`), análises/dia, backtests/24h,
ativos, histórico, mesas, capital (`TIER_DAILY_ANALYSES`, `BANCADA_COTAS`), suporte prioritário (`FEATURE_TIER`), preço mensal
(`normalMonthlyUsd`, o que `/pricing` mostra), orçamento de unidades (`orcamentoDiarioDeUnidades` — os DOIS limites ditos), Founders
(`CONFIG_APROVADA`: 36 meses do encerramento oficial, royalty não vai a holder, produtos separados, data não anunciada; `BENEFICIOS`:
disponível × roadmap sem data × nunca prometido; premium segue o holder e transferir não reinicia — provado contra `premiumAtivo` e
`janelaPremium`). **Preço do passe: "em definição", nenhum número** — `precoPublicoUsd` é `null` enquanto PROVISÓRIO, como na vitrine
(RM-09b: o gabarito do round anterior exigia os números; corrigido). Injetado só no `ask`, entre a fundação e o modo (prefixo estável,
cacheável): **~905 tokens** (3.618 caracteres) por pergunta livre. Nenhuma segunda fonte manual.

## 18. ZION QUALITY GATE

Determinístico (sem modelo): cada fato do bloco = sua constante; montagem do contexto (`ask` recebe fundação → fatos → modo →
idioma; os outros 8 modos inalterados); bloco determinístico; e **todo fato obrigatório de todos os 10 casos do gabarito está no
contexto do `ask`, e nenhuma afirmação proibida está** — sem o bloco, 6 casos (zetta, solana, taxas, founders, workbench, complexa)
não eram atendíveis. Fronteiras de tier, taxas, redes e Founders cobertas. **LIVE MODEL REGRESSION = NOT EXERCISED** — o arnês ao
vivo (`bench/integracao/zion-qualidade.integration.ts`) agora usa o mesmo contexto da rota e é pulado sem credencial (não autorizada).

## 19. TESTS

| execução | resultado |
|---|---|
| **Suíte completa no C1b `7aa021d`** (worktree isolada, `npm ci --offline`, container 2g/5g) | **311 arquivos / 4.630 testes — 4.630 PASS, 0 FAIL, 0 SKIP** |
| Suíte completa no C1 `802939c` | **FAIL** — 1 / 4.630: `motor.complexidade` rsi14, razão 3,295 > 3,2 (motor inalterado; medida sequencial sob carga). Sem reexecução: corrigido o método (mínimos intercalados, mesmos limites) → C1b, recert completa do zero. O mesmo teste já tinha falhado uma vez na verificação do `4cac776` e passado 3/3 isolado (registrado). |
| type-check / lint (C1b) | 0 / 0 erros, 145 avisos (= HEAD auditado) |
| build (C1b, rede só para `next/font`) | PASS na 1ª tentativa |
| SQL em cadeia nova 0001→0076 (C1b) | 19/19 `.sql` rc=0 (T20, T21, T22, **T23** PASS) |
| concorrência (C1b) | 20b PASS (30 → 10) · **23b PASS (2/10/30)** · 16b OK · 13-estável 20/20 PASS · 13 **não** estável **FAIL** (preexistente, mesma asserção de temporização do round anterior, DCA não tocado) |
| integração PostgREST real (C1b) | 19 PASS + 1 SKIP (ZION ao vivo): `postgrest`, `papel-concorrencia`, `pilot-padrao` |
| matriz de migrations (C1b) | A–E 15/15 PASS; 0076 recusada em A/B/C |
| **não executados** | `04_conc_venda`, `05_conc_compra`, `06_conc_liquidacao_x_projecao` (exigem o socket/`runuser` de outra campanha; não tocam este round); regressão do ZION contra o modelo real (credencial) |

Cobertura nova por achado: §6. Evidência: `recert-c1b/` (identidade, npm ci, type-check, lint completo, suíte verbosa, build, SQL,
concorrência, integração, matriz, unidade atômica) e `recert-c1-FAILED/`.

## 20. BENCHMARK REGRESSION

Smoke comparativo (antes × depois na MESMA execução; motor e modo mesa não foram tocados nesta remediação):

| | round anterior | agora | leitura |
|---|---|---|---|
| RSI HEAVY (10 × 17.520) | 64,6 s → 28,0 ms (2.308×) | 105,2 s → 38,8 ms (**2.709×**) | máquina ~1,6× mais lenta (o LEGADO também ficou); razão estável/melhor |
| mesa HEAVY (10 × 4.320) | 19,1 s → 1,24 s (15,4×) | 32,5 s → 1,88 s (**17×**) | idem |
| papel 3.250 desks | 308 req/tique, 3.250 avaliadas, 0 nunca vistas | **310 req/tique** (+2 = tomar/soltar o lease), 3.250, 0 | determinístico |
| papel 3.250, mesma sessão | auditado 14e5a20: 2.761 ms | remediação: 2.928 ms (+6%) | dentro do ruído (o mesmo código variou 1,7–2,9 s entre execuções) |

200/500/1.000/2.000/3.250 desks: todas avaliadas, 0 nunca vistas, 0 adiadas, 30/30 tiques com `excl=tomada`. Limiar: razão
antes/depois e contagens determinísticas — não milissegundos absolutos. **Sem regressão.**

## 21. ECONOMIC IMPACT

Recalculado porque três entradas mudaram custo: preço de lista do Kimi (RM-08), +905 tokens do bloco de fatos (somados a TODAS as
análises — limite superior) e 310 req/tique. Nenhuma premissa ajustada para melhorar a oferta; horas e custo de suporte inalterados.
Regenerado duas vezes: SHA-256 idêntico (`7ed4635d…`).

| 36 meses, EXPECTED | máquina | IA | banco/infra | humano | fixo | econômico | margem (referral 0%) |
|---|---|---|---|---|---|---|---|
| Pro $149 | $0,09 | $37,10 (antes $21,92) | $0,08 | $63 | $1,79 | **$102** (antes $86,88) | $46,93 (31,5%) |
| Trader $399 | $0,37 | $92,75 | $0,34 | $189 | $1,79 | **$284** | $115 (28,8%) |
| Pilot $1.990 | $1,13 | $111 | $1,02 | $630 | $1,79 | **$745** | $1.245 (62,6%) |

**HEAVY e STRESS continuam NEGATIVOS em todos os planos** (HEAVY: Pro −116%, Trader −115%, Pilot −38%), e o **humano é 55–85% do
custo econômico** em todas as células. Sensibilidade às horas de suporte (×0 … ×2), referral 0/10/15/20% e reserva de serviço: no
modelo (§4, §6, §11) — só matemática, nada aprovado. Suporte (definição provisória do mandato, hipótese econômica): Pro padrão
assíncrono; Trader fila prioritária assíncrona; Pilot prioridade máxima assíncrona + incidentes de produto; em todos sem 24/7, sem SLA
financeiro, sem concierge, sem consultoria de trading, sem execução de estratégia pelo CEO, sem chamada privada garantida, sem suporte
ilimitado, ZION como primeira linha.

## 22. OPEN RISKS

| nível | risco | por que aberto |
|---|---|---|
| HIGH | Economia HEAVY/STRESS negativa | premissas comerciais (suporte, preço) — decisão do dono |
| HIGH | 0073–0076 não aplicadas no hospedado | proibido neste round; recomendação: uma transação (§11) |
| MEDIUM | Definição comercial do Pilot (padrão só cabe na estratégia própria; modo mesa = 806/dia) | decisão do CEO/auditor |
| MEDIUM | Regressão de qualidade do ZION contra o modelo real NÃO EXERCIDA | credencial não autorizada |
| MEDIUM | Rota dedicada do tique não agendada (cron-job.org) | passo externo do dono |
| MEDIUM | CE-02-F1 (barreira do modo mesa usa o horizonte), CE-13a (retenção) | fora deste escopo; inalterados |
| LOW | NF-01 subcobrança de 1 vela/ativo (0,05%) | corrigir muda a régua da cota |
| LOW | NF-04 `reasoning_tokens` somados sempre no caminho não-streaming (pode superestimar) | exige verificação por provedor |
| LOW | NF-05 rodada com fechamento não persistido fica `rodando` (conta na janela de 24h) | sem varredura de reconciliação |
| LOW | Leituras admin por chave não são retrato num instante | painel, não ledger (declarado) |
| LOW | `.in()` em `dca/store.ts:447` e `lab/store.ts:275`; caches sem tráfego; 13 não estável | fora deste escopo; inalterados |
| LOW | Preços de lista sem data na página do provedor | fatura do console é a fonte autoritativa |

## 23. EXTERNAL BLOCKERS

R-01 Vercel (HTTP 402) · R-02 `CEX_RECOVERY_HMAC_KEY` · R-03 advisory Tailwind/braces · migrations Founders 0071/0072 e deste trabalho
0073–0076 não aplicadas no hospedado · credencial de IA para o arnês ao vivo · agendamento de `/api/bancada/tique` · conferência
das faturas do Kimi/DeepSeek contra a lista publicada.

## 24. AUDITOR HANDOFF

Reproduzir (worktree do branch; nada toca lab, hospedado ou produção):

```bash
B=/home/zetta/Documentos/ZETTA_WORLD/zswap-local/bin
$B/capped-run . 'npm ci --offline --no-audit && npx tsc --noEmit && npx eslint . && npx vitest run'
$B/rm-stack up .                                            # Postgres + PostgREST descartáveis, cadeia 0001→0076
for f in supabase/tests/*.sql; do docker exec rm-pg-20261005 psql -X -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f /wt/$f; done
docker exec -e PSQL="psql -X -U supabase_admin -d postgres" -e NS="2 10 30" rm-pg-20261005 bash /wt/supabase/tests/23b_bancada_papel_concorrencia.sh
S=$(cat ../../state/remediation-20261005/rest-jwt-secret)
NETWORK=rm-net-20261005 $B/capped-run . "CE_REST_URL=http://rm-rest-20261005:3000 CE_JWT_SECRET=$S npx vitest run --config bench/vitest.integration.config.ts bench/integracao/papel-concorrencia bench/integracao/pilot-padrao"
$B/rm-matriz .                                              # estados A–E + 0076 recusada
$B/rm-carga-papel . auditoria 6 200 3250                    # regressão de carga
node scripts/cost/modelo-36-meses.mjs                       # modelo (determinístico)
```

O que conferir primeiro: (1) a identidade canônica da abertura e a decisão de NÃO incluir o símbolo (§8); (2) o lease e a
semântica "recusa, não espera" (§7); (3) a classificação dos estados de schema e a recomendação de aplicação numa transação (§11);
(4) a correção da trava de complexidade no C1b (§19) — limites iguais, só o método; (5) a definição do Pilot e o NO do modo mesa (§15);
(6) a correção do gabarito Founders (RM-09b, §17).
