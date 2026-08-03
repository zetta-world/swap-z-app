# Leitura segura do banco — a classe de erro que custou mais caro

**Status:** 🟢 fechada em 03/08/2026 · travada por teste
**Teste que garante:** `src/lib/supabase/read-safety.test.ts`

---

## Por que este documento existe

O mesmo defeito apareceu **cinco vezes em duas semanas**, sempre descoberto pelo
estrago e nunca pela leitura do código:

| # | Onde | O que causou |
|---|------|--------------|
| 1 | dedup do `paper/engine.ts` | O vazamento de caixa original — mesas reabrindo posições que já tinham, caixa debitado por posição inexistente |
| 2 | `resolvePaperPositions` | Posição arquivada resolvida de novo, creditando caixa duas vezes |
| 3 | `reconcileWallets` | O reparo pagou **US$ 1.429,09** de déficit fantasma |
| 4 | `arbiter2` | Posição arquivada lida como aberta — **US$ 100,19** devolvidos ao caixa |
| 5 | `ullr.ts` | Dedup de pools truncado: o arqueiro podia repetir a mesma flecha |

Cada um foi tratado como **incidente**: consertado, testado, seguido em frente.
Ninguém perguntou *quantos mais existem*. Quando a pergunta foi finalmente
feita, a resposta era **37**.

Consertar 37 à mão sem trava significa consertar 37 e ganhar o 38º na semana
seguinte. Correção que depende de alguém lembrar não é correção — é uma
intenção com data de validade.

---

## As duas regras

### 1. `limit` não é garantia

`.limit(20000)` é um **pedido do cliente**. O PostgREST tem teto próprio no
servidor (tipicamente 1.000 linhas). Pedir 20.000 devolve 1.000 — **sem erro,
sem aviso, e sem ordem definida**.

Foi exatamente isto que fez o reparo pagar o que não devia: com ~2.100 posições
vivas, a reconciliação leu ~1.000, as carteiras que ficaram de fora apareceram
com zero posições, `esperado = capital inicial`, e um déficit que não existia
virou dinheiro.

**Só `selectAllRows` / `.range()` percorre tudo.**

### 2. `archived_at` separa medição de histórico

Ler sem o filtro mistura trade vivo com trade retirado da medição. Nos caminhos
que **creditam caixa**, isso vira dinheiro.

---

## Como declarar um recorte legítimo

Nem toda leitura precisa do universo. "Os últimos 50 eventos da tela" é um
recorte honesto — mas ele tem que ser **declarado**, porque a diferença entre
recorte e truncamento não está no código: está na intenção, e intenção não
declarada é indistinguível de esquecimento.

```ts
// leitura-limitada: <por que este recorte basta>
// inclui-arquivadas: <por que o histórico entra aqui>
```

O teste aceita a declaração e reprova a ausência dela.

---

## A linha divisória que guiou a varredura

**Número que decide → pagina.** Portão de lançamento, reconciliação de caixa,
dedup, resolução de posição, histórico que a IA lê antes de escolher.

**Número que informa → declara.** Painéis, contadores de pulso, listas de
"últimos N". O comentário diz por que o recorte basta *e* o que aconteceria se
alguém passasse a decidir com aquele número.

Vários painéis ganharam a mesma ressalva explícita: *"é tendência para o olho,
não número de decisão — se virar base de decisão, tem que paginar."*

---

## O que o teste protege contra

- Leitura nova de tabela que cresce, sem paginação e sem declaração
- Leitura nova de tabela arquivável, sem filtro e sem declaração
- **Esvaziamento das listas de tabelas** — alguém "consertando" a suíte
- **O scanner varrendo nada** — se o caminho ou o regex quebrar, ele falha em
  vez de passar por vazio, que é a pior forma de um teste mentir

O que ele **não** protege: uma tabela nova que ninguém adicionou às listas.
Essa continua sendo decisão humana, e está escrita aqui para ser lembrada.

---

## A lição de método, que é maior que o bug

Documentar sem consultar é pior que não documentar.

O cabeçalho do `reconcile.ts` explica a armadilha do truncamento **como causa
raiz do vazamento original** — e o truncamento de 03/08 foi escrito três
parágrafos abaixo daquele texto, dentro do detector do próprio problema.

O documento existia. Servia. Não foi lido.

Antes de escrever numa área, **ler o cabeçalho do arquivo e procurar se o que
vai ser construído já existe**. A sonda de orderbook custou meio dia de trabalho
duplicado por essa razão: ela já rodava havia seis dias, com 4.085 medições
corretas, num feed que ninguém agregava.
