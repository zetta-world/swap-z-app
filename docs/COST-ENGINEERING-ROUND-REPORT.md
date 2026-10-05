# COST ENGINEERING ROUND — RELATÓRIO PARA AUDITORIA INDEPENDENTE

> Round local (lane B), 05/10/2026. Ledger **L-040** (abertura) e **L-041** (entrega). Plano: `docs/PLANO-COST-ENGINEERING-ROUND.md`.
> Modelo econômico gerado: `docs/COST-ENGINEERING-36M-MODEL.md`. Evidência fora do repo:
> `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/evidence/cost-engineering-20261005T174907Z/` (MANIFEST.sha256).
> Nada foi enviado, mesclado, implantado ou aplicado em banco hospedado. Produção, Vercel, Supabase hospedado e Lane A: intocados.

Rótulos de confiança: **MEASURED** (medido nesta máquina, evidência citada) · **TESTED** (teste automatizado que falha sem a
correção — prova por mutação quando indicado) · **CODE-PROVEN** (leitura de código, sem execução) · **ESTIMATED** (hipótese ou
preço público a conferir) · **UNRESOLVED**.

---

## 1. EXECUTIVE VERDICT

**ROUND STATUS: READY FOR INDEPENDENT AUDIT** — com riscos remanescentes declarados (§28) e bloqueadores externos (§29), nenhum
deles introduzido por este round.

O round encontrou e corrigiu **desperdício algorítmico** (o pedido original) e, medindo de verdade contra um PostgREST real,
**cinco defeitos de corte silencioso** que eram mais graves que o custo:

| # | o que estava errado | efeito medido | depois |
|---|---|---|---|
| 1 | RSI do Workbench recalculado vela a vela (O(N²)) | HEAVY RSI 64,6 s/rodada (passa do tempo de função) | 28 ms, resultado idêntico (2.308×) |
| 2 | Modo mesa recalculava indicadores do prefixo inteiro a cada barra | HEAVY 19,1 s | 1,24 s, idêntico barra a barra (15×) |
| 3 | Leitura de velas sem paginação (PostgREST corta em 1.000) | backtest de 1 ano em 1h rodava sobre 1.000 de 8.761 velas | todas as velas |
| 4 | Cota do Workbench contada no app (cortada em 1.000) e sem trava | Pilot (5.000/dia) sem teto efetivo; requisições simultâneas passavam juntas | contada e reservada no banco, atômica |
| 5 | Tique dos desks de papel: corte fixo nas 200 mesas mais antigas; `.in()` de 500 UUIDs estoura o cabeçalho | 3.250 desks (direito Trader+Pilot): 3.050 nunca vistos, 30 avaliados por tique; com ≥~450 posições abertas, **nenhuma fecha** | 3.250 avaliados por tique, 0 nunca vistos, 0 problemas |
| 6 | Receita/crescimento/resumo do admin somavam as primeiras 1.000 linhas | números econômicos do dono truncados | paginados |
| 7 | Tokens cacheados contados em dobro (provedor OpenAI-compatível) | custo de entrada do ZION superestimado até ~3,3× | separado |

Testes: **304 arquivos / 4.547 testes PASS** (baseline 296 / 4.490), type-check 0, lint 0 erros (145 avisos = baseline),
SQL 18/18 + concorrência 20b/16b/13-stable PASS em cadeia nova 0001→0075, build PASS.

Economia (§24–§27, `docs/COST-ENGINEERING-36M-MODEL.md`): depois da engenharia, a máquina deixa de ser o problema nos cenários
esperados; **o custo econômico de 36 meses é dominado pela premissa de suporte humano**, e em cenário pesado/estresse a oferta de
36 meses por pagamento único não se paga sem decisões do dono (preço, suporte, retenção). O round **não** decide nada disso: mostra a conta.

---

## 2. BASE / HEAD / BRANCH

| campo | valor |
|---|---|
| base autorizada | `0afa8414636ec6eb73bf9e1d600272aff9367228` · tree `26198edd6896a767bc6bbea09a1874c5593eb1b3` (L-039, HEAD de `pre-vercel-forward-20261003T234200Z`) |
| branch do round | `cost-engineering-round-20261005` (local, sem upstream) |
| worktree | `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/cost-engineering-20261005` |
| HEAD de código validado | `037d3a66efef48ee73121e9555779be86a6d4114` (último commit de produto; o commit deste relatório é só docs) |
| divergência medida | `/home/zetta/swap-z-app` está em `kimi/round2-audit-fixes` = `d7741bb` (15/09), **ancestral** da base (127 commits atrás) — não é o estado atual (START-HERE §4). Nada foi alterado ali. A base é ancestral de todo commit do round (`git merge-base --is-ancestor 0afa841 HEAD`). A branch `pre-vercel-forward-*` não foi movida. |

## 3. WORKING TREE STATUS

Limpa ao fim do round (`git status --short` vazio). `node_modules` instalado por `npm ci --offline` dentro do container, ignorado pelo git.

## 4. COMMITS CREATED

| SHA | escopo | mensagem |
|---|---|---|
| `529cd88` | docs | plano antes do código, base registrada (L-040) |
| `2b91e7a` | Workbench | motor próprio linear (CE-01) |
| `062daae` | bench | arnês de benchmark end-to-end (CE-03) |
| `77a915f` | teste | trava de complexidade do motor (CE-01) |
| `d570d62` | Workbench | modo mesa com retrato pré-calculado (CE-02) |
| `cbe1d40` | market data | leitura de velas paginada (CE-11) |
| `22a27da` | DB | migration 0073 — reserva atômica da cota (CE-04/05) |
| `d445042` | Workbench | rota decide pela reserva; orçamento por computação (CE-04/05) |
| `e885ae1` | bench | benchmark do modo mesa + prova em PostgREST real |
| `7838493` | ZION | contabilidade de tokens cacheados (CE-07) |
| `0196494` | DB | migration 0074 — último tique em lote; guardas de migration/ACL |
| `a1fe480` | paper | leitores do cron completos; `.in()` em lotes (CE-09) |
| `fc59805` | paper | tique escala por par: fila justa, leituras compartilhadas, análise por símbolo (CE-09) |
| `72638a7` | paper | rota dedicada do tique (CE-09) |
| `8caeb8c` | bench | teste de carga dos desks + sonda do limite do `.in()` (CE-10) |
| `b8f9142` | ZION | cache exato em memória para varreduras públicas (CE-07) |
| `0e9c3ca` | DB/obs | receita/crescimento/resumo paginados + varredura estática (CE-12/14) |
| `0bda6f4` | obs | métricas de custo na linha da rodada; migration 0075 (CE-14) |
| `39a2bb6` | market data | série fechada servida da memória (CE-06) |
| `564239f` | docs | modelo de 36 meses reprodutível (CE-15) |
| `a2d83fd` | ZION | gate mínimo de qualidade; prompts provados inalterados (CE-08) |
| `037d3a6` | Workbench/docs | orçamento do Pilot 1/16; armazenamento e preço mensal no modelo (CE-05/15) |
| (este) | docs | relatório, ledger L-041, plano e estado |

**Erratas de histórico (declaradas, não reescritas):** (a) os commits `22a27da`…`a1fe480` sozinhos falham a guarda de lista de
migrations (`conexoes-0063.test.ts`), porque a 0073 só foi registrada nela em `0196494`; a partir de `0196494` a suíte é verde.
(b) a mensagem de `fc59805` diz "1.120 combinações"; o teste compara **2.240** (40 × 2 × 4 × 7).

## 5. FILES CHANGED

63 arquivos (39 novos, 24 alterados), +6.088 / −465 (`git diff --shortstat 0afa841..037d3a6`). Principais:

- Workbench: `src/lib/bancada/motor.ts`, `mesa-real.ts`, `agente.ts`, `tique.ts`, `store.ts`, `cotas.ts`, `src/app/api/bancada/backtest/route.ts`, `src/app/api/bancada/tique/route.ts` (nova)
- Indicadores: `src/lib/api/market-indicators.ts` (`RetratoPorPrefixo`, `montarRetrato` compartilhada)
- Market data: `src/lib/mercado/store.ts` (paginação, série fechada em memória)
- Tier: `src/lib/tier/check.ts` (`getTiersForWallets`)
- ZION: `src/lib/ai/provider.ts`, `src/lib/zion/cache-de-resposta.ts`, `src/lib/zion/regressao-qualidade.ts`, `src/app/api/zion/route.ts`
- Admin/obs: `src/lib/supabase/paginar.ts`, `src/app/admin/api/receita/route.ts`, `growth/route.ts`, `src/lib/admin/watchdog.ts`
- DB (local): `supabase/migrations/0073`, `0074`, `0075`; `supabase/tests/20`, `20b`, `21`, `22`
- Referências congeladas (só teste/bench): `src/lib/bancada/__referencia__/*`
- Bench/carga/integração: `bench/**`; scripts: `scripts/cost/**`; docs deste round.

## 6. PROBLEMS CONFIRMED

| ID | problema | confiança |
|---|---|---|
| CE-01 | `valorDoGatilho` recalculava a série do RSI inteira por vela (O(N²)); `slice` do resto da série por operação (O(N²) com operações densas) | MEASURED + TESTED |
| CE-02 | `rodarMesa` chamava `computeIndicators` sobre o prefixo inteiro a cada barra (O(N²)) | MEASURED + TESTED |
| CE-04a | `consumoDaJanela` contava no app linhas cortadas em `db-max-rows` = 1000 → Pilot (5.000) sem teto | MEASURED (PostgREST real: 1.000 de 5.000) + TESTED (mutação) |
| CE-04b | ler → decidir → inserir sem trava (TOCTOU) | TESTED (T20b: 30 sessões; integração HTTP: 30 requisições) |
| CE-11 | `lerDoBanco` sem paginação: janela de 1 ano em 1h = 1.000 de 8.761 velas | MEASURED (PostgREST real) + TESTED (mutação) |
| CE-09a | `mesasLigadasParaOCron` = corte nas 200 mais antigas | MEASURED (carga: 3.050 de 3.250 nunca vistos) |
| CE-09b | `mesasDasPosicoesParaOCron` com `.in()` de até 1.000 UUIDs: falha a partir de ~450 (cabeçalho de resposta > 16 KB no Node) → todas as posições "sem linha de estratégia", nenhuma fecha | MEASURED (sonda `limiar-in.mjs`: 400 OK, 450 falha; carga N≥2.000: 500 problemas/tique) |
| CE-09c | `posicoesAbertasParaOCron` = corte nas 500 mais antigas | CODE-PROVEN + TESTED |
| CE-09d | tique pendurado no fim de uma função de 60 s, depois de 30–45 s de varreduras | CODE-PROVEN (`zion/backtest/route.ts`) |
| CE-09e | tique encerrava sem fechar posições quando nenhuma mesa estava ligada | CODE-PROVEN |
| CE-07a | `prompt_tokens` (total, com cacheados) gravado como entrada não cacheada | CODE-PROVEN + TESTED |
| CE-14a | receita, crescimento e resumo diário somavam as primeiras 1.000 linhas | CODE-PROVEN + TESTED (helper) |
| CE-05-R1 | orçamento uniforme ¼ permitia ao Pilot ~219 M velas/dia (7× o uso pesado) | MEASURED (modelo) — mitigado (1/16) |
| CE-13a | `bancada_operacao` grava todas as operações de toda rodada, sem retenção; `platform_events` sem retenção | CODE-PROVEN + ESTIMATED (crescimento no modelo) |
| CE-08a | o modo `ask` do ZION não recebe nenhum fato da plataforma (taxas, planos, Founders, ZETTA Chain) | CODE-PROVEN |
| CE-02-F1 | no modo mesa, `fechouEm` é o fim do horizonte e a próxima entrada só nasce depois do horizonte, mesmo que a posição tenha fechado antes | CODE-PROVEN — **não corrigido** (§28) |

## 7. PROBLEMS NOT CONFIRMED (ou confirmados com outro número)

| afirmação anterior | o que a medição mostrou |
|---|---|
| "RSI ~6.846 ms isolado vs ~0,45 ms, ~15.000×" | Componente isolado não foi remedido; **end-to-end** HEAVY RSI (10 × 17.520 velas, motor + `resumir` + `julgar`): 64,6 s → 28 ms (**2.308×**); LARGE 1.417×; MEDIUM 336×. Média/canal também melhoraram (11×/5× HEAVY), mas não eram quadráticos em N (O(N·n)). |
| "capacidade de papel ~0,4%" | A fórmula confere para mesas de agente com 3 símbolos (120 unidades ÷ 3.250 × 9 = 0,41% por tique). A medição mostrou pior: o universo nunca passava de **200 mesas** (corte fixo) e, com ≥ ~450 posições abertas, **nenhuma posição fechava**. 30 desks avaliados por tique em qualquer N. |
| "cache parcial ~20–30%" | **Não verificável** sem tráfego (produção sem uso, L-029). A contabilidade OpenAI-compatível tinha erro (CE-07a): qualquer taxa de cache medida antes desta correção deve ser recomputada. |
| "max output 4.000 vs ~1.904 observado" | Coerente com o código; **não mudado**: a cobrança é pela saída real e reduzir o teto arrisca cortar a 5ª carta. Recomendação em §13. |

## 8. WORKBENCH CHANGES

- **Estratégia própria (`motor.ts`)**: série do gatilho calculada uma vez (`serieDoGatilho`); RSI de Wilder idêntico; **média mantém a
  mesma ordem de soma** (soma móvel arredondaria diferente e poderia inverter um cruzamento exato); canal com deque monotônico
  (só comparações); a fatia passada a `computeExitPath` termina na vela do fechamento — equivalente quando cada vela está ≥ 1 ms
  depois da anterior, verificado em O(N); fora disso, cai no caminho antigo.
- **Modo mesa (`mesa-real.ts` + `market-indicators.ts`)**: `RetratoPorPrefixo` calcula EMA/RSI/MACD/ATR/ADX/OBV/tendências de
  prazos maiores/máximo e mínimo do ano uma vez e devolve, por comprimentos de prefixo, o mesmo `SymbolIndicators`; janelas (OBV,
  volume relativo, divergência, swings) refeitas na janela com a mesma ordem de soma; `montarRetrato` é a ÚNICA derivação de
  tendência/regime/alinhamento (usada também por `computeIndicators`). Fatia de saída limitada a `ate`; `findIndex` trocado pelo
  mesmo índice.
- **Rota**: cota atômica (§11), orçamento (§12), métricas de custo na linha (§20), série fechada em memória (CE-06).
- **Prova de equivalência** (igualdade exata, `Object.is`, contra cópias congeladas da base em `src/lib/bancada/__referencia__/`):
  `motor.equivalencia.test.ts` (sementes × 66 estratégias, platôs com empate exato, NaN/±∞/±0, tempo repetido/voltando, 1m/1d);
  `indicadores-por-prefixo.equivalencia.test.ts` (TODA barra de 3 × 700, NaN/±0/plano/curtas, `rodarMesa` inteiro);
  `agente.equivalencia.test.ts` (2.240 combinações). Mutações aplicadas e revertidas, todas pegas: `>`→`>=` na média; fatia uma
  vela curta; índice da EMA50; janela do OBV; lookahead de uma barra no modo mesa (6 testes vermelhos).

## 9. INDICATOR COMPLEXITY

| caminho | antes | depois |
|---|---|---|
| gatilho RSI (própria) | O(N²) | O(N) |
| gatilho média (própria) | O(N·n), n ≤ 400 | O(N·n) — mantido de propósito (exatidão) |
| gatilho canal (própria) | O(N·n) | O(N) |
| saída por operação (própria) | O(N) por operação → O(N·ops) | O(duração da operação) → O(N) total |
| retrato por barra (mesa) | O(prefixo) por barra → O(N²) | O(1) amortizado + janela fixa (OBV 20, vol 21, divergência ~60, swings: O(swings) por barra) |
| tique dos desks | O(desks) leituras | O(pares × intervalos) leituras + O(desks) CPU |

Trava de regressão (`motor.complexidade.test.ts`): razão de tempo ao dobrar N < 3,2× e teto de 1,5 s para 40 mil velas (margem
~100×). Contra o motor legado ela FALHA (RSI 33,7 s; operação densa 2,1 s) — provado.

## 10. BENCHMARK BEFORE / AFTER (MEASURED)

Container 2 GB / heap 1792 MB, Node 24.21.0, séries sintéticas determinísticas, resultado conferido igual antes de medir.
Arquivos: `evidence/.../bench/workbench-propria.{md,json}`, `workbench-mesa.{md,json}`.

**Estratégia própria (mediana; n = amostras do "antes"; depois n = 15):**

| cenário | gatilho | símbolos × velas | antes | depois | p95 depois | ganho |
|---|---|---|---|---|---|---|
| SMALL | rsi14 | 1 × 365 | 1,54 ms (7) | 0,086 ms | 0,19 ms | 18× |
| MEDIUM | rsi14 | 3 × 2.190 | 192 ms (7) | 0,57 ms | 1,15 ms | 336× |
| LARGE | rsi14 | 10 × 8.760 | 11,56 s (3) | 8,15 ms | 8,51 ms | 1.417× |
| HEAVY | rsi14 | 10 × 17.520 | 64,60 s (1) | 28,0 ms | 53,3 ms | 2.308× |
| HEAVY | media20 | 10 × 17.520 | 354 ms (1) | 33,0 ms | 61,0 ms | 11× |
| HEAVY | canal20 | 10 × 17.520 | 284 ms (1) | 54,9 ms | 114,8 ms | 5× |

**Modo mesa (mediana; antes n = 3, HEAVY n = 1; depois n = 11/5):** SMALL 1 × 720: 62 → 7,2 ms (9×); MEDIUM 3 × 2.160:
1,54 s → 95 ms (16×); LARGE 1 × 4.320: 1,19 s → 97 ms (12×); HEAVY 10 × 4.320: **19,1 s → 1,24 s (15×)**.

Limitação: o "antes" HEAVY tem n = 1 (cada execução leva ~65 s); sem p95 para ele — declarado.

## 11. QUOTA ENFORCEMENT

- **Antes**: `consumoDaJanela` lia as linhas da janela e contava `length`; o PostgREST corta em 1.000 (`PGRST_DB_MAX_ROWS=1000` no
  lab, mesmo padrão do hospedado). Medido no PostgREST real: a consulta antiga devolve **1.000** com 5.000 rodadas na janela.
  E a rota lia → decidia → inseria sem trava.
- **Depois** (migration 0073, local): `bancada_reservar_rodada` — `pg_advisory_xact_lock(hashtextextended('bancada_cota:'||dono))`,
  `count(*)` com o relógio do banco (`now() - janela`), confere rodadas e unidades, insere só se couber. Rodada `recusada` não conta;
  `falhou`/`rodando` contam (como antes). Erro/resposta fora do formato → 503 `consumo_desconhecido` (falha fechada).
  `security definer`, `search_path` fixo, EXECUTE só `service_role`. Índice `(dono, criada_em desc)` existente usado (plano provado).
- **Provas**: T20 (31 asserções: 0, 1, limite−1, limite, limite+1, limite 0/1, 1.000, 5.000, recusada, falhou/rodando, borda exata
  de 24h e 24h+1ms, janela expirando, isolamento por dono, orçamento, entradas inválidas, ACL, índice); T20b (30 sessões
  simultâneas, limite 10 → exatamente 10, outro dono não afetado); integração HTTP real (30 requisições → 10; 5.001ª do Pilot
  recusada; `anon`/`authenticated` negados, 0 linhas). Retentativa/duplicata: cada requisição consome um slot — o freio de rajada
  (12/min) continua antes.
- `consumoDaJanela` mantida para leitura, agora `count=exact` + soma paginada (teste: 5.000 → 5.000; o código antigo dá 1.000).

## 12. COMPUTE-AWARE BUDGET

`unidades(rodada) = velas lidas × (modo mesa ? 2 : 1)`; `orçamento/24h = backtestsPorDia × teto por rodada × fração(plano)`,
fração ¼ (free/pro/trader) e **1/16 (Pilot)**. Teto por rodada inalterado (`símbolos × dias × 24`).

| plano | orçamento/24h | uso PESADO modelado | folga |
|---|---|---|---|
| free | 65.700 | — | — |
| pro | 4.380.000 | 600.000 | 7,3× |
| trader | 21.900.000 | 3.000.000 | 7,3× |
| pilot | 54.750.000 | 30.000.000 | 1,8× |

Peso 2 do modo mesa: leitura + ~29 µs de CPU por barra (MEASURED), da mesma ordem do custo de ler a vela. Testes:
fórmula, uso comum nunca esbarra, rodadas no teto cabem X/4 (X/16 Pilot), folga ≥ 1,8× sobre o pesado em todo plano.
**Risco comercial declarado**: "até X backtests/24h" continua verdadeiro; para rodadas pesadas X deixa de ser alcançável.
Preço, plano e X **não** mudaram; a fração é constante de engenharia — **revisão do dono recomendada** (§28 CE-05-R1).

## 13. ZION COST ENGINEERING

- **Contabilidade** (CE-07a): `entradaOpenAICompat` = total − cacheados, lendo `prompt_tokens_details.cached_tokens` (OpenAI) ou
  `cached_tokens` (Moonshot). Exemplo do teste: 8k de prompt com 6k cacheados — conta antiga 3,31× a correta.
- **Cache exato em memória** (60 s, LRU 64 / 2 MB): só varreduras automáticas `trading`/`sniper`/`arbitrage` **sem nenhum dado do
  usuário**; chave = SHA-256(modelo ∅ sistema ∅ usuário); só resposta completa; `zion_analysis.cacheHit` para medir a taxa.
- **Prefixo estável**: ordem fundação → modo → idioma já era a certa; o teste prova fundação e modos **byte a byte iguais à base**.
- **Não feito, com motivo**: roteamento para modelo mais barato, cache semântico, teto de saída dinâmico, resumo de histórico —
  todos mudam a resposta e exigiriam avaliação contra o modelo real (credencial real, não autorizada). Recomendação de teto
  dinâmico: `max(1,5 × p99 de saída observado por modo, 1.500)`, medido pelos eventos `zion_analysis` quando houver tráfego.
- Prefixo medido: fundação 12.819 + modo trading 9.030 caracteres ≈ 5,5k tokens.

## 14. ZION QUALITY REGRESSION

`src/lib/zion/regressao-qualidade.ts`: 10 casos (redes, ZETTA Chain "em breve", Solana, taxas, cotas do ZION, Founders, Workbench,
ZION não executa sozinho, chaves privadas, comparação Trader×Pilot) com fatos **lidos das constantes do produto** e um avaliador
(fatos presentes, afirmações proibidas ausentes). Offline: avaliador provado com respostas boas e ruins; **prompts inalterados**.
Ao vivo: `bench/integracao/zion-qualidade.integration.ts` — pulado sem `ZION_QUALIDADE_AO_VIVO=1` + chave (não autorizado neste
round). Regra de aceite para qualquer troca por custo: aprovação do candidato ≥ a do modelo atual.
**Achado CE-08a**: o modo `ask` não recebe fatos da plataforma — perguntas institucionais dependem do conhecimento do modelo;
recomendado um bloco de fatos gerado das constantes, logo após a fundação (estável → cacheável), validado pelo arnês ao vivo.

## 15. MARKET DATA

- Paginação de `mercado_vela` (CE-11) — corrige resultado, aumenta leitura das rodadas grandes (custo agora visível e orçado).
- Série fechada em memória (CE-06): mesma (par, intervalo, janela) → 0 idas ao banco; só leitura completa e janela fechada; teto
  250 mil velas por instância; cópia nova por acerto.
- Tique: uma leitura por (par, intervalo, janela) por tique, compartilhada por todas as mesas; fechamento agrupado por par.
  Chamadas à fonte externa no teste de carga: 182 → 120 em 6 tiques, cobrindo 108× mais desks.
- Cotação de execução **não** foi tratada como vela histórica: nada no caminho de swap/quote foi tocado.

## 16. PAPER DESKS ARCHITECTURE

Fila justa sobre TODAS as mesas elegíveis com cursor persistido (`admin_kv` `bancada:tique:cursor`); teto do plano aplicado sobre
todas as mesas de cada dono; orçamento de **leituras distintas** (400) e **tempo** (15 s no cron do backtest; 45 s na rota
dedicada `/api/bancada/tique`); o que o orçamento corta é carimbado (`adiadaEm`) e vem primeiro na próxima passagem; leituras
compartilhadas; análise do agente uma vez por símbolo (`prepararAgente`, mesma ordem de guardas); tier em lote (`tier_cache` em
lotes de 100, tolerância de 55 min — declarado: rebaixamento corta a mesa em até ~1 h); último tique em lote (0074, com queda para
o PATCH antigo); posições fechadas mesmo sem mesa ligada. Agendar a rota dedicada é passo do dono (cron-job.org); até lá o tique
segue no cron do backtest; quando a dedicada roda, o backtest pula o tique por 40 min.

## 17. PAPER LOAD TEST (MEASURED, PostgREST + Postgres reais)

Semeadura: mistura do direito (Trader 3 / Pilot 10 por dono), metade própria e metade agente, 1/3 com posição aberta, 20 pares
× 1h/4h/1d. 6 tiques por N. `evidence/.../bench/papel-carga-{atual,depois}-N.json`.

| desks | antes: avaliados/tique | nunca avaliados (6 tiques) | requisições/tique | ms/tique (local) | depois: avaliados/tique | nunca avaliados | req/tique | ms/tique |
|---|---|---|---|---|---|---|---|---|
| 200 | 30 | 51 | 568 | 928 | **200** | **0** | 288 | 488 |
| 500 | 30 | 327 | 865 | 1.439 | **500** | **0** | 289 | 548 |
| 1.000 | 30 | 827 | 1.366 | 2.225 | **1.000** | **0** | 292 | 636 |
| 2.000 | 30 | 1.827 | 367* | 7.657 | **2.000** | **0** | 298 | 750 |
| 3.250 | 30 | 3.077 | 367* | 7.671 | **3.250** | **0** | 308 | 1.099 |

\* com ≥ 2.000 desks o "antes" tinha 500 "problemas" por tique (o `.in()` estourado): as posições nem eram lidas para fechar.
Limitação: latência local (~1 ms); em produção cada requisição custa ~10–20 ms (ESTIMATED) → ~3–6 s por tique para 3.250 desks,
dentro dos 15 s. Missed cycles: 0 nos 6 tiques. Fairness: todo desk avaliado em todo tique (`cicloCompleto`).

## 18. DATABASE OPTIMIZATION

- Contagem da cota no banco com índice existente (plano verificado em T20.31); reserva atômica.
- Leituras paginadas por chave (`mercado_vela`, mesas e posições do cron) e por offset estável (admin).
- `.in()` em lotes de 100 (limite medido ~450 UUIDs).
- Escrita em lote do último tique (0074): 1 requisição por 500 mesas em vez de 1 por mesa.
- Tier em lote: ⌈donos/100⌉ leituras por tique em vez de 1 por dono.
- Varredura estática (`scripts/cost/varrer-leituras-sem-limite.mjs`): 68 candidatos em 17 tabelas; triagem: os materiais foram
  corrigidos (receita, crescimento, resumo, cron, velas, cota); a maioria é limitada por construção (contas por fonte, posições
  abertas por sessão, chaves fixas) ou já pagina (`escopo-de-conta`). **Não verificados** (cardinalidade): `dca/store.ts:447`
  `.in("plano_id", ids)` e `lab/store.ts:275` `.in("run_id", okIds)` — §28.
- Nenhuma migration hospedada; 0073–0075 aditivas, locais, provadas em cadeia nova.

## 19. STORAGE / RETENTION

Modelado (`COST-ENGINEERING-36M-MODEL.md` §7): cada backtest grava rodada + resultado + **todas** as operações; sem retenção.
Pilot pesado: ~2,8 GB/mês → US$ 230 em 36 meses (acumulado); com retenção de 90 dias do detalhe: US$ 39. `platform_events` também
sem retenção (page_view incluído). **Política proposta, NÃO implementada** (apagar dado de cliente exige decisão do dono):

```sql
-- PROPOSTA — não aplicar sem decisão do dono.
-- 1) detalhe de operações de rodadas com mais de 90 dias (o resumo em bancada_resultado fica para sempre):
-- delete from public.bancada_operacao o using public.bancada_rodada r
--  where r.id = o.rodada_id and r.criada_em < now() - interval '90 days';
-- 2) page_view com mais de 30 dias; eventos de segurança/financeiros NUNCA:
-- delete from public.platform_events where event_type = 'page_view' and created_at < now() - interval '30 days';
-- 3) velas de intervalo < 1h com mais de 30 dias (re-baixáveis da fonte):
-- delete from public.mercado_vela where intervalo in ('1m','3m','5m','15m','30m') and abriu_em < extract(epoch from now() - interval '30 days') * 1000;
```

Não remover: trilhas de auditoria, evidência Founders (append-only), estado financeiro do CEX/autopilot, eventos de segurança.

## 20. ECONOMIC OBSERVABILITY

- Rodada do Workbench: `custo_velas`, `custo_unidades` (0073), `duracao_ms`, `velas_da_fonte`, `velas_do_cache` (0075) na própria
  linha — sem linha nova por rodada.
- Tique: `ResumoDoTique.leituras` e `cicloCompleto` no evento `bancada_papel_tique`.
- ZION: `zion_analysis` com `cacheHit` e tokens corrigidos (cacheados separados).
- Admin: receita/crescimento/resumo leem tudo; o resumo diz quando a leitura foi incompleta.
- Sem segredo nem conteúdo sensível nos registros (só contagens, tempos e ids).

## 21. SECURITY REVIEW

| ponto | resultado |
|---|---|
| RLS | inalterada; tabelas novas não há; colunas novas em `bancada_rodada` |
| ACL das RPCs novas | `bancada_reservar_rodada`, `bancada_gravar_ultimos_tiques`: security definer, `search_path` fixo, EXECUTE só `service_role` (T20/T21; integração HTTP: anon/authenticated negados); registradas na guarda `rpcs-acl.test.ts` |
| posse | reserva por `dono` vindo da sessão; escrita em lote confere `id`+`dono` por linha (T21.04) |
| auth | rota nova `/api/bancada/tique`: `CRON_SECRET` em tempo constante, gate `pause_bancada`, lock |
| falha fechada | cota: erro/forma inválida → 503; nunca cota livre |
| caches | ZION: só payload público, chave = prompt inteiro, sem dado de usuário; séries: dado público, só janela fechada e completa; cópia nova por acerto |
| tier no tique | tolerância de 55 min só no tique de papel (sem dinheiro); rotas de usuário inalteradas |
| idempotência/financeiro | nada do autopilot, CEX, DCA, swap/quote ou Founders foi tocado |
| segredos | nenhum segredo novo; o JWT do PostgREST descartável é gerado e guardado só em `zswap-local/state/` (fora do repo, 0600) |
| guardas textuais | `taxa-e-janela.test.ts` ③④ reescritas para as MESMAS intenções no mecanismo novo, com justificativa no teste — o auditor deve conferir |

## 22. TEST RESULTS

| item | resultado |
|---|---|
| baseline (0afa841) | 296 arquivos / 4.490 testes PASS (1ª execução: 1 FAIL ambiental — `git: not found` na imagem slim; repetida na imagem com git: PASS) |
| final (037d3a6) | **304 arquivos / 4.547 testes — TOTAL 4.547, PASS 4.547, FAIL 0, SKIP 0** |
| type-check | 0 erros |
| lint | 0 erros, 145 avisos (= baseline) |
| SQL, cadeia nova 0001→0075 | 18/18 arquivos `.sql` rc=0 (T20/T21/T22 PASS); 20b PASS; 16b PASS; 13 stable 20/20 PASS |
| SQL não rodados | 04/05/06 (exigem `runuser` e socket `/var/tmp/zswap-pg` de outra campanha; não tocam nada deste round) |
| SQL instável preexistente | `13_dca_a58_concorrencia.sh` (variante não estável) FAIL de temporização ("pause não observou blocking real (1ms)"); a base mantém `_stable` exatamente por isso; 20/20 PASS na estável; DCA não foi tocado |
| integração PostgREST real | 5/5 PASS (velas, cota, 5.001ª, concorrência HTTP, ACL) |
| carga | 10 rodadas (5 N × antes/depois), 6 tiques cada |
| qualidade ZION ao vivo | SKIP (credencial real não autorizada) |
| build (Next.js) | **PASS** no container capado (2ª execução, com rede para `next/font`); a 1ª, sem rede, falhou de forma ambiental (`next/font` não baixa as fontes) — `build-final-run1-ENV-FAIL-no-network-next-font.txt` / `build-final-run2.txt`; rota nova compilada (`.next/server/app/api/bancada/tique`) |

## 23. PERFORMANCE RESULTS

§10 (Workbench), §17 (desks). Travas automáticas: complexidade do motor (§9); equivalências exatas (§8); teste de carga
reprodutível (`ce-carga-papel`). Nenhum limiar de relógio em CI.

## 24. 36-MONTH NEW COST

`docs/COST-ENGINEERING-36M-MODEL.md` (gerado de `scripts/cost/premissas-36-meses.json`). Por holder, 36 meses, USD:

| cenário | plano | CASH | HUMANO | FIXO | ECONÔMICO | econômico/preço |
|---|---|---|---|---|---|---|
| EXPECTED | pro | 22,09 | 63,00 | 1,79 | 86,88 | 58% |
| EXPECTED | trader | 55,50 | 189 | 1,79 | 246 | 62% |
| EXPECTED | pilot | 67,89 | 630 | 1,79 | 700 | 35% |
| HEAVY | pro | 82,14 | 189 | 1,79 | 273 | 183% |
| HEAVY | trader | 230 | 504 | 1,79 | 736 | 184% |
| HEAVY | pilot | 704 | 1.890 | 1,79 | 2.596 | 130% |
| STRESS | pro | 182 | 378 | 1,79 | 562 | 377% |
| STRESS | trader | 632 | 1.008 | 1,79 | 1.642 | 412% |
| STRESS | pilot | 1.228 | 3.780 | 1,79 | 5.010 | 252% |

CPU do Workbench removida pela engenharia (36 meses por holder, mesma carga): Pilot HEAVY US$ 606 → 2,46; Pilot STRESS
US$ 1.105 → 4,49 (com o novo orçamento). Antes, o tique dos desks **não entregava** o direito contratado a nenhum custo
(30 desks por tique, universo máximo 200).

## 25. MARGIN BY TIER

Margem = preço − referral − econômico (modelo §4). EXPECTED com referral 0%: Pro 42%, Trader 38%, Pilot 65%; com 20%: 22% / 18% /
45%. HEAVY e STRESS: negativos em todos os planos, dominados pelo HUMANO. CASH/preço (só máquina) — EXPECTED: 15% / 14% / 3%;
HEAVY: 55% / 58% / 35%; STRESS: 122% / 158% / 62%. Comparado ao preço mensal do Hird no código (7,90 / 20,90 / 159): custo
econômico EXPECTED 31% / 33% / 12% do preço mensal; HEAVY 96% / 98% / 45%.

## 26. REFERRAL SENSITIVITY

Modelo §4–§5. Carteira inteira (2.850 pagos + 40 de reserva), EXPECTED: resultado US$ 363 mil (0%) → 283 mil (10%) → 243 mil
(15%) → 203 mil (20%). HEAVY (−US$ 576 mil a −736 mil) e STRESS negativos em qualquer referral. Nenhuma política aprovada aqui.

## 27. SERVICE RESERVE MODEL

Modelo §6. Passivo = CASH + HUMANO de 36 meses por holder. Cobertura (EXPECTED / HEAVY / STRESS):
40/35/15 → Pro 0,70× / 0,22× / 0,11×; Trader 0,57× / 0,19× / 0,09×; Pilot 0,43× / 0,12× / 0,06×.
25/20/10 → Pro 0,44× / 0,14× / 0,07×; Trader 0,33× / 0,11× / 0,05×; Pilot 0,29× / 0,08× / 0,04×.
Orientada a passivo (HEAVY + 20%): Pro 218% do preço, Trader 221%, Pilot 156% — ou seja, nenhuma reserva percentual sobre o preço
cobre o passivo pesado com as premissas de suporte atuais. **Somente matemática; nenhuma política declarada aprovada.**

## 28. REMAINING RISKS

| nível | risco | causa | impacto | solução recomendada | por que não resolvido |
|---|---|---|---|---|---|
| HIGH | Economia de 36 meses negativa em HEAVY/STRESS | oferta de pagamento único × suporte humano (premissa) | margem negativa | dono fixar `horaHumanaUsd`/horas, revisar preço/escopo de suporte, retenção | decisão comercial, fora do mandato |
| HIGH | Migrations 0073–0075 não aplicadas | lane B local | a rota da bancada exige a RPC 0073 para rodar (falha fechada: 503) — **deploy desta branch sem aplicar 0073 para a bancada** | aplicar 0073–0075 junto com o release que levar este código | aplicação hospedada proibida neste round |
| MEDIUM | CE-05-R1: orçamento do Pilot | fração 1/16 escolhida por engenharia | rodadas muito pesadas reduzem o X alcançável | dono revisar fração/redação da oferta | toca percepção comercial |
| MEDIUM | CE-02-F1: barreira do modo mesa usa o horizonte, não o fechamento | código anterior | menos operações e `fechouEm` = fim do horizonte no extrato | corrigir com prova de que muda o resultado e revisão do flywheel | mudança de semântica de resultado — regra "não melhorar número sem entender os filtros" |
| MEDIUM | CE-08a: `ask` sem fatos da plataforma | desenho do prompt | resposta institucional pode errar taxa/plano | bloco de fatos das constantes + arnês ao vivo | exige avaliação com credencial real |
| MEDIUM | CE-13a: crescimento sem retenção | sem política | GB/mês por Pilot pesado | política §19 | apagar dado de cliente exige decisão do dono |
| MEDIUM | Rota dedicada não agendada | cron-job.org | tique segue limitado ao que sobra do cron do backtest (15 s) | agendar `/api/bancada/tique` a cada 30 min | agendamento externo |
| LOW | `.in()` de `dca/store.ts:447` e `lab/store.ts:275` | cardinalidade não verificada | falharia acima de ~450 ids | lotes de 100 | fora do custo deste round; registrado |
| LOW | Cache do ZION/séries em memória | instâncias serverless | taxa de acerto desconhecida | medir `cacheHit` quando houver tráfego | sem tráfego (L-029) |
| LOW | `13_dca_a58_concorrencia.sh` instável | temporização | ruído de teste | usar `_stable` (já existe) | preexistente, fora do escopo |
| LOW | Preços ESTIMATED do modelo | listas públicas, região gru1 | erro proporcional no modelo | dono conferir faturas | sem acesso às faturas |

Nenhum BLOCKER aberto para a auditoria deste round.

## 29. EXTERNAL BLOCKERS (só registro — nada foi alterado)

- **R-01**: Vercel conta/pagamento — produção responde HTTP 402 `DEPLOYMENT_DISABLED`.
- **R-02**: `CEX_RECOVERY_HMAC_KEY` ausente na Vercel.
- **R-03**: advisory Tailwind/braces (exceção estreita do dono).
- Migrations Founders **0071/0072** não aplicadas no hospedado; somam-se agora **0073/0074/0075** (este round), também não aplicadas.
- Credencial de provedor de IA para o arnês de qualidade ao vivo (não autorizada neste round).
- Agendamento da rota dedicada do tique (cron-job.org).

## 30. AUDITOR HANDOFF

Reproduzir (worktree do round; nada aqui toca lab, hospedado ou produção):

```bash
cd /home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/cost-engineering-20261005
B=/home/zetta/Documentos/ZETTA_WORLD/zswap-local/bin
$B/capped-run . 'npm ci --offline --no-audit && npx tsc --noEmit && npx eslint . && npx vitest run'
# benchmarks (antes × depois na mesma execução)
$B/capped-run . 'BENCH_OUT=/tmp/b npx vitest run --config bench/vitest.bench.config.ts'
# Postgres descartável (cadeia 0001→0075) + provas SQL
$B/ce-pg up . && for f in supabase/tests/2*.sql; do $B/ce-pg psql -v ON_ERROR_STOP=1 -f /wt/$f; done
docker exec -e PSQL="psql -X -U supabase_admin -d postgres" -e CONC=30 ce-pg-20261005 bash /wt/supabase/tests/20b_bancada_reserva_concorrencia.sh
# PostgREST descartável (ver o comando em bench/integracao/postgrest.integration.ts) + integração e carga
$B/ce-carga-papel $PWD depois 6 200 3250
# modelo econômico
node scripts/cost/modelo-36-meses.mjs
```

O que conferir primeiro: (1) as equivalências exatas e as mutações (§8); (2) a prova da cota e do truncamento contra PostgREST
real (§11, §6); (3) a mudança de mecanismo do tique e as guardas textuais reescritas (§16, §21); (4) premissas ESTIMATED do
modelo (§24) — o modelo é tão bom quanto elas.
