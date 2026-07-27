# Relatório técnico — 27/07/2026

**Escopo:** commits `bff4e0d..b07826b` (7 PRs: #151-#157) + PR #158 (docs).
**Volume:** 18 arquivos · **+347 / −90** linhas · 120 testes (era 119) ·
`tsc --noEmit` limpo · ESLint 0 erros (3 warnings pré-existentes de
react-hooks, intocados).

| Commit | Hora UTC | Assunto |
|---|---|---|
| `bff4e0d` | 09:15 | piso de stop nos scanners + lições sem truncar |
| `669c894` | 10:37 | janela de tempo nos painéis |
| `472c99f` | 17:40 | cache nunca lido + tokens de raciocínio |
| `fd97c31` | 17:53 | aposentar Agente A + Agente B sem Anthropic |
| `c199653` | 18:04 | aposentar `oracle_self` |
| `7b463d9` | 18:11 | cooldown do Oráculo desk-wide |
| `b07826b` | 18:14 | radar isento do piso (controle puro) |

---

# PARTE I — DEFEITOS: causa-raiz, evidência e correção

## D1 · Piso de stop ausente nos scanners

**Sintoma.** Stop médio dos scanners *encolheu* entre coortes: 2,02% → 1,72%,
com RR médio subindo 2,11 → 2,58.

**Causa-raiz.** O gate `reward/risk >= MIN_RR` (2) pode ser satisfeito de duas
formas: afastando o ALVO ou aproximando o STOP. Aproximar o stop é sempre mais
"fácil" para o modelo, e um stop dentro da banda de ruído do ativo morre por
oscilação, não por tese errada. A correção de 25/07 (`stopFloorGate`) só foi
aplicada ao Sniper (`sniper.ts`), não ao funil compartilhado.

**Evidência.** Auto-Retro do próprio `self_scan`:
> *"Tight stops in TRENDING_DOWN SELLs (under 1%) are getting clipped almost
> instantly (DOGE 0.4%, SOL 0.8%, BNB 0.3%, XRP 0.7% all stopped in under 7h)"*

**Correção** — `src/lib/zion/backtest.ts`

Constantes novas (L431-432):
```ts
const MIN_STOP_ATR = Number(process.env.BACKTEST_MIN_STOP_ATR ?? 1.5); // × 1h ATR%
const MIN_STOP_PCT = Number(process.env.BACKTEST_MIN_STOP_PCT ?? 1.2);
```

`ExtractOpts` — ANTES (linha única):
```ts
export interface ExtractOpts { minRR?: number; regimeFilter?: boolean; minStopPct?: number }
```
DEPOIS (L448-454):
```ts
export interface ExtractOpts {
  minRR?: number; regimeFilter?: boolean; minStopPct?: number;
  atrPctBySymbol?: Map<string, number>; minStopAtr?: number;
  stopFloor?: boolean;   // ver D6
}
```

Gate novo em `extractSuggestion` (L537-544), inserido ANTES do gate de
geometria — a ordem importa: rejeitamos por stop-de-ruído antes de avaliar RR:
```ts
if ((opts?.stopFloor ?? true) && entry && entry > 0 && stop) {
  const atrPct = opts?.atrPctBySymbol?.get(base);
  const floor = Math.max(
    atrPct != null && atrPct > 0 ? atrPct * (opts?.minStopAtr ?? MIN_STOP_ATR) : 0,
    opts?.minStopPct ?? MIN_STOP_PCT,
  );
  if ((Math.abs(entry - stop) / entry) * 100 < floor) return null;
}
```

`logSuggestions` passou a extrair ATR dos indicadores (L568-574):
```ts
+ const atrBy = new Map<string, number>();
  for (const ind of indicators) { ...
+   if (ind.atrPct != null && ind.atrPct > 0) atrBy.set(sym, ind.atrPct);
  }
```

Prompt (`buildScanInstruction`, L94-97) — o modelo é avisado do gate para não
desperdiçar cards:
```
STOP FLOOR — the stop must sit at least max(1.5×ATR, 1.2%) from entry.
Build the RR ratio by choosing the TARGET, never by tightening the stop.
```

`sniper.ts` L143 — passou a alimentar o mesmo mapa (antes o Sniper tinha
gate próprio isolado):
```diff
- const s = extractSuggestion(card, refBy, regimeBy);
+ const s = extractSuggestion(card, refBy, regimeBy, { atrPctBySymbol: atrBy });
```

**Semântica preservada:** o piso só age quando o card TEM stop. Chamada
direcional sem bracket continua passando (resolve no horizonte).

**Testes** (`backtest.test.ts`, +2): rejeita stop de 1,5% com ATR 1,4%
(piso 2,1%); aceita stop de 2,5% com alvo que mantém RR≥2; piso plano de
1,2% quando não há leitura de ATR.

---

## D2 · Lições da Auto-Retro truncadas na parte acionável

**Sintoma.** Lições terminando no meio da prescrição:
`"...until a higher-conviction filter is a"`, `"...require a s"`,
`"...my tight-stop short entries are being "`.

**Causa-raiz.** `MAX_LESSON_CHARS = 220` (constante que eu escolhi em 25/07
sem dados). O formato que os modelos produzem é *diagnóstico + receita*, e o
corte caía sistematicamente na receita — a metade que muda comportamento.

**Correção** — `src/lib/zion/retro.ts` L28-32:
```diff
- const MAX_LESSON_CHARS = 220;
+ const MAX_LESSON_CHARS = Number(process.env.RETRO_LESSON_CHARS ?? 400);
```
**Teste** atualizado para cravar 400 **e** verificar que uma lição real da
rodada de 26/07 (205 chars) sobrevive intacta — teste de regressão contra o
dado que expôs o bug, não contra um sintético.

---

## D3 · Painéis achatavam eras de configuração

**Sintoma.** `Mistral: −0,23%` no torneio quando a era recente dele era
`+0,12%`. Uma correção que funcionava era matematicamente invisível.

**Causa-raiz.** As duas rotas agregavam TODA a rodada viva sem recorte
temporal. A rodada viva acumula eras (pré-auditoria, coorte de FDS,
pós-piso-de-stop) e a média vitalícia dilui a era nova na antiga.

**Decisão de design.** Cortar por `created_at`, **não** `resolved_at`: um card
pertence à configuração que o **produziu**. Um card criado sob a config antiga
que resolve hoje é dado da era antiga.

**Correção** — `src/app/admin/api/backtest/route.ts` L36-38 (idem em
`tournament/route.ts`):
```ts
const rawDays = Number(req.nextUrl.searchParams.get("days") ?? "");
const days = Number.isFinite(rawDays) && rawDays > 0 && rawDays <= 3650 ? rawDays : null;
const since = days ? new Date(Date.now() - days * 86_400_000).toISOString() : null;
```
Aplicado à query paginada (L48) e à lista recente (L56). No torneio, os
ciclos das mesas são cortados por `closed_at` (abrem e fecham no mesmo tick).

`tournament/route.ts` mudou de assinatura para acessar a query string:
```diff
- export async function GET(): Promise<NextResponse> {
+ export async function GET(req: NextRequest): Promise<NextResponse> {
```

Painéis: fileira `24H · 7D · 30D · TUDO`, padrão **7D**, com o rótulo
"por data do CARD (a config que o gerou)".

**Invariante preservada:** a janela é **só de exibição**. `runTournamentCull`
segue julgando a rodada viva inteira — uma visão de 24H não pode executar um
agente.

---

## D4 · Cache pago e nunca lido

**Sintoma.** Fatura Anthropic de julho: **$25,07**.

**Causa-raiz.** `cacheSystem: true` em 3 caminhos de cron. O TTL padrão do
prompt caching da Anthropic é **5 minutos**; o cron de backtest roda a cada
**30 minutos** e o Oráculo **1×/dia**. Toda escrita expirava antes de qualquer
leitura — pagávamos o prêmio de escrita (1,25× input) e capturávamos ~0% do
desconto de leitura (0,1× input).

**Evidência** (CSV oficial, agregado):
```
cache-WRITE : 2.389.090 tokens
cache-READ  :     9.432 tokens   → 0,39% de aproveitamento
```
Decomposição da fatura:

| Modelo | input | cache-WRITE | cache-READ | output | total |
|---|---:|---:|---:|---:|---:|
| sonnet-4-6 | $2,85 | **$5,09** | $0,003 | $3,52 | $11,46 |
| opus-4-8 | $3,99 | **$6,45** | $0,000 | $3,16 | $13,60 |

**Por que 1h TTL também não resolveria:** escrita a 2× input + uma leitura a
0,1× ≈ 1,05×/chamada no nosso ritmo, ainda pior que input puro (1,0×).

**Correção** — remoção de `cacheSystem` em 3 chamadas:
`backtest.ts` L197 (Agente A), `backtest.ts` L385 (CEO), `oracle.ts` (oráculo).

---

## D5 · Tokens de raciocínio fora da contabilidade

**Sintoma.** Console xAI: `Reasoning text tokens 359,2K = $0,90` contra
`Completion text tokens 140K = $0,35`.

**Causa-raiz.** `openaiCompatChat` lia apenas `completion_tokens`. Provedores
com raciocínio faturam o traço interno em linha separada → **72% do custo de
saída do Grok** nunca chegava ao FINANCE.

**Correção** — `src/lib/ai/provider.ts` L118-137:
```diff
- usage?: { prompt_tokens?: number; completion_tokens?: number };
+ usage?: {
+   prompt_tokens?: number; completion_tokens?: number;
+   completion_tokens_details?: { reasoning_tokens?: number };
+ };
...
- outTokens: data.usage?.completion_tokens ?? 0,
+ outTokens: (data.usage?.completion_tokens ?? 0)
+   + (data.usage?.completion_tokens_details?.reasoning_tokens ?? 0),
```

**Correção de reporte (minha).** Eu afirmei que o painel FINANCE subestimava
custos. **Falso**: `estimateCost` (`ai-cost.ts` L57-65) sempre multiplicou
`cacheWriteTokens × p.cacheWrite5m`. Quem ignorou a coluna foi a **minha
consulta SQL ad-hoc**, e foi por isso que classifiquei o Mistral (tier
gratuito, custo $0) como nosso agente mais caro. `ai-cost.ts` recebeu comentário
registrando que a linha do Mistral é a tarifa que *valeria* com pay-as-you-go.

---

## D6 · Cooldown do Oráculo era por modelo (buraco do ARB)

**Sintoma.** Oráculo em **0W/6L**; **5 das 6 derrotas eram ARB comprado**, por
3 modelos distintos.

| source | símbolo | regime | resultado | criada |
|---|---|---|---:|---|
| oracle_deepseek | ARB | RANGING | −5,4% | 17/07 |
| oracle_mistral | ARB | RANGING | −5,4% | 17/07 |
| oracle_mistral | ARB | RANGING | −5,5% | 18/07 |
| oracle_deepseek | ARB | RANGING | −6,6% | 18/07 |
| oracle_kimi | ARB | TRENDING_DOWN | −4,5% | **25/07** |
| oracle_deepseek | ADA | TRENDING_UP | −4,5% | 26/07 |

**Causa-raiz.** O cooldown de 25/07 indexava por `source`. O Kimi entrou em ARB
no dia 25 — dois dias após DeepSeek e Mistral serem stopados lá — porque o
*Kimi* nunca tinha sido stopado em ARB. A trava funcionou como especificada; a
especificação é que estava errada: **um stop é evidência sobre o SÍMBOLO**, não
sobre o analista.

**Correção** — `src/lib/zion/oracle.ts`:
```diff
- const cooldownBy = new Map<string, Set<string>>();   // por source
+ const deskCooldown = new Set<string>();              // da mesa (L164)
...
-     if (r.status === "hit_stop") {
-       (cooldownBy.get(r.source) ?? cooldownBy.set(r.source, new Set()).get(r.source)!).add(r.symbol);
-     }
+     if (r.status === "hit_stop") deskCooldown.add(r.symbol);   // L176
...
-     if (!symbolAllowed(s.symbol, { cooldown, ownOpen, ... }))
+     if (!symbolAllowed(s.symbol, { cooldown: deskCooldown, ownOpen, ... }))  // L231
```
O bloco de memória do prompt passou a explicitar a regra (L180-190) em vez de
deixar o modelo descobrir por cards sumindo em silêncio.

**Preservado:** a memória continua **por modelo** (é o que torna a reflexão
pessoal); só a TRAVA virou coletiva. `symbolAllowed` manteve a assinatura —
o teste existente cobre a nova semântica com comentário atualizado.

---

## D7 · Grupo de controle contaminado

**Sintoma (encontrado em auditoria própria, antes de religar).** O radar loga
via `logSuggestions`, o mesmo funil dos agentes tratados — logo recebeu o piso
de stop de D1.

**Por que é grave.** O radar é a única régua não-tratada do sistema; foi ele
que provou que o colapso de 17/07 e o rali de 26/07 eram **regime, não
competência**. Um controle tratado transforma o experimento da semana em
"antes vs depois", exatamente o desenho que já nos enganou duas vezes.

**Correção** — `backtest.ts` L575-583:
```ts
const isControl = source === "radar";
const rows = cards
  .map((c) => extractSuggestion(c, refBy, regimeBy,
      isControl ? { stopFloor: false } : { atrPctBySymbol: atrBy }))
```
com comentário de 7 linhas explicando o porquê e a instrução explícita
*"Do not 'fix' this to make the radar look better"* — porque vai parecer bug.

**Escopo da isenção:** apenas o piso. O radar segue passando por sanidade de
escala (±25%), geometria, RR mínimo, clamp de alvo e filtro de regime.
**Teste** (+1): controle isento aceita stop de 1%, mas card com RR 0,33
continua rejeitado.

---

# PARTE II — MUDANÇAS ARQUITETURAIS (não são bugs)

## A1 · Agente A aposentado

**Justificativa:** medido dentro de ~1pt dos cérebros grátis, sendo a maior
linha recorrente da fatura.

- `app/api/zion/backtest/route.ts`: estágio removido do `Promise.all`.
  ANTES: `const [claudeCards, hybridCards, ...providerCards]` com
  `runBacktestScan(marketData)` na primeira posição e
  `logSuggestions(claudeCards, ..., "self_scan")`.
  DEPOIS: `const [hybridCards, ...providerCards]` — sem o estágio.
- `cull.ts` L30: `self_scan` removido de `CULL_SOURCES` (não roda, não pode
  ser cortado).
- `runBacktestScan` mantida como **código morto documentado** — o ledger ainda
  carrega histórico `self_scan`.
- Painéis: rótulo `Agent A · ZION (aposentado)` com `kind: "retired"` (cor
  `--adm-ink-4`) e `A·ZION†` no filtro do Backtest.

## A2 · Agente B reconstruído sem Anthropic

`registry.ts` L108-127 — papel `ceo` criado e cadeias reordenadas:
```diff
- export type HybridRole = "brain" | "macro" | "sentiment";
+ export type HybridRole = "brain" | "macro" | "sentiment" | "ceo";
  const ROLE_PREFERENCE: Record<HybridRole, string[]> = {
-   brain:     ["deepseek", "mistral"],
-   macro:     ["kimi", "deepseek"],
+   brain:     ["mistral", "kimi"],
+   macro:     ["kimi", "mistral"],
    sentiment: ["grok", "mistral"],
+   ceo:       ["deepseek", "kimi", "mistral"],
  };
```

**Decisão:** `brain` saiu de DeepSeek para Mistral **de propósito** — se o
DeepSeek assina E rascunha, o CEO revisa o próprio texto (carimbo, não segunda
opinião). Bônus: Mistral é o tier gratuito.

`backtest.ts` `runHybridScan` — guarda e gate (L340-345):
```diff
- if (process.env.HYBRID_B_ENABLED !== "true") return [];
- const anthropicKey = process.env.ANTHROPIC_API_KEY;
- const brain = roleProvider("brain");
- if (!anthropicKey || !brain?.apiKey) return [];
+ if ((process.env.HYBRID_B_ENABLED ?? "true") === "false") return [];
+ const brain = roleProvider("brain");
+ const ceo = roleProvider("ceo");
+ if (!brain?.apiKey || !ceo?.apiKey) return [];
```
*(o gate existia para proteger crédito de Opus; sem assento caro, o padrão
inverte para ligado)*

Assento de CEO (L380-398) — de `anthropicChat` com 2 modelos Anthropic para
`openaiCompatChat` com fallback entre provedores, agora **respeitando o
circuit breaker** (que a versão Anthropic não fazia):
```diff
- const primaryModel  = process.env.HYBRID_ORCH_MODEL ?? "claude-opus-4-8";
- const fallbackModel = process.env.HYBRID_ORCH_FALLBACK_MODEL ?? modelChain()[0];
- for (const [model, role] of [[primaryModel, "hybrid_ceo"], [fallbackModel, "hybrid_ceo_fallback"]]) {
-   const o = await anthropicChat({ model, ... }, anthropicKey);
+ const ceoFallback = configuredProviders().find((p) => p.id !== ceo.id && p.id !== brain.id) ?? null;
+ for (const [provider, role] of [[ceo, "hybrid_ceo"], [ceoFallback, "hybrid_ceo_fallback"]]) {
+   if (!provider?.apiKey) continue;
+   if (await isTripped(provider.id)) continue;
+   const o = await openaiCompatChat({ model: provider.model, ... }, { apiKey, baseUrl });
+   await recordResult(provider.id, provider.label, true);
```
Erros agora chamam `recordResult(false)` + `logError` (antes: `catch {}` mudo).

`retro.ts` L138-143 — a reflexão do `hybrid_scan` segue o assento:
```ts
if (source === "hybrid_scan") {
  const ceo = roleProvider("ceo");
  return ceo ? { kind: "compat", providerId: ceo.id } : null;
}
```

## A3 · `oracle_self` aposentado

Bloco `if (claudeKey) { runs.push({ source: "oracle_self", ... }) }` removido
de `oracle.ts`. Imports `anthropicChat`, `modelChain` e `SCAN_CARDS_SCHEMA`
ficaram órfãos e foram removidos. Resultado: **zero Anthropic no flywheel**.
As 3 teses abertas continuam resolvendo (a resolução independe de source).

---

# PARTE III — MEDIÇÕES

## Coorte 09:01 — veredito do fim de semana

Query de confundidor (a que mudou a conclusão):
```sql
SELECT CASE WHEN created_at >= '2026-07-25T15:40:00Z' THEN 'FDS' ELSE 'pre' END AS coorte, side,
  COUNT(*) FILTER (WHERE status='hit_target') AS w,
  COUNT(*) FILTER (WHERE status='hit_stop') AS l
FROM zion_suggestions WHERE archived_at IS NULL AND source LIKE '%_scan'
GROUP BY 1,2;
```
| Coorte | buy | sell |
|---|---:|---:|
| pré | 26% (6W/17L) | 7% (6W/76L) |
| FDS | **77%** (23W/7L) | **4%** (1W/27L) |

Compra 77% / venda 4% = assinatura de rali. **Veredito: sem mérito.**
Geometria confirmou o vício: stop médio 2,02% → 1,72%, RR 2,11 → 2,58,
tempo até stop 18,9h → 11,5h.

## Coorte 18:01 — completa

| Agente | W/L/E | Líq. | Stop médio |
|---|---|---:|---:|
| Sniper | 6/6/0 | −0,02% | 1,80% |
| Mistral | 19/31/5 | −0,09% | 1,50% |
| Radar (controle) | 11/14/6 | −0,36% | 2,67% |
| self_scan † | 7/28/7 | −0,53% | 1,99% |
| Kimi | 7/39/9 | −0,87% | 1,93% |
| Grok | 6/32/2 | −0,98% | 1,98% |
| hybrid_scan | 1/3/0 | −1,46% | 1,64% |
| DeepSeek | 2/17/3 | −1,47% | 2,19% |
| Oráculos (3) | 0/6/0 | −4,6 a −5,7 | 4,4-5,5% |

Mesas: **Arbiter** +$58,95 (+5,90%, 420 ciclos, 0 perdas, 40 ciclos/24h) ·
**Arbiter 2.0** +$23,75 (+7,92% sobre $300, 140 ciclos, 0 perdas, 20/24h).

## Custo — reconciliação

| Provedor | Julho | Fonte |
|---|---:|---|
| Anthropic | **$25,07** | CSV oficial (bate com o console) |
| xAI | $3,50 | console (26% = raciocínio) |
| Kimi | ~$1,50 | console |
| DeepSeek | $0,74 | console (1.153 req) |
| Mistral | **$0** | tier gratuito, 19% da cota |

Custo/dia Anthropic: **11-13/07 = $5,56 / $5,97 / $6,01** (Agente B com Opus)
· **18-24/07 = $0,04** (pausado) · **26/07 = $1,64** (FDS).
Três dias de Opus = **$17,50 = 70% da fatura do mês**.

---

# PARTE IV — ESTADO OPERACIONAL

**`admin_kv` alterado hoje:**
| Chave | 09:10 | 18:20 |
|---|---|---|
| `pause_agent_a` | true | true (estágio removido do código) |
| `pause_agent_b` | true | **false** |
| `pause_tournament` | true | **false** |
| demais gates | false | false |

Nenhuma migration hoje. Nenhuma chave `culled:*` ativa.

**Env novas/alteradas:** `BACKTEST_MIN_STOP_ATR` (1.5) ·
`BACKTEST_MIN_STOP_PCT` (1.2) · `RETRO_LESSON_CHARS` (400) · `HYBRID_CEO` ·
`HYBRID_BRAIN` · `HYBRID_B_ENABLED` (padrão invertido para ON) ·
`HYBRID_ORCH_MODEL`/`HYBRID_ORCH_FALLBACK_MODEL` **obsoletas**.

**Cobertura de testes adicionada:** 4 casos novos —
piso de stop com ATR · piso plano sem ATR · isenção do controle ·
truncamento de lição em 400 com regressão sobre lição real.

**Critério pré-registrado da semana:** sucesso = coorte tratada supera a
não-tratada em **diff-in-diff contra o radar**, com stop médio subindo de
1,72% para ~2,5%+. Fracasso = menos cards sem ganho relativo.
