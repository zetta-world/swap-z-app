# STRATEGY INTELLIGENCE & FORENSIC LEARNING · 🟡 DOCUMENTADO + FERRAMENTA DA FASE A PRONTA — NENHUMA MUDANÇA DE ESTRATÉGIA EM EXECUÇÃO

> **Aberto em:** 03/10/2026 · ledger **L-030**.
> **Status:** `DOCUMENTED` · `NOT_YET_EXECUTING_STRATEGY_CHANGES`.
> **Origem dos números:** auditoria forense **só-leitura** sobre os dados do Supabase de produção,
> trazida pelo dono (fonte: **dono — auditoria só-leitura, números NÃO re-medidos pelo agente que
> escreveu este documento**). Nenhuma estratégia, genoma, parâmetro, linha de banco ou estado de
> produção foi modificado pela auditoria nem por este documento.
> **Invariantes desta trilha:** `REAL_MONEY_AUTONOMY=NO` · `STRATEGY_CERTIFICATE=NO` ·
> `PILOT_PERMISSION=NO`.
> **Parentes:** `docs/PLANO-FORA-DA-AMOSTRA.md` (walk-forward), `docs/INVARIANTES-DE-MEDICAO.md`,
> `docs/MEDICAO-TEM-BORDA.md`. Nada aqui substitui as regras deles; esta trilha as usa.

---

## 0. O que este documento é — e o que não é

- **É** o registro formal de achados forenses e de **hipóteses pré-registradas** (H1–H6), com o
  plano de execução futura (fases A–G).
- **Não é** autorização para mudar estratégia, threshold, universo de ativos ou permissão de
  execução. Nenhuma regra daqui vale em produção.
- Todo número abaixo é **retrospectivo**. Serve para **gerar hipóteses**, nunca para provar
  lucratividade futura.

## 1. Snapshot do dataset (data da auditoria: 03/10/2026)

Contagens medidas na auditoria. São um **retrato daquela data**, não totais imutáveis.

| tabela | linhas |
|---|---|
| `paper_positions` | 3497 |
| `celeiro_posicoes` | 318 |
| `celeiro_fluxos` | 2290 |
| `celeiro_mutacoes` | 9 |
| `lab_runs` | 100 |
| `lab_results` | 100 |
| `bancada_operacao` | 47 |
| `mercado_vela` | 11651 |
| `lab_strategies` | 29 |

## 2. Achados

### FSL-01 — Anatomia da perda

Entre os trades direcionais negativos analisados:

| causa | n | % | movimento bruto médio | PnL final médio |
|---|---|---|---|---|
| STOP | 578 | 73,44% | ≈ −2,22% | ≈ −2,47% |
| EXPIRAÇÃO negativa | 167 | 21,22% | ≈ −1,78% | ≈ −2,04% |
| movimento bruto positivo tornado negativo pelo custo | 42 | 5,34% | — | — |

**Leitura:** custo de transação importa, mas **não** é a causa principal da maioria das perdas
históricas: a maior parte das posições perdedoras já estava economicamente errada **antes** do
atrito final. Foco futuro principal: **seleção de entrada / abstenção** — não só otimização de taxa.

### FSL-02 — Regime de mercado

| regime | n | PnL médio | ≈ USD | win rate |
|---|---|---|---|---|
| TRENDING_UP | 605 | ≈ +0,474% | ≈ +147,17 | ≈ 52,73% |
| TRANSITIONING | 196 | ≈ −0,298% | ≈ −26,37 | ≈ 34,18% |
| RANGING | 230 | ≈ −0,510% | ≈ −60,64 | ≈ 28,70% |
| TRENDING_DOWN | 378 | ≈ −1,130% | ≈ −216,60 | ≈ 20,11% |

`TRENDING_DOWN + SELL` também foi **historicamente negativo**. Portanto: **não** codificar a regra
ingênua `DOWN ⇒ SELL`. A investigação futura precisa cobrir: correção do classificador de regime;
latência do regime; comportamento na transição; compatibilidade regime × estratégia específica.

### FSL-03 — Confiança

Amostra unida: **1415** posições.

| faixa de probabilidade | n | PnL médio | win rate |
|---|---|---|---|
| < 50 | 228 | −0,939% | 28,95% |
| 50–59,99 | 344 | −0,506% | 30,52% |
| 60–69,99 | 352 | −0,166% | 35,51% |
| 70–79,99 | 49 | +0,800% | 53,06% |
| 80–89,99 | 1 | amostra insuficiente | — |

A separação histórica aparece perto de 70. **Não** adotar 70 como threshold de produção: o valor
foi descoberto retrospectivamente e exige validação fora da amostra.

### FSL-04 — Universo de ativos

| ativo | n | PnL médio | win rate |
|---|---|---|---|
| LINK | 111 | +0,768% | 56,76% |
| UNI | 140 | +0,757% | 53,57% |
| ETH | 67 | +0,318% | — |
| ARB | 125 | +0,026% | — |
| BTC | 74 | −0,445% | — |
| SOL | 117 | −0,526% | — |
| AVAX | 91 | −0,624% | — |
| ADA | 125 | −0,820% | — |
| DOT | 129 | −0,870% | — |

Robustez entre fontes: LINK positivo em 7/9 grupos de fonte relevantes · UNI 7/10 · ARB 6/7 ·
AVAX 0/9 · DOT 2/10 · ADA 2/9. **Não** fazer blacklist/whitelist só com estes valores retrospectivos.

### FSL-05 — Contrafactuais retrospectivos

> ⚠️ **SOMENTE GERAÇÃO DE HIPÓTESE.** Não são estratégias certificadas. Nunca descrever estes
> resultados como prova de lucratividade futura.

| filtro histórico | n | PnL médio | ≈ USD | win rate |
|---|---|---|---|---|
| base (amostra unida) | 1415 | −0,225% | ≈ −157,65 | 37,31% |
| probabilidade ≥ 70 | 50 | +0,884% | ≈ +23,01 | 54% |
| TRENDING_UP | 605 | +0,474% | ≈ +147,17 | 52,73% |
| prob ≥ 70 + TRENDING_UP | 34 | +1,901% | ≈ +33,78 | 67,65% |
| LINK + UNI + ARB | 376 | +0,517% | ≈ +98,71 | — |
| LINK + UNI + ARB + TRENDING_UP | 213 | +0,937% | ≈ +101,43 | 59,15% |

### FSL-06 — Vantagem condicional

| estratégia | posições fechadas | PnL médio | ≈ USD |
|---|---|---|---|
| VÖLUNDR / `strat_mech` | ≈ 183 | ≈ +0,416% | ≈ +38,06 |
| SKAÐI / `strat_day` | ≈ 208 | ≈ +0,267% | ≈ +27,87 |

As duas têm **forte concentração temporal**. Exemplo: VÖLUNDR, semana de 17/08/2026 — 74 trades,
PnL médio ≈ +1,932%, win rate ≈ 82,4%, ≈ +71,50 USD; as semanas seguintes degradaram
materialmente. **Leitura:** possível **vantagem condicional**. Não assumir alpha permanente.

### FSL-07 — Barreira de custo

| preditor | bruto | atrito | líquido |
|---|---|---|---|
| VÖLUNDR | ≈ +0,770% | ≈ 0,354% | ≈ +0,416% |
| Radar | ≈ +0,101% | ≈ 0,268% | ≈ −0,168% |
| scan Mistral | ≈ +0,007% | ≈ 0,253% | ≈ −0,246% |

**Leitura:** alguns preditores contêm informação, mas não vantagem negociável suficiente para
pagar o custo de execução.

### FSL-08 — Celeiro: doenças diferentes

| mesa | efeito de preço | taxas | derrapagem |
|---|---|---|---|
| `comprador_cego` | ≈ +18,67 USD | ≈ −18,52 USD | ≈ −0,25 USD |
| `maker_de_faixa` | ≈ +2,60 USD | ≈ −5,47 USD | — |
| `alavancado_de_tendencia` (controle) | ≈ −105,39 USD | ≈ −29,04 USD | — |

As duas primeiras podem ter algum sinal bruto, sem vantagem executável suficiente; a terceira é
principalmente problema de **sinal/preço**, não só de taxa. **Princípio: NÃO MUTAR A DOENÇA ERRADA.**

### FSL-09 — Laboratório (conclusões qualitativas medidas)

- `funding_basis`: historicamente positivo, retorno baixo, custo/risco do mundo real **não**
  medidos por completo.
- `covered_call`: prêmio potencial, dependente de regime, **inconclusivo**.
- AMM LP: vantagem pequena contra hold, abaixo/perto da incerteza de medição.
- arbitragem DEX↔CEX: em geral negativa depois dos custos modelados; as raras bordas positivas
  ficam expostas a MEV/revert/bloco/execução.
- `momentum_rotation`: historicamente negativo nas rodadas relevantes.
- `grid_bot`: perdas históricas muito grandes nas rodadas observadas (≈ −47% a −54%).

**Princípio:** não ressuscitar estratégia estruturalmente ruim só ajustando parâmetro.

### FSL-10 — Verdade dos dados / contabilidade

Há inconsistências históricas entre `paper_accounts` e `paper_positions`. Exemplo: Arbiter —
PnL fechado por posição ≈ +199,43 USD, PnL realizado em `paper_accounts` = 0. Outros deltas
históricos observados: Radar, Mistral, Kimi, Self e Hybrid. Causas possíveis: histórico de reset,
arquivamento, troca de versão do simulador, mudança semântica, contabilidade incompleta.
**Não** rotular como corrupção sem investigação. Algumas rodadas da bancada não guardam vínculo
formal com `estrategia_id`.

**Consequência:** o aprendizado autônomo **NÃO** pode usar estes datasets como verdade canônica
antes de uma etapa de reconciliação de dados (Fase A).

## 3. Hipóteses pré-registradas (NÃO são regras aprovadas)

| id | hipótese | de qual achado | limite explícito |
|---|---|---|---|
| **H1 — REGIME GATE** | estratégias direcionais podem ter vantagem condicional, não universal: `SINAL → regime compatível? → NÃO: ABSTER · SIM: seguir avaliando` | FSL-02 | não é regra de produção; `DOWN ⇒ SELL` está vetado |
| **H2 — CONFIDENCE GATE** | sinais de baixa confiança devem ser bloqueados ou rebaixados | FSL-03 | threshold escolhido/validado **sem vazamento de dado futuro**; 70 não é adotado |
| **H3 — UNIVERSE GATE** | a vantagem pode depender de estratégia + ativo + regime + confiança, e não da estratégia sozinha | FSL-04, FSL-05 | sem whitelist/blacklist retrospectiva |
| **H4 — STRATEGY PERMISSION** | VÖLUNDR/SKAÐI podem precisar de uma camada que decida **quando** operam, em vez de parâmetros que tentam fazê-las funcionar em todo regime | FSL-06 | não assumir alpha permanente |
| **H5 — COST HURDLE** | a permissão de execução deve testar algo equivalente a `vantagem esperada > atrito esperado + margem de segurança` | FSL-07, FSL-08 | a margem **não** é inventada aqui |
| **H6 — ABSTENTION ALPHA** | boa parte da melhora futura pode vir de **não** operar oportunidades ruins; ABSTER é decisão positiva válida; o sistema não otimiza número de trades | FSL-01…FSL-08 | — |

## 4. Plano de execução futura (documentado, NÃO executado)

| fase | conteúdo | saída |
|---|---|---|
| **A — DATA TRUTH** | reconciliar `paper_accounts`, `paper_positions`, sugestões, Celeiro, Bancada, Lab e a semântica dos dados de mercado | datasets com verdade declarada e deltas explicados (FSL-10) |
| **B — LOSS ATTRIBUTION** | causa primária e secundária de cada posição perdedora. Taxonomia candidata: `wrong_direction`, `wrong_regime`, `low_confidence`, `bad_asset`, `cost_over_edge`, `stop_geometry`, `time_expiry`, `late_entry`, `liquidity`, `unknown` | tabela de atribuição |
| **C — COUNTERFACTUAL ENGINE** | simular decisões de filtro **sem reescrever a história** | contrafactuais reprodutíveis |
| **D — WALK-FORWARD VALIDATION** | validação **só temporal**; nada de split aleatório treino/teste em cronologia de mercado (ver `PLANO-FORA-DA-AMOSTRA.md`) | métricas fora da amostra |
| **E — STRATEGY PERMISSION LAYER** | `estratégia + regime + ativo + confiança + barreira de custo = permissão` | camada de permissão (desligada) |
| **F — OBSERVER MODE** | recomendações ALLOW/BLOCK **sem execução** | log prospectivo |
| **G — CERTIFICATION** | só depois de evidência prospectiva / fora da amostra | certificado (hoje: `STRATEGY_CERTIFICATE=NO`) |

## 5. Padrão de sucesso

O objetivo **não** é "deixar o backtest histórico verde". O objetivo é:

> pré-registrar regras → testar em períodos futuros/não vistos → incluir custos → comparar com
> benchmark → exigir amostra adequada → provar repetibilidade → **só então** certificar.

## 6. Status de execução

| item | status |
|---|---|
| auditoria forense (só leitura) | **feita** (dono, 03/10/2026) |
| este documento | `DOCUMENTED` |
| Fase A — **ferramenta** (só leitura) | `TOOLING_READY` (lane B, 04/10/2026) — ver §7. **Execução sobre dados reais: NOT_STARTED** (exige leitura do hospedado = autorização do dono) |
| Fase B — **esquema** de atribuição | `SCHEMA_READY` (rascunho v0, rótulos só locais) — ver §7 |
| Fases C–G | `NOT_STARTED` |
| mudança de estratégia, genoma, parâmetro, threshold, universo | **nenhuma** |
| `REAL_MONEY_AUTONOMY` · `STRATEGY_CERTIFICATE` · `PILOT_PERMISSION` | `NO` · `NO` · `NO` |

## 7. Ferramenta da Fase A e esquema da Fase B (04/10/2026, lane B — nada executado sobre produção)

| peça | caminho | o que faz |
|---|---|---|
| exportação só leitura | `scripts/strategy/exportar.mjs` + `scripts/strategy/sql/exportar.sql` | um único SELECT (JSON) rodado em `BEGIN TRANSACTION READ ONLY … ROLLBACK`; trava estática (`somente-leitura.mjs`) recusa verbo de escrita, multi-comando, `SELECT INTO`, `FOR UPDATE`, funções com efeito; `--alvo hospedado` exige `--dono-autorizou`; credencial nunca em argumento nem na saída |
| motor de reconciliação | `src/lib/strategy-truth/reconciliacao.ts` | puro, sem import; relatório canônico (`dataset, row_count, identity_key, time_range, authoritative_fields, derived_fields, known_semantic_versions, accounting_total, position_total, delta, classification, confidence, notes`) |
| relatório | `scripts/strategy/relatorio.mjs` | exportação + eventos datados conhecidos → `.json` + `.md`; não toca banco |
| atribuição de perda (esquema) | `src/lib/strategy-truth/atribuicao.ts` | taxonomia de 10 rótulos, validador (`destino` só `local_somente`), regra v0 conservadora |

**Conferências:** contador `realized_pnl_usd` × soma das posições (explicações testadas em ordem: vivas →
só arquivadas → vida inteira → depois de reset datado → depois de troca de semântica datada → padrão de reset
sem evento = `RESET_EFFECT/LOW`); caixa (mesma fórmula de `paper/reconcile.ts`); wins+losses × alvos/stops
vivos; `paper_positions → zion_suggestions` (órfãs); rodada 1 arquivada (0017); Celeiro `preco` por
`fechamento:<id>` × `usd × movimento assinado`, genoma referenciado/ativo; Bancada `n` × operações, concluída
sem resultado, rodada própria sem `estrategia_id`; Lab run ok ↔ resultado, `net = gross − cost`; mercado
descritivo (`market_brain` não tem histórico → não serve para regime retroativo).

**Classificação:** `EXPLAINED / VERSIONED_SEMANTICS / ARCHIVAL_EFFECT / RESET_EFFECT / DATA_GAP / UNKNOWN`.
Nada é consertado; o reparo de carteira continua manual (`admin/api/paper-repair`). `UNKNOWN` é "investigar",
nunca "corrupção".

**Atribuição v0 — o que NÃO faz:** `low_confidence` e `wrong_regime` só com limiar/regra pré-registrados
passados de fora (H1/H2 não adotados); `bad_asset`, `late_entry`, `liquidity` nunca atribuídos (falta dado);
stop sem trajetória posterior = `unknown`. Nenhum rótulo vai para produção.

**Provas (04/10):** 19 testes determinísticos (`strategy-truth.test.ts`); prova viva no banco **descartável**
com dados **sintéticos**: fingerprint e `pg_stat_user_tables` idênticos antes/depois, escrita no embrulho =
`25006`, CLI recusa SQL de escrita (exit 65) e hospedado sem autorização (exit 77). Evidência:
`zswap-local/evidence/pre-vercel-forward-20261003T234200Z/strategy-phase-a/`.

**Próximo passo (do dono):** autorizar a leitura do Supabase hospedado
(`STRATEGY_PSQL=… node scripts/strategy/exportar.mjs --alvo hospedado --dono-autorizou …`) e fornecer as datas
reais de reset/troca de semântica que conhecer (`--eventos`). Só então os deltas do FSL-10 (Arbiter, Radar,
Mistral, Kimi, Self, Hybrid) recebem classificação.
