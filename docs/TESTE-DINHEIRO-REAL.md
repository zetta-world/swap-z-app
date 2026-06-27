# Plano de Teste com Dinheiro Real — Z-SWAP Autopilot

> **Preparado em:** 2026-06-27 · **Para executar a partir de:** ~11/07/2026
> **Capital de teste:** ~US$ 50 · **Objetivo:** validar, com risco mínimo, todo
> o caminho de execução real que construímos (Parte 1 do plano) + a qualidade
> da análise do ZION.
>
> Leia inteiro ANTES de começar. Faça as fases **em ordem** — cada uma libera
> a próxima só se passar. Pare ao primeiro sinal estranho (ver "Critérios de
> aborto").

---

## 🔐 REGRA DE OURO Nº 1 — chaves de API SEM saque

Ao criar as chaves de API na exchange (Binance / Gate.io / etc.):
- ✅ **Habilite:** "Spot Trading" (negociação à vista).
- ❌ **NUNCA habilite:** "Withdrawal" / "Saque".
- ✅ Se a exchange permitir, **trave o IP** (IP whitelist) no IP do servidor.

**Por quê:** mesmo no pior cenário possível (bug, chave vazada), **o dinheiro
não consegue sair da exchange**. O auto-rebalance (que move fundos) fica
desligado neste teste — não vamos testá-lo agora.

> O sistema já deriva o destino de saque da SUA carteira conectada (nunca de
> texto do LLM), mas chave sem permissão de saque é a trava física definitiva.

---

## Fase 0 — Pré-voo (SEM dinheiro ainda)

**0.1 — Backtest acumulou dados?** No Supabase (SQL Editor):
```sql
select status, count(*) as n, round(avg(outcome_pct),2) as avg_pct
from zion_suggestions group by status order by n desc;
```
- [ ] Tem dados resolvidos (win/loss/hit_target/hit_stop), não só "open".
- [ ] Olhe o win-rate bruto = wins / (wins+losses). **Não precisa ser alto**, mas se estiver < 35%, me chame ANTES de pôr dinheiro — revemos a estratégia.

**0.2 — Deploy atual e navegação OK:**
- [ ] Vercel → Deployments → último commit **Ready**.
- [ ] Navegue entre Planos / Dashboard / Histórico **sem refresh** → tudo abre na hora (sem tela branca).

**0.3 — Análise do ZION mostra o contexto novo:** abra o ZION e analise um par (ex.: ETH). Confirme que aparecem:
- [ ] Bloco `MACRO CONTEXT` (dominância BTC, stablecoins, DXY/S&P).
- [ ] `Trajectory/Cycle` (posição no range de 1 ano).
- [ ] `MARKET MEMORY` (regime há quanto tempo).
- [ ] Se analisar um token DEX: `TECHNICAL ANALYSIS` + linha `SMART MONEY`.

---

## Fase 1 — 1 trade manual mínimo (~US$ 10)

Objetivo: validar o caminho de ordem + a contabilidade de custo, com você no controle total.

- [ ] Deposite ~US$ 50 em **USDT** na exchange.
- [ ] Conecte a exchange no Z-SWAP (chaves sem saque).
- [ ] Faça **UMA compra a mercado de ~US$ 10** de BTC ou ETH (manual, pela tela de CEX).
- [ ] Confirme na **app da exchange**: a ordem executou, gastou ~US$ 10 (não mais).
- [ ] No Z-SWAP, veja o Histórico: a transação aparece com símbolo, valor e P&L (vai mostrar 0% até você vender).

✅ **Passou se:** gastou ~US$10 (não US$50), a ordem aparece correta no histórico.
🛑 **Pare se:** gastou muito mais que US$10, ou a ordem não aparece.

---

## Fase 2 — Autopilot no navegador (conservador, mínimo)

Objetivo: validar o countdown, o **teto de notional real (C1)**, a memória de posição (C5) e o cap de exposição (A4).

- [ ] Configure o autopilot: preset **Conservador**.
  - Com ~US$40 de saldo, o sizing dinâmico ≈ 20% = **~US$8/trade**.
- [ ] **Ative** o autopilot (toggle) e deixe a aba aberta.
- [ ] Quando aparecer o **banner de countdown**, LEIA o valor (`~$X`) antes de deixar disparar.
- [ ] Deixe disparar **1 compra**. Confirme:
  - [ ] Na exchange: gastou ~o valor do banner (dentro de 1,5× o cap).
  - [ ] No Supabase: a posição foi gravada:
    ```sql
    select * from autopilot_positions order by entry_ts desc limit 5;
    ```
    (só preenche se você armou uma sessão de **background**; no modo browser a
    posição fica no localStorage — confira no painel do autopilot na tela.)
- [ ] **Teste o teto:** baixe o `maxTradeUsd` pra um valor minúsculo no painel e veja o autopilot **rejeitar** o próximo card (aparece como rejeitado no log).

✅ **Passou se:** o valor gasto bate com o banner e respeita o cap; rejeições funcionam.
🛑 **Pare se:** gastou mais que ~1,5× o cap mostrado, ou disparou sem countdown.

---

## Fase 3 — Autopilot em background / cron (o mais sensível: ele VENDE sozinho)

Objetivo: validar o **exit-engine server-side (A5)**, o loss-stop no servidor (C2),
o cap de exposição no cron (A4) e o lock anti-duplicação (A2).

- [ ] No painel de **Background Autopilot**, **arme uma sessão** com:
  - preset Conservador, market type **spot**, símbolos só **BTC/ETH/SOL**,
  - TTL curto (ex.: 6h).
- [ ] Deixe rodar algumas horas (o cron roda a cada ~5min). Monitore:
  ```sql
  -- sessão e contadores
  select exchange_id, trades_today, pnl_today, frozen_until_day, locked_until, last_scan_at, last_error
  from autopilot_sessions order by last_scan_at desc;

  -- ordens que o cron disparou
  select ran_at, symbol, side, order_type, notional_usd, status, reason
  from autopilot_runs order by ran_at desc limit 30;

  -- posições abertas (deve abrir em compras e fechar/realizar em vendas)
  select base, base_amount, cost_usd, status, exit_order_id, entry_ts
  from autopilot_positions order by entry_ts desc;
  ```
- [ ] Confirme, ao longo do tempo:
  - [ ] **Compras** aparecem em `autopilot_runs` (status `fired`) e abrem linha em `autopilot_positions`.
  - [ ] Os notionais respeitam o cap (nada gigante).
  - [ ] Se vender: aparece `exit filled` / `settled` no log e a posição **fecha**; `pnl_today` reflete o resultado.
  - [ ] **Nunca** vende um ativo que o bot não comprou (só fecha o que abriu).
  - [ ] `locked_until` aparece preenchido durante um run (lock funcionando).
- [ ] **Desarme** a sessão ao terminar o teste.

✅ **Passou se:** compras e (eventuais) vendas batem com os caps, posições abrem/fecham certo, P&L é contabilizado.
🛑 **Pare e me chame se:** vender algo não-comprado, notional acima do cap, ou `pnl_today` não bater.

---

## Fase 4 — Provar que os freios mordem

- [ ] **Loss-stop:** se acumular perda perto do `daily_loss_stop_usd`, confirme que
  `frozen_until_day` é setado e o bot **para** de operar até o dia seguinte (UTC).
- [ ] **Exposição:** confirme que, ao atingir o `maxOpenExposureUsd`, novas compras
  são **rejeitadas** (`reason` = "total exposure cap...").
- [ ] **Cap diário:** confirme que ele para ao atingir `max_trades_per_day`.

---

## 📊 Queries de monitoramento (cola no Supabase)

```sql
-- Visão geral da sessão
select * from autopilot_sessions order by updated_at desc;

-- Tudo que o cron fez hoje
select ran_at, symbol, side, status, notional_usd, reason
from autopilot_runs where ran_at::date = now()::date order by ran_at desc;

-- Posições e P&L
select base, status, base_amount, cost_usd, entry_price from autopilot_positions;

-- Backtest acumulado (a qualquer momento)
select status, count(*), round(avg(outcome_pct),2) from zion_suggestions group by status;
```

---

## 🚨 Critérios de aborto (pare TUDO e me chame)

1. Qualquer ordem com valor **muito acima** do esperado/cap.
2. Qualquer tentativa/registro de **saque** (não devia existir — chave sem saque).
3. O bot **vende um ativo que não comprou**.
4. Posições/ordens **não aparecem** no banco quando deveriam.
5. `pnl_today` ou contadores **claramente errados**.
6. Saldo na exchange **caindo sem explicação** no histórico.

**Como abortar rápido:** desligue o toggle do autopilot na tela **E** desarme a
sessão de background (botão Disarm) **E**, se preciso, revogue as chaves de API
na exchange (mata tudo instantaneamente).

---

## ✅ Checklist final do teste bem-sucedido

- [ ] Fase 0 (pré-voo) — backtest com dados, navegação ok, contexto novo no ZION.
- [ ] Fase 1 — trade manual de ~US$10 executou e contabilizou certo.
- [ ] Fase 2 — autopilot browser respeitou o teto e o countdown.
- [ ] Fase 3 — cron comprou/vendeu dentro dos caps, posições e P&L corretos.
- [ ] Fase 4 — loss-stop, exposição e cap diário **bloquearam** quando devido.

Se tudo passar com US$50, aí sim dá pra subir o capital **gradualmente** (US$50 →
US$200 → ...), sempre observando o run-log nas primeiras vezes de cada degrau.

> **No dia do teste:** me chame. Eu revejo os números reais do backtest, ajusto
> esta lista se precisar, e acompanho cada fase com você em tempo real.
