# PAINEL SINCRONIZADO — a tela do escritório e o celular · 🟢 FEITO

> **Aberto em:** 14/08/2026 · **Origem:** *"o painel geral não parece estar
> atualizado em tempo real, ele tem que estar sincronizado"* — dono, olhando o
> admin no celular.
>
> **Dois usos, exigências opostas:** aberto o dia inteiro num PC do escritório,
> e no celular quando ele está viajando.

---

## O QUE A MEDIÇÃO ACHOU

### 1. O painel ficava MAIS LENTO quanto mais saudável a conexão

A lógica era *"se o ping do tempo real cobre, pode desacelerar a sondagem"*:

```ts
setInterval(load, realtime?.status === "live" ? 180_000 : 60_000)
```

| painel | vivo | morto |
|---|---|---|
| PlatformEvents | 180s | **60s** |
| AuditLog | 120s | **30s** |
| Operations | 60s | **30s** |
| Tournament · Finance · Growth · Backtest · Traffic | 180s | **120s** |

A premissa era falsa: de **12 painéis que desaceleravam, só 3 assinavam o
ping** (`AuditLog`, `LogsSecurity`, `PlatformEvents`). Os outros 9
desaceleravam e **não recebiam nada em troca**.

⚠️ **Uma inversão silenciosa.** Nada quebra, nada avisa, e o número na tela é
de três minutos atrás enquanto o indicador diz "ao vivo". A regra agora não tem
exceção: **o intervalo nunca aumenta por causa do tempo real.** Ping é ganho,
não troca.

### 2. E a maioria dos "painéis parados" NÃO estava parada — era botão

Contei 29 painéis sem `setInterval` e cheguei a propor auto-refresh em doze.
**Estava errado**, e a classificação desmente:

| tipo | quantos | o que fazer |
|---|---|---|
| **botão** (medição sob demanda: `rodar()`) | 8 | **nada** — ver abaixo |
| **carrega na montagem** | 10 | caso a caso |
| **sem carga própria** (recebe por props) | 8 | nada |

⚠️ **AUTO-REFRESH NUM PAINEL DE BOTÃO SERIA DEFEITO, NÃO MELHORIA.** `Funding`,
`Rendimento`, `Liquidez`, `DexCex`, `Combinacao`, `Variancia`, `RotacaoGrade`,
`WhatWorked` e `Calibragem` disparam MEDIÇÃO — várias com POST que grava
`lab_runs` e gasta chamada de API. Colocar relógio neles seria rodar medição
sozinho, de hora em hora, para sempre. Eles não estão desatualizados: mostram o
resultado da rodada que **você** pediu.

E dos 10 que carregam na montagem, 7 são **painéis de ação com formulário**
(`KillSwitches`, `Whitelist`, `SwapAllowlist`, `AdminAccess`, `Liberacao`,
`AiControls`, `Users`). Recarregar por baixo de um formulário aberto apaga o
que a pessoa está digitando — trocar um defeito por outro.

**Sobraram os de leitura pura**, e só esses receberam relógio.

---

## O QUE MUDOU

### `refresh-gap.ts` — a decisão, pura e testável

`devoRodar(agora, ultimo, minGap, forcado)`. Mora fora do hook porque o hook é
`"use client"` e importa JSX; um teste que importasse o hook arrastaria a
árvore de componentes só para comparar dois números, e aí a parte que decide
ficaria sem teste — que é sempre a que mais precisa.

### `useAutoRefresh.ts` — reescrito

| comportamento | por quê |
|---|---|
| intervalo **nunca** desacelera com tempo real vivo | a inversão acima |
| assina o ping do tempo real | a tela de 65" acompanha sozinha |
| **estrangula a rajada** (15s) | `recordEvent` emite a cada evento do flywheel; um tick com seis eventos dispararia seis buscas para a mesma tela |
| **para quando a aba esconde** | celular no bolso não queima bateria nem 4G |
| **busca ao VOLTAR, forçado** | quem tira o telefone do bolso quer o agora, não o de quando guardou |

⚠️ O retorno à aba **ignora o estrangulamento de propósito**. Sem isso, a
primeira tela depois de uma viagem de metrô seria a mesma que ele deixou.

### Painéis

- **12** tiveram a inversão corrigida (o intervalo vivo passou a ser o menor dos dois)
- **4** de leitura pura passaram a usar o hook: `Lab`, `ArbiterCohort`, `Margin`, `Receita`
- **os de botão e os de formulário ficaram como estavam**, e agora está escrito por quê

---

## O AVISO DE RODADA NOVA — o buraco que a decisão acima abriu · 🟢

Deixar os painéis de botão sem relógio é a decisão certa **e cobra um preço**:
se o cron, outra aba ou outro dia produziu uma rodada mais nova, a tela continua
mostrando a antiga **sem dizer que é antiga**. Número velho apresentado como
número atual é a família de defeito que este repositório persegue desde o
começo, aqui na forma mais inocente: um painel que simplesmente não sabe.

⚠️ **A resposta certa não é recarregar — é AVISAR.** Recarregar apagaria o
resultado que o dono está lendo e o trocaria por outro sem ele pedir. Quem
decide se quer o novo é ele; o trabalho é garantir que ele SAIBA que existe.

- `GET /admin/api/lab/ultima` — só o carimbo de data por slug. Não reusa
  `/admin/api/lab` porque aquela faz três consultas POR ESTRATÉGIA (quase
  noventa idas ao banco para 28 estratégias), e numa tela aberta o dia inteiro
  isso repetiria para sempre.
- `temRodadaNova()` — a decisão, pura e testada.
- `<AvisoRodadaNova>` — usa o mesmo `useAutoRefresh`. Um aviso que sondasse por
  conta própria seria a segunda política de atualização do painel, e duas
  políticas divergem, é só questão de tempo.

Ligado em **7 painéis**: Funding, Rendimento, Liquidez, DexCex, Combinacao,
Variancia, RotacaoGrade.

### ⚠️ A folga de 5 segundos, e por que ela não é frescura

`vistoEm` é marcado no relógio do **navegador** quando a resposta chega;
`started_at` é o relógio do **banco** quando a rodada começou. Não são o mesmo
relógio, e a rodada sempre começa ANTES de a resposta chegar.

Sem folga, **a própria medição que o dono acabou de rodar se anunciaria como
"mais recente que a tela"** — o aviso acusaria a si mesmo, toda vez, e em uma
semana ninguém mais olharia para ele. Tem teste.

### E painel vazio não é painel desatualizado

`vistoEm = 0` (nada na tela ainda) não avisa. Dizer "há algo mais recente que o
nada que você está vendo" é verdade e é inútil — o botão logo ao lado já diz o
mesmo, melhor.

---

## O QUE ISTO NÃO RESOLVE

- Os escopos do ping ainda são cinco (`stats`, `tier`, `killswitch`, `events`,
  `audit`). Não há escopo para "abriu posição" ou "terminou medição" — quem
  quer saber disso assina `events`, que é grosso. Um escopo por assunto tornaria
  a atualização mais barata, e é trabalho para quando incomodar.
