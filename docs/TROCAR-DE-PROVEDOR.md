# TROCAR DE PROVEDOR DE IA — Kimi ↔ Anthropic

> **Para quem chega agora:** a plataforma roda hoje no **Kimi** porque o saldo da
> Anthropic acabou em 21/08/2026. A volta é **uma variável de ambiente** — não é
> tarefa de código, não precisa de PR, não precisa de mim.

---

## 1. Para reativar a Anthropic (quando o saldo voltar)

Na **Vercel → Settings → Environment Variables**, marcando **Production**,
**Preview** e **Development**:

| variável | valor |
|---|---|
| `AI_PROVIDER` | `anthropic` |
| `ANTHROPIC_API_KEY` | a chave nova |

Depois **Redeploy**. É isso.

### Para voltar ao Kimi

`AI_PROVIDER=kimi` (ou apagar a variável — o padrão é Kimi) e redeploy.

⚠️ **Não apague a `KIMI_API_KEY` ao trocar.** Deixar as duas chaves no ambiente
é o que torna a troca reversível em trinta segundos. Elas não custam nada
paradas: só a do `AI_PROVIDER` é usada.

---

## 2. Como conferir que pegou

**Na tela:** abrir a gaveta do ZION em `/zion`. O subtítulo mostra o provedor
ativo — `KIMI · TRADING` ou `SONNET 4.6 · TRADING`.

**No painel de saúde:** o indicador de IA passa a pingar o provedor ativo. Se
ficar vermelho com *"auth recusada"*, a chave está errada; se disser *"sem
ANTHROPIC_API_KEY neste ambiente"*, a variável não chegou ao Production.

**No banco:** o campo `model` de `zion_analysis` mostra quem respondeu.

```sql
select metadata->>'model' as modelo, count(*), max(created_at)
from platform_events
where event_type='zion_analysis' and created_at > now() - interval '1 hour'
group by 1;
```

---

## 3. O que muda de verdade ao voltar (além do nome)

### O cache de prompt volta — e ele é a maior diferença

A Anthropic cacheia blocos de sistema: a fundação de ~10K tokens passa a ser
cobrada a **0,1×** no reuso. O caminho compatível-OpenAI não tem isso na forma
que usamos, então hoje cada chamada paga a fundação inteira.

Pela tabela de `src/lib/admin/ai-cost.ts`:

| | entrada | saída |
|---|---|---|
| Kimi | $0,60 /MTok | $2,50 /MTok |
| Sonnet | $3,00 /MTok (**$0,30 em cache**) | $15,00 /MTok |

⚠️ **É conta de tabela, não de fatura.** Nunca houve tráfego de usuário
suficiente para medir — em 22/08 o `zion_analysis` com `source: "user"` ainda
era quase vazio. Quando houver, a consulta acima responde de verdade.

### O `anthropicStream` cacheia por BLOCO, e a ordem é a economia

`src/lib/ai/provider.ts` manda fundação e modo como blocos separados, cada um
com `cache_control`. O último bloco (idioma) **não** é cacheado de propósito —
ele varia por requisição, e cachear o que muda desperdiça a escrita de cache.

---

## 4. Onde isso vive no código

| arquivo | papel |
|---|---|
| `src/lib/ai/ativo.ts` | **o seletor.** Lê `AI_PROVIDER` e devolve chave, modelo, baseUrl, timeout |
| `src/lib/ai/provider.ts` | os quatro caminhos: `anthropicChat`, `anthropicStream`, `openaiCompatChat`, `openaiCompatStream` |
| `src/app/api/zion/route.ts` | ZION (streaming) |
| `src/app/api/narratives/route.ts` | agrupamento de narrativas |
| `src/lib/autopilot/scan.ts` | scan CEX do autopilot |
| `src/lib/admin/health.ts` | o monitor — pinga o provedor ATIVO |

Rotas que sobrepõem o modelo sem trocar de provedor: `ZION_MODEL`,
`NARRATIVES_MODEL`, `KIMI_MODEL`, `ANTHROPIC_MODEL`.

---

## 5. Três decisões que parecem detalhe e não são

**Não existe fallback entre provedores.** Se `AI_PROVIDER=anthropic` e a chave
não está lá, a rota **recusa** dizendo qual variável falta — não cai para o
Kimi. Cair em silêncio faria a plataforma gastar na conta errada sem ninguém
pedir, e *"por que a fatura da Kimi subiu?"* é pergunta que ninguém responde
três semanas depois.

**O padrão é Kimi.** Um padrão `anthropic` quebraria qualquer ambiente novo onde
ninguém definiu a variável — e quebrar por FALTA de configuração é o pior modo
de falha, porque parece bug.

**O `extraBody` do Kimi não é opcional.** O `kimi-k2.6` amarra a temperatura ao
modo de raciocínio: thinking-ON exige `1`, thinking-OFF exige `0.6`, e mandar o
par errado devolve **400 em toda chamada**. Foi o que derrubou o ZION em 21/08 —
a temperatura foi passada, o campo que desliga o thinking não. O seletor os
entrega juntos e há teste exigindo isso.

---

## 6. ⚠️ O que a página de preços ainda promete

Estas continuam vendendo Anthropic, e **de propósito** — a troca é temporária:

| plano | promete |
|---|---|
| Pro / Trader | "Sonnet 4.6" |
| **Pilot (30 SOL)** | **"Claude Opus 4.8"** |

Enquanto durar o Kimi, quem assina recebe outro modelo. Se o intervalo for de
dias, é ruído. **Se for semanas com gente comprando, isso precisa de um aviso na
vitrine** — não porque o produto piore, mas porque a página descreve o que não
está entregando.

Ao reativar a Anthropic, isso se resolve sozinho.

---

## 7. Um defeito conhecido, ainda aberto

**A cota é debitada ANTES da análise rodar.** Em `src/app/api/zion/route.ts`, o
`consumeAnalysisQuota` corre antes da chamada ao modelo — então uma análise que
falha (400, timeout, provedor fora) **consome a cota do dia e não devolve**.

Aconteceu em 21/08: as chamadas que deram 400 queimaram 7 das 5 análises diárias
do dono, e o contador teve de ser zerado à mão em `rate_limits`.

O código já reconhece o princípio para o outro caso — *"cobrar uma análise de
quem levou 402 seria cobrar pelo 'não'"* — mas cobre só a recusa de plano, não a
falha da própria análise. **Isso morde cliente pagante**: no Pilot de 30 SOL,
uma sequência de erros do provedor consome o pacote sem entregar nada.
