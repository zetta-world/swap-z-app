# PLANO — o torneio para de esconder duas coisas

**Status: 🟢 entregue** · 16/08 · partes 1 e 2 do item B combinado com o dono.

O item B nasceu de uma crítica dele:

> *"vc fez a porra toda junto e misturado tá um caos sofisticado (…) e essa
> amostra de 1 decidido vem depois de centenas decididos historicamente"*

Conferi no banco e ele estava certo nas duas coisas.

---

## Parte 1 — a linha que escondia 2.114 decididos

`tournament/route.ts` trazia `.is("archived_at", null)`. A intenção era boa: o
arquivo é história, e uma média vitalícia esconde se um conserto funcionou. O
efeito na tela não era.

| mesa | o que a tela mostrava | o que o arquivo dizia |
|---|---|---|
| GERI | +7,040% · **1** decidido | 691 decididos a −0,517% |
| SLEIPNIR | +2,410% · **1** decidido | 862 decididos a −0,592% |
| MUNINN | +0,903% · **3** decididos | 367 decididos a −0,831% |
| HEIMDALL | −0,183% · 4 decididos | 194 decididos a +0,711% |

**2.114 decididos escondidos.** Uma mesa com 862 trades a −0,59% aparecia como
"+2,41%, 1 trade" — e podia ganhar medalha.

### O conserto não é apagar o filtro

A rodada viva continua respondendo *"o conserto funcionou?"*; a vida inteira
responde *"esta mesa já provou alguma coisa?"*. Trocar uma pela outra só
inverteria qual mentira a tela conta. **As duas aparecem**, coluna `VIDA` ao
lado de `DEC`.

Três decisões dentro disso:

- **Uma leitura, dois baldes.** Duas consultas custariam o dobro e poderiam
  divergir por um trade que resolvesse no meio; aqui os dois números saem das
  mesmas linhas, separados em memória. De quebra, a varredura própria do
  Valhalla sumiu — era a mesma tabela lida uma terceira vez.
- **A vida inteira ignora a janela.** "Vida inteira dos últimos 7 dias" não é
  vida inteira; é a mesma janela com outro nome, e rótulo que mente é pior que
  coluna a menos.
- **Mesa neutra devolve `null`.** O ledger dela é a carteira de papel, que já
  vem filtrada por arquivo. Fabricar um número ali daria uma coluna que parece
  a das outras e mede outra coisa.

### Um buraco de tipo que só apareceu agora

`ZionSuggestionRow` **não declarava `archived_at`**, embora a coluna exista
desde o primeiro arquivamento e meia dúzia de leituras já filtrasse por ela.
Filtrar por campo não declarado passa batido; SELECIONAR não compila. Enquanto
ninguém precisou LER a coluna, o filtro escondia 2.114 decididos e o tipo não
tinha como avisar. É a mesma nota que `PaperPositionRow` já carregava — a lição
estava escrita e não viajou.

---

## Parte 2 — o `nEfetivo` estava certo; errado era o que eu dava a ele

Escrito em 15/08 e aplicado **por mesa**. No dia seguinte apareceu o caso que
ele não pega:

```
UNI · sell_safe · 14/08
  kimi_scan     +5,83   resolvido 11:30
  mistral_scan  +7,04   resolvido 12:00
  radar         +4,93   resolvido 12:00
```

Três mesas, um movimento do UNI. Cada uma tem UM trade, cada uma marca "1
ideia" — e a tela apresentava **três confirmações independentes** de que
`sell_safe` funciona.

Janela de 7 dias inteira: **46 decididos, 23 ideias distintas.** Metade.

Não há função nova: é a MESMA `nEfetivo` recebendo a coorte sem o `source`. Um
segundo algoritmo para o mesmo conceito seria uma segunda definição de "ideia",
e duas definições divergem.

### ⚠️ O dono discordou de um ponto, e tinha razão

As três não são cópias — entrada, alvo, stop e confiança eram diferentes nas
três; cada mesa montou a própria geometria, e a concordância na ENTRADA é sinal
bom.

O que não muda é a **contagem de evidência**: se o UNI tivesse subido 1,9%, as
três perdiam juntas. Independência de raciocínio e independência de RESULTADO
são coisas diferentes, e é a segunda que decide quantas vezes o mundo falou. O
aviso na tela diz exatamente isso, para não virar "as mesas são redundantes".

---

## O que ficou de fora

**Parte 3 do item B — colapsar as 24 mesas em 7 motores.** É mudança de eixo do
painel, não de medição, e merece a própria entrega. O Setor E (16/08) foi o
primeiro corte: separou a família "scanner de modelo" da família "biblioteca de
playbooks", que era a mistura mais cara.

Continua valendo o mapa: `runBacktestScanForProvider` é UMA função sobre a mesma
`marketData` com seis modelos; `selectPlaybook` é UMA biblioteca com cinco
políticas; `arbiter2` é UM motor com três alavancagens.
