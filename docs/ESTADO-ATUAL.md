# ESTADO ATUAL — leia isto primeiro

> **O que é:** o ponto de retomada. `CLAUDE.md` diz como o repositório é
> organizado; este documento diz **onde estamos agora**, o que está aberto, e o
> que já custou caro aprender.
>
> **Quando ler:** no começo de qualquer sessão nova, e sempre que o contexto for
> comprimido. Antes de responder qualquer coisa sobre o estado do projeto.
>
> **Quando escrever:** ao fim de cada entrega. Documento desatualizado é pior que
> documento nenhum — dá a impressão de que foi conferido.
>
> **Última atualização:** 23/08/2026, com o Celeiro **vendido em três símbolos**
> por leitura de regime, e o Investigador ligado.

---

## 1. Onde o projeto está

| | |
|---|---|
| `main` | `9b679dd` — em produção desde 23/08 00:01 UTC |
| CI | verde · **117 arquivos de teste** |
| Provedor de IA | **Kimi** (`AI_PROVIDER=kimi`) — temporário, sem crédito na Anthropic |
| Banco | Supabase `vuvvftdsfmagmtbovzgq` (projeto **z-swap**) |
| Outra mão no código | o agente **`zettaceo`** também commita aqui (ver §1.1) |

Últimos commits, do mais novo:

```
9b679dd  O Investigador liga — de escrito-e-parado para rodando (#333)
9181855  Retorno sobre capital — deixa de premiar quem arrisca mais (#332)
4c3aad4  Os dois agentes de tendência, a banca declarada (#331)
1733d5f  As três invariantes que faltavam — o Maker perdeu acertando 65% (#330)
ed97961  ESTADO-ATUAL: o Celeiro produzindo, o Kimi temporário (#329)
224429d  O painel do Celeiro ganha o desenho pedido (#328)
720a95f  A plataforma inteira sai da Anthropic e passa a analisar com Kimi (#325)
51465a6  O cinto antes do motor (#324)  ← do zettaceo, não meu
e55a250  O CELEIRO — a segunda arena, e a auditoria que a obrigou (#318)
```

### 1.1 ⚠️ NÃO SOU A ÚNICA MÃO NESTE REPOSITÓRIO

O agente **`zettaceo`** commita aqui também — a #324 é dele. Descobri por acaso,
ao levar um conflito de merge.

**Antes de rebasear ou forçar, confira o que a `main` ganhou enquanto você
trabalhava**, e compare ARQUIVO A ARQUIVO antes de assumir que não há
sobreposição:

```bash
git log --oneline HEAD..origin/main          # o que apareceu
git show --name-only --format="" <sha-dele>  # o que ele tocou
```

Na #324 a sobreposição era zero (ele em `paper/engine`, eu na camada de IA) e o
rebase foi seguro. Da próxima pode não ser.

### Nota da auditoria (18/08): **8,2 / 10**

| área | nota | |
|---|---|---|
| Qualidade de código e testes | 9,0 | era 5,5 em 02/07 — de 0 para 1.440 testes + CI |
| Disciplina de medição | 9,0 | 33 invariantes, cada uma com a cicatriz |
| Segurança | 8,0 | acesso impecável; dependências atrasadas |
| Arquitetura | 7,5 | limpa, mas 24 mesas para ~7 motores |
| Operação / deploy | 7,5 | webhook falhou 1 vez e ninguém soube |
| Documentação | 7,5 | 12.805 linhas; índice quebrou em 8 arquivos |
| Integridade de dados | 7,0 | 13 de 23 carteiras com contador divergente |

---

## 2. O ambiente — leia antes de rodar qualquer coisa

⚠️ **A máquina mudou no meio da sessão de 17/08.** O repositório NÃO está no
diretório de trabalho primário.

| | |
|---|---|
| Máquina | Windows · Git Bash · o cwd é outro projeto (`zetta_analytics_final_ready`) |
| Clone do swap-z | `C:\Users\55849\Downloads\.audit-swapz` |
| Node local | **22.11.0** |
| `gh` CLI | instalado e **autenticado** (`zettaceo`, escopos `repo` + `workflow`) |

⚠️ **A SUÍTE DE TESTES NÃO RODA NESTA MÁQUINA.** O vitest 4 exige Node ≥ 22.12
(`require()` de ESM) e o local é 22.11. `tsc --noEmit` e `npm run lint`
funcionam. **Quem decide sobre testes é o CI.**

⚠️ **E `npm run build` TAMBÉM NÃO FECHA MAIS** (20/08). O webpack COMPILA — sai
`⚠ Compiled with warnings`, só os avisos pré-existentes do wagmi — e o processo
estoura `Error: kill EPERM` no desmonte dos workers do jest, saindo com código 1
antes de imprimir a lista de rotas.

**Confirmado que não é o código:** com `git stash -u` aplicado, o mesmo build no
`HEAD` limpo dá o mesmo exit 1 com as mesmas duas ocorrências de EPERM. É a
máquina. Use o build só para ver se COMPILA (procure a linha `Compiled`), e trate
o exit code como ruído.

⚠️ O checkout vem com CRLF (o git normaliza para LF no commit — confira com
`git show HEAD:arquivo` em caso de dúvida).

⚠️ **Heredoc de bash quebra com conteúdo longo/acentuado** nesta máquina.
Para escrever arquivo grande, use a ferramenta de escrita direta.

✅ **Correção de 19/08: existe Python** — `python 3.13.1` no PATH. A anotação
anterior dizia que não havia, e isso estava errado: `python - <<'PY'` com
heredoc **funciona**, inclusive com acento, e é a forma mais segura de editar
markdown longo (ancore a substituição e faça `assert count == 1` antes de
gravar, para não errar silenciosamente). Para JS, escreva um `.mjs` e rode com
`node` — e **nunca** misture heredoc com `node -e` no mesmo comando.

⚠️ **O ref de rastreio da branch MENTIU por meses — e a causa era o clone.**
Em 19/08, `git fetch origin <branch>` rodou sem erro e `origin/claude/...`
continuou apontando **cinco PRs para trás**. `--prune` também não corrigiu.

A causa: o clone foi feito **single-branch**, e o refspec era

```
remote.origin.fetch = +refs/heads/main:refs/remotes/origin/main
```

Só a `main`. Todo outro ref de rastreio ficou **congelado no valor do dia em que
nasceu**, e nenhum `fetch` jamais o atualizaria. Não era cache velho — era um
ref que o git nunca teve ordem de mexer, e que mesmo assim responde a
`rev-parse` com cara de resposta atual.

**Já corrigido neste clone** (19/08):

```bash
git config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'
git fetch origin --prune
```

⚠️ **Se um dia clonar de novo, não use `--single-branch`** — ou o ref volta a
mentir. E `--force-with-lease=<branch>` sozinho **não protege nada** aqui: ele
ancora justamente no ref podre. Confira no servidor antes de forçar:

```bash
git ls-remote origin claude/swap-z-recovery-deploy-b7y2cw   # a verdade
git rev-parse origin/claude/swap-z-recovery-deploy-b7y2cw   # o que você acha
```

E ancore o lease no SHA que o `ls-remote` devolveu, nunca no nome da branch:
`git push --force-with-lease=<branch>:<sha-do-ls-remote>`.

Como a branch é sempre squash-merged, o normal é o remote dela ficar com UM
commit órfão de conteúdo idêntico à `main`. Confirme que é isso antes de forçar:
`git diff <sha-remoto> origin/main --stat` tem que sair **vazio**.

> Ferramenta de segurança apontada para a fonte errada dá a sensação da
> proteção sem a proteção. Foi assim que a GERI morreu em #304.

Para retomar:

```bash
export PATH="$PATH:/c/Program Files/GitHub CLI"
cd /c/Users/55849/Downloads/.audit-swapz
git fetch origin --prune --quiet
git checkout -B claude/swap-z-recovery-deploy-b7y2cw origin/main
```

---

## 3. O dono, e como ele trabalha

Chama-se **General** (CEO e fundador); eu sou co-CEO técnico. Escreve rápido, com
erros de digitação — leia a intenção (`gare.io` = Gate.io, `corte` = coorte).

Regras permanentes dele:

- Branch de trabalho: `claude/swap-z-recovery-deploy-b7y2cw`. **Nunca empurrar
  para a `main` sem ordem explícita.**
- Não abrir PR sem ele pedir — mas ele pede com frequência ("manda pra main").
- **Solana não cobra taxa.** Decisão final, não reabrir.
- Tudo tem que caber na tela sem arrastar para os lados. Revisto em 17/08: pode
  rolar DENTRO de uma área, e o menu leva a cada item em tela própria.
- Ele usa o painel no PC do escritório e no celular quando viaja.
- **"cada centavo importa"** — o dinheiro em jogo é dele.

O que ele mais valoriza: medir antes de afirmar. A crítica mais útil que ele já
fez foi *"não confio na tarefa que vc executou, revisa tudo"* — e ele estava
certo. Quando ele discorda de uma leitura minha, **medir** antes de responder:
ele acertou nas duas vezes em que discordou (a GERI aprendendo, e a pilha de
mesas misturadas).

---

## 4. O que está aberto, em ordem

### Depende dele (não consigo fazer)

1. **Reativar a Anthropic quando o saldo voltar** — `AI_PROVIDER=anthropic` +
   `ANTHROPIC_API_KEY` na Vercel, e redeploy. **É só isso.** O passo a passo, o
   que muda de verdade (o cache de prompt volta) e como conferir estão em
   `docs/TROCAR-DE-PROVEDOR.md`.
2. **Decidir sobre a página de preços enquanto durar o Kimi.** Ela vende
   "Sonnet 4.6" (Pro/Trader) e "Claude Opus 4.8" (Pilot, 30 SOL). Se a volta for
   em dias, deixar assim é o certo. Se demorar semanas com gente comprando,
   precisa de aviso na vitrine — a página descreve o que não está entregando.
3. **Decidir sobre o `next`.** A única correção é a **16.3.1** — major 14 para
   16, 21 advisories em jogo. É migração com branch e plano próprios, não audit
   fix.

✅ **Feito em 18/08** — alinhamento do contador: 13 → 10 divergentes. As 3 vivas
(radar, mistral, arbiter2) corrigidas; as 10 aposentadas preservadas de
propósito, porque cicatriz não se reescreve.

✅ **Feito em 19/08** — teste da carteira Coinbase, **passou**. Com o COOP em
`same-origin-allow-popups`, o popup de `keys.coinbase.com` abre e oferece
"Entrar com a Base" (QR ou passkey) — exatamente o passo que morria antes com
*"window.opener está inacessível"*. Fecha duas coisas de uma vez: a Smart Wallet
volta a funcionar depois de semanas morta, e a verificação do override do
`axios` sai de PARCIAL para **completa** — o SDK carrega, faz rede e conclui o
fluxo com a versão nova.

### O CELEIRO — a segunda arena (construída em 19–20/08)

Torneio novo, separado, placar em **USDT acumulado**. Nasceu de uma medição: num
passeio aleatório P(alvo antes do stop) = `stop/(alvo+stop)`, e as seis mesas de
LLM ficaram de **−6,7 a −30,4 pp ABAIXO disso** em 3.300 decisões. Prever direção
com modelo é pior que jogar moeda — a família inteira saiu.

⚠️⚠️ **CORREÇÃO DE 22/08 — eu generalizei errado.** Daquela medição eu escrevi
"nenhum agente aposta em direção", e isso está errado: o que se mediu foi LLM
**PREVENDO** direção. **Seguir tendência MEDIDA é outra coisa** — é reagir a um
estado observável, e a #324 mediu que isso PAGA (5,5× mais quando a posição
cresce). A regra correta: **o lado vem do regime medido, nunca da opinião de um
modelo.**

Desenho em `docs/PLANO-O-CELEIRO.md` + a correção em
`docs/PLANO-CELEIRO-AMBICIOSO.md`. **Seis agentes**, quatro sem direção e dois de
tendência. A IA é o **Investigador**: não opera, lê o extrato decomposto (taxa,
derrapagem, funding, preço), propõe UMA mutação de parâmetro com resultado
escrito antes, e é pontuada pelo **USDT que a mutação gerou** contra o braço que
não mudou.

#### ⚠️⚠️ O MAKER DE FAIXA MORREU, E A AUTÓPSIA MUDOU O PROJETO

Ele rodou 29 posições e ficou **NEGATIVO acertando 65,5%**:

    preço      +3,1557   (+0,1088 por operação)
    taxa       −3,3750   (−0,0563 × 2 pernas)
    líquido    −0,2339

**O trade médio ganhava $0,1088 e pagava $0,1125 de pedágio.** Perdia por
CONSTRUÇÃO — alvo de 0,6% contra ida-e-volta de 0,225%.

⚠️ **E AUMENTAR O TAMANHO NÃO CONSERTA**: a taxa é proporcional ao nocional. O
que muda a razão é o TAMANHO DO MOVIMENTO — swing, não escalpe. Foi apagado, não
ajustado: subir o alvo para 1,35% consertaria a conta e destruiria a tese.

#### ✅ O QUE ESTÁ RODANDO (23/08, madrugada)

Seis agentes, cron de 30 min. **O Alavancado de Tendência está VENDIDO em
BTC, ETH e SOL** — o mercado virou baixa e ele tomou o lado:

| símbolo | lado | alavanca | liquida em |
|---|---|---|---|
| BTC | **sell** | **10×** | 10,0% |
| ETH | **sell** | **8×** | 12,5% |
| SOL | **sell** | **3×** | 33,3% |

⚠️ **TRÊS ALAVANCAS DIFERENTES PARA A MESMA DECISÃO, e isso é o desenho.** O SOL
tem volatilidade de 0,98% por vela contra 0,32% do BTC — a conta devolveu 3%
onde o BTC aguentou 10×. A alavanca sai do risco MEDIDO de cada ativo.

Exposição em **$600 de $1.000 = 60%**, exatamente o teto do agente. Abriu três e
parou.

**E as recusas também estão certas**, com o motivo literal no log:
o Caçador de Tendência não abriu nada — *"este agente é spot e não vende: na
baixa ele fica de fora"*; a Convergência recusou os três — *"operar no empate é
pagar risco por nada"*.

⚠️ **TUDO EM PAPEL, de propósito.** Só se liga credencial quando o extrato
provar USDT positivo em amostra que aguente.

#### As três invariantes que o cadáver do Maker exigiu

| | regra |
|---|---|
| **I1** | o alvo tem de limpar o pedágio por **6×** (mínimo 1,35%) |
| **I2** | o **regime** decide se opera e de que lado — e *sangrando* ≠ *baixa* |
| **I3** | a alavanca sai do **pior movimento pico-a-vale**, com folga 2× |

E a **banca declarada** por agente (`bancaUsd`, `fracaoPorPosicao`,
`tetoDeExposicao`, `alavancagemMaxima`) substituiu o `Math.max(capitalMinimoUsd,
50)` que vivia escrito na mão dentro do cron.

#### O Investigador: LIGADO, mas ainda sem rodar um ciclo

O ciclo está no cron desde `9b679dd`. **Ainda não produziu mutação nenhuma**, e
por dois motivos legítimos:

1. o deploy entrou às 00:01:16 e o último tick foi 00:00:27 — 49s antes;
2. ele exige **30 lançamentos na janela** para perguntar, e só o Aluguel de
   Ocioso tem — que é o controle e **não é investigado de propósito**.

O primeiro ciclo real leva alguns dias até um agente acumular extrato. Isso é o
desenho, não atraso.

### Decisões dele, não minhas

3. **A pilha das 24 mesas para ~7 motores** (parte 3 do "item B"). Crítica dele:
   *"vc fez a porra toda junto e misturado"*. O Setor E foi o primeiro corte.
   `runBacktestScanForProvider` é UMA função por 6 modelos; `selectPlaybook` é
   UMA biblioteca por 5 políticas; `arbiter2` é UM motor por 3 alavancagens.
4. **A fronteira de custo no ledger de papel** (`FRONTEIRA_CUSTO_ISO`): arquivar
   a rodada e recomeçar com a régua nova, ou conviver e cortar nas leituras.

### Trabalho meu, quando ele mandar

6. **Fase 2 da UI** — os painéis ganharam ESPAÇO em tela própria, não o USO dele.
   O torneio tem largura total e continua desenhado para coluna de 400px. Falta
   também o menu de bandeja no celular.
7. **Guarda de SHA** — comparar o `VERCEL_GIT_COMMIT_SHA` servido com o HEAD da
   `main`. Em 17/08 um merge não disparou build (1 em 17) e só foi descoberto
   porque ele foi procurar um botão.
8. **Retenção do `platform_events`** — 522 linhas por dia, sem política.
9. **Derrapagem de TEMPO** — exige `quoted_price` contra `executed_price` em
   ordem real. Sem isso todo resultado do laboratório é um PISO, não um número.
10. `cron-job.org` é ponto único de agendamento.

---

## 5. Perguntas em aberto — medições que ainda não responderam

| pergunta | como responder |
|---|---|
| O teto de credibilidade do arbitrador está cego? | botão **JULGAR AS DESCARTADAS** em MEDIÇÕES. `REAL = 0` fecha a questão: a estratégia não paga neste custo e as 4 mesas estão corretamente paradas |
| A derrapagem cabe no orçamento em tamanhos maiores? | botão **MEDIR A DERRAPAGEM**. A $50 deu impacto **0,000%** e sobra **0,000** — a taxa come o orçamento inteiro. Os outros 5 tamanhos aparecem na tela mas **não ficam gravados** no evento |
| Por que a GERI não emite sinal? | ela só voltou a `live` no `ba30cc2` (18/08); antes o `isArquivada` bloqueava. **Conferir se escaneia depois do deploy** |
| Por que nenhuma lição nova desde 16/08 02:30? | o volante foi religado no #303 e `agent_lessons` tem 18 linhas. Conferir `naoRefletidos` contra o limiar de 10 |

---

## 5.1 A AUDITORIA DA #324 (do zettaceo) — um achado em aberto

Auditei o trabalho dele em 22/08. **A medição reproduz ao centavo**: ele afirma
206 posições e +$126,98, e a posição nº 206 fechou às 22:01:14 com acumulado de
exatamente +$126,98. `tendencia24h` não tem viés de antecipação, está LIGADO no
abridor, e os testes cobrem o caso central.

⚠️ **O ACHADO, AINDA ABERTO:** o filtro de tendência faz **~720 chamadas/dia** à
Gate.io (15 símbolos × 48 ticks) e **não deixa rastro nenhum** quando não barra
ninguém — `paper_regime_tick` só grava se bloqueou alguém ou estourou o teto.

Hoje isso é correto (mercado subindo, filtro passa tudo). Mas é
**indistinguível de estar quebrado**: se a Gate.io limitar taxa, tudo volta
`null`, o filtro passa tudo, e a tela fica idêntica. Falha-aberta + ausência de
registro é a combinação exata das cicatrizes desta casa.

O conserto é pequeno: gravar quando o filtro AVALIOU — quantos símbolos deram
sinal e quantos vieram `null`.

---

## 6. O que custou caro aprender (além das 33 invariantes)

**A regressão que passou verde.** A PR #304 mergeou o `EM_PROVA` do `cull.ts` e
o plano, mas **nenhuma linha de `desks.ts`** — a edição morreu num
`git reset --hard` de ressincronização. O repo passou dois dias com a GERI ainda
arquivada, uma isenção de corte protegendo mesa morta, e **nada acusou**, porque
o teste seguia afirmando o estado antigo — que era, de fato, o estado do código.

> Depois de um `git reset --hard`, confira o que o commit REALMENTE levou.
> `git show <sha> --stat -- <arquivo>` vazio quando você esperava mudança é a
> pista. Eu afirmei ao dono que estava feito, e não estava.

**Eu inventei uma causa a partir de um vazio.** Li `offered: 0` nas mesas e
afirmei, com tabela, que elas tinham parado de ver preço. O instrumento que eu
mesmo tinha subido horas antes (`market_data_cego`) me desmentiu no primeiro
tick: todo símbolo tinha preço. A biblioteca estava **recusando**, não cegando.
É a invariante nº 33, escrita por mim de manhã e violada por mim à tarde.

**A auditoria só achou a regressão porque clonei do zero.** Auditar a partir da
memória da sessão teria repetido o erro — eu tinha certeza e estava errado.
Leia o código, não a lembrança dele.

**Um header de segurança matou um meio de conexão, e o CI ficou verde.**
`Cross-Origin-Opener-Policy: same-origin` quebrou a Coinbase Smart Wallet no
commit `fc24aa3` e ninguém soube por semanas — nada no repositório conecta
carteira, então o defeito só existia no navegador do usuário. O dono achou por
acaso, testando outra coisa. Corrigido em #314 com trava em
`headers-carteira.test.ts`, e **confirmado em 19/08 pelo único juiz que valia:
o navegador dele**, conectando de verdade.

E note o que o conserto exigiu: o `curl` do header voltando
`same-origin-allow-popups` provava o deploy, **não** a carteira. Só o clique
prova a carteira. Header servido não é fluxo funcionando.

> Endurecimento de segurança que passa no CI não é endurecimento verificado.
> O que o CI não exercita, o CI não protege.

**Generalizar uma medição para além do que ela mediu custa um projeto inteiro.**
Medi que LLM **PREVENDO** direção fica abaixo de uma moeda, e daí escrevi
"nenhum agente aposta em direção". Seguir tendência MEDIDA é outra coisa — e a
prova estava no próprio repositório, na #324 que eu tinha acabado de auditar.
Três dias de desenho foram na direção errada por causa de uma palavra.

> A medição diz exatamente o que mediu. Tudo além disso é opinião com cara de
> dado.

**Um alvo que não cobre o pedágio perde sem o mercado opinar.** O Maker de
Faixa acertou 19 de 29 e ficou negativo: ganhava $0,1088 de preço e pagava
$0,1125 de corretagem. Nenhum backtest tinha dito isso, e nenhuma taxa de acerto
teria salvado.

> Antes de perguntar se a estratégia funciona, pergunte se a ARITMÉTICA fecha.
> E aumentar a aposta não conserta: a taxa é proporcional.

**Não pergunte "o quê" sem perguntar "por quanto tempo".** O dono pediu para
trocar tudo para Kimi. Eu li como MIGRAÇÃO e apaguei o `anthropicChat`, tirei o
SDK do `package.json`, removi o ramo do `retro`. Era uma PAUSA por falta de
crédito — *"depois eu volto"*. Transformei uma decisão de ORÇAMENTO em tarefa de
código, e tive de desfazer no dia seguinte.

> Mudança temporária pede um seletor, não uma migração. A pergunta que faltou
> era "isso é definitivo?", e ela custa uma frase.

**A causa costuma estar escrita no arquivo que você já leu.** O ZION devolveu
400 em toda chamada porque faltou o `extraBody` que desliga o thinking do Kimi —
e o `registry.ts` diz, em texto: *"sending the wrong one 400s"*. Eu li aquele
comentário, usei o campo certo em `narratives` e `autopilot`, e esqueci na
função que EU acabara de escrever.

> Copiar a assinatura de um irmão que funciona é mais seguro que reescrevê-la
> de memória.

**Três guardas do repositório me reprovaram em 48h, e os três estavam certos:**
o `admin-css.test.ts` (classes que não existem), o `mesa-arquivada-nao-gasta`
(caminho novo gastando fora do inventário) e o `legibilidade.test.ts` (texto de
9px). Nenhum deles teria sido pego em revisão — os três são CONTA, e conta
confere-se sozinha.

**Teste que copia a constante que deveria conferir não confere nada.**
`pnl-math.test.ts` tinha `const COST = 0.2` na mão: oito asserções verdes sobre
metade da taxa real.

**Mutação passa quando o caso de teste não distingue.** Trocar mediana por média
não derrubou nada, porque meus três casos tinham mediana igual à média.

**Guarda novo também erra.** O teste que criei para pegar "diagnóstico sem
conserto" reprovou na primeira execução — ancorava no nome do campo, cuja
primeira ocorrência é a definição de tipo, 200 linhas acima do JSX. Falso
positivo custa a mesma credibilidade que falso negativo.

---

## 7. Onde as coisas moram

| assunto | caminho |
|---|---|
| Mapa do repositório | `CLAUDE.md` |
| **As 33 invariantes** | `docs/INVARIANTES-DE-MEDICAO.md` — ler antes de cada fase |
| Índice de todos os docs | `docs/README.md` — doc novo entra ali **no mesmo commit** |
| Env vars e incidentes | `docs/RUNBOOK.md` |
| Registro das mesas | `src/lib/zion/desks.ts` (fonte única) |
| Custo | `src/lib/zion/custo.ts` — um primitivo, nomes inconfundíveis |
| Reparo das carteiras | `src/lib/paper/reconcile.ts` |
| Registro de painéis | `src/lib/admin/modules.ts` **e** `src/components/admin/panel-map.tsx` (as duas pontas) |
| Áreas do painel | `src/lib/admin/areas.ts` |

---

## 7.1 Os documentos novos (19–23/08)

| documento | para quê |
|---|---|
| `PLANO-O-CELEIRO.md` | o desenho da segunda arena e a medição que a obriga |
| `PLANO-CELEIRO-AMBICIOSO.md` | **a correção de 22/08** — o Maker perdeu acertando 65%, e as três invariantes que faltavam |
| `AUDITORIA-MESAS-19-08.md` | por que o livro antigo é negativo ANTES do custo |
| `TROCAR-DE-PROVEDOR.md` | **Kimi ↔ Anthropic numa variável** — leia ao reabastecer |
| `PLANO-TAMANHO-E-REGIME.md` | do zettaceo: filtro de tendência e tamanho de posição |

---

## 8. Rotina de encerramento

Antes de terminar qualquer entrega:

1. `tsc --noEmit` + `lint` + `build` localmente (testes: **CI**).
2. PR, esperar CI verde, mergear só com ordem dele.
3. Conferir que o deploy de produção disparou (já falhou 1 vez em 17).
4. **Atualizar este documento** — estado, o que está aberto, e o que doeu.
5. Doc novo? Entra no `docs/README.md` no mesmo commit.
