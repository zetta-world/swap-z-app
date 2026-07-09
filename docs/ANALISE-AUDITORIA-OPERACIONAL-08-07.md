# Auditoria operacional + desempenho dos agentes — 2026-07-08

> Pedido do CEO: "olha o banco de dados e as operações; já depositei dinheiro nas
> IAs, só Kimi que não estava rodando — outro agente mexeu, não sei se quebrou
> algo. Auditoria completa + desempenho dos agentes."

## Veredito rápido

- ✅ **O outro agente (PR #108) NÃO quebrou nada.** Trocou só o id do modelo Kimi
  (`kimi-k2-0711-preview` → `kimi-k2.6`), 3 linhas. Type-check limpo, 50/50 testes.
  O id e o base URL estão **corretos** (confirmado na doc da Moonshot: a série
  `kimi-k2` foi descontinuada em 25/05/2026; `kimi-k2.6` é o sucessor; base URL
  `https://api.moonshot.ai/v1`).
- ⚠️ **Mas o fix sozinho NÃO fez o Kimi voltar.** Deploy do fix ficou pronto às
  **18:08:58 UTC**; o Kimi falhou de novo às **18:30:42** (breaker: "4 falhas
  seguidas") — 22 min DEPOIS do código correto no ar. Logo a causa restante é
  **chave/créditos da conta Moonshot**, não o código.
- ✅ Automação toda saudável: crons no horário, gates OFF (tudo rodando), nenhum
  kill-switch ligado. Caminho do dinheiro (autopilot/operations) **ocioso e
  íntegro** — esperado pré-launch (zero usuários operando).

## Estado operacional (admin_kv)

| Sinal | Valor | Leitura |
|-------|-------|---------|
| cron:radar:last | 18:37 | ✅ 1min no horário |
| cron:autopilot:last | 18:35 | ✅ 5min no horário |
| cron:backtest:last | 18:30 | ✅ 30min no horário |
| pause_agent_a / _b | false / false | ✅ agentes ligados |
| pause_backtest / pause_tournament | false / false | ✅ flywheel ligado |
| disable_swap / disable_cex / maintenance_mode | false | ✅ plataforma aberta |
| kill-switches / cb:* persistidos | nenhum | ✅ nada travado |

## Desempenho dos agentes (ledger `zion_suggestions`, todo o histórico)

| Agente | Total | Aberto | W | L | Exp. | Win% | Exp. bruta | **Exp. líq.** | Desde |
|--------|------:|-------:|--:|--:|-----:|-----:|-----------:|--------------:|-------|
| **self_scan** (Claude) | 110 | 68 | 17 | 21 | 4 | 45% | +0.60% | **+0.40%** ✅ | 28/06 |
| mistral_scan | 105 | 65 | 12 | 23 | 5 | 34% | +0.02% | −0.18% | 01/07 |
| grok_scan | 76 | 62 | 2 | 12 | 0 | 14% | −0.85% | −1.05% | 08/07 |
| deepseek_scan | 58 | 57 | 0 | 1 | 0 | — | −1.55% | −1.75% | 08/07 |
| radar | 11 | 11 | 0 | 0 | 0 | — | — | — | 08/07 |
| **kimi_scan** | **0** | — | — | — | — | — | — | — | **nunca** |

R:R e magnitude (decididos):
- self_scan: avg_win **+3.54%**, avg_loss −2.20% → profit factor ~**1.30** (net-positivo).
- mistral_scan: avg_win +4.77%, avg_loss −2.71% → PF ~0.92; acerta pouco mas quando
  acerta é grande; **superconfiante** (conf média 54.6 com o pior win-rate maduro).
- grok/deepseek: começaram HOJE (08/07). Amostra decidida 14 e 1 — **ruído puro**,
  62/57 posições ainda abertas. Proibido concluir qualquer coisa (regra ≥100).

**Conclusões honestas:**
1. Só o **Claude (self_scan)** é líquido-positivo hoje (+0.40%), com apenas 38
   decididos — ainda < MIN_SAMPLE=100, então nem ele autoriza cirurgia de prompt.
2. Grok e DeepSeek estão vermelhos, mas é o 1º dia — **não mexer**. A regra do
   flywheel honesto (≥100 decididos antes de tocar prompt) existe por cicatriz:
   na análise #02 o Agent A inverteu de −0.59% para +0.39% só com 24h de maturação.
3. **Kimi nunca produziu uma linha** — id de modelo morto = toda chamada 404 →
   breaker → pulado. Confirmado: 0 linhas, 5 fontes distintas, nenhuma de Kimi.

## Kimi — diagnóstico fechado

Config **correta** (`kimi-k2.6` + `api.moonshot.ai/v1`). O breaker disparou às
17:00 e às 18:30 (esta última já com o fix no ar). Ou seja: a Moonshot está
**recusando a chamada** por motivo de conta — chave inválida/desatualizada no
Vercel, ou saldo não creditado. Hoje o motivo exato é uma caixa-preta porque o
torneio engolia o erro (`catch {}` sem status).

**Ação do CEO (fora do código):** em platform.moonshot.ai verificar (a) saldo
creditado e (b) que `KIMI_API_KEY` no Vercel é a chave válida para `api.moonshot.ai`
(atenção: chave de `moonshot.cn` não vale em `.ai`). Depois do próximo tick de
backtest, o motivo exato (401 vs 402) vai aparecer no painel de Logs — ver patch.

## Patch entregue nesta auditoria — observabilidade de falha de provedor

Pequeno, cirúrgico, só adiciona logging (não muda caminho de sucesso nem fluxo):

- `provider.ts`: erro de upstream agora carrega **status + corpo truncado**
  (`upstream 401: invalid_api_key ...`) em vez de só `upstream 401`. O corpo de
  erro nunca ecoa a chave — seguro logar.
- `backtest.ts`: os dois `catch` do caminho OpenAI-compat (torneio + hybrid) agora
  chamam `logError(...)` → evento `error` em `platform_events`, visível no painel
  de Logs e consultável por SQL. Nada de "N falhas" sem motivo.
- `circuit.ts`: `recordResult` aceita `reason?` e o alerta do breaker passa a dizer
  **"Last error: ..."** — o CEO vê no Telegram/Alerts se é chave ou crédito.

Resultado: da próxima falha de qualquer provedor, o **porquê** fica registrado.

## Pendências (registradas, NÃO implementadas)

- ⏸️ Kimi: aguardando CEO validar conta/chave Moonshot (fora do código).
- ⏸️ Prompt surgery / H1-H4 / Z7: travado até ≥100 decididos por agente.
- ⏸️ Grok/DeepSeek: deixar maturar; reavaliar quando cada um passar de ~50
  decididos (hoje 14 e 1).
