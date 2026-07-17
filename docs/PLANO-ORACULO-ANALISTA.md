# ORÁCULO — de bot de day trade pra analista de teses — 🔴 (plano, 17/07)

> Gatilho: teoria do CEO, confirmada pelos dados — "estamos usando as IAs mais
> avançadas do mercado e fazendo análise igual bot de day trader." Este plano
> redesenha O QUE se pergunta às IAs. Nada aqui altera o flywheel de medição,
> o arquivo de rodadas, o corte automático ou o arbiter.

## Diagnóstico (por que o formato atual tem teto baixo)

Três provas, todas dos nossos próprios dados:

1. **Modelos indistinguíveis.** Claude/Grok/Mistral/DeepSeek/Kimi empatados
   numa faixa de ~1pt de expectancy (rodada 1 madura: −0.8 a −1.2). Se
   inteligência importasse na tarefa, haveria dispersão. Não há → o gargalo
   é o FORMATO da tarefa, não o cérebro. Input de bot (RSI/MACD/ADX 1h),
   output de bot (bracket a cada 30min) → desempenho de bot.
2. **O único livro positivo é o sem-LLM** (arbiter, aritmética pura). O
   próprio código diz: "a language model adds nothing to arithmetic except
   cost and hallucination". Aplicamos na arbitragem e esquecemos no resto.
3. **Confiança anti-calibrada** (win 32.7% com prob <60 → 0% com 80+): pedimos
   confiança sobre uma análise que não usa nenhuma capacidade real do modelo.

Estrutural: indicador técnico é derivado do preço — informação que todo quant
já arbitrou em milissegundos antes do nosso tick. Não há edge ali pra ninguém.
E o stop ~2% exigido pelo formato intraday vive DENTRO do ruído diário de
cripto (noise-out ≠ tese errada — 92% das mortes da rodada 2 nas primeiras
12h foram stop).

## Princípio

**Bot faz trabalho de bot; IA de fronteira faz trabalho de analista.**
O edge de um LLM está no que bot nenhum lê: narrativa, causalidade, contexto
macro, eventos de calendário, assimetria de informação nova. A pergunta certa
não é "emita um bracket sobre estes osciladores" — é "qual é a TESE, qual
evidência a invalida, e em que horizonte ela paga".

## O agente: ORÁCULO (source `oracle`)

| Dimensão | Bot atual (scanners) | Oráculo |
|----------|---------------------|---------|
| Cadência | timer 30min | **1×/dia** (F2: + wake por evento informacional) |
| Input | indicadores 1h | **contexto**: macro, funding rates, fear&greed, notícias/eventos, estrutura BTC/ETH, indicadores só como pano de fundo |
| Pergunta | "um card por símbolo, cubra o máximo" | "**1-3 teses** da semana, se houver; zero é resposta válida" |
| Horizonte | 72h | **7-14 dias** (168-336h) |
| Stop | ~2% (dentro do ruído) | **fora do ruído**: ≥ max(2×ATR-diário, 4%) — stop de TESE, não de passeio |
| RR | ≥2 | ≥1.5 (alvo de tese com stop largo; o edge é o acerto, não a geometria) |
| Custo | 48 calls/dia/agente | 1-2 calls/dia |

Cada tese emitida vira um card no MESMO schema (`{"cards":[...]}`) e loga em
`zion_suggestions` com `source='oracle'` — resolução, painéis, torneio, paper
wallet e corte automático medem o Oráculo de graça, sem código novo de medição.
O card ganha um campo novo no summary: **"invalida se: <evidência>"** — o
racional auditável fica no ledger.

### Inputs por fase (pragmático: só fonte pública/grátis primeiro)

- **F1 (já disponível hoje):** macro context atual (`getMacroContext`),
  funding rates (Binance público — funding persistente = posicionamento
  lotado), Fear & Greed (alternative.me), estrutura BTC/ETH multi-timeframe
  (já calculada em `htf4h/1d/1w`), calendário econômico manual no prompt
  (FOMC/CPI são datas conhecidas).
- **F2:** headlines de notícias cripto (fonte a definir: CryptoPanic free
  tier / RSS agregado), calendário de unlocks/listings; **wake por evento**:
  o Oráculo acorda quando entra informação nova relevante, não só no cron.
- **F3 (se F1/F2 pagarem):** on-chain flows, posicionamento de derivativos.

### Gates objetivos (as cicatrizes valem pro Oráculo também)

- Entry sanity ±25%, clamp de alvo, RR mínimo — os gates do funil continuam,
  com os parâmetros do perfil de tese (stop largo, horizonte longo).
- Filtro de regime NÃO se aplica no modo tese (uma tese de reversão com
  evidência é exatamente o que o Oráculo existe pra ter — mas ela precisa
  DECLARAR a invalidação; o gate vira: sem "invalida se", sem trade).
- Probability: segue logada, nunca gate (anti-calibrada).
- Orçamento: máx 3 teses abertas simultâneas (escassez tipo sniper).

## Medição honesta (o flywheel julga, como sempre)

- O baseline é o formato bot: os scanners atuais CONTINUAM rodando na rodada 2
  — eles são o grupo de comparação. Matar o baseline antes da prova seria fé,
  não medição.
- Amostra mínima de tese é mais lenta (1-3/dia): julgar com `≥30 decididos`
  (BACKTEST_MIN_SAMPLE próprio, teses são poucas e grandes) e comparar
  expectancy líquida vs melhor scanner e vs radar.
- Sucesso = Oráculo líquido-positivo OU claramente acima do baseline no mesmo
  período. Fracasso = empate ou pior → a hipótese "formato analista" morre
  com honra e barato.

## O que NÃO muda

Arbiter (paga o aluguel) · flywheel/arquivo/corte · ZION user-facing ·
gates de dinheiro real (nada aqui toca ordem real).

## Fases

- 🔴 **F1** — Oráculo diário: prompt de tese + inputs disponíveis (macro,
  funding, F&G, HTF) + gates de perfil tese + cron 1×/dia + painel herda.
- ⏸️ **F2** — feed de notícias/eventos + wake por evento informacional.
- ⏸️ **F3** — decisão: se Oráculo > baseline com amostra, migrar os scanners
  perdedores pro formato analista (cada modelo vira um Oráculo concorrente no
  torneio); se não, manter só como mesa experimental.

## Pendências

- ⏳ Rodada 2 maturar (73 abertas) — o baseline precisa do placar justo.
- 🔴 Implementar F1 (após aprovação deste plano).
- ⏸️ Escolher fonte de notícias da F2 (grátis primeiro).
