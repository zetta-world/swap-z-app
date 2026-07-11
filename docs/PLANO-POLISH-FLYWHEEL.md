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

## Pendências
- ⏳ Medir coorte pós-deploy (Grok/Claude/Mistral) daqui a ~1-2 dias.
- ⏸️ Se a tendência-disciplina ajudar, considerar levá-la (com cautela) pro
  prompt do ZION ao vivo.
