# PLANO — o mural de agentes: dois cérebros, um repositório

**Status: 🔴 desenhado, nada implementado** · 23/08.

> **Em uma frase:** um quadro compartilhado no banco onde cada agente declara
> em que setor está mexendo e deixa recado para os outros — para que a
> coordenação pare de depender de alguém conferir à mão.

---

## 1. O problema, com o caso real de hoje

Em 23/08 duas sessões trabalharam no mesmo repositório ao mesmo tempo: uma no
VSCode (celeiro, agentes, ZION) e outra na nuvem (auditoria de ponte e
autopilot). Quatro PRs de um lado, cinco commits do outro, no mesmo dia.

**Não houve colisão — e é importante entender POR QUE não houve:**

1. `--force-with-lease` **recusou dois pushes** porque a branch tinha andado.
   Nas duas vezes o trabalho do outro foi preservado empilhando por cima.
2. Antes de cada merge, a interseção de arquivos foi conferida **à mão**:
   ```
   sessão A → autopilot/cron · positions-server · sessions
   sessão B → celeiro/cron · OBSERVACAO-CELEIRO-23AGO.md
   interseção → ZERO
   ```

⚠️ **O item 1 é uma trava. O item 2 é disciplina.** Travas seguram sempre;
disciplina segura enquanto ninguém está com pressa — e a reta final de um beta
é exatamente quando a pressa aparece.

O mural existe para transformar o item 2 em algo que não dependa de memória.

## 2. O que EXISTE hoje, e por que basta

Nada de tecnologia nova. As duas peças já são usadas para tudo:

| peça | o que já faz | o que o mural acrescenta |
|---|---|---|
| `admin_kv` | kill-switches, gates, `lock:*` do autopilot | `agente:<nome>` — quem está em qual setor |
| `platform_events` | todo evento do sistema | `agente_recado` — mensagem entre sessões |
| painel admin | 50+ módulos registrados | um painel que mostra os dois |

⚠️ **O denominador comum é o BANCO, não a máquina.** É isso que faz funcionar
para qualquer sessão do dono — VSCode na máquina dele, nuvem, celular, ou uma
futura — sem depender de as duas estarem no mesmo lugar. Foi verificado em
23/08: o `ListAgents` não enxerga sessões entre máquinas diferentes, e o canal
direto entre elas não existe hoje.

---

## 3. Parte 1 — a declaração de setor

### A chave

```
admin_kv["agente:<nome>"] = {
  setor:     "autopilot",
  arquivos:  ["src/lib/autopilot/*", "src/app/api/autopilot/*"],
  branch:    "claude/autopilot-registro-critico",
  desde:     "2026-08-23T18:00:00Z",
  expira_em: "2026-08-23T18:30:00Z",
  nota:      "corrigindo os dois críticos da auditoria"
}
```

### O TTL não é detalhe, é a peça central

⚠️ **Declaração sem prazo vira lixo que trava todo mundo.** Uma sessão que cai,
é fechada, ou fica sem contexto deixa a chave para trás; sem TTL, o setor fica
"ocupado" para sempre e o mural passa a atrapalhar em vez de ajudar.

30 minutos, renovado a cada entrega. É o mesmo padrão do `tryLockSession` do
autopilot, que usa TTL de 3 min contra tick de 5 justamente para que um cron
morto libere sozinho.

### A regra de uso

**Antes de tocar num setor**, o agente lê o mural:

- setor livre → declara e trabalha
- setor de outro, **declaração viva** → escolhe outro setor, ou deixa recado e
  espera
- setor de outro, **declaração vencida** → assume, e registra que assumiu

⚠️ **AVISA, NÃO BLOQUEIA.** O mural não pode impedir um agente de trabalhar:
se a leitura falhar, se o banco estiver fora, ou se a declaração estiver
vencida por engano, o trabalho tem de continuar. Um quadro de coordenação que
vira portão é um ponto único de falha novo — e o que ele protege (colisão de
escopo) é menos grave do que o que ele quebraria (o agente não trabalhar).

Falha ABERTA, como o filtro de regime da ponte, e pelo mesmo motivo: sem sinal,
não se sabe nada — e não saber não é motivo para parar.

---

## 4. Parte 2 — os recados

```
platform_events: {
  event_type: "agente_recado",
  metadata: {
    de:      "swap-z-app-59",
    para:    "vscode" | "todos",
    assunto: "mexi no messages.ts — 4 locales",
    corpo:   "adicionei addrBurn/addrWrongFamily. Se você tocar no arquivo, puxe a main antes.",
    lido:    false
  }
}
```

Cada agente lê os recados endereçados a ele (ou a `todos`) ao começar uma
sessão, e marca como lido.

⚠️ **ASSÍNCRONO DE PROPÓSITO, e isso não é limitação.** Os ciclos de trabalho
aqui são de minutos — uma auditoria, uma leva de correção, um merge. Tempo real
resolveria um problema que não existe e traria um que existe: duas sessões
conversando enquanto editam é mais chance de agir sobre estado velho, não menos.

---

## 5. Parte 3 — o painel

Módulo novo na área **SISTEMA**, registrado em `modules.ts` **e** em
`panel-map.tsx` (invariante nº 32 — id declarado sem componente compila, passa
no lint, passa nos testes, e a tela fica vazia).

Duas listas:

```
QUEM ESTÁ ONDE
  vscode           celeiro/agentes      há 12 min    expira em 18 min
  swap-z-app-59    autopilot            há 40 min    ⚠ VENCIDA

RECADOS PENDENTES
  → vscode   "mexi no messages.ts — 4 locales"        há 5 min
```

⚠️ Declaração vencida aparece marcada, não some: sumir esconderia que alguém
trabalhou ali e não fechou.

---

## 6. ⚠️ O QUE ESTE PLANO NÃO RESOLVE — e por que está escrito aqui

**O mural é CONVENIÊNCIA, não garantia.** Ele depende de os agentes lembrarem
de escrever nele, e tudo que depende de lembrar falha eventualmente.

A linha de defesa real continua sendo mecânica, e ela já funciona:

| trava | por que ela segura |
|---|---|
| branch por agente, nunca commit direto na `main` | conflito vira merge, não sobrescrita |
| `--force-with-lease`, **nunca** `--force` | recusou dois pushes em 23/08 |
| `git diff main HEAD` (dois pontos) antes de mergear | mostra o que muda de fato |
| `git cherry origin/main <branch>` | prova por patch se algo ficou de fora |

⚠️ **O diff de TRÊS pontos engana.** Em 23/08 ele mostrou 10 arquivos e 1.095
linhas — incluindo trabalho da outra sessão que parecia estar prestes a ser
revertido. O de dois pontos mostrou **3**. Três pontos responde "o que esta
branch fez desde que nasceu"; dois pontos responde "o que muda se eu mergear",
e é a segunda que decide.

**Se for para escolher uma só coisa deste documento**, que seja a tabela acima —
não o mural.

## 7. O que isto NÃO é

1. **Não é chat em tempo real.** Não existe hoje canal direto entre sessões em
   máquinas diferentes; verificado em 23/08.
2. **Não é lock de arquivo.** Não impede ninguém de editar nada.
3. **Não substitui o `ESTADO-ATUAL.md`**, que continua sendo o ponto de
   retomada. O mural é o *agora*; o documento é o *acumulado*.

## 8. Ordem de entrega

1. **A tabela de travas na seção 6, escrita no `CLAUDE.md`** — é o único item
   que protege de verdade, e não custa código nenhum.
2. `lib/agentes/mural.ts` — declarar, ler, expirar (puro + testes).
3. Rota admin e painel em SISTEMA.
4. Recados.

⚠️ O passo 1 sozinho entrega a maior parte do valor. Os outros três são
conforto — úteis, mas conforto.
