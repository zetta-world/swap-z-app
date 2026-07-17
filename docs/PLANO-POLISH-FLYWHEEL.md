# Polish do flywheel — por que Grok e Claude perdem (11/07)

> Gatilho: 3 agentes cruzaram 100 decididos → análise autorizada. CEO pediu
> polir o Grok (não cortar) e investigar o prompt do Claude. Status vivo.

## Diagnóstico (dados no nível da sugestão, ≥100 decididos)

**A descoberta central: COMPRA ganha, VENDA perde — em TODOS os agentes.**

| Agente | buy dec / win% | sell dec / win% | Exp. líq. |
|--------|---------------:|----------------:|----------:|
| Mistral 🥇 | 64 / **92%** | 73 / **0%** | **+0.58%** |
| Grok | 37 / 81% | **125 / 2.4%** | −0.69% |
| Claude | 52 / 67% | **143 / 8.4%** | −0.93% |

Leitura:
1. **Todo short perde (0-8% win)** — o mercado subiu nessa janela; shorts são
   stopados. É **regime**, não bug (a resolução de sell está correta).
2. **A diferença é o VOLUME de shorts.** Mistral é ~equilibrado (64/73) e vive
   das compras excelentes; **Grok (125 sells) e Claude (143 sells) se afogam em
   shorts perdedores.** Esse é o "porquê" de perderem.
3. **Grok tem números corrompidos:** alvo médio de compra = **505%** de distância
   (RR 440) — ~7 cards com alvo astronômico que passavam pelo gating (o gate de
   escala validava só o ENTRY, não o alvo).

## Causa raiz no prompt (`buildScanInstruction`, só backtest — NÃO afeta ZION ao vivo)
- Força "um card por símbolo" + "cubra o máximo" → empurra direção mesmo sem
  edge. Com viés de baixa do modelo → fábrica de shorts contra a tendência.
- Nenhuma disciplina de tendência explícita.

## Cirurgia aplicada (experimento — o flywheel vai julgar)

| Fix | O quê | Overfit? |
|-----|-------|----------|
| **Bracket clamp** (`extractSuggestion`) | rejeita alvo >30% de distância (`BACKTEST_MAX_TARGET_PCT`). Mata o lixo do Grok. | ❌ pura qualidade de dado |
| **Disciplina de tendência** (prompt) | card A FAVOR da tendência é alta-prob; CONTRA a tendência exige evidência de reversão explícita; não emitir contra-tendência só por cobertura. **Simétrico** (favorece short em baixa tanto quanto long em alta). | ❌ trend-respect, não viés de compra |
| **Realismo de bracket** (prompt) | alvo dentro de ~15% do entry, nunca múltiplo do preço. | ❌ |

**Por que não é overfit "só comprar":** a regra é simétrica por regime — numa
janela de baixa ela favoreceria shorts. É disciplina de seguir tendência, não
viés direcional. E ajuda TODOS (até o Mistral, cujos 73 sells dão 0% — menos
shorts ruins = melhor pra ele também).

## Como medir (honesto)
As linhas históricas ficam; as NOVAS (após o deploy de 11/07) refletem o prompt
novo. Comparar a coorte nova (buy/sell split + win% por lado + exp. líquida) vs
a antiga quando cada agente somar ~50-100 decididos pós-deploy. Se o volume de
shorts contra-tendência cair e a exp. líquida de Grok/Claude subir sem derrubar
o Mistral → cirurgia validada. Se não → reverter (é só o prompt do backtest).

## Medição da coorte (17/07 — 🟡 confundida pelo regime, mas mecânica validada)

**O regime VIROU no meio do experimento** (bull → bear após ~11/07): no radar
(grupo de CONTROLE, prompt intocado) buy win caiu 67%→25% e sell win subiu
14%→46%. Logo, before/after cru não mede a cirurgia — mede o mercado.

Coorte nova (≥300 decididos/agente; corte 11/07 17:15 UTC):

| Agente | buy dec/win (old→new) | sell dec/win (old→new) | Exp. líq. (old→new) |
|--------|----------------------|------------------------|--------------------:|
| Grok | 176/46% → 135/6% | 179/**4%** → 320/**35%** | −0.59 → −0.79 |
| Mistral | 156/53% → 105/21% | 118/9% → 242/26% | +0.08 → −0.95 |
| Claude (self) | 133/46% → 113/23% | 217/18% → 279/29% | −0.67 → −1.00 |
| radar (controle) | 66/67% → 59/25% | 14/14% → 24/46% | **+2.13 → −1.54** |

Leitura honesta:
1. **A mecânica da cirurgia funciona.** O mix de direção agora SEGUE o regime
   (todos os agentes migraram pra sell no bear — sell share 43-50% → ~70%) e o
   sell win% saltou de 2-9% pra 26-35%. Era exatamente o comportamento
   simétrico prometido: no bull favorecia buy, no bear favorece sell.
2. **Bracket clamp validado:** alvo médio do Grok 259% → **2.8%** (máx 13.3%).
   O lixo de dado morreu.
3. **Diff-in-diff vs controle:** radar (sem cirurgia) piorou **−3.7 pts**;
   os agentes operados pioraram −0.2 a −1.0. Relativo ao mercado, a cirurgia
   segurou os agentes — não os derrubou.
4. **MAS ninguém é lucrativo no regime novo** (todos −0.8 a −1.2 líquido).
   As compras contra-tendência remanescentes (win 6-23%) ainda vazam. O edge
   dos agentes era, em grande parte, o bull market.

Decisão: **manter a cirurgia** (não reverter — o controle prova que a queda é
regime, não o prompt) e seguir medindo. NÃO promover pro ZION ao vivo até ver
uma coorte com expectancy líquida positiva em regime adverso.

## Pendências
- 🟢 Medir coorte pós-deploy — feito 17/07 (acima).
- ⏳ Re-medir quando o regime virar de novo (a prova final da simetria).
- ⏸️ Promoção pro prompt do ZION ao vivo — bloqueada até expectancy líquida
  positiva fora do bull.
