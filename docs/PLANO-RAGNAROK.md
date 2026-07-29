# PLANO-RAGNAROK — o retorno dos guerreiros de Valhalla

> Status geral: 🟡 em construção
> Origem: veredito anterior ("IA não prevê direção em cripto") era **verdadeiro
> mas estreito**. Testamos só o formato scanner (bracket long/short) + oráculo,
> só em CEX, com métrica de acerto-de-previsão. Nunca testamos **seleção de
> estratégia por regime**, **acumulação de USDT (long-only)**, nem **DEX**.
> Este plano ressuscita os agentes com o mandato certo.

## A tese (do dono)

> "A questão não é IA adivinhar a direção do mercado, é IA analisar o mercado e
> seguir a estratégia que melhor se adequa àquele momento — stop, range,
> pullback, suporte/resistência. Modelos de fronteira são ótimos em prever
> padrão, e o mercado é isso até quando está lateralizado."

E: os trades buscam **aumentar a quantidade de USDT** — comprar um token barato
e vender com lucro. **Long-only, spot, acumulação.**

## Decisões travadas (28/07)

| Fork | Escolha |
|------|---------|
| Mandato | **Acumulação long-only** — só compra barato/vende caro; métrica = crescimento de USDT (carteira paper), não acerto de bracket |
| Mercado | **DEX + CEX** — usa `getSymbolIndicators` (CEX) e `getDexSymbolIndicators` (GeckoTerminal) |
| Motor | **Novo agente seletor** dedicado, separado do formato scanner |

## Por que o experimento antigo não testou isto

- `extractSuggestion` (backtest.ts) tem **regime filter** que faz
  `if regime === "RANGING" return null` — ou seja, **rejeitava exatamente os
  mercados laterais** onde mean-reversion vive. Os agentes nunca puderam
  operar range.
- O formato scanner emitia **long E short** (`bullish → buy_limit`,
  `bearish → sell_safe`). Short = apostar na queda. Não é acumular USDT.
- A métrica do torneio é **% por trade** (acerto de alvo vs stop). A carteira
  paper (`paper_accounts.cash_usd`, `pnl_usd`) **já mede USDT acumulado** — só
  nunca recebeu um agente long-only seletor.

## Arquitetura

Dois cérebros na mesma pista, medidos pela **mesma carteira paper** (USDT):

1. **`strat_mech`** — seletor MECÂNICO (determinístico, zero-LLM). O "bot burro"
   de controle. Dado o regime + S/R + ATR, escolhe o playbook e monta o bracket
   long. Se um bot mecânico honesto não lucra, a estratégia está errada — não a IA.
2. **`strat_ai`** — seletor de FRONTEIRA. Recebe a análise completa do ZION +
   a sugestão mecânica, e pode **aceitar / vetar / ajustar** (entrada, alvo,
   stop, tamanho). A pergunta do experimento: **a IA bate o bot mecânico?**

Playbooks (todos LONG):
- `range_reversion` — regime RANGING: compra perto do **suporte**, alvo perto da
  **resistência**, stop abaixo do suporte (ATR-floored). O unlock principal.
- `trend_pullback` — TRENDING_UP: compra o **pullback** (perto de EMA20/suporte),
  alvo na continuação, stop abaixo da estrutura.
- `capitulation_reversal` — TRENDING_DOWN **só** com `bullish_rsi` divergence
  perto da mínima de 1 ano (rangePct baixo). Senão, downtrend long-only = fora.
- TRANSITIONING → fora (v1).

Escoamento: escreve em `zion_suggestions` com `source` novo → a `paper/engine.ts`
já abre/fecha posição e credita USDT na carteira automaticamente. O torneio e o
painel Paper já leem por source.

## Fatias (slices)

- [x] **S0 — Valhalla**: memorial viking (feito, `cf232be`).
- [x] **S1 — motor mecânico**: `src/lib/zion/strategist.ts` puro + testes
  (`selectPlaybook`, brackets long a partir de S/R+ATR, RR e stop-floor). 🟢
- [x] **S2 — wiring cron**: `src/lib/zion/ragnarok.ts` (`runStrategistScan`)
  grava DIRETO em `zion_suggestions` — **não** passa por `logSuggestions`, cujo
  `extractSuggestion` tem o `if RANGING return null` que mataria o experimento.
  Roda no tick logo após os indicadores, com try próprio (é grátis, não pode
  ficar refém de falha de LLM). `strat_mech` entrou em `PAPER_SOURCES` e no
  torneio. 🟢
- [ ] **S3 — DEX**: 🔴 **maior do que parecia** — descoberto em 29/07 que toda a
  camada de resolução é CEX-shaped: `resolveOpenSuggestions` precifica por
  klines da Binance e o `paper/engine` preenche com `gateioSpot`. Um token
  só-DEX **nunca preencheria nem resolveria** — ficaria aberto para sempre,
  poluindo o ledger. **É por isso que DEX nunca foi testado**: não faltou
  vontade, faltou encanamento. Exige (a) migration com `chain`/`pool_address`
  em `zion_suggestions`, (b) resolver por `getOHLCV` do pool quando houver
  pool, (c) fill do paper pelo mesmo preço. Fazer com o encanamento certo, não
  com gambiarra — uma mesa que loga sugestão que nunca resolve é pior que
  nenhuma mesa.
- [x] **S4 — camada IA**: `strategist-ai.ts` — **MÍMIR** (`strat_ai`). A IA NÃO é
  perguntada "pra onde vai o preço?"; recebe o retrato técnico + o plano do
  ferreiro e responde uma pergunta de OFÍCIO: é o playbook certo pra este
  momento e a geometria está bem posta? Pode **aceitar / vetar / ajustar**.
  Duas travas em código (não no prompt): todo ajuste volta pelo
  `buildLongBracket` (mesmo portão do mecânico) e long-only é estrutural —
  não existe campo pra short e o bracket reprova stop acima da entrada.
  Âncora de escala de 10% mata o deslize de casa decimal. 17 testes. Gate
  `pause_ragnarok_ai` separado do mecânico: cortar custo não cala o controle. 🟢
- [x] **S5 — painel**: `RagnarokPanel` + `/admin/api/ragnarok`. Mostra, nesta
  ordem: **USDT acumulado por mesa** (a régua do mandato — vem primeiro),
  **qual playbook paga** (range vs pullback vs reversão) e **o duelo**
  mecânico vs IA no mesmo mercado, com o cruzamento mesa × playbook para ver
  se a IA muda a ESCOLHA de estratégia, não só os níveis. 🟢

## S6 — A FROTA: nomes vikings + separação por estilo (29/07) 🟢

`src/lib/zion/desks.ts` é agora a FONTE ÚNICA de quem é cada mesa: nome viking,
runa, estilo (scalp/day/swing/posição/evento), praça (CEX/DEX), direção
(long-only / long+short / market-neutral), cérebro (mecânico ou modelo),
horizonte e **a pergunta que a mesa existe para responder**. Torneio e carteira
paper leem daqui — renomear uma mesa é editar UM arquivo.

O torneio deixou de ser uma tabela só: agora **agrupa por estilo**, porque
julgar day trade com a régua de swing é cronometrar maratonista nos 100m.

| source | nome | estilo | direção | cérebro |
|---|---|---|---|---|
| arbiter | ᛉ RATATOSKR | scalp | market-neutral | mecânico |
| arbiter2 | ᛇ JÖRMUNGANDR | scalp | market-neutral | mecânico |
| strat_mech | ᚹ VÖLUNDR | swing | long-only | mecânico |
| radar | ᚻ HEIMDALL | evento | long+short | mecânico |
| sniper | ᚢ ULLR | evento | long+short | IA |
| hybrid_scan | ᚬ ODIN | swing | long+short | DeepSeek (CEO) |
| deepseek_scan | ᚺ HUGINN | swing | long+short | DeepSeek |
| kimi_scan | ᛗ MUNINN | swing | long+short | Kimi |
| mistral_scan | ᚷ GERI | swing | long+short | Mistral |
| llama_scan | ᚠ FREKI | swing | long+short | Llama |
| grok_scan | ᛊ SLEIPNIR | swing | long+short | Grok |
| oracle_* | ᚦ VÖLVA · <modelo> | posição | long+short | IA |
| self_scan | ᛏ TÝR | swing | — | Anthropic (encerrado) |
| oracle_self | ᛋ SAGA | posição | — | Anthropic (encerrado) |

A casa de Odin dá nome ao torneio de modelos: os corvos (Huginn/Muninn), os
lobos (Geri/Freki) e o corcel (Sleipnir) competem servindo ao mesmo trono.

### Correções de custo/sinal na mesma leva

- **Anthropic REMOVIDO de vez**: `runBacktestScan` era código morto lendo
  `ANTHROPIC_API_KEY`. Enquanto existisse uma função pronta, um religamento
  distraído trazia a fatura de volta. Apagada + import removido.
- **Grok sai do assento de sentimento**: a xAI aposentou o Live Search, então o
  assento rodava "Grok pelado" — analista de sentimento SEM acesso ao X, que era
  a razão inteira de ele estar ali. Mistral assume. Grok segue no torneio de
  scanner, onde disputa com o mesmo insumo dos outros.
- **`pause_ragnarok`**: gate próprio para a mesa nova (desligar sem derrubar o
  resto do tick).

## Honestidade (cicatrizes a preservar)

- Métrica primária = **USDT na carteira** (paper), não win-rate. Win-rate é
  secundário.
- `strat_mech` é o CONTROLE — não "melhorar" ele pra IA ganhar. A comparação só
  vale se o mecânico for honesto.
- Long-only de verdade: `side` sempre `"buy"`. Nada de short disfarçado.
- Stop fora da banda de ruído (ATR floor), senão morre de clima, não de estar errado.
- Amostra mínima antes de qualquer veredito (mesma disciplina do flywheel).
