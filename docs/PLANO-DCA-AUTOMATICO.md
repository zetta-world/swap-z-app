# PLANO — DCA AUTOMÁTICO (lado CEX)

**Status: 🔴 desenhado, nada implementado** · 24/08/2026.

> **O que é:** compras recorrentes que acontecem SOZINHAS, no horário, sem o
> dono estar na frente da tela.
>
> **Por que existe:** a auditoria do setor LIMIT/DCA (#347) achou que a aba
> `/orders` prometia "compras recorrentes" e **não havia agendador nenhum** —
> nem rota, nem cron, nem código. A #347 tirou a promessa falsa. Este plano
> constrói a coisa de verdade.

---

## 1. Por que CEX e não DEX

**Ninguém consegue mover o token do usuário sem a assinatura dele naquele
momento.** É a postura da casa (`Z-SWAP nunca guarda suas chaves`) e é o que
torna o DCA on-chain um projeto grande: exige contrato próprio + auditoria
externa, ou conta inteligente (Safe / EIP-7702) que a maioria dos usuários não
tem.

Na corretora a situação é OUTRA, e melhor: **o dinheiro já está lá e a chave de
API já está conosco**, cifrada em `autopilot_sessions.creds_cipher`
(AES-256-GCM). O autopilot já compra e vende com ela, a cada 5 minutos, em
produção, com travas de dinheiro e log de auditoria.

> DCA automático na CEX não é um sistema novo. É **um relógio** em cima de uma
> máquina que já roda.

O lado DEX fica para depois do beta, com plano próprio. A decisão é do dono,
tomada em 24/08.

---

## 2. ⚠️ O DCA NÃO ENTRA DENTRO DO `processSession`

O autopilot pergunta ao ZION o que fazer: cards → `mapCardToCexIntents` →
ordens. O DCA **já sabe o que fazer** e só precisa do relógio.

Misturar os dois criaria dois defeitos de uma vez:

1. um ciclo de DCA deixaria de acontecer porque o ZION não teve nada a dizer;
2. o ciclo consumiria o `max_trades_per_day`, que é o orçamento de trades da
   ESTRATÉGIA — e o dono veria o robô parar de operar sem entender por quê.

**Passada separada, no mesmo cron.** Tabela própria, gate próprio, contador
próprio. Compartilham só a credencial e o `lock` por sessão.

---

## 3. ⚠️⚠️ A DECISÃO CENTRAL: IDEMPOTÊNCIA POR CICLO

O risco que mata este recurso não é o cron não disparar. É **disparar duas
vezes** — e comprar duas.

O `tryLockSession` de hoje protege contra passadas concorrentes, mas ele é um
lock com TTL de 3 minutos: uma passada que trave, expire o lock e volte a si
compraria de novo. Lock é otimização, não garantia.

**A garantia é do banco:**

```sql
unique (plano_id, ciclo_numero)
```

E a ordem das operações é INEGOCIÁVEL:

1. `insert` da linha do ciclo com status `reservado` — se der conflito, **outra
   passada já pegou este ciclo, aborta sem comprar**
2. só então coloca a ordem na corretora
3. `update` da linha com o resultado real (preço, quantidade, custo)

⚠️ Se o passo 3 falhar, a linha fica `reservado` com uma ordem que EXISTE. Isso
é ruim, mas é **muito** melhor que o inverso: o ciclo não repete, e um alerta
alto pede reconciliação humana. É a lição do `engine.ts:492` e dos dois
críticos do autopilot — na dúvida, falha para o lado que não gasta.

---

## 4. O relógio

```
next_run_at <= now()  →  o ciclo está vencido
```

### ⚠️ Avançar do HORÁRIO AGENDADO, nunca de `now()`

```
ERRADO:  next_run_at = now() + intervalo        ← acumula atraso do cron
CERTO:   next_run_at = next_run_at + intervalo
```

O cron roda a cada 5 min; um plano diário que avançasse de `now()` andaria
alguns minutos por dia e em um mês estaria em outro horário.

### ⚠️ E NÃO REPOR CICLOS PERDIDOS

Se o cron ficou fora 3 dias, um plano diário tem 3 ciclos vencidos. **Comprar
os três de uma vez é gastar 3× o previsto num único preço** — exatamente o
oposto do que DCA existe para fazer.

Regra: dispara **UM** ciclo por passada. Os demais vencidos são pulados, com
`motivo: "janela perdida"`, contados em `ciclos_pulados`, e o `next_run_at`
salta para a próxima janela futura.

> `pulado` ≠ `feito` ≠ `falhou`. Três estados, como `expired` ≠ win/loss no
> flywheel. Somar os três daria um plano "completo" que comprou metade.

---

## 5. As travas de dinheiro

| trava | de onde vem |
|---|---|
| `pause_dca` | kill-switch novo em `admin_kv`, na lista de `gate-keys.ts` |
| liberação / pilotos | `decidirAutomacao`, o MESMO gate do autopilot |
| teto por ciclo | `min(plano.por_ciclo_usd, sessao.max_trade_usd)` |
| orçamento total | soma dos ciclos feitos nunca passa de `orcamento_total_usd` |
| validade | `autopilot_sessions.expires_at` — plano morre com a sessão |
| saldo | confere caixa na corretora ANTES de reservar o ciclo |

⚠️ **O teto por ciclo é `min`, não o do plano.** Se o dono baixar o
`max_trade_usd` da sessão, o DCA tem de obedecer — senão a trava que ele
apertou vale para o robô e não para o DCA, e ele não vai imaginar isso.

⚠️ **Sem preço de referência, NÃO compra.** Mesma regra do `price-guard.ts`: o
caminho de dinheiro falha FECHADO. Um DCA é ordem a mercado por natureza, mas
"a mercado" num livro seco é como se perde 30% num tick.

---

## 6. O esquema

```sql
create table dca_planos (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references autopilot_sessions(id) on delete cascade,
  wallet_address     text not null,
  exchange_id        text not null,
  symbol             text not null,

  orcamento_total_usd numeric not null check (orcamento_total_usd > 0),
  por_ciclo_usd       numeric not null check (por_ciclo_usd > 0),
  ciclos_total        int     not null check (ciclos_total between 1 and 365),
  intervalo           text    not null check (intervalo in ('hourly','daily','weekly','monthly')),

  -- o relógio
  next_run_at        timestamptz not null,
  ciclos_feitos      int not null default 0,
  ciclos_pulados     int not null default 0,

  -- ⚠️ `encerrado_por` distingue COMPLETO de MORTO. Um plano que parou porque
  -- a sessão expirou não é um plano que terminou.
  status             text not null default 'ativo'
                     check (status in ('ativo','pausado','completo','encerrado')),
  encerrado_por      text,
  criado_em          timestamptz not null default now()
);

create table dca_ciclos (
  id            uuid primary key default gen_random_uuid(),
  plano_id      uuid not null references dca_planos(id) on delete cascade,
  ciclo_numero  int  not null,
  -- ⚠️⚠️ A GARANTIA CONTRA COMPRA DUPLA. Ver §3.
  unique (plano_id, ciclo_numero),

  status        text not null check (status in ('reservado','feito','pulado','falhou')),
  motivo        text,
  agendado_para timestamptz not null,
  executado_em  timestamptz,

  order_id      text,
  preco         numeric,
  quantidade    numeric,
  custo_usd     numeric
);
```

RLS habilitada, ZERO policies — o padrão da casa.

---

## 7. As fases

| # | o quê | status |
|---|---|---|
| D1 | migration + `lib/dca/plano-cex.ts` (funções puras: relógio, teto, decisão de ciclo) com testes | 🔴 |
| D2 | passada de DCA no cron, com a ordem reserva→ordem→registro da §3 | 🔴 |
| D3 | `pause_dca` no `gate-keys.ts` e no painel de kill-switches | 🔴 |
| D4 | UI: criar plano, ver ciclos feitos/pulados, pausar, encerrar | 🔴 |
| D5 | painel admin: planos ativos, ciclos do dia, falhas | 🔴 |
| D6 | i18n nos 4 locales | 🔴 |

⚠️ **D1 antes de D2, sempre.** A aritmética do relógio e dos tetos é pura e
testável sem banco nem corretora. Foi assim que `lib/orders/plano.ts` pegou os
sete valores impossíveis que a tela aceitava — e é barato fazer de novo.

---

## 8. O que este plano NÃO faz

- **Não faz DCA na DEX.** Fica para depois do beta, plano próprio.
- **Não repõe ciclos perdidos** (§4). De propósito.
- **Não vende.** DCA aqui é acumulação; saída é outro assunto.
- **Não promete preço.** Ordem a mercado com guarda de referência, e o extrato
  mostra o preço REAL de cada ciclo, não o médio estimado.

---

## 9. A pergunta em aberto

O plano morre junto com a sessão (`expires_at`). Sessões de autopilot são
curtas por segurança; um DCA de 12 meses não cabe nisso.

**Não resolvi de propósito** — é decisão do dono, e envolve segurança:
renovação automática de sessão enquanto houver plano ativo significa
credencial viva por mais tempo. Perguntar antes de implementar D1.
