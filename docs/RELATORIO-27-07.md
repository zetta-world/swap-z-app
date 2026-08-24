# Relatório do dia — 27/07 (segunda)

> 7 PRs · 18 arquivos · +347/−90 linhas · 120 testes verdes · tsc + lint limpos.
> Tudo mergeado na `main` e em produção.

## Resumo em uma frase

Fechamos o experimento do fim de semana com veredito honesto (foi rali, não
mérito), consertamos **6 bugs/falhas** — três deles custando dinheiro real —
e reconstruímos a frota removendo a Anthropic por completo, de ~$15 para
~$2-3 por semana.

---

## 1 · Bugs, falhas e erros ENCONTRADOS hoje

| # | O que estava errado | Como foi descoberto | Custo/impacto |
|---|---|---|---|
| 1 | **Painéis achatavam eras de config** numa média vitalícia — uma correção que funcionava ficava invisível (Mistral aparecia −0,23% quando a era recente dele era +0,12%) | CEO olhando o painel: *"se vc não me fala que os agentes melhoraram eu não saberia olhando"* | Decisões cegas; dependência de medição manual |
| 2 | **Piso de stop não chegou aos scanners** — a correção de 25/07 só cobriu o Sniper; o stop médio dos scanners *encolheu* 2,02%→1,72% | Medição da coorte de FDS | Mortes por ruído continuando |
| 3 | **Lições da Auto-Retro truncadas em 220 chars**, cortando exatamente a receita (`"...require a s"`) | Leitura das lições geradas | Metade útil da reflexão perdida |
| 4 | **Cache pago e nunca lido**: 2.389.090 tokens de cache-WRITE contra 9.432 de READ (0,39%) — TTL de 5min vs cron de 30min | Reconciliação com a fatura real | **~$2,38 queimados** |
| 5 | **Tokens de raciocínio invisíveis**: xAI cobra reasoning em linha separada (359,2K = $0,90) e só líamos `completion_tokens` | Console da xAI | **72% do custo de saída do Grok** fora do FINANCE |
| 6 | **Cooldown do Oráculo era por modelo, não da mesa** — 5 das 6 derrotas foram o MESMO ARB comprado por 3 modelos diferentes | Autópsia das teses decididas | ~−5,5%/tese repetida |
| 7 | **Controle contaminado**: o piso de stop vazou para o radar (mesmo funil `logSuggestions`) | Auditoria própria antes de religar | Perderíamos a régua da semana |

**Erro meu, corrigido publicamente:** reportei que o painel FINANCE subestimava
custos. Falso — o `estimateCost` sempre precificou cache write corretamente.
Quem ignorou a coluna foi a **minha consulta SQL ad-hoc**. Por causa disso eu
disse que o Mistral era nosso agente mais caro quando ele é **gratuito**.

---

## 2 · Correções APLICADAS (por PR)

| PR | Correção | Arquivos-chave |
|---|---|---|
| **#151** | Piso de stop `max(1,5×ATR, 1,2%)` nos scanners (a lição que eles mesmos escreveram) · lições até 400 chars · scanners desligados | `backtest.ts`, `retro.ts` |
| **#152** | Janela de tempo 24H/7D/30D/TUDO nos painéis Backtest e Torneio, padrão 7D; corte por `created_at` (a config que gerou o card) | `admin/api/backtest`, `admin/api/tournament`, 2 painéis |
| **#153** | `cacheSystem` removido dos 3 caminhos de cron · `reasoning_tokens` somados ao custo · Mistral documentado como tier gratuito | `provider.ts`, `ai-cost.ts`, `backtest.ts`, `oracle.ts` |
| **#154** | Agente A aposentado · Agente B recabeado: **DeepSeek assina, Mistral rascunha** · fallback do CEO sem Anthropic, com breaker · `HYBRID_B_ENABLED` liga por padrão | `registry.ts`, `backtest.ts`, `cull.ts`, `retro.ts` |
| **#155** | `oracle_self` aposentado — flywheel 100% sem Anthropic | `oracle.ts` |
| **#156** | Cooldown pós-stop passa a ser **da mesa inteira** (um stop bloqueia o símbolo para todos os analistas) | `oracle.ts` |
| **#157** | Radar **isento** do piso de stop — controle tratado não é controle | `backtest.ts` |

### Decisões de arquitetura embutidas

- **Brain ≠ CEO no Agente B**: movi o assento técnico de DeepSeek para Mistral
  porque um CEO revisando o próprio rascunho é carimbo, não segunda opinião
  (e o Mistral é grátis).
- **Isenção do controle é estreita**: o radar segue passando por escala,
  geometria, RR, clamp e filtro de regime — só não recebe o tratamento novo.
- **Janela é só de exibição**: o motor de corte continua julgando a rodada
  viva inteira, então uma visão de 24H nunca executa um agente.

---

## 3 · Medições de coorte do dia

### Manhã (09:01) — veredito do fim de semana

Placar bruto melhorou em todos (DeepSeek −1,75→+0,60 · Kimi −1,39→+0,01 ·
Mistral −0,71→+0,12 · Grok −1,10→−0,29). **Foi armadilha de regime:**

| Coorte | buy win | sell win |
|---|---:|---:|
| pré (rodada 2) | 26% | 7% |
| fim de semana | **77%** (23W/7L) | **4%** (1W/27L) |

Compra a 77% e venda a 4% = rali. Espelho exato do bear de 17/07.
**Veredito: sem mérito provado.** Scanners desligados às 09:10.

**O que a coorte PROVOU:** a Auto-Retro gera diagnóstico real — três modelos
redescobriram sozinhos as conclusões da auditoria de 25/07:
- Claude: *"stops abaixo de 1% em TRENDING_DOWN são clipados quase
  instantaneamente (DOGE 0,4%, SOL 0,8%, BNB 0,3%, XRP 0,7%, todos em <7h)"*
- Claude: *"entradas duplicadas no mesmo ativo multiplicaram perdas"*
- Kimi: *"cooldown de 48h por ativo após stop"*

Também apareceu uma lição **errada** (Mistral: *"apertar stops para ≤0,5%"*),
substituída na reflexão seguinte — evidência de por que "lição é contexto,
nunca permissão".

### Noite (18:01) — coorte completa

| Agente | W/L | Líq. | Nota |
|---|---|---:|---|
| Sniper 🎯 | 6W/6L | **−0,02%** | quase breakeven; stop médio subiu p/ 1,80% |
| Mistral | 19W/31L | **−0,09%** | melhor scanner — e é o gratuito |
| Radar (controle) | 11W/14L | −0,36% | a régua |
| Claude (self) † | 7W/28L | −0,53% | aposentado hoje |
| Kimi | 7W/39L | −0,87% | |
| Grok | 6W/32L | −0,98% | |
| DeepSeek | 2W/17L | −1,47% | promovido a CEO do Agente B |
| Oráculos (3) | **0W/6L** | −4,6 a −5,7 | 5 das 6 = mesmo ARB |

**Mesas invictas:** Arbiter +$58,95 (**+5,90%**, 420 ciclos, 0 perdas) ·
Arbiter 2.0 +$23,75 (**+7,92%** sobre $300, 140 ciclos, 0 perdas).

---

## 4 · Custo — a reconciliação com as faturas

Julho real: **Anthropic $25,07** (bate com o console) · xAI $3,50 ·
Kimi ~$1,50 · DeepSeek $0,74 · **Mistral $0** (tier gratuito).

O vilão não eram os agentes atuais — era o **Agente B com CEO Opus**:

| Dia | Custo Anthropic | Estado |
|---|---:|---|
| 11, 12, 13/07 | $5,56 · $5,97 · $6,01 | Agente B com Opus |
| 18-24/07 | **$0,04/dia** | scanners pausados |
| 26/07 | $1,64 | fim de semana cheio |

Três dias de Opus = **$17,50 = 70% da fatura do mês**.

**Projeção pós-mudanças: ~$2-3/semana** com tudo ligado e zero Anthropic.

---

## 5 · Estado no fim do dia

**Ligado:** Ferrari (Mistral→DeepSeek) · torneio de 4 modelos · Oráculo de 3 ·
Sniper · Arbiter · Arbiter 2.0 · **Radar sem tratamento** (controle).
**Aposentados:** Agente A (`self_scan`), Oráculo Claude (`oracle_self`).

**O que a semana vai medir:** (1) primeira medição real do piso de stop —
nenhum card de scanner nasceu sob a regra ainda; (2) a Ferrari sem Anthropic;
(3) o Oráculo com trava coletiva; (4) 7 dias atravessam mais de um regime,
o antídoto ao confundidor que estragou a leitura do fim de semana.

**Critério pré-registrado:** sucesso = coorte tratada bate a não-tratada no
**diff-in-diff contra o radar**, com stop médio subindo de 1,72% para ~2,5%+.
Fracasso = só produz menos cards sem melhorar a expectancy relativa.
