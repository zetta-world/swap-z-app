# ARBITER — do papel ao dinheiro real — 🟡 (2.0 em simulação, 21/07)

> Gatilho: CEO validou o conceito (aula do "dois bolsos": vender na cara +
> comprar na barata com saldo dos dois lados captura o spread inteiro sem
> transferir nada) e definiu o produto: o cliente chega SÓ com USDT — a
> máquina se prepara sozinha. Este plano guarda o caminho completo pro real.

## Fatos medidos (paper 1.0, rodada 2: 17-21/07)

- 180 round-trips, 0 perdas, +$27,30 sobre entradas de $50 → +0,303%/trade
  líquido (custo 0,4% já descontado). Retorno sobre capital DE GIRO ≈ 54%
  em 3,5d; a escala vem de cobertura (moedas × venues), não do tamanho.
- **Gate.io é o hub** (154 dos 180 trades). Venues que importam: Gate.io,
  Binance, OKX, MEXC. Kraken/Bybit quase não geram rota.
- Moedas: MANA (35), BONK (32), JUP (14), LDO (13), RUNE (10) = 58% do
  total — o universo expandido da alavanca 4 pagou.
- Rotas são BIDIRECIONAIS (binance→gateio 38× e gateio→binance 26×): o
  spread oscila de lado → estoque se rebalanceia sozinho, lucrando.

## Arquitetura de produto (decisões do CEO)

1. **Cliente só deposita USDT.** Nada de pedir pra ele comprar MANA.
2. **Modo preparação autônomo**: o arbiter lê a própria telemetria (rotas/
   moedas frequentes), gera a receita de alocação e compra o estoque de
   trabalho sozinho, explicando no painel. Rebalanceia preferindo trades na
   direção contrária (de graça, lucrando); transferência só em último caso.
3. **Arbiter 2.0 (spot+futuros)** resolve o cold-start por completo: só
   USDT, sem estoque — ver abaixo.

## Arbiter 2.0 — spot + perpétuo (source `arbiter2`) — 🟢 simulando

Mecânica: spread entre venues detectado → **compra spot na barata** +
**short do perp na cara** (1x, USDT como margem) no mesmo instante →
posição 100% neutra que TRAVA o spread → fecha as duas pontas quando os
preços convergem (ou timeout). Funding positivo enquanto short = recebe
por esperar.

Simulação honesta, já na realidade dos **$300 de saldo** (decisão CEO):
- Carteira paper `arbiter2` começa com **$300** (não $1000): cada ciclo
  trava 2×$50 (perna spot + margem 1x) → máx 3 posições simultâneas — a
  restrição de capital real desde o dia 1.
- Custo de ciclo completo (4 pernas: spot in/out + perp in/out + basis
  buffer): `ARB2_COST_PCT` = **0,45%**. Piso líquido `ARB2_MIN_NET_PCT`
  0,15%. Mesmos filtros de sanidade do 1.0 (teto 3%, mediana, sem
  Coinbase).
- Convergência: fecha quando o spread atual ≤ `ARB2_EXIT_SPREAD_PCT`
  (0,05%) — lucro = spread travado − custo + funding acumulado; timeout em
  `ARB2_MAX_HOLD_H` (48h) fecha no spread que estiver (pode dar pequena
  perda — registrada, flywheel honesto).
- Funding: taxa real do perp da Bybit no fechamento × (horas/8) × tamanho;
  short recebe quando positiva.
- Aproximação declarada: preço do perp na venue cara ≈ spot da venue cara
  (basis típico <0,05%, coberto no buffer de custo). A F2 mede o real.
- Posições `arbiter2` abertas são HEDGEADAS: MTM direcional = 0 no painel;
  o motor de paper comum NÃO resolve essas posições (o 2.0 fecha as
  próprias, por convergência — não por alvo/stop).

## F2 — validador de orderbook (pré-requisito do real) — 🔴

Antes de qualquer depósito: conferir cada oportunidade contra o LIVRO real
(bid/ask com profundidade) nas rotas/moedas medidas, registrando o
preenchimento realista ao lado do teórico por ~1 semana. Saída: "o 0,30%
teórico vira X% real e aguenta $Y por ordem".

## 💰 FEATURE GUARDADA: Funding Farming (renda neutra ~5-15% a.a.) — ⏸️

O arroz-com-feijão dos desks neutros, quase de graça com a infra do 2.0:
**long spot + short perp da MESMA moeda na MESMA corretora** — zero
direção, zero dependência de spread entre venues — colhendo o funding a
cada 8h (majors ~5-15% a.a.; memecoins lotadas de long, bem mais).
- Uso ideal: capital OCIOSO entre oportunidades de spread vira rendimento.
- Simulação primeiro (mesma regra de sempre): carteira paper
  `funding_farm`, funding real da Bybit, custo de 4 pernas, rotação pra
  moeda com melhor funding anualizado × liquidez.
- Vira produto de prateleira: "renda neutra em USDT" — o cliente entende
  "recebo aluguel a cada 8h" sem precisar entender perp.
- Status: **guardada por decisão do CEO (21/07) — implementar após o
  Arbiter 2.0 provar o motor spot+perp na simulação.**

## Caminho pro real (ordem de execução)

1. 🟢 Arbiter 2.0 em simulação com $300 (este deploy).
2. 🔴 F2 — validador de orderbook (spot 1.0 E basis do 2.0).
3. ⏸️ ~1-2 semanas de dados: 1.0 (estoque) vs 2.0 (futuros) vs realismo F2.
4. ⏸️ Funding farming em simulação.
5. ⏸️ Real com capital de teste (~$300-1000, 3 venues, API keys SEM saque,
   caps + kill-switch + fail-closed — regras da casa pra dinheiro).

## Regras invioláveis no real

Chave de API **sem permissão de retirada** · alavancagem 1x no short ·
margem isolada · monitor de distância de liquidação com fechamento
automático das duas pontas · caps por trade/dia · kill-switch admin_kv ·
sem preço de referência = rejeita (fail-closed).
