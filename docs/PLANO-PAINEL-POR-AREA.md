# PLANO — o painel deixa de ser um monte

**Status: 🟡 fase 1 entregue** · 16/08, a pedido do dono.

> *"só porque é um painel admin inspirado em terminal cyberpunk não é obrigado
> ficar essa bagunça, tudo amontoado (…) veja o laboratório, está um amontoado
> de grades espremidas para tudo, sendo que muita coisa ali merece sua própria
> UI (…) temos que organizar esse caos de forma premium e bem separada"*

---

## O estado que ele descreveu, em número

**51 painéis** num `grid auto-fill minmax(400px, 1fr)` chapado. Sem hierarquia:
uma tabela de torneio com sete colunas e um número solto recebiam a mesma caixa.

E **20 deles numa categoria só** (`lab`). As "categorias" eram chips que
FILTRAVAM — escondiam o resto e mantinham você na mesma tela.

## A diferença entre filtro e menu

Não é estética. Um filtro te deixa onde você está com menos coisa à vista; a
página continua sendo "tudo". Um **menu te leva a um lugar**, e o lugar pode ter
layout próprio, título próprio, respiro próprio. Era isso que faltava.

## O modelo, nas palavras do dono

> *"quando escolher laboratório vai aparecer todos os itens que tem no
> laboratório, daí você navega no menu e escolhe o item que você quer ir e vai
> abrir o item com sua UI dedicada; e caso selecione a opção ALL do laboratório
> pode ir para a UI que rola dentro de cada área"*

Três telas:

| rota | o que é |
|---|---|
| `/admin` | as 7 áreas, cada uma com a PERGUNTA que responde |
| `/admin/area/<área>` | os itens da área, em cartão · botão `ALL` |
| `/admin/area/<área>/<painel>` | **um painel, a tela inteira** |
| `/admin/area/<área>?all=1` | a grade rolável — da área, não das 51 |

O caminho vive na **URL**, não em estado. É o que faz "manda o link do torneio"
funcionar, o botão voltar voltar, e recarregar não jogar o dono no começo — ele
abre no PC do escritório e no celular quando viaja.

## A divisão: MESAS ≠ MEDIÇÕES

A `lab` misturava duas coisas que não são a mesma:

- **quem OPERA** — torneio, carteira paper, aprendizado, ligas, barra de
  lançamento. Mesas vivas, dinheiro simulado andando agora.
- **o que MEDE** — backtests, custo de corretora, liquidez, rotação de grade.
  Perguntas sobre o passado, sem mesa nenhuma do outro lado.

É a **mesma separação que o dono cobrou dias antes**, sobre os conceitos:
*"mesa, estratégia, paper, agente, torneio… nada, quando tudo deveria ser
isolado"*. A tela repetia a confusão que o modelo de dados já tinha. Esta é a
primeira vez que a interface concorda com a crítica.

| área | n | |
|---|---|---|
| ⌘ COMANDO | 3 | o que precisa de atenção agora |
| ♛ MESAS | 8 | quem opera, com que resultado, aprendendo o quê |
| 🔬 MEDIÇÕES | 12 | o que o histórico diz sobre cada estratégia |
| 💰 DINHEIRO | 7 | quanto entrou, custou, sobrou |
| ⚙ OPERAÇÃO | 4 | autopilot e sessões |
| 👥 PESSOAS | 4 | quem usa, quanto cresce |
| 🛡 SISTEMA | 13 | travas, auditoria, saúde, registro |

O monte de 20 virou **8 + 12**, e nada passa de 13.

### Área não é categoria

A `category` de cada módulo continua existindo e governa o chip antigo. A área é
uma camada **acima** dela, com mapa explícito (`AREA_DA_CATEGORIA`) mais uma
exceção por nome (`MESAS`). Mudar a `category` de dez módulos mexeria no chip, no
layout salvo do dono e na ordem declarada — três coisas com teste próprio, por
causa de uma decisão de navegação.

## ⚠️ A invariante nº 32 finalmente tem teste

O registro diz que um painel EXISTE; o mapa diz quem o DESENHA. Nada obrigava os
dois a concordarem — e em 15/08 eu registrei o painel da taxa da corretora,
importei o componente e **esqueci a linha do mapa**. `tsc`, `lint`, 1338 testes e
o build passaram; a tela ficou vazia; o dono foi procurar o botão e não achou.

`painel-desenhado.test.ts` fecha as **três** pontas por onde a tela fica vazia:

1. módulo no registro sem entrada no mapa
2. entrada no mapa sem módulo no registro
3. componente usado no mapa e não importado

...mais duas da navegação: todo módulo em **exatamente uma** área, e todo id do
registro presente no tipo `ModuleId`.

Mutação conferida: remover a linha `"taxa-cex"` do mapa — o defeito literal de
15/08 — derruba o teste.

E `PainelSozinho` **acusa na tela** em vez de renderizar vazio: na grade o
sintoma era um buraco entre cartões, fácil de não ver; em tela cheia seria a
página inteira em branco.

## O que falta (fase 2)

- **UI dedicada de verdade** para os painéis que pedem: torneio (tabela larga),
  medições (gráfico grande). Hoje eles ganharam o ESPAÇO; ainda não redesenhei o
  conteúdo para usá-lo.
- **Menu de bandeja no celular** — hoje o menu de áreas quebra em linhas.
- Parte 3 do item B (24 mesas → 7 motores) continua aberta.
