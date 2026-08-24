# PLANO — ÚLFHÉÐNAR: onde a matilha se reporta

**Status: 🟢 entregue** · 23–24/08 · plano, migration, rota, painel e rename.

> **O que é:** a aba onde o dono vê o que os agentes fizeram e por quê, e onde
> ele pergunta a eles — de forma ASSÍNCRONA, que é a única que funciona.

---

## 1. O nome — e por que ele mudou duas vezes

Os **Úlfhéðnar** ("os de pele de lobo") são a irmandade de elite de Odin: os
guerreiros que lutavam vestidos em peles de lobo, primos dos berserkir, citados
na *Vatnsdæla saga* e no *Haraldskvæði*. O que os define e serve a esta aba é
que eles **atacavam como matilha** — coordenados, não cada um por si. É o que
duas sessões de agente precisam fazer no mesmo repositório.

⚠️ **ESTA ABA JÁ SE CHAMOU EINHERJAR, E O NOME ESTAVA ERRADO — ERRO MEU.**

`Einherjar` já era o tier pago de US$ 159/mês em `pricing/plans.ts` ("escolhido
de Valhalla"). Eu batizei a aba assim sem conferir a lista de tiers. Duas coisas
com um nome só no mesmo produto é confusão plantada: quem grepasse "einherjar"
acharia o plano do cliente e o mural dos agentes na mesma busca.

⚠️ **E O PRIMEIRO SUBSTITUTO TERIA SIDO PIOR.** Eu ofereci `Berserkir` ao dono,
que escolheu. Só ao ir mexer é que conferi a lista inteira: **`Berserkr` também
é tier** (US$ 20,90/mês). Teria trocado uma colisão exata por uma de uma letra,
que lê como erro de digitação. Voltei e perguntei antes de fazer o trabalho.

> A lição não é "escolhi mal um nome". É que eu ofereci opções **sem ler a
> fonte** — `plans.ts` estava a um `grep` de distância nas duas vezes.

Os três nomes da Hird ficam reservados aos tiers: **Drengr · Berserkr ·
Einherjar**. A runa da aba é **ᚢ** (Uruz), não ᛒ nem ᛖ, que são dos tiers.

## 2. ⚠️ O QUE ESTA ABA NÃO É, E POR QUE ISSO VEM PRIMEIRO

### Não é chat ao vivo, e não pode ser

Uma página web **não consegue injetar mensagem numa sessão do Claude Code
rodando na máquina do dono**. Não existe canal de entrada: a sessão lê quando
ela roda, e não há como "tocar o telefone dela". Verificado em 23/08 — o
`ListAgents` não enxerga sessões entre máquinas diferentes.

Construir uma caixa de chat que sugere resposta imediata seria exatamente o
defeito que as auditorias de 23/08 acharam dez vezes: **interface afirmando o
que o sistema não faz**. A tela DIZ que é assíncrono, com o tempo desde a
pergunta e o estado de leitura visíveis.

### Não abre cheia de conversa antiga

Até 23/08 as duas sessões **nunca trocaram uma mensagem**. A coordenação foi
pelo git e pelo `ESTADO-ATUAL.md`. Um painel de "conversas entre agentes"
abriria vazio, e vazio-por-ausência precisa dizer que é ausência — não fingir
que o histórico sumiu.

## 3. O que a aba MOSTRA — três painéis

### 3.1 O SALÃO — o que os agentes fizeram, e por quê

Linha do tempo montada do `platform_events`, que já registra o trabalho real:
medições de laboratório, alertas, ticks do celeiro, disparos do autopilot,
volante de aprendizado.

⚠️ **Isto funciona HOJE, sem nada novo.** É o registro que já existe, hoje
espalhado por painéis diferentes, reunido numa linha só e legível.

⚠️ **O que NÃO entra: commits e PRs.** Eles vivem no GitHub, não no banco, e a
aplicação não tem token para lê-los. Um painel que promete "tudo que os agentes
fizeram" e silenciosamente omite metade seria pior que um que declara o
recorte. A linha do tempo diz, no rodapé, que o registro de código está no
GitHub.

### 3.2 A CAIXA — perguntar e ser respondido

O dono escreve para um agente (ou para todos). A mensagem vira linha na tabela.
**Na próxima vez que aquele agente trabalhar, ele lê a caixa e responde ali.**

Cada mensagem mostra:

```
para: nuvem · "por que o teto de cotação caiu para 600?"
perguntado há 12 min · AINDA NÃO LIDO
```

⚠️ **"Ainda não lido" é informação, não enfeite.** É a diferença entre "o
agente não respondeu" e "o agente nem viu" — e sem isso o dono ficaria
esperando alguém que não sabe que foi chamado.

### 3.3 QUEM ESTÁ ONDE — o mural

O `admin_kv["agente:<nome>"]` do `PLANO-MURAL-DE-AGENTES.md`: setor declarado,
branch, e TTL. Declaração vencida aparece MARCADA, não some.

## 4. O modelo de dados

Tabela nova `ulfhednar_mensagens`, porque caixa de entrada precisa de estado de
leitura e de resposta — coisas que `platform_events` (append-only, sem update)
não modela bem.

```sql
de          text         -- 'dono' | 'nuvem' | 'vscode'
para        text         -- destinatário, ou 'todos'
assunto     text
corpo       text
criado_em   timestamptz
lido_em     timestamptz  -- null = nem viu
resposta    text         -- null = não respondeu
respondido_em timestamptz
```

⚠️ **RLS habilitada com ZERO políticas**, como toda tabela desta casa. O acesso
é só pela service key, e a rota é `requireAdmin`.

## 5. Como um agente usa

No começo de uma sessão, ou entre entregas:

1. lê as mensagens onde `para` = seu nome (ou `todos`) e `lido_em is null`
2. marca como lida
3. responde o que souber

⚠️ **Ler a caixa é responsabilidade do agente, e nada obriga.** É a mesma
fragilidade do mural, e ela está escrita aqui pelo mesmo motivo: um canal que
depende de alguém lembrar de olhar falha eventualmente. O que reduz o risco é a
caixa aparecer no `ESTADO-ATUAL.md` como passo da rotina de retomada.

## 6. O que isto NÃO resolve

1. **Latência.** Minutos a horas, dependendo de quando o agente rodar. Para a
   sessão da nuvem pode ser mais rápido (ela acorda com eventos do GitHub);
   para a do VSCode, é quando o dono abrir.
2. **Conversa entre agentes em tempo real.** Continua não existindo.
3. **O histórico anterior a 23/08.** Não há — eles nunca conversaram.

## 7. Se o dono quiser resposta em SEGUNDOS

É outro produto, e vale dizer com clareza: seria um agente rodando DENTRO da
plataforma (como o ZION já roda), com acesso de leitura ao banco. Ele
responderia na hora — mas **não é o agente que auditou a ponte**. É um novo,
que leria o mesmo registro.

Os dois podem coexistir: o ZION responde o "o que está acontecendo agora"; a
caixa responde o "por que você decidiu assim", que só quem decidiu sabe.

## 7.1 ⚠️⚠️ O BLOQUEIO: o tipo `Database` está no limite do TypeScript

**A migration foi escrita e APLICADA no banco. A UI parou aqui**, e o motivo é
maior que esta aba.

Ao registrar `ulfhednar_mensagens` no tipo `Database` (`lib/supabase/types.ts`),
que passaria a ter **20 tabelas**, o type-check quebrou em DOIS ARQUIVOS QUE
NINGUÉM TOCOU:

```
src/lib/zion/sniper.ts  Argument of type '{...}[]' is not assignable to 'never[]'
src/lib/zion/ullr.ts    Argument of type '{...}[]' is not assignable to 'never[]'
```

O `zion_suggestions` — tabela que existe e sempre funcionou — passou a resolver
como **`never`**.

### Isolado em dois testes

| teste | resultado |
|---|---|
| remover só a entrada nova | os erros somem |
| manter a entrada, na forma mais simples possível | **os erros continuam** |

**É a CONTAGEM de tabelas, não a forma da entrada.** A profundidade de
inferência do supabase-js estoura, e o TypeScript degrada EM SILÊNCIO: ele não
diz "limite atingido", ele resolve outras tabelas como `never`.

### Por que isto é urgente e não é sobre esta aba

⚠️ **O ERRO APARECE LONGE DA CAUSA.** Quem adicionar a próxima tabela vai ver o
build quebrar em `sniper.ts` e `ullr.ts` e procurar ali — quando o problema está
em `types.ts`.

⚠️ **E a outra sessão está criando tabelas.** `celeiro_genoma`, `celeiro_posicoes`,
`celeiro_fluxos` e `celeiro_mutacoes` são recentes. A próxima que ela registrar
cai nesta armadilha.

É a mesma família de tudo que as auditorias de 23/08 acharam: falha silenciosa
que se disfarça de outra coisa.

### As duas saídas

**(a) Contornar** — a tabela nova fica FORA do tipo `Database`, acessada com um
cast local e comentário explicando. Contido, não toca em nada existente, e a
aba sai. Mas deixa o teto lá.

**(b) Consertar o teto** — refatorar o `Database` (dividir por domínio, ou
simplificar as entradas mais verbosas) para caber mais tabelas.

⚠️ **(b) toca um arquivo que as DUAS sessões usam**, enquanto a outra está
criando tabelas do celeiro. É exatamente o cenário de colisão que o
`PLANO-MURAL-DE-AGENTES.md` descreve. Merece PR próprio e supervisão do dono —
não caronar numa entrega de UI.

**Recomendação: (a) agora, (b) como próximo trabalho.**

---

## 8. Ordem de entrega

1. Migration `0029_ulfhednar_mensagens.sql`
2. `lib/ulfhednar/mensagens.ts` — puro + IO, com testes
3. Rota `admin/api/ulfhednar` (GET lê tudo, POST escreve mensagem)
4. Painel `ÚlfhéðnarPanel.tsx` + registro em `modules.ts` **e** `panel-map.tsx`
   (invariante nº 32 — id sem componente compila e a tela fica vazia)
5. Área própria em `areas.ts`
