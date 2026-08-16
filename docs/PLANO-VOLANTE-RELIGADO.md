# PLANO — religar o volante de aprendizado

**Status: 🟡 em execução** · aberto 16/08 por ordem do dono ("faz o A primeiro,
religa as lições pra todas as mesas").

---

## O que se descobriu, e como

A conversa começou com o dono discordando de mim. Eu tinha lido o `+7,04%` da
GERI como "amostra pequena, ruído", e ele respondeu que aquilo era um agente
**aprendendo a esperar** — que antes fazia muitas entradas e agora fazia uma, na
hora certa, e que uma IA deveria ter cogitado isso.

Fui medir. Ele estava certo:

| semana | cards por tick | confiança declarada | acerto | bruto |
|---|---|---|---|---|
| 06/07 | 3,91 | 58,3 | 33,3% | −0,189% |
| 13/07 | 4,00 | 59,7 | 16,1% | −1,322% |
| 20/07 | 1,43 | 63,6 | 41,0% | +0,112% |
| 27/07 | 1,29 | 64,3 | 0,0% | −1,771% |
| 10/08 | 1,00 | 65,0 | 100% | +7,04% |

Cards por tick caiu 4× e a confiança subiu monotonicamente. Não é estrangulamento
nosso: estrangular corta o número de *ticks*, não o número de cards **dentro** do
tick. Agregado: 636 decididos a −0,524% antes de 20/07; 56 decididos a −0,302%
depois. O mecanismo está escrito em `agent_lessons`, em 27/07, pela própria GERI:

> *"Counter-trend BUY entries in TRANSITIONING regimes consistently stopped out —
> require at least one higher-high or confirmed reversal structure before entering."*

Três de três lições mandam esperar, exigir estrutura, ou não entrar. O trade de
14/08 que deu +7,04% é um `sell_safe` — o que a lição dele mandou priorizar.

**A ressalva que sobrevive:** −0,302% continua negativo, e com 0,4% de ida e volta
as duas eras perdem. Ele aprendeu a errar menos; ainda não provou que aprendeu a
ganhar. Com 56 decididos, os 0,22 ponto não separam aprendizado de sorte.

Ao procurar a causa, veio o que importa de verdade:

```
kimi_scan      última lição 27/07    20 dias parado
mistral_scan   última lição 27/07    20 dias parado
grok_scan      última lição 27/07    20 dias parado
self_scan      última lição 27/07    20 dias parado
radar          última lição 25/07    22 dias parado
deepseek_scan  última lição 25/07    22 dias parado
sniper         última lição 25/07    22 dias parado
```

**Zero lições novas em todo o sistema há 20 dias.** E as cinco mesas de estratégia
que estão rodando *agora* — VÖLUNDR, SKAÐI, URÐR, MÍMIR, FREYJA — nunca tiveram
uma única lição. Nasceram sem o mecanismo.

O único agente que demonstrou aprender foi arquivado quando começou a aprender, e
o motor que o fez aprender está parado.

---

## Por que parou — a causa, provada

`runRetroSweep` **está** ligado no cron de 30min (`api/zion/backtest`, linha 266).
Não é fiação. São dois defeitos independentes.

### Defeito 1 — o marco absoluto contra uma população que zera

```ts
export function shouldRetro(decidedNow, decidedAtLastRetro, everyN = 10) {
  return decidedNow - (decidedAtLastRetro ?? 0) >= everyN;
}
```

O `decidedNow` conta decididos **da rodada viva** (`archived_at is null`). O
`decidedAtLastRetro` é o `decided_count` gravado na última reflexão — anotado
quando a rodada anterior ainda estava viva.

Arquivar a rodada zerou o numerador e deixou o marco lá em cima:

| mesa | marco gravado | decididos vivos hoje | `shouldRetro` |
|---|---|---|---|
| radar | 23 | 5 | `5−23 = −18 ≥ 10` → **false** |
| mistral_scan | 60 | 1 | **false** |
| kimi_scan | 54 | 3 | **false** |
| grok_scan | 51 | 1 | **false** |
| self_scan | 39 | 0 | **false** |

Não é "ainda não chegou a hora". É **nunca mais**: o radar precisaria de 33
decididos na rodada viva para alcançar um marco que descreve trades que já foram
arquivados. Um contador absoluto medido contra uma população que outra parte do
sistema esvazia não tem como voltar a disparar.

### Defeito 2 — `brainFor()` devolve `null` para MÍMIR

```ts
if (source === "hybrid_scan")            return ceo
if (source.startsWith("oracle_"))        return …
if (source.endsWith("_scan"))            return …
if (source === "sniper" || "radar")      return hybridBrain()
return null;                             // ← strat_ai cai aqui
```

`strat_ai` (MÍMIR) tem `brain: "llm"`, decide com `roleProviderChain("brain")` e
tem prompt próprio — é a única mesa mecânica-com-cérebro do laboratório, e é
filtrada fora da varredura na linha 176. Nunca teve uma lição.

E o outro lado também falta: `strategist-ai.ts` **não injeta** `lessonsBlock`. Se
a lição fosse gerada hoje, ninguém a leria. Os dois lados precisam ser ligados, ou
é a invariante nº 25 de novo — um controle que nenhum importador chama.

---

## O que "todas as mesas" quer dizer, honestamente

O dono pediu para religar as lições **para todas as mesas**. Sete delas não têm
onde a lição pousar, e é preciso dizer isso em vez de fabricar texto:

| mesa | cérebro | canal de aprendizado |
|---|---|---|
| GERI, MUNINN, SLEIPNIR, HUGINN, FREKI, TÝR, ODIN, VÖLVA×5 | `llm` | **lição** (`agent_lessons` → prompt) |
| HEIMDALL (radar), VEÐRFÖLNIR (sniper) | `llm` | **lição** |
| **MÍMIR** (`strat_ai`) | `llm` | **lição** — faltando, entra agora |
| URÐR (`strat_record`) | `none` | **registro medido** (`loadPlaybookRecord` + `loadHistory`) — já existe |
| VÖLUNDR (`strat_mech`) | `none` | **nenhum, de propósito** — é o grupo de controle |
| SKAÐI, FREYJA, ULLR | `none` | nenhum |
| RATATOSKR, JÖRMUNGANDR, NÍÐHÖGGR, FÁFNIR | `none` | nenhum (market-neutral, spread) |

Uma lição é texto injetado num prompt. `selectPlaybook` é código determinístico:
não há prompt, e gerar lição para ele produziria texto que ninguém lê — a
invariante nº 25 outra vez, agora de propósito.

**O que essas mesas ganham em vez disso:** o canal delas passa a ser DECLARADO e
VISÍVEL. VÖLUNDR não aprender é uma decisão experimental (sem controle não se mede
o valor do filtro); hoje isso vive num comentário e não na tela. A diferença entre
"não aprende porque decidimos" e "não aprende porque quebrou" é a diferença entre
um experimento e um defeito, e não dá para ver nenhuma das duas hoje.

---

## O trabalho

### A1 — trocar o marco absoluto por decididos NÃO REFLETIDOS 🟡
O gatilho passa a contar trades **resolvidos depois da última reflexão**, e não um
total contra um total. Imune a arquivamento, a re-escopo e a qualquer coisa que
mexa no tamanho da população. `decided_count` continua sendo gravado (auditoria),
mas deixa de ser o gatilho.

### A2 — MÍMIR reflete e lê 🟡
`brainFor("strat_ai")` → o assento `brain` (o mesmo que decide reflete sobre o que
decidiu, como no resto do módulo). E `strategist-ai.ts` injeta `lessonsBlock`.

### A3 — o silêncio passa a ser visível 🟡
O volante morreu em 27/07 e nada avisou por 20 dias. Módulo puro + rota + painel
com, por mesa: canal declarado, quando aprendeu pela última vez, quantos decididos
esperam reflexão, e se travou. Um motor de aprendizado sem mostrador é um motor que
volta a morrer em silêncio.

---

## O que este plano NÃO faz

- **Não desarquiva a GERI.** Religar o volante é diferente de repor a mesa em
  operação, e a segunda decisão é do dono.
- **Não fabrica lição para mesa mecânica.**
- **Não mexe na pilha das 24 mesas** — é o item (B), separado, ainda não pedido.
- **Não conserta as duas convenções de custo** (0,2% por perna vs ida-e-volta),
  que continua aberto.
