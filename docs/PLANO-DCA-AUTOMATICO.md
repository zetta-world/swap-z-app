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

## 1. ⚠️⚠️ DCA E AUTOPILOT SÃO PRODUTOS DIFERENTES

**Correção do dono, 24/08, e ela reescreveu este plano.** A primeira versão
pendurava o DCA em `autopilot_sessions`: chave de API compartilhada, gate
compartilhado, teto herdado da sessão. Ele leu e disse:

> *"eu queria evitar misturar DCA automático de auto piloto, cada um é uma
> solução diferente"*

Ele tem razão, e o custo do acoplamento era maior do que eu tinha visto:

| | autopilot | DCA |
|---|---|---|
| quem decide o quê comprar | a IA | o dono, uma vez |
| risco | ilimitado dentro dos tetos | limitado por construção |
| prazo saudável de credencial | curto | longo |
| quem quer usar | quem aceita robô de IA | quem quer poupar |

⚠️ **Obrigar alguém a ligar um robô de IA para ter um plano de poupança é o
acoplamento virando produto ruim.** São públicos diferentes.

### ⚠️ E O ACOPLAMENTO CRIAVA UM PROBLEMA QUE SUMIU AO SEPARAR

A v1 deste documento terminava com uma pergunta em aberto: o plano morre com o
`expires_at` da sessão, e um DCA de 12 meses não cabe numa sessão curta.

Aquele problema **só existia por causa da mistura**. Sessão de autopilot é
curta porque IA operando sozinha é arriscada; um DCA de ativo fixo, valor fixo
e horário fixo não precisa da mesma coleira. Separados, cada um tem o prazo que
o SEU risco pede. A pergunta não foi respondida — ela deixou de existir.

### ⚠️ E O ARGUMENTO QUE EU NÃO TINHA ESCRITO: RAIO DE EXPLOSÃO

Hoje, se a rota `/api/autopilot/cron` devolver 500, **para tudo que estiver
dentro dela**. O autopilot é a peça complexa e arriscada. O plano de poupança
de alguém não pode morrer junto com um bug da IA.

Rota de cron própria. Heartbeat próprio. Kill-switch próprio.

---

## 2. O modelo em três camadas

O banco de hoje mistura duas coisas numa linha só: `autopilot_sessions` diz ao
mesmo tempo **"conectei minha corretora"** e **"o robô está ligado"**. É a
mesma confusão do dono, uma camada abaixo.

```
cex_conexoes          ← a CHAVE mora aqui, e só aqui
   ├── autopilot_sessions   ← o robô de IA (config, tetos, validade curta)
   └── dca_planos           ← o plano de poupança (relógio, validade longa)
```

**Uma cópia do segredo, um lugar para revogar, dois produtos independentes.**

⚠️ A alternativa — cada produto com a própria cópia cifrada — foi recusada pelo
dono em 24/08, e o motivo é de segurança: com duas cópias, **matar o autopilot
no pânico NÃO mataria o DCA**. Ele seguiria operando com a segunda chave, que é
exatamente o que ninguém quer descobrir num incidente.

### ⚠️ A MUDANÇA MEXE EM CAMINHO DE DINHEIRO VIVO — virada em três tempos

`autopilot_sessions.creds_cipher` está em produção agora, com dinheiro real.
Não se troca isso num commit.

| tempo | o quê |
|---|---|
| T1 | cria `cex_conexoes` e faz backfill a partir de `creds_cipher`; adiciona `conexao_id` **nulável** em `autopilot_sessions`. Nada lê ainda. |
| T2 | leitura DUPLA: usa `conexao_id` quando existe, cai em `creds_cipher` quando não. Roda dias assim, com contador de qual caminho serviu. |
| T3 | com o contador em 100% no caminho novo, remove `creds_cipher`. |

⚠️ **O contador do T2 não é enfeite.** Sem ele, o T3 é um chute — e a
invariante nº 33 diz que "ninguém usou o caminho velho" e "meu contador está
quebrado" não podem ser a mesma tela.

---

## 3. ⚠️⚠️ A DECISÃO CENTRAL: IDEMPOTÊNCIA POR CICLO

O risco que mata este recurso não é o cron não disparar. É **disparar duas
vezes** — e comprar duas.

Lock com TTL não garante: uma passada que trave, expire o lock e volte a si
compraria de novo. Lock é otimização.

**A garantia é do banco:**

```sql
unique (plano_id, ciclo_numero)
```

E a ordem das operações é INEGOCIÁVEL:

1. `insert` da linha do ciclo com status `reservado` — se der conflito, **outra
   passada já pegou este ciclo, aborta sem comprar**
2. só então coloca a ordem na corretora
3. `update` da linha com o resultado real (preço, quantidade, custo)

⚠️ Se o passo 3 falhar, a linha fica `reservado` com uma ordem que EXISTE. É
ruim, e é **muito** melhor que o inverso: o ciclo não repete, e um alerta alto
pede reconciliação humana. É a lição do `engine.ts:492` e dos dois críticos do
autopilot — na dúvida, falha para o lado que não gasta.

---

## 4. O relógio

```
next_run_at <= now()  →  o ciclo está vencido
```

### ⚠️ Avançar do HORÁRIO AGENDADO, nunca de `now()`

```
ERRADO:  next_run_at = now() + intervalo        ← acumula o atraso do cron
CERTO:   next_run_at = next_run_at + intervalo
```

Um plano diário que avançasse de `now()` andaria alguns minutos por dia e em um
mês estaria em outro horário.

### ⚠️ E NÃO REPOR CICLOS PERDIDOS

Se o cron ficou fora 3 dias, um plano diário tem 3 ciclos vencidos. **Comprar
os três de uma vez é gastar 3× o previsto num único preço** — o oposto exato do
que DCA existe para fazer.

Dispara **UM** ciclo por passada. Os demais viram `pulado` com motivo
`"janela perdida"`, entram em `ciclos_pulados`, e o `next_run_at` salta para a
próxima janela futura.

> `pulado` ≠ `feito` ≠ `falhou`. Três estados, como `expired` ≠ win/loss no
> flywheel. Somar os três daria um plano "completo" que comprou metade.

### ⚠️ E SÓ A JANELA CORRENTE COMPRA — descoberto no D1

Se o plano tem 3 ciclos e o cron ficou fora cinco semanas, **o intervalo
inteiro do plano já passou**. A primeira implementação disparava a última
janela mesmo assim; o teste pegou.

Uma compra cinco semanas depois de o plano ter terminado, num momento que o
dono não escolheu, **não é DCA — é uma ordem a mercado avulsa com o dinheiro de
uma poupança**. Nesse caso o plano encerra, com as janelas registradas como
perdidas.

"Janela corrente" tem definição exata e sem tolerância arbitrária: aquela cuja
SEGUINTE ainda é futura. Vale o mesmo quando a passada bate o teto de janelas —
paramos por tempo, não por ter alcançado o presente, então não compra: registra
o que andou e a próxima passada continua.

---

## 5. As travas — PRÓPRIAS, não herdadas

| trava | de onde vem |
|---|---|
| `pause_dca` | kill-switch novo em `admin_kv`, na lista de `gate-keys.ts` |
| liberação do DCA | estado PRÓPRIO no `admin_kv`, julgado por `decidirAutomacao` |
| teto por ciclo | `dca_planos.por_ciclo_usd`, com teto de plataforma |
| orçamento total | soma dos ciclos feitos nunca passa de `orcamento_total_usd` |
| teto diário por carteira | soma de TODOS os planos da mesma carteira |
| validade | `cex_conexoes.expires_at` — longa, e do DCA |
| saldo | confere caixa na corretora ANTES de reservar o ciclo |

⚠️ **Gate próprio, função compartilhada.** `decidirAutomacao(wallet, liberacao,
pilotos)` já é função PURA sobre um estado lido do banco. O DCA passa o SEU
estado. Abrir robô de IA ao público e abrir plano de poupança ao público são
decisões diferentes, com riscos diferentes — e agora podem ser tomadas em dias
diferentes.

⚠️ **O teto diário por carteira é novo, e é necessário.** Sem autopilot para
herdar limite, dez planos de US$ 100/dia na mesma carteira são US$ 1.000/dia
sem nada olhando o conjunto.

⚠️ **Sem preço de referência, NÃO compra.** Mesma regra do `price-guard.ts`: o
caminho de dinheiro falha FECHADO. DCA é ordem a mercado por natureza, mas "a
mercado" num livro seco é como se perde 30% num tick.

---

## 6. O esquema

```sql
-- ── a chave, isolada dos dois produtos ───────────────────────────────
create table cex_conexoes (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  exchange_id    text not null,
  creds_cipher   text not null,          -- AES-256-GCM: iv.tag.ciphertext b64
  expires_at     timestamptz not null,
  is_active      boolean not null default true,
  criado_em      timestamptz not null default now(),
  unique (wallet_address, exchange_id)
);

-- ── o plano de poupança ──────────────────────────────────────────────
create table dca_planos (
  id                  uuid primary key default gen_random_uuid(),
  conexao_id          uuid not null references cex_conexoes(id) on delete cascade,
  wallet_address      text not null,
  symbol              text not null,

  orcamento_total_usd numeric not null check (orcamento_total_usd > 0),
  por_ciclo_usd       numeric not null check (por_ciclo_usd > 0),
  ciclos_total        int     not null check (ciclos_total between 1 and 365),
  intervalo           text    not null check (intervalo in ('hourly','daily','weekly','monthly')),

  next_run_at         timestamptz not null,
  ciclos_feitos       int not null default 0,
  ciclos_pulados      int not null default 0,

  -- ⚠️ `encerrado_por` distingue COMPLETO de MORTO. Um plano que parou porque
  -- a conexão expirou não é um plano que terminou.
  status              text not null default 'ativo'
                      check (status in ('ativo','pausado','completo','encerrado')),
  encerrado_por       text,
  criado_em           timestamptz not null default now()
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
| D0 | `cex_conexoes` + backfill + `conexao_id` nulável (T1 da §2) | 🟢 **24/08 — backfill NÃO exercitado (banco sem sessões)** |
| D1 | `lib/dca/relogio.ts` puro (janela, avanço, decisão de ciclo, tetos) com testes | 🟢 **24/08 — 33 testes** |
| D2 | migration `dca_planos` + `dca_ciclos` | 🟢 **24/08 — trava unique provada no banco** |
| D3 | rota `POST /api/dca/cron` PRÓPRIA, com a ordem reserva→ordem→registro da §3 | 🟢 **24/08 — falta AGENDAR no cron-job.org** |
| D4 | `pause_dca` + liberação própria em `gate-keys.ts` e no painel | 🟢 **24/08 — cartão no AiControlsPanel** |
| D5 | leitura dupla no autopilot + contador (T2 da §2) | 🟢 **24/08 — escrita dupla, leitura dupla, contador por passada** |
| D6 | UI: criar plano, ver ciclos feitos/pulados, pausar, encerrar | 🟢 **24/08 — aba DCA no console de CEX** |
| D7 | painel admin: planos ativos, ciclos do dia, falhas | 🔴 |
| D8 | i18n nos 4 locales | 🔴 |
| D9 | remover `creds_cipher` (T3 da §2) — só com o contador em 100% | 🔴 |

⚠️ **D1 antes de D3, sempre.** A aritmética do relógio e dos tetos é pura e
testável sem banco nem corretora. Foi assim que `lib/orders/plano.ts` pegou os
sete valores impossíveis que a tela aceitava, e é barato repetir.

⚠️ **D9 é o último, e depende de medição, não de calendário.**

---

## 7.1 ⚠️ O QUE FICOU ABERTO DEPOIS DO D2/D3

- **A rota existe e NÃO está agendada.** Sem o job no cron-job.org, nenhum
  plano roda. Entra no `RUNBOOK` junto com os três que já existem.
- **O backfill do D0 não foi exercitado.** No momento da migration o banco
  tinha ZERO sessões de autopilot, então a cópia foi no-op. A lógica está
  escrita e não está provada contra dado real — não confundir uma coisa com a
  outra.
- **T2 feito, T3 pendente e DEPENDENTE DE MEDIÇÃO.** Armar uma sessão agora
  grava nos dois lugares, e a leitura prefere o cofre contando qual caminho
  serviu (`cofre_origem_credencial`, um evento por passada com sessão).
  Enquanto `sessao > 0` nesse contador, remover `creds_cipher` quebra alguém.
  ⚠️ **Com zero sessões no banco, o contador ainda não gravou NADA** — e
  "nunca rodou" não é "rodou e deu zero".
- **A UI existe e o cron NÃO está agendado.** A própria tela diz isso, em
  vermelho, acima do formulário — plano salvo e nada rodando é exatamente o
  tipo de coisa que não pode ficar implícita.

### ⚠️ O QUE O T2 DECIDIU, E QUE O PLANO NÃO PREVIA

**Conexão revogada FALHA, não cai para trás.** O plano dizia "leitura dupla:
usa o cofre quando existe, cai no `creds_cipher` quando não". Ao implementar
ficou claro que essa regra, literal, tem um buraco: se o dono revogasse a
conexão no cofre, a leitura cairia na cópia da sessão e **revogar não revogaria
nada** — o oposto exato do ponto do cofre.

Agora a queda só vale para "não há elo" ou "a linha sumiu". Conexão que EXISTE e
está desligada lança, e o autopilot para aquela sessão. Falha fechado.

### ⚠️ ONDE A UI MORA, E POR QUÊ

Na **aba DCA do console de CEX** (`/cex`), não na aba DCA de `/orders`. As duas
se chamam DCA e são coisas diferentes:

| | `/orders` · DCA | `/cex` · DCA |
|---|---|---|
| praça | DEX | corretora |
| onde vive | `localStorage` do navegador | banco, cifrado |
| quem dispara | você, à mão | o cron, sozinho |
| a chave | nunca sai da carteira | cópia cifrada no servidor |

⚠️ **E criar um plano aqui é um CONSENTIMENTO.** O console guarda as chaves só
no navegador, atrás de senha e com auto-lock de 10 minutos. Um plano de DCA não
pode viver assim — o cron roda com o dono dormindo. Por isso o aviso é a
PRIMEIRA coisa da tela, antes do formulário, e não um asterisco no rodapé.

### ⚠️ O MODO SIMULADO — testar tudo sem dinheiro de verdade

Pedido do dono em 24/08: *"por enquanto não vai ser possível eu testar com
dinheiro de verdade, então faça tudo que for possível para deixar tudo
alinhado"*.

Um plano nasce **`simulado`** e percorre o caminho INTEIRO — mesma decisão de
janela, mesma reserva com a trava `unique`, mesmos tetos, mesmo preço real de
mercado, mesmo extrato. A única linha que muda é a que chama `placeCexOrder`.

⚠️ **É o que faz o ensaio valer.** Se o simulado fosse um caminho paralelo,
provaria só que o caminho paralelo funciona — e o dono ligaria o dinheiro real
confiando num ensaio que nunca ensaiou a peça certa.
`lib/dca/modo-simulado.test.ts` exige isso: **uma** chamada a `placeCexOrder` no
arquivo, e reserva/tetos/guarda-de-preço todos ANTES do ramo.

⚠️ **NO PLANO, NUNCA NUMA VARIÁVEL DE AMBIENTE.** Um `DCA_DRY_RUN` global faria
o mesmo plano se comportar diferente conforme o deploy, e alguém virando a
chave transformaria histórico simulado em histórico com cara de real.

⚠️ **E PLANO SIMULADO NÃO PEDE A CHAVE DA CORRETORA.** Dá para exercitar tudo
sem entregar credencial a ninguém. Quem garante é o BANCO —
`check (modo = 'simulado' or conexao_id is not null)` — porque esta tabela está
fora do tipo `Database` e aqui não existe checagem de tipo.

| trava | provada no banco |
|---|---|
| simulado sem conexão | aceito |
| **real sem conexão** | **recusado** |
| modo inventado | recusado |
| campo omitido | vira `simulado` |

O carimbo vai também no CICLO (`dca_ciclos.simulado`), e não deduzido do plano:
um `update` na linha do plano relabelaria o histórico inteiro de uma vez. O que
aconteceu fica dito onde aconteceu.

## 8. O que este plano NÃO faz

- **Não faz DCA na DEX.** Fica para depois do beta, plano próprio: on-chain
  exige contrato auditado ou conta inteligente que a maioria não tem.
- **Não repõe ciclos perdidos** (§4). De propósito.
- **Não vende.** DCA aqui é acumulação; saída é outro assunto.
- **Não promete preço.** Ordem a mercado com guarda de referência, e o extrato
  mostra o preço REAL de cada ciclo, não o médio estimado.
- **Não reaproveita nada do autopilot além da cifra e do gate puro.** Se um dia
  parecer que compartilhar mais economiza trabalho, releia a §1.
