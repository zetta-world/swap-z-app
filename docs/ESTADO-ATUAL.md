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
> ⚠️ Os commits #343/#344 dizem **EINHERJAR**: era o nome da aba até 24/08.
> Foi renomeada para **ÚLFHÉÐNAR** porque colidia com um tier pago — §5.4.
>
> **Última atualização (linha `platform-closure`):** 26/09/2026 — Release
> Phase 3 no staging hosted; ver o bloco `platform-closure` abaixo e
> `docs/LEDGER-MESTRE-RELEASE.md` §Z.
>
> **Última atualização (`main`):** 15/09/2026 — **a auditoria externa de 30 achados,
> fechada** (§5.27, PRs #419–#445). Antes disso: 08/09/2026, a leva do PR #410
> (§5.26: sete telas afirmando sobre A o que só era verdade sobre B). E antes,
> 31/08/2026,
> `main` em **`f722941`**. Dois dias
> densos (#366–#382). O fio que costura quase tudo:
>
> ### ⚠️⚠️ ATIVIDADE NÃO É EVIDÊNCIA DE FUNCIONAMENTO
>
> Cinco defeitos independentes, o mesmo formato: **a peça certa existia,
> testada, e estava desligada do caminho que decide.**
>
> | o que parecia | o que era | PR |
> |---|---|---|
> | A/B do Celeiro rodando | rodava com **um braço só** — `bracoDaPosicao` nunca alternava | #368, #369 |
> | CI verde em todo push | o workflow só disparava em `main`; **PR em draft não rodava nada** | #370 |
> | `pool_novo` examinando candidatos | montava o endereço do token a partir do id do **POOL** — reprovava 100% há dez dias | #371 |
> | selo **LIVE** pulsando no `/pro` | o gráfico estava congelado; o selo media o `setInterval`, não a vela | #377 |
> | filtro da régua de direção "certo" | checava `controle` e ignorava `controleDeDirecao` — metade das réguas passava | #372 |
> | `/pools` dizendo "nenhuma pool" | era **429 da GeckoTerminal**; vazio-por-falha com cara de vazio-por-ausência | #374 |
>
> A lição operacional: **teste que confirma que a peça existe não prova que ela
> é chamada.** Todo conserto desta leva teve de mostrar a peça *decidindo*.
>
> ### O que mais mudou
>
> * **#367 — cadeia de reserva de modelos.** Um modelo recusado não derruba
>   mais o provedor inteiro; veto com prazo em `admin_kv` (`modelo_vetado:<id>`).
> * **#370 — o Alavancado dimensionado para sobreviver ao experimento:**
>   alavanca máxima **10 → 3**, e `alvoAcompanhaOStop` (I3) na ordem certa.
> * **#381 — o Maker voltou com bracket ±1,5%.** Ele não morreu de errar (70,4%
>   de alvo-primeiro, n=27, p≈0,026) — morreu de **pedágio**: entregava 121% do
>   ganho de preço em taxa. O genoma v2 foi escrito **no banco**, porque
>   `genomaAtivo` ignora a semente do código e ele teria voltado com o bracket
>   que o matou.
> * **#382 — a medição que este contêiner não roda virou botão no admin.**
>   Ver §5.12.
>
> ⚠️ **Regra nova do dono, 31/08:** *"todas as correções que vc faz, melhorias e
> mudanças, têm que ir para produção sempre"*. Não existe mais entregar num PR
> e esperar ordem para mergear — ver §3 e a §8.

> ### ⚠️ LINHA `platform-closure` — FORA DA `main`, CERTIFICADA EM `691bfdc` (26/09/2026)
>
> Nada desta linha está em produção. `round9-surgical` está congelada em
> `798fe27`; `platform-closure` parte dela e carrega o **Batch 1** (PC-1/2/3,
> migration 0065), o **Batch 2** do DCA (A58/A59/A86/A96/A97, migration 0066) e
> o **Batch 3** (0067: as 5 tabelas financeiras só para `service_role`).
> Batch 2 fechado por retest em `3123fb4`; Batch 3 fechado por retest em `691bfdc`.
> **As migrations 0059–0067 NUNCA foram aplicadas em produção.** Foram aplicadas em
> PostgreSQL 17.6 descartável (Release Phase 2) e num **Supabase de staging**
> (`nvbrzifyurslegudlhaz`, Release Phase 3).
>
> **Release Phase 3 (26/09) — INCOMPLETE: ROLLBACK/REBUILD PROOF MISSING.** No
> hosted: baseline 0001→0058 = fingerprint de produção; 0066 e 0067 = alvos
> certificados; achado pré-0067 reproduzido; testes 02/14/01/08–12 PASS;
> `apply_migration` provado atômico; produção inalterada. **Faltam:**
> backup/restore, rebuild hosted independente e concorrência 04/05/06/13 — as
> três exigem acesso PG direto, que este contêiner não tem. Detalhe e plano em
> `docs/LEDGER-MESTRE-RELEASE.md` §Z.
>
> ⚠️ **Armadilhas medidas na Phase 3:**
> - `mcp__Supabase__execute_sql` roda como `supabase_read_only_user`: lê o
>   catálogo, mas **não** prova ACL por papel (não assume `anon`) nem grava.
>   Para isso, `apply_migration` (roda como `postgres`) com um `raise` sentinela
>   no fim, que desfaz tudo.
> - O fingerprint de catálogo é sensível à **ordem** da ACL.
> - O staging é descartável: depois de fechar a §Z.6, **apagar o projeto** ou
>   resetar a senha (ela passou pelo chat).
>
> | lição do Batch 2 | onde ficou escrita |
> |---|---|
> | pacote "validado" sem `tsc` completo nem PostgreSQL chegou com 4 defeitos | commits `21ac739`, `ff23612` |
> | `psql -c` **não** interpola `:'var'` — o teste de concorrência nunca tinha rodado | `supabase/tests/13_dca_a58_concorrencia.sh` |
> | `exception when others` aprova falha fechada pelo motivo ERRADO | `supabase/tests/12_dca_batch2.sql` |
> | `abaixo_do_minimo` é terminal: o teto DIÁRIO não pode encerrar plano | `src/lib/dca/relogio.ts` |
> | `pause_dca` pausa entrada nova, não o recovery do que já saiu | `src/app/api/dca/cron/route.ts` |
>
> **O mapa completo** — SHA de cada etapa, estado de cada migration em produção,
> o que bloqueia o release e o plano dele — está em `docs/LEDGER-MESTRE-RELEASE.md`.
> ⚠️⚠️ **P0 CONFIRMADO em 26/09 (leitura autorizada do schema de produção):**
> a 0056 foi aplicada em 16/09 e `autopilot_sessions.creds_cipher` não existe;
> o código em produção (`25fc4b0`) ainda grava e lê essa coluna, então **armar
> autopilot em produção falha desde 16/09**. Havia **0 sessões e 0 intents** —
> nada quebrado, nenhum dinheiro em risco; só a função indisponível. O conserto
> é o release (não há hotfix isolado). O banco está no nível **0058**; o delta
> do release é **0059 → 0067**; o migration history NÃO segue a numeração do
> repo. Tudo em `docs/LEDGER-MESTRE-RELEASE.md` §Y.
>
> Rodar o arnês SQL: `supabase/tests/README.md` (cluster descartável, papéis
> `anon`/`authenticated`/`service_role` criados à mão, 0001→última em ordem).

---

## 1. Onde o projeto está

| | |
|---|---|
| `main` | **`5863b04`** (15/09) · conferido **por conteúdo**, não pelo estado do PR — ver §6 |
| CI | verde · **3.068 testes** · 207 arquivos · dispara em **todas as branches** (#370) |
| Deploy | Vercel produção acompanha a `main` |
| Provedor de IA | **Kimi** (`AI_PROVIDER=kimi`) — temporário, sem crédito na Anthropic |
| Banco | Supabase `vuvvftdsfmagmtbovzgq` (projeto **z-swap**) |
| Outra mão no código | **duas sessões Claude** trabalham aqui — ver §1.1 (corrigido) |

Últimos commits, do mais novo:

```
f722941  A medicao que o conteiner nao roda vira botao no admin (#382)  ← nuvem
daea83a  O Maker volta, com o bracket largo e o criterio de 23/08 intacto (#381)  ← nuvem
65a9c8e  Terminal PRO: tamanho executavel, contra nao fazer nada, preferencias (#380)  ← nuvem
d409b4d  Terminal PRO: a DEPTH volta, o dado descartado aparece, custo da ideia (#379)  ← nuvem
d36c339  O terminal PRO dizia "LIVE" sobre um grafico congelado (#377)  ← nuvem
cb4a911  "Nenhuma pool encontrada" era a fonte fora do ar, e ninguem sabia (#374)  ← nuvem
ca12542  A regua de DIRECAO podia mutar, e o filtro estava "certo" (#372)  ← nuvem
5c2ef17  Os tres agentes silenciosos do Celeiro (#371)  ← nuvem
a6142df  O Alavancado dimensionado para sobreviver ao proprio experimento (#370)  ← nuvem
2a475dd  O A/B do Celeiro passa a ter dois bracos (#369)  ← nuvem
64af97f  A Mistral caia de hora em hora: alerta errado, e sem reserva de modelo (#367)  ← nuvem
0d75311  As mesas tem borda? Medido: cinco de seis perdem para nao fazer nada (#364)  ← nuvem
7570115  ESTADO-ATUAL: o dia 29/08, e a coorte que nunca esteve ganhando (#363)  ← nuvem
6bb2fe7  O resolvedor nao expirava: guarda do preco antes da do horizonte (#362)  ← nuvem
38cdb25  O sinal de cinco horas atras: o portao de frescor no abridor (#361)  ← nuvem
0b87ac1  Auditoria do LIMIT/DCA: o teto diario era um teto POR PLANO (#360)  ← nuvem
e00902a  A taxa do DCA sai da sombra: projetada antes, medida depois (#359)  ← nuvem
143df6d  O DCA usava o gate do autopilot, e barrado era mudo (#358)  ← nuvem
7aaf2e8  Conserta o shell derrubado: pura ao lado de import de servidor (#345)  ← nuvem
f1c9174  EINHERJAR: a aba do salão, e a caixa de recados (#344)  ← nuvem
bfb5ab5  EINHERJAR: o plano, a migration, e o teto de tipos que parou a UI (#343)  ← nuvem
ea1764e  Celeiro: a alavanca real, a taxa por praça, e o painel de capital (#339)
c1b2ec3  ESTADO-ATUAL: as duas auditorias, as travas, e quem é a outra mão (#342)  ← nuvem
af886d7  Plano: o mural de agentes — e a tabela de travas (#341)   ← nuvem
f27591e  A ordem executava e o registro sumia calado — autopilot (#340)  ← nuvem
7814ad1  Fecha a ponte: teto mudo, saída por Solana, destino (#338)  ← nuvem
3236738  O destinatário de outra rede, o selo que não verificava (#337)  ← nuvem
2c1339f  Auditoria da ponte: o valor que mudava sozinho (#336)  ← nuvem
0187acc  O stop fora do ruído, e o agente que morreu com capital vivo (#335)
9b679dd  O Investigador liga — de escrito-e-parado para rodando (#333)
51465a6  O cinto antes do motor (#324)   ← nuvem
e55a250  O CELEIRO — a segunda arena, e a auditoria que a obrigou (#318)
```

### 1.1 ⚠️ NÃO SOU A ÚNICA MÃO NESTE REPOSITÓRIO

⚠️ **CORREÇÃO DE ATRIBUIÇÃO (23/08, noite).** A versão anterior desta seção
dizia que "o agente `zettaceo` commita aqui". Não existe agente com esse
nome: **`zettaceo` é a conta do DONO**, e ela aparece como autora porque o
GitHub atribui o squash-merge a quem mergeia, não a quem escreveu.

As duas mãos são **duas sessões Claude do mesmo dono**:

| sessão | onde roda | o que fez em 23/08 |
|---|---|---|
| **VSCode** | máquina Windows dele | celeiro, agentes de tendência, ZION → Kimi |
| **nuvem** | contêiner isolado | auditoria de ponte e autopilot (#336–#341) |

⚠️ **ELAS NÃO SE FALAM.** Verificado em 23/08: o `ListAgents` não enxerga
sessões entre máquinas diferentes, e não há canal direto. A coordenação é
assíncrona, pelo git e por este documento. O desenho de um mural compartilhado
está em `docs/PLANO-MURAL-DE-AGENTES.md` (#341) — **não implementado**.

O outro agente descobriu a segunda mão **por um conflito de merge**. Isso é o
sintoma; abaixo está o que evita.

**Antes de rebasear ou forçar, confira o que a `main` ganhou enquanto você
trabalhava**, e compare ARQUIVO A ARQUIVO antes de assumir que não há
sobreposição:

```bash
git log --oneline HEAD..origin/main          # o que apareceu
git show --name-only --format="" <sha-dele>  # o que ele tocou
```

### ⚠️ AS QUATRO TRAVAS — decore estas, não o mural

Em 23/08 as duas sessões abriram 4 PRs e 5 commits no MESMO dia e não houve
colisão. Duas coisas seguraram, e elas não são da mesma natureza:

| | |
|---|---|
| `--force-with-lease` recusou dois pushes | **trava** — segura sempre |
| a interseção foi conferida à mão | **disciplina** — segura enquanto não há pressa |

```bash
# 1. branch por agente, NUNCA commit direto na main
git checkout -B minha-branch origin/main

# 2. --force-with-lease, NUNCA --force  (recusou 2 pushes em 23/08)
git push --force-with-lease

# 3. antes de mergear: DOIS pontos, não três
git diff --name-only main HEAD        # o que MUDA se eu mergear
git diff --name-only main...HEAD      # ⚠️ ENGANA: mede desde a divergência

# 4. provar por patch o que ficou de fora (imune a squash)
git cherry origin/main <branch>       # linhas com + = não aplicado
```

⚠️ **O item 3 custou um susto real.** Três pontos mostrou 10 arquivos e 1.095
linhas, incluindo trabalho da outra sessão que parecia prestes a ser revertido.
Dois pontos mostrou **3**. Três pontos responde "o que esta branch fez desde
que nasceu"; dois pontos responde "o que muda se eu mergear".

⚠️ **E o item 4 desfaz o susto oposto:** depois de um squash-merge, `git log`
main..branch` ainda lista o commit original (SHA diferente) e parece que
sobrou trabalho. O `git cherry` compara por conteúdo do patch e mostra a
verdade.

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

## 2. Os ambientes — leia antes de rodar qualquer coisa

⚠️⚠️ **SÃO DOIS, E ELES NÃO SE PARECEM.** Esta seção descrevia "o ambiente" no
singular e listava as travas da máquina Windows — testes que não rodam, build
que não fecha, heredoc que quebra. Nada disso vale no contêiner remoto, e um
agente lendo a seção do outro conclui que está quebrado o que está funcionando.

* **§2 (abaixo)** — a máquina do dono, Windows + Git Bash. É onde o agente do
  VSCode trabalha.
* **§2.1** — o contêiner remoto (Linux, efêmero). É onde a sessão da nuvem
  trabalha, e ele tem as capacidades opostas.

---

### A máquina Windows (agente do VSCode)

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

## 2.1 O contêiner remoto (sessão da nuvem) — medido em 29/08

⚠️ **As capacidades são quase o INVERSO da máquina acima.** Aqui a suíte roda e o
build fecha; o que falta é acesso ao mundo e às chaves.

| | |
|---|---|
| Plataforma | Linux · Ubuntu 24.04.4 · contêiner **efêmero** |
| Repositório | `/home/user/swap-z-app`, clone fresco a cada sessão |
| Node · npm | **22.22.2** · 10.9.7 |
| Python | 3.11.15 |
| `git` refspec | completo (`+refs/heads/*`), 29 refs remotas · ⚠️ clone **shallow** |
| Fim de linha | LF, UTF-8 (sem o CRLF do Windows) |

### O que funciona aqui e NÃO funciona lá

| | Windows | contêiner |
|---|---|---|
| `npm test` | ❌ Node 22.11 < 22.12 | ✅ **2.067 testes** |
| `npm run build` | ❌ `EPERM` no desmonte | ✅ **exit 0** |
| heredoc de bash | ❌ quebra com acento | ✅ funciona |

### O que NÃO funciona aqui, e a máquina Windows tem

⚠️ **`gh` CLI é AUSENTE.** Toda operação de GitHub passa pelo **MCP**
(`mcp__github__*`): PR, merge, leitura de CI, logs de job. Não adianta escrever
comando `gh` para esta sessão.

⚠️ **NÃO existe `.env.local`.** Sem `SUPABASE_SERVICE_ROLE_KEY` e sem
`NEXT_PUBLIC_SUPABASE_URL` no disco.

⚠️⚠️ **A REDE É FILTRADA, e isso derruba uma instrução do `CLAUDE.md`.**
Medido em 29/08:

| destino | resultado |
|---|---|
| `api.github.com` | ✅ 200 |
| `api.gateio.ws` | ❌ **bloqueado** pelo proxy |
| `<projeto>.supabase.co` | ❌ **bloqueado** pelo proxy |
| `api.geckoterminal.com` | ❌ 403 |

**Consequência prática:** `scripts/mural.mjs` **NÃO roda deste contêiner** — as
duas condições dele falham (sem `.env.local` E com o host da Supabase bloqueado).
O `CLAUDE.md` manda usar esse script para falar com o outro agente; daqui, o
caminho que funciona é **SQL pelo MCP da Supabase**, escrevendo direto em
`ulfhednar_mensagens`. A aba ÚLFHÉÐNAR mostra o mesmo conteúdo, então o efeito é
idêntico — só o meio é outro.

⚠️ E não dá para testar API de preço daqui (Gate.io, GeckoTerminal). Uma medição
que dependa delas tem de sair do **banco** ou da **Vercel**, nunca de `curl`
local — e afirmar "a API respondeu X" sem ter conseguido chamá-la seria inventar.

### Para retomar (contêiner)

```bash
cd /home/user/swap-z-app
git fetch origin main -q
git checkout -B claude/swap-z-recovery-deploy-b7y2cw origin/main
```

---

## 2.2 ⚠️ O `stop-hook-git-check.sh` tinha dois bugs — consertado em 29/08

O hook que avisa *"There are N unpushed commit(s)"* ao fim de cada turno.
⚠️ **Ele vive em `~/.claude/`, LOCAL DE CADA MÁQUINA** — não está no repo e o
conserto de um lado não chega no outro. O patch completo está no mural.

**Bug 1 — acusava branch JÁ MERGEADA.** Depois de um squash-merge,
`origin/<branch>` continua apontando para o commit pré-squash e
`origin/branch..HEAD` conta ≥1 para sempre. O hook pedia push de trabalho que já
estava na `main`, e a correção que sugeria era empurrar um órfão de volta para
uma branch morta. Disparou **três vezes em 29/08**.

**Bug 2 — ficava MUDO com trabalho real.** Achado ao testar o primeiro, e é o
grave. Sem branch remota de mesmo nome, o upstream caía no literal
`origin/HEAD`; num clone sem essa ref e com default fora do padrão, o `rev-list`
falhava, o `|| unpushed=0` engolia o erro e o hook **calava com commit não
publicado na mão**.

⚠️ **A correção do bug 2 não é trocar o fallback por `$default..HEAD`** — isso
varreria commits já publicados em outra branch e trocaria um silêncio por um
número inflado (é o mesmo raciocínio do bloco de assinatura, `claude-code#69586`).
A pergunta que não depende de saber a default é **`HEAD --not --remotes`**:
*"este commit está em algum ref remoto?"*.

⚠️ **A REGRA QUE FICA:** se a default não for resolvível, o bloco não roda e o
aviso antigo vale. **Falhar para o lado de avisar, nunca para o de calar** — um
hook que emudece quando não consegue decidir perde exatamente o commit que
existe para pegar.

Testado em 8 cenários lado a lado com o original, incluindo os três que têm de
continuar acusando (commit novo, arquivo não commitado, arquivo não rastreado).

---

## 3. O dono, e como ele trabalha

Chama-se **General** (CEO e fundador); eu sou co-CEO técnico. Escreve rápido, com
erros de digitação — leia a intenção (`gare.io` = Gate.io, `corte` = coorte).

Regras permanentes dele:

- Branch de trabalho: `claude/swap-z-recovery-deploy-b7y2cw`. Commit direto na
  `main` local **continua proibido** — o que mudou é quem aperta o merge.
- ⚠️⚠️ **MUDOU EM 31/08 — TUDO VAI PARA PRODUÇÃO, SEMPRE.** Palavras dele:
  *"uma coisa que vc tem que ter em sua mente cibernética: todas as correções
  que vc faz, melhorias e mudanças têm que ir para produção sempre"*.

  A regra anterior era **"nunca mergear sem ordem explícita"**, e ela produzia
  exatamente o que ele não quer: trabalho pronto, verde, parado num PR
  esperando ele voltar do celular. **Agora o ciclo é meu do começo ao fim** —
  branch, PR, CI verde, merge, e conferir na `main`.

  ⚠️ E a conferência é **por conteúdo, nunca pelo estado do PR**. Em 31/08 o
  PR #381 apareceu "pronto" enquanto estava vazio do trabalho que eu tinha
  anunciado — o push tinha ido para a branch antiga. `grep` no arquivo
  mergeado, não "o GitHub diz merged".

  O que continua sendo dele: variáveis de ambiente na Vercel, cliques em
  botão que exigem sessão de admin, e decisões de produto.
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
3. ~~**Decidir sobre o `next`.**~~ ✅ **FEITO em 06/09** — `14.2.35 → 16.3.4`,
   `react@18 → 19`, `eslint@8 → 9`. **O `next` saiu do `npm audit`.** Plano e
   resultado em `docs/PLANO-NEXT-16.md`; o que sobra no audit (44) é tudo pilha
   de carteira, frente separada.

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

✅ **Feito em 29/08 — quatro entregas, e uma delas desmonta o placar.**

| PR | o que fecha |
|---|---|
| #359 | a taxa do DCA: projetada antes de criar, medida a cada ciclo (`0034_dca_taxa.sql`) |
| #360 | o teto diário da carteira **era um teto por plano** — N planos davam N × US$ 1.000/dia |
| #361 | o portão de frescor: o sinal de 5 horas atrás não abre mais posição |
| #362 | o resolvedor não expirava sugestões — **provado em produção às 14:00:21** |

⚠️ **O que mudou de verdade na leitura do laboratório:** o lucro de 19–22/08 era
artefato de execução atrasada dentro de uma alta, não borda (§5.9). Medir direito
vai fazer o placar parecer **pior**, não melhor.

⚠️ **EXISTE UM STATUS NOVO** em `zion_suggestions`: `unresolvable`. Qualquer
código que faça `status !== "open"` para contar resolvidas passa a contar errado.
Os três que existiam foram ajustados (§5.10).

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
11. **F2 do atraso de execução** — apertar o teto de frescor de 1,0 para 0,5 SE a
    medição mandar. Rodar até **≥100 fechadas** com o portão ativo, lendo a
    `fracao_media_do_horizonte` do `paper_sinal_velho`. Critério de sucesso
    escrito ANTES: `expired` cai de 15% para ≤10% **sem** a expectativa cair
    junto. Se cair junto, o portão corta trade bom e volta atrás.
12. **F3 do atraso de execução** — consertar a FILA, não só filtrar a saída dela.
    A sugestão preterida ainda espera indefinidamente. ⚠️ Nada de F3 antes de F2:
    mexer nos dois ao mesmo tempo deixa duas variáveis mudando e nenhuma medição.
13. ✅ **"As mesas têm borda?" — MEDIDA em 29/08. Ver `docs/MEDICAO-TEM-BORDA.md`.**
    Cinco de seis perderam para segurar os próprios símbolos, por 3 a 21 pp; a
    melhor fez **+$42 de uma oportunidade de +$194** (22% da maré). Separando as
    eras, as cinco mesas ficam **negativas** quando o artefato de execução
    atrasada some. E só uma passa no `MIN_SAMPLE` — com 112 dos seus 124 trades
    dentro do período contaminado.
    ⚠️ **NÃO é prova**: a janela limpa tem 51 trades em 5 dias, abaixo do
    critério da casa. O certo não é desligar as mesas, é deixar a amostra limpa
    chegar a 100 decididas — o critério de julgamento está escrito no documento
    ANTES dos dados. O gráfico `ContraSegurar` está no topo do TORNEIO.
14. **`ultimaPassadaDoCron` confunde "nunca rodou" com "a leitura falhou"** —
    dois estados, uma cara, num indicador que não move dinheiro (§5.8).

---

## 5. Perguntas em aberto — medições que ainda não responderam

| pergunta | como responder |
|---|---|
| O teto de credibilidade do arbitrador está cego? | **PARCIALMENTE RESPONDIDA em 26/08 — ver §5.6.** As 4 mesas estão paradas desde 03/08 09:54 e isso está CORRETO: 4.085 sondagens de livro deram líquido real −0,629% contra teórico +0,451%. O que falta é só o teto: botão **JULGAR AS DESCARTADAS** em MEDIÇÕES |
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

> ✅ **A sessão da nuvem confirma: o achado está CERTO e segue aberto** (23/08,
> noite). O defeito é meu — eu escrevi o `paper_regime_tick` para só gravar
> quando barra alguém, com o argumento de não poluir o `platform_events`.
>
> O argumento era bom e a conclusão errada: silêncio por "não barrou nada" e
> silêncio por "a Gate.io limitou taxa e tudo voltou `null`" ficam idênticos na
> tela. É a invariante nº 33 cometida por quem passou o dia caçando ela nos
> outros — a mesma armadilha do `offered: 0`.
>
> Não corrigi ainda porque o dono não pediu esta rodada. **É o primeiro item
> da fila da nuvem.**

---

## 5.2 AS DUAS AUDITORIAS DE 23/08 (sessão da nuvem)

Auditoria setor por setor, a pedido do dono, antes do beta. **Nível pedido:
"minuciosa, nível CIA".** Método: leitura de código com execução real dos
validadores — não inferência.

### PONTE (`/bridge`) — 14 achados, 14 fechados

| # | achado | onde |
|---|---|---|
| 🔴 | valor corrompido acima de 2^53, passando em TODAS as travas | #336 |
| 🔴 | destinatário de outra rede com o botão ativo | #337 |
| 🔴 | o destino que a LiFi devolve nunca era conferido | #338 |
| 🔴 | ponte saindo de Solana: quebrada, e só se descobria no fim | #338 |
| 🟠 | endereço de queima (`0x000…0`) pintado de VERDE | #336 |
| 🟠 | `$0,00` como texto de "não sei" | #336 |
| 🟠 | selo "SAFE ROUTE" vindo de `riskScore` digitado à mão | #337 |
| 🟠 | coluna `enforced` confundindo "vigiado" com "aprovado" | #337 |
| 🟠 | "ENFORCING" afirmado por `!!process.env` | #337 |
| 🟡 | teto de cotação alto (4,32 M/dia) **e mudo** | #338 |
| 🟡 | três validadores divergentes de endereço | #337 |
| 🟡 | maiúsculas recusadas em endereço legítimo | #337 |
| 🟡 | valores < 0,000001 quebrando | #336 |
| 🟡 | destinatário persistindo entre navegações | #337 |

⚠️ **ABERTO:** o CSP com `unsafe-inline`. É app-wide, não da ponte, e a migração
para nonce toca middleware e todas as rotas. **Não caronar** numa leva de
correção — merece plano e verificação próprios.

### AUTOPILOT — 2 críticos, 2 fechados

Os dois eram a **mesma classe** que o `engine.ts:492` já documenta:

> "O cliente do Supabase NÃO LANÇA em erro de banco: ele RESOLVE com
> `{ data: null, error }`."

Lá custou US$ 450 a 1.000 em catorze carteiras de PAPEL. **A correção foi
aplicada no laboratório e não no caminho de dinheiro real.**

1. **A posição não gravada** — a ordem executava, o `upsert` falhava calado, e o
   bot **nunca mais saía daquele trade** (o ramo de venda não achava a
   posição). O painel dizia FIRED. Fechado com retentativa + alerta alto.
2. **O contador diário** — o RPC sem conferir `error`. Se falhasse, o limite de
   trades do usuário **deixava de existir** em silêncio. Agora devolve booleano
   e a passada PARA de disparar.

⚠️ **ABERTO, mesma classe:** ~9 chamadas de escrita em `positions-server.ts`
e `sessions.ts` com erro não conferido. As do caminho crítico estão fechadas;
`closeServerPosition` e `markServerExitArmed` são menos graves (a checagem de
saldo na corretora protege contra venda dupla).

⚠️ **NÃO AUDITADOS:** `/swap` (a home), o onramp, e o painel admin.

### O padrão que as duas auditorias expuseram

Dos 16 achados, **dez não eram lógica errada** — eram o sistema **afirmando com
confiança o que não sabia**: `$0,00`, o selo verde, `enforced`, "ENFORCING", o
503 mudo, `isSolanaSrc` nomeado e nunca usado, a resposta do agregador nunca
conferida, e as duas escritas do autopilot.

Nenhum quebrava nada. Todos deixavam alguém — o usuário ou o dono — decidir com
informação falsa. **E três estavam nas próprias ferramentas de auditoria**, os
instrumentos usados para confiar no resto.

> Se for para procurar em um setor novo, **comece por onde a tela afirma**: de
> onde vem o dado que sustenta a afirmação, e se os dois são a mesma coisa.

---

## 5.3 ⚠️ O TETO DE TIPOS DO `Database` — a armadilha que espera a próxima tabela

**Leia isto ANTES de registrar qualquer tabela nova em
`src/lib/supabase/types.ts`.** Custou uma UI inteira parada em 23/08 e vai
custar de novo, porque o sintoma aparece longe da causa.

O que aconteceu: registrei `ulfhednar_mensagens` como a **20ª tabela** do tipo
`Database`. O `tsc` quebrou — mas **não naquela tabela**. Quebrou em
`sniper.ts` e `ullr.ts`, dizendo que colunas de `zion_suggestions` não
existiam. A inferência do genérico do `supabase-js` tem teto de profundidade;
passar dele não dá erro na gota que transbordou, **dá `never` em outras
tabelas**, escolhidas por ordem de resolução e não por culpa.

> **O ERRO APARECE LONGE DA CAUSA.** Quem adicionar a 21ª tabela vai ver o
> build quebrar num arquivo que não tocou, e vai procurar ali. O problema está
> em `types.ts`, na linha que ele acabou de escrever.

**O que está em produção hoje é o contorno (opção a):** a tabela ficou **fora**
do `Database`. `src/lib/ulfhednar/mensagens.ts` tem um `ClienteCru` local e
`const TABELA = "ulfhednar_mensagens" as never;`. Perde-se tipagem **nesse
arquivo** — que tem 3 campos e 2 funções — e preserva-se a de
`zion_suggestions`, que é caminho de dinheiro. O comentário no topo do arquivo
diz isso com todas as letras.

**A correção de verdade (opção b), quando alguém tiver fôlego:** quebrar o
`Database` em tipos por domínio (`DatabaseZion`, `DatabaseAdmin`,
`DatabaseCeleiro`) e tipar cada cliente com o seu. Não é urgente; é
**inevitável**, e cada tabela nova até lá paga o pedágio.

⚠️ **E a outra sessão está criando tabelas.** Se o build dela quebrar num
arquivo que ela não tocou, é isto. Mande-a ler esta seção antes de debugar.

---

## 5.4 ⚠️ OS NOMES DA HIRD SÃO DOS TIERS — não use nenhum dos três

`src/lib/pricing/plans.ts` reserva **Drengr** (US$ 7,90) · **Berserkr**
(US$ 20,90) · **Einherjar** (US$ 159) para os planos pagos, com as runas
ᛞ · ᛒ · ᛖ. Não batize nada dentro do produto com esses nomes.

Eu batizei: a aba dos agentes nasceu **EINHERJAR** em 23/08, exatamente o nome
do tier de US$ 159. Quem grepasse "einherjar" achava o plano do cliente e o
mural dos agentes na mesma busca.

⚠️ **E o primeiro substituto teria sido pior.** Ofereci `Berserkir` ao dono, que
escolheu. Só ao ir mexer conferi a lista inteira e vi que **`Berserkr` também é
tier** — teria trocado uma colisão exata por uma de UMA LETRA, que lê como erro
de digitação. Voltei e perguntei antes de renomear 15 arquivos.

> A lição não é "escolhi mal um nome". É que eu ofereci opções **sem ler a
> fonte** — `plans.ts` estava a um `grep` de distância nas duas vezes.

Renomeado para **ÚLFHÉÐNAR** ("os de pele de lobo", runa ᚢ), que não colide com
nenhum dos três. A migration `0030` renomeia a tabela, os dois índices **e a
chave primária** — a PK não segue o `rename to` da tabela, e só apareceu porque
fui conferir no banco em vez de confiar no `success: true` da ferramenta.

---

## 5.5 O DCA AUTOMÁTICO NA CEX (24–25/08)

`docs/PLANO-DCA-AUTOMATICO.md` tem o desenho. O que a retomada precisa saber:

**DCA e autopilot são produtos SEPARADOS**, por decisão do dono. Rota de cron
própria (`/api/dca/cron`), gate próprio (`pause_dca`), tabelas próprias. O
argumento decisivo é raio de explosão: se `/api/autopilot/cron` der 500, para
tudo que estiver dentro dela — e a poupança de alguém não pode morrer junto com
um bug da IA.

**A chave da corretora agora mora em `cex_conexoes`** — um cofre que os dois
produtos referenciam. `autopilot_sessions.creds_cipher` ainda existe: a leitura
prefere o cofre e cai nele quando não há elo, contando qual caminho serviu
(evento `cofre_origem_credencial`). **O T3 — remover o campo velho — depende
dessa medição**, e com zero sessões de autopilot no banco ela nunca gravou.
⚠️ "Nunca rodou" não é "rodou e deu zero". Critério em `RUNBOOK` §2.2.

**Um plano nasce `simulado`** e roda o caminho inteiro sem colocar ordem e sem
pedir credencial. É o mesmo caminho, não um paralelo — 12 travas exigem uma só
chamada a `placeCexOrder`, e reserva/tetos/guarda-de-preço antes do ramo.

⚠️ **A trava que sustenta tudo é do BANCO**: `unique (plano_id, ciclo_numero)`,
com a ordem inegociável **reserva → ordem → registro**. Lock tem TTL; garantia
tem constraint.

### ⚠️ Duas sessões trabalharam no mesmo dia, e deu certo — leia como

Em 24/08 as duas entregaram com minutos de diferença (#350 dele às 20:01, #349 e
#351 minhas às 20:06 e 20:17). Ele mexeu no MESMO arquivo que eu
(`celeiro/cron/route.ts`) e nada quebrou.

O que segurou: branch por agente, CI em todo push, e **as travas trabalhando por
mim** — a catraca do `event-durability` obrigou o `recordEvent` dele a ter
`await` sem eu estar presente.

⚠️ **O que NÃO estava protegido, e agora está:** as duas sessões aplicam DDL no
MESMO banco. Se as duas criassem migration no mesmo dia, ambas chegariam ao
mesmo número — e **o git não pega isso**, porque `0034_a.sql` e `0034_b.sql` não
são conflito para ele. Escapou por sorte (só uma criou). A trava é
`migrations-ordenadas.test.ts`.

O canal entre as sessões é o mural (`scripts/mural.mjs`, aba ÚLFHÉÐNAR).
⚠️ O `ListAgents` **não** enxerga sessões de outra máquina — é do arcabouço, não
tem conserto aqui.

---

## 5.6 ⚠️ A ARBITRAGEM ESTÁ MORTA DESDE 03/08 — e o caixa está certo (26/08)

**A pergunta que gerou isto:** o painel mostra **$313** de P&L nas quatro mesas
de arbitragem e **exatamente 0,00** de movimento de caixa, enquanto
`strat_mech` (+50,65), `strat_day` (+47,59), `radar` (+11,96) e `strat_ai`
(−10,54) mexeram. Parecia dinheiro sumido.

**Não é bug de caixa, e não era achado novo** — o `DescartadasPanel` já
documenta a aritmética desde 17/08. São duas janelas diferentes na mesma tela.

### O que os dados dizem

1. **As quatro mesas não operam há 23 dias.** Último `arb_opportunity` e último
   `arb2_open`: **03/08 09:54**. Não estão pausadas (`pause_arbiter` = false)
   nem sem caixa. Continuam rodando: 5.376 `arb_data_anomaly` e 3.311
   `arb2_window_empty` em 30 dias, o mais recente hoje.

2. **Estão paradas por aritmética.** Piso de custo = `COST_PCT + MIN_NET_PCT` =
   0,40 + 0,15 = **0,55%** (0,60% no arbiter2). Teto de credibilidade =
   `MAX_GROSS_PCT` = **0,30%**. Um spread teria de ser maior que 0,55% E menor
   que 0,30% ao mesmo tempo. **A janela é vazia por construção**, e o próprio
   evento diz isso: *"piso de custo acima do teto de credibilidade"*.

3. **O caixa em 0,00 está certo.** Em 03/08 10:25 as 2.078 posições foram
   arquivadas e o caixa restaurado ao inicial. `reconcile` só lê não-arquivadas,
   logo esperado = inicial = caixa. Os $313 são a coluna **vida inteira** do
   torneio, que inclui arquivadas de propósito.

### O número que decide

As 4.085 sondagens de orderbook (`arb_realism`, 28/07 a 03/08):

| | |
|---|---|
| líquido **teórico** médio | **+0,451%** |
| líquido **real** (andando o livro a $50) | **−0,629%** |
| derrapagem média | 1,081% |
| teórico positivo E real negativo | **4.068 de 4.085 — 99,6%** |

A última oportunidade da vida da mesa: RUNE, spread 0,71%, teórico +0,31%, real
**−0,876%**.

⚠️ **Os $313 foram contabilizados no preço de TOPO DE LIVRO.** Lidos os livros,
os mesmos 2.078 trades perdiam dinheiro. Quem arquivou em 03/08 10:25 não
escondeu lucro — retirou lucro que a medição já tinha desmentido.

### O que fazer com isso

- **Não construir produto pago em cima de arbitragem.** Um tier venderia o
  número teórico (+0,45%) e entregaria o real (−0,63%), e piora com tamanho.
- **A pergunta viva é o TETO, não o piso.** ~83 rotas/dia saem marcadas
  "pagaria se fosse real". O `DescartadasPanel` existe para ler esses livros.
- **Aposentar formalmente as quatro mesas**, ou marcá-las no torneio como
  "janela vazia por construção" — 23 dias de silêncio não podem ter a mesma
  cara de 23 dias sem setup (invariante nº 33).

---

## 5.7 A TAXA DO DCA — projeção e aferição (26/08)

**O buraco:** a tela do DCA nunca escreveu a taxa em lugar nenhum. Num plano de
$10 × 90 ciclos a 0,2% por ordem são **$1,80 — 1,8% do orçamento** evaporando
sem aparecer. E `dca_ciclos.custo_usd` guarda `order.cost` (o **total gasto**),
não a taxa: **a taxa nunca era gravada**, então não havia contra o que conferir.

**O que foi entregue:**

| peça | onde |
|---|---|
| projeção pura, testada | `src/lib/dca/custo.ts` + `custo.test.ts` (16 casos) |
| coluna `taxa_usd` + `taxa_nao_precificada` | `supabase/migrations/0034_dca_taxa.sql` (aplicada) |
| captura da taxa real da ordem | `src/app/api/dca/cron/route.ts` via `taxaEmUsd()` |
| projeção na criação, aferição no extrato | `src/components/cex/DcaPanel.tsx` |

⚠️ **DCA é UMA perna.** Usar `CUSTO_IDA_E_VOLTA_PCT` — que é o que quase todo o
resto do repo usa — dobraria a taxa em silêncio. O primeiro teste do arquivo
existe só para segurar isso.

⚠️ **A projeção conta os ciclos que VÃO rodar, não os pedidos.** O plano para
quando o orçamento acaba, e a aritmética espelha `tetoDoCiclo` — inclusive o
último ciclo parcial, que compra se passar do mínimo da corretora.

⚠️ **A aferição compara alíquota com alíquota, nunca total com total.** Um plano
no ciclo 3 de 90 pagou $0,06 de $1,80 projetado; ler isso como economia de 97%
seria ler um plano no começo como um plano barato.

⚠️ **Ciclo sem taxa registrada NÃO vira zero** — sai contado à parte. Plano
simulado grava `null` de propósito: simulação não paga taxa, e dizer "a
corretora cobrou zero" seria inventar medição. *Este defeito existiu de verdade
no primeiro rascunho* (`Number(null)` é `0`, que passa em `isFinite`) e foi o
teste que o pegou.

**O que continua fora:** derrapagem (não medida para estes pares), taxa efetiva
por nível VIP (só em consulta autenticada) e taxa de saque. A tela diz isso.

---

## 5.8 A AUDITORIA FINAL DO SETOR LIMIT/DCA (26/08) — três achados

Passada de fechamento sobre `/orders`, `/dca`, o cron e o store. Os dez itens da
auditoria de 24/08 (PR #347) continuam de pé. O que apareceu de novo:

### 1. ⚠️⚠️ O teto diário da carteira era um teto POR PLANO

`gastoHojeDaCarteira` diz, no próprio cabeçalho, por que existe:

> "sem sessão para herdar limite, dez planos de US$ 100/dia na mesma carteira
> seriam US$ 1.000/dia com nada olhando o conjunto"

E o único chamador passava **`[p.id]`** — o plano corrente, sozinho. O limite que
a função promete para a carteira valia por plano: **N planos na mesma carteira =
N × US$ 1.000/dia**, que é literalmente o cenário nomeado como motivo dela
existir.

O tipo não tinha como pegar: `[p.id]` e a lista da carteira são os dois
`string[]`. **A assinatura agora pede a CARTEIRA** (`gastoHojeDaCarteira(wallet)`)
— não dá para passar um plano onde se pede um dono.

⚠️ E é consultado a cada plano, **sem cache**, de propósito: numa passada com três
planos vencidos da mesma carteira, o segundo precisa enxergar o que o primeiro
acabou de gastar.

### 2. ⚠️ A consulta do teto lia 1.000 linhas da plataforma inteira e filtrava no cliente

```
.select(...).eq("status","feito").order("executado_em",…).limit(1000)
```
…e só depois filtrava por plano e por data **em JavaScript**. Com mais de mil
ciclos concluídos no intervalo, os desta carteira caem **fora** da janela lida, a
soma volta menor do que é — e um teto de dinheiro que subestima o gasto **ABRE**.

É a armadilha do PostgREST que o cabeçalho de `paper/reconcile.ts` documenta,
dentro da função que existe para fechar um limite. Agora os filtros são do
servidor (`.in`, `.gte`), e uma leitura que estoura o teto devolve **`null`** —
"não sei" é não-compra, como o `price-guard`.

### 3. ⚠️ `avancarPlano` depois da compra falhava calado

O cron não checava o retorno (a rota `PATCH` do mesmo recurso já checava). O
estrago não é comprar duas vezes — a reserva com `unique` impede. É pior de
diagnosticar: **o dinheiro sai e o relógio não anda**, então toda passada
seguinte recalcula o mesmo número de ciclo, bate em `ja_reservado` e sai sem
fazer nada. **O plano congela para sempre**, e o dono vê "1 de 12" sem uma linha
dizendo por quê.

Agora a gravação é conferida e emite `dca_incidente` com Telegram; e o
`ja_reservado` — normal uma vez, sintoma se insiste — grava
`dca_ciclo_ja_reservado` uma vez por hora por ciclo.

### O que foi conferido e está certo

- `porCiclo` **trunca** (divisão inteira), então a projeção de taxa nunca
  divergirá do plano gravado — conferido caso a caso.
- Pausar um plano `completo` e retomá-lo **não** o ressuscita: `decidirCiclo`
  barra em `restantes <= 0` antes de qualquer compra.
- Reserva → ordem → registro continua na ordem certa, com a trava `unique` como
  garantia (e não o lock, que tem TTL).
- Modo simulado é o padrão; `real` exige a palavra e o banco confirma com
  `dca_planos_real_exige_conexao`.
- `GET`/`PATCH` só enxergam plano da carteira da sessão — id não é autorização.

### Fica em aberto (não é defeito, é limite conhecido)

`ultimaPassadaDoCron` devolve `haMinutos: null` tanto para "nunca rodou" quanto
para "a leitura do `admin_kv` falhou". São estados diferentes com a mesma cara —
invariante nº 33 em escala pequena, num indicador que não move dinheiro.

---

## 5.9 ⚠️⚠️ A COORTE INVERTEU — e a causa não era o filtro (29/08)

O dono leu a coorte: *"estávamos ganhando, daí adicionamos um filtro e foi só
ladeira abaixo"*. A data batia — o filtro de regime entrou em **23/08 02:31** e a
virada é exatamente ali.

**Não era o filtro. E a gente nunca esteve ganhando.**

### O que foi descartado, cada um com dado

| hipótese | teste | veredito |
|---|---|---|
| o mercado virou | SOL **+12,8%** de 22 a 28/08 (duas fontes independentes) | ❌ perderam em mercado que SUBIU |
| o filtro escolhe errado | sem filtro: 24h de alta → **72,6%** (234 trades); de queda → 34,9% | ❌ a regra dele está certa |
| alvo e stop trocados | 233/233 antes e 54/54 depois copiam a sugestão exata | ❌ sem troca |
| o stop apertou | apertou, mas é **consequência**, não causa | ❌ |

### A causa: execução atrasada dentro de uma alta

| era | n | **preenchimento vs preço de referência** | stop% | alvo% |
|---|---|---|---|---|
| antes de 23/08 | 223 | **+2,090%** | 5,61 | 3,86 |
| depois | 44 | **+0,038%** | 2,86 | 5,35 |

A sugestão nasce com alvo em R+6% e stop em R−2,9%, mas a posição abria **5 horas
depois** — a fila (uma posição por símbolo por mesa) adia a preterida e ela
esperava indefinidamente. Na alta de 19–22/08 (SOL a ~5,8%/dia) o preço já tinha
andado +2,09% nessas 5h, e medido do preenchimento REAL o par virava **alvo a
3,86% / stop a 5,61%**: perto do alvo, longe do stop.

Num mercado subindo isso bate no alvo quase sempre, e bateu: `strat_mech` fez
**64 alvos em 70**. Quando a alta desacelerou, o preenchimento voltou a cair em
cima da referência e apareceu a expectativa verdadeira.

| mesa | expectativa ANTES | DEPOIS | alvos batidos |
|---|---|---|---|
| strat_mech | +2,07% | **−2,18%** | 64/70 → **0/12** |
| strat_day | +1,58% | −1,30% | 29/77 → 0/13 |
| radar | +1,02% | −2,57% | 26/39 → 1/11 |

⚠️ **O lucro de 19–22/08 foi artefato de execução atrasada. Não era borda.**

### ⚠️ A HIPÓTESE QUE EU ERREI, e ela está registrada de propósito

Apostei que a deriva mataria a expectativa. **Medi e não mata** — todas as faixas
de atraso deram expectativa positiva. O dano é outro: o atraso **transforma
horizonte em ficção**. Aberta no prazo, 15% expiram; com metade do horizonte já
gasto, **52%**. E `expired` não é win nem loss — o atraso não perde dinheiro,
**fabrica amostra sem veredito**.

### O que entrou (F1, PR #361)

`lib/paper/frescor.ts` mais o portão no abridor. Teto em **1,0** por decisão do
dono: barra só a posição que nasceria já vencida (5 dos 285 trades da janela).
O padrão está no CÓDIGO, não só na env — a ausência de
`PAPER_MAX_FRACAO_HORIZONTE` cairia em 0,5, que não foi o escolhido.

✅ **CONFIRMADO EM PRODUÇÃO:** `paper_sinal_velho` disparou 5 vezes, a última às
13:31 de 29/08.

Plano completo, com F2 (apertar o teto com dado) e F3 (consertar a fila):
`docs/PLANO-ATRASO-DE-EXECUCAO.md`.

---

## 5.10 ✅ O RESOLVEDOR NÃO EXPIRAVA — consertado e PROVADO em produção (29/08)

Achado ao conferir se o portão da §5.9 sufocaria a fila: **9 `zion_suggestions`
estavam `open`, a mais antiga de 04/08** — 25 dias com horizonte de 12h.

Cinco eram legítimas (28/08, horizonte 72h). As **quatro presas eram todas
`launch_shot` on-chain** — VEK, XSGD, USDC, HEGIC — abertas por **200 a 608
horas**.

### A causa: uma ordem de guardas

```ts
if (spot == null || spot <= 0) return null;                 // ← saía aqui
...
if (nowMs >= horizonMs) return { status: "expired", ... };  // ← nunca chegava
```

A guarda do preço vinha **antes** da do horizonte. Sem par na Binance e com o
pool sem vela no GeckoTerminal, os dois caminhos de preço secavam e a função
saía pela primeira linha, para sempre.

### O conserto — e o que ele recusou fazer

Sem cotação não dá para dizer se bateu alvo, stop ou nada. `expired` com
`outcome_pct = 0` seria fabricar o único número que importa.

- **status terminal `unresolvable`** com `outcome_pct` **NULO**
- **carência de 24h** (`ZION_CARENCIA_SEM_PRECO_H`) — provedor fora do ar por dez
  minutos não condena linha resolvível
- **fora das três agregações** — `getBacktestStats`, torneio e `launch-gate`
  faziam `status !== "open"` e teriam contado a linha como resolvida com 0%

⚠️⚠️ **O SEGUNDO DEFEITO, que só apareceria depois de consertar o primeiro.** O
GeckoTerminal devolve as **300 velas mais recentes**: para uma linha de 608h com
horizonte de 12h, todas caem fora do replay, e o chamador passa o último close
como `spot`. Desbloquear sem mais nada resolveria as quatro com o preço de
**hoje** — quatro linhas travadas trocadas por **quatro números inventados**,
que é pior, porque travado ao menos se vê.

### ✅ A PROVA, e por que ela existe

**Não mexi no banco à mão de propósito.** Um `UPDATE` manual daria o resultado
bonito e nenhuma evidência de que o código funciona.

| | |
|---|---|
| deploy de produção | 29/08 **13:34:45** |
| primeira passada do cron depois dele | **14:00:15** |
| as 4 viraram `unresolvable` | **14:00:21**, todas com `outcome_pct` NULO |
| sobraram em `open` | 5 — exatamente as legítimas de 28/08 |
| evento `zion_sugestao_sem_preco` | `linhas: 4` |

⚠️ **A LIÇÃO DE PROCESSO:** às 13:44 as quatro ainda estavam `open` e eu quase
concluí que o conserto falhara. O deploy tinha entrado às 13:34:45 e a última
passada do cron fora às **13:30:11 — quatro minutos ANTES**. A instrução que eu
mesmo tinha escrito na verificação agendada ("não conclua que falhou sem checar
se o cron rodou depois do deploy") foi o que impediu o diagnóstico errado.
**Sempre confira a ordem deploy → cron antes de julgar um conserto em produção.**

---

## 5.11 ⚠️ UM NOME DE MODELO APAGOU QUATRO MESAS (29/08)

Detalhe completo em `PLANO-RESERVA-DE-MODELO.md`. O essencial:

```
403 · "This model is not available in your subscription tier"
type: tier_not_allowed · code 1910 · modelo: mistral-large-latest
```

Entre 00:00 e 03:30 de 29/08 o `mistral-large-latest` saiu do plano do dono. **A
chave continua válida** — o que é recusado é o MODELO. Três falhas abriram o
disjuntor e a Mistral inteira saiu; como ela ocupa os assentos `brain` E
`sentiment`, caíram junto o flywheel, o radar, o oráculo e o sniper.

### Dois defeitos, e o primeiro apontava para o lugar errado

1. **O alerta mandava gerar outra chave** (PR #367). `classificarFalha` procurava
   `not found`/`not supported`/`invalid`; a Mistral disse **"not available"** — a
   mesma cicatriz de 25/07 a um sinônimo de distância. Caiu no ramo `auth` por
   causa do 403. Nasceu a classe `plano`, e o alerta de causa permanente parou
   de se repetir de hora em hora (nove idênticos num dia).
2. **Não havia reserva de modelo dentro do provedor.** Existiam três camadas de
   reserva — provedor→provedor (`roleProviderChain`, 03/08), modelo→modelo da
   plataforma (`zion/model.ts`, N1) — e nenhuma cobria esta. Cada camada ganhou
   a sua reserva no dia em que caiu; esta caiu agora.

⚠️ **E a reserva de provedor existia e não salvou.** Só o `strat_ai` consome a
fila inteira; `backtest`, `oracle`, `sniper` e `radar` chamam `roleProvider()` /
`hybridBrain()`, que devolvem **um**. Reserva que um chamador usa cobre um
chamador — vale conferir isso na próxima vez que algo "já estiver coberto".

### O que entrou

`src/lib/ai/modelo-reserva.ts` substitui `openaiCompatChat` nos 10 pontos que
chamam com `ProviderConfig`. `<PROVEDOR>_MODEL` passa a aceitar lista separada
por vírgula. Troca de modelo SÓ nas classes `plano` e `modelo` — em `auth`,
`cota` e `upstream` descer a fila repetiria o mesmo erro e esconderia a causa.
O modelo que respondeu vai para o `recordEvent`, senão o flywheel mede um e
credita outro.

⚠️ **NÃO substitui a ação do dono:** se o plano não inclui nenhum modelo da
fila, a mesa cai igual. Conferir a assinatura da Mistral e apontar
`MISTRAL_MODEL` para o que o tier inclui continua pendente.

---

## 5.12 A MEDIÇÃO QUE ESTA MÁQUINA NÃO RODA — resolvida por botão (31/08)

O `/pro` aponta `bnb-usdt` para a **PancakeSwap V3 0,05%**; a tela do DEXTools
que o dono comparou era a **V2**. Ninguém escolheu isso — os endereços de
`PRO_PAIRS` foram escritos à mão quando o terminal nasceu e nunca foram medidos
contra alternativa nenhuma. **Uma constante escrita uma vez decide o que o
usuário vê todo dia.**

O item ficou parado por um motivo que não era trabalho: **este contêiner não
alcança a `api.geckoterminal.com`**. A saída foi dele:

> *"é só seguir a minha ideia: põe o teste para o painel ADM e um botão para
> testar por lá, daí vc lê o resultado das medições e testes pelo banco"*

É o padrão que vale para **qualquer** medição bloqueada por rede daqui em
diante: a rota mede onde a rede existe (Vercel), grava em tabela, e a sessão lê
por SQL. Medição que vive só na tela de quem clicou não é medição, é impressão.

### ⚠️ A pergunta foi reescrita, e a nova é mais honesta

O plano pedia *"qual piscina dá melhor execução no nosso tamanho"*. Isso **não
é medível** com o que a GeckoTerminal publica: profundidade de V3 depende da
liquidez **por tick**, e a fonte não expõe. Prometer essa resposta seria
inventá-la. O que é medível são duas réguas, e elas ficam separadas:

| régua | o que mede |
|---|---|
| **cobertura de vela de 1m** | quantos dos últimos 180 minutos têm vela. A fonte só devolve o minuto em que houve trade — isto **é** o *"o gráfico nem se mexe"*, medido, não um proxy |
| **TVL** | o mais perto de execução que dá para ler honestamente, e está rotulado como TVL, nunca como profundidade |

⚠️ **Quando as duas apontam para piscinas diferentes, o veredito é `conflito` e
nada é escolhido.** Compor as duas num score esconderia justamente o que decide
— é o erro que pintou de verde uma piscina que perdeu 53%, porque segurar
perdeu 54% (§ do painel de LP). E sem TVL em nenhuma candidata **uma régua não
existiu**: a saída é `inconclusiva`, não "a cobertura decide sozinha".

### O que ficou no repositório

| | |
|---|---|
| lógica pura | `src/lib/pro/escolha-da-piscina.ts` — 21 testes |
| rota | `src/app/admin/api/pro-piscinas/route.ts` — leitura pura, `requireAdmin` |
| painel | `ProPiscinasPanel` → id `pro-piscinas` |
| tabelas | `pro_piscina_medicao` (o que foi **lido**) · `pro_piscina_veredito` (o que foi **concluído**) — migration `0035`, aplicada |

⚠️ **A rota não troca a piscina sozinha.** `trocar` é recomendação **gravada**;
mudar `PRO_PAIRS` é edição revisada em PR. Rota de admin que reescreve em
silêncio o que o usuário vê é classe de automação que esta casa não tem.

⚠️ **`getOHLCV` devolve `[]` para piscina morta E para 429.** Por isso nasceu
`getOHLCVOuFalha`, que lança: sem ela, *"não medimos esta piscina"* (lacuna)
ficaria idêntico a *"esta piscina está morta"* (condenação). Toda métrica das
duas tabelas é nullable pelo mesmo motivo — `NULL` = a fonte recusou, `0` = ela
respondeu zero.

### O defeito que o meu próprio teste pegou

A janela comparava milissegundos com `>= início` **e** `<= agora`, incluindo as
duas bordas: **181 minutos distintos numa janela chamada de 180**, com cobertura
passando de 100% antes do clamp. Agora conta minutos inteiros, e a tolerância de
relógio **dobra** a vela do futuro para o minuto corrente em vez de esticar a
janela — que era por onde o 181º entrava.

### ⚠️⚠️ O BOTÃO FOI CLICADO — e a resposta é que O MÉTODO NÃO MEDE (lido em 05/09)

Quatro rodadas: três em 31/08 22:51–22:52 e uma em 01/09 11:44. **69 medições,
54 vereditos.** O painel funcionou, gravou, e reportou com honestidade. O que
ele reportou é que a medição não aconteceu.

**Dois bloqueios INDEPENDENTES, e o segundo é o que mata:**

| | |
|---|---|
| **leitura** | **60 de 69 leituras voltaram `geckoterminal limite (status 429)`.** Só 9 leram, todas na ethereum. A rodada mais bem-sucedida (01/09, já com marcapasso) leu **43%**; a pior, 0%. |
| **descoberta** | ⚠️ **De 23 pares, só UM teve mais de uma piscina candidata** (`eth-usdc-uni-v3-005`, 5 candidatas). Os outros 22 tinham **exatamente uma** — e comparação precisa de duas. |

⚠️ **O segundo bloqueio é o grave**, e paginar mais devagar não resolve: mesmo
com a fonte respondendo 100%, **22 dos 23 pares continuariam inconcluídos**,
porque não há segunda piscina para comparar. O `porque` gravado diz isso com
todas as letras: *"0 de 1 piscinas foram lidas — comparação precisa de duas.
Piscina só é pior que outra quando a outra existe na medição."*

**O único par mensurável deu resposta, e ela é consistente em TRÊS rodadas:**

```
ETH/USDC · Uniswap V3 0,05% · 0x88e6…5640
  cobertura da atual   92–95%     melhor alternativa   92–99%
  diferença            0–5 pontos (ruído é 10)
  TVL                  $105,4M — a maior das candidatas
  veredito             atual_e_a_melhor  (as duas réguas concordam)
```

⚠️ **Ou seja: para o par que dá para medir, a piscina do `/pro` já está certa.**
Não é evidência sobre os outros 22 — é evidência sobre este.

**O que fazer com isso (não é clicar de novo):**

1. ⚠️ **A `mercado_vela` (fase 0 da bancada) é exatamente o conserto do 429.**
   Vela fechada não muda: buscada uma vez, servida para sempre. A medição de
   piscinas ainda busca direto na fonte a cada rodada — migrá-la para o cache
   transforma 60 recusas em 60 leituras de banco.
2. **A descoberta precisa de outra fonte ou de outro critério.** Se a
   GeckoTerminal só conhece uma piscina para 22 dos 23 pares, a pergunta "qual a
   melhor piscina" não tem resposta possível por essa porta — e isso é uma
   conclusão sobre o MÉTODO, não sobre as piscinas.

---

## 5.13 A BANCADA DO CLIENTE — fases 0 e 1 em produção (05/09)

O dono mandou expor um **laboratório para o cliente**, e corrigiu minha primeira
leitura: *"ter um laboratório de testes para os clientes não é copiar o nosso e
pôr para os clientes, é algo totalmente diferente"*. O `/admin` é instrumento de
pesquisa nosso; a bancada responde outra pergunta — *"a MINHA ideia, com o MEU
capital, sobrevive ao custo?"*. Desenho inteiro em `docs/PLANO-BANCADA-DO-CLIENTE.md`.

**Fase 0 — a tabela de velas** (`0036`, `lib/mercado/`). Vela de período FECHADO
nunca muda: buscada uma vez, servida para sempre. O milésimo backtest de BTC sai
de mil buscas para zero. É o que faz o produto ser barato — o backtest não custa
token, custa CPU e vela, e a vela era o problema.

**Fase 1 — as primeiras tabelas COM DONO** (`0037`, `lib/bancada/`).

### ⚠️⚠️ A promessa de "RLS de verdade" não sobreviveu à arquitetura

O plano dizia, escrito por mim: *"precisam de policy que amarre `wallet_address`
à sessão"*. Ao ir escrever, dois fatos do código mataram a ideia:

1. a sessão desta casa é um **JWT nosso** (HS256, `AUTH_JWT_SECRET`), verificado
   no Node — ele **nunca chega ao Postgres**, e `auth.jwt()` devolveria NULL;
2. quem consulta usa a **service key**, que **ignora RLS por definição**.

⚠️ Escrever a policy assim mesmo teria sido **pior** do que não escrever: seria
*uma trava que existe, parece certa, e está desligada do caminho que decide* — a
classe exata de defeito que esta sessão perseguiu seis vezes. E a próxima pessoa
a auditar leria a policy e **pararia de procurar**.

O isolamento é real, em outra camada, e está declarado no cabeçalho da migration:

| camada | o que impede |
|---|---|
| RLS ligada, zero policies | o anon key (exposto no browser) não lê nada |
| `dono` é o 1º parâmetro obrigatório de todo o store | esquecer o filtro vira **erro de tipo** |
| `Dono` é **tipo marcado**, só a sessão o constrói | `POST {"dono":"0xdavítima"}` **não compila** |
| banco falso com linhas de verdade | prova o dado que voltou, não o texto do código |

⚠️ **E o ataque real não era ler o banco** — é a rota aceitar `dono` do corpo da
requisição. Nenhuma policy jamais veria isso: do ponto de vista do Postgres a
consulta está perfeitamente filtrada, só que **pelo valor errado**.

### Quebrado nos dois sentidos antes de subir

| o que quebrei | o que aconteceu |
|---|---|
| removi o `.eq("dono", …)` da porta única de leitura | 6 testes vermelhos |
| removi o `.eq("dono", …)` dos `update` | 3 testes vermelhos |
| troquei `Dono` por `string` | `type-check` quebrou: *Unused '@ts-expect-error'* |

⚠️ O terceiro é o mais útil: o `@ts-expect-error` no teste **é a asserção**. Se a
marca do tipo enfraquecer, ele fica sem erro para suprimir e o CI quebra — não há
como afrouxar a trava em silêncio.

### Duas decisões de custo que ficaram no código

- **A janela da cota é MÓVEL de 24h, não o dia do calendário.** Reset à
  meia-noite convida ao consumo dobrado na virada: cota inteira às 23h59 e de
  novo às 00h01.
- **Rodada `recusada` não consome cota.** Ela é barrada pelo portão do pedágio
  antes de ler vela nenhuma; cobrar por ela puniria o cliente justamente pela
  mensagem que o impediu de perder dinheiro, e ensinaria a não testar.
- **Falha de leitura devolve `null`, nunca `0`.** Zero liberaria a cota inteira
  exatamente quando o banco está ruim — falha ABERTA num caminho que segura
  custo.

**Aberto:** fases 2–7 (motor puro, rota com cota, UI `/laboratorio`, estratégias
da casa, papel adiante no cron, `/pricing` nos 4 locales). E as cotas da §6.2 do
plano são **desenho meu por critério de custo**, não medição de disposição a
pagar — preço é decisão do dono.

---

## 5.14 A BANCADA — fase 2, o motor puro (05/09)

`lib/bancada/`: `vocabulario.ts` (parâmetros, nunca código), `custo.ts` (o
pedágio ANTES de rodar), `motor.ts` (sinal → operações), `veredito.ts` (os três
estados + ruído + o que não foi medido). 69 testes.

### O que a fase 2 CONSERTOU do que eu mesmo tinha escrito

| defeito | como apareceu |
|---|---|
| **o portão julgava `max(alvo, stop)`** | copiei de `sementeAbreAlgumaVez` sem perguntar se a pergunta era a mesma. Não era: lá é *"abre alguma vez?"*, aqui é *"sobra depois do pedágio?"* — e quem paga o pedágio é o ALVO. Com `max`, alvo de 0,1% com stop de 5% PASSAVA: sinal verde para a morte exata do Maker. Um teste pegou. |
| **o horizonte nunca vencia** | `expiraEm` era medido de `abriuEm`, mas `computeExitPath` mede de `opened_at` = `abriuEm + 1`. Um milissegundo: `nowMs >= horizonMs` nunca era verdade, e toda posição que devia EXPIRAR voltava como "ainda aberta" — sumia do resultado sem aparecer como defeito. |
| **posição aberta não bloqueava novas** | o `continue` do caso "não resolveu" pulava a barreira, e os sinais seguintes abriam por cima de uma posição viva. `aindaAbertas` subia para 3 e ninguém somava aquilo com nada. |
| **`derrapagem_pct` era `not null`** (0037) | escrever 0 ali AFIRMA "medimos e não existiu". Backtest lê velas, e vela não tem livro de ofertas. Migration 0038 a torna nula. |

⚠️ **Os quatro são meus, dos últimos dois dias.** Nenhum apareceu em revisão de
código — apareceram ao escrever o teste que tentava quebrá-los.

### A fórmula do equilíbrio era o caso particular

O plano registrava `0,5 + custo/(2 × alvo)`. Ela vale só com `stop = alvo`. A
geral é `p = (stop + custo)/(alvo + stop)` — e com alvo 3% / stop 1% a antiga
erra por **21 pontos percentuais**. A nova reproduz as três linhas de cicatriz
(83,3% · 63,3% · 58,0%) exatamente, o que é a prova de que ela **contém** a
medição antiga em vez de contradizê-la.

### Uma definição, não duas

`computeExitPath` (`paper/engine.ts`) ganhou o custo como PARÂMETRO, com o
default de sempre — nenhum chamador muda. A bancada reusa a convenção de saída
(stop-first, `expirada` separada) com a taxa da praça e do papel do cliente.
⚠️ Um segundo simulador de bracket seria uma segunda verdade sobre dinheiro, e
foi uma taxa única aplicada a todo mundo que aposentou o Maker por engano.

### O plano tinha DUAS tabelas de cota

§2.1 (rascunho: free 3/dia) e §6.2 (decisão: free 10/dia). Cada uma coerente
sozinha — **que é exatamente a forma da cicatriz do Free/ZION**. A §2.1 foi
marcada como superada, no lugar, com o aviso de que a fase 3 lê a §6.2.

**Quebrado nos dois sentidos antes de subir:** lookahead ligado, fórmula
simétrica de volta, piso de ruído desligado, `expirada` contada como acerto,
derrapagem gravada como 0 — **um teste vermelho em cada caso**.

---

## 5.15 A BANCADA — fase 3, a cota e a rota (05/09)

`BANCADA_COTAS` em `tier/types.ts` (irmã de `TIER_DAILY_ANALYSES`, fonte única),
`bancada/cotas.ts` (decisão pura) e `POST /api/bancada/backtest`.

### ⚠️⚠️ O freio que o plano escreveu não freava nada

§6.2 dizia que o teto interno era **`símbolos × dias` por rodada**. Ele ignora a
granularidade:

| pedido | velas por símbolo |
|---|---|
| 1 ano em velas de **1 dia** | 365 |
| 1 ano em velas de **1 minuto** | **525.600** |

Os dois cabem em *"3 símbolos, 1 ano"* do plano free. Um deles custa **1.400
vezes** o outro, e é exatamente o pedido que vira rajada contra o limite por IP
da fonte — a mesma rajada que em 31/08 voltou com 56 de 62 leituras em 429.

O freio real é `símbolos × dias × 24` (a janela em velas de 1h): passa todo uso
normal, barra a patologia. ⚠️ E a recusa **ensina a saída** — *"use um intervalo
maior, a leitura fica igual de boa e sai na hora"* — em vez de só negar.

⚠️ **E o que custa não é a CPU, é a BUSCA.** O motor varre 26 mil velas em
milissegundos; o que dói é a primeira ida à fonte, e depois da tabela de velas
ela não se repete. Por isso o teto é generoso, não apertado.

### A bancada falha FECHADO onde o ZION falha ABERTO — e não é incoerência

`consumeAnalysisQuota` libera quando o banco cai, com a regra certa para ela:
uma proteção que derruba o produto quando ela própria falha não é proteção — e a
resposta do ZION continua **boa** nesse estado.

Aqui não continua. Sem banco, `velasDoIntervalo` cai para a fonte a cada rodada:
o resultado sai **com buracos de vela** E cada teste vira uma rajada contra a
fonte. Liberar seria entregar medição ruim ao preço mais caro que ela tem.

⚠️ E a recusa **diz a verdade sobre o motivo**: `consumo_desconhecido`, nunca
`cota_esgotada`. Um cliente que não rodou nada hoje lendo "acabou seu limite"
reclamaria de um limite que não era o problema.

### A comparação com "segurar" tinha unidades trocadas

`resumir` somava percentuais de operação. Pôr esse total ao lado do retorno de
janela do buy-and-hold é comparar `Σ` de retornos por trade com o que aconteceu
com um dólar do começo ao fim — **e o erro cresce com o número de operações**:
quanto mais a estratégia opera, mais bonita ela fica sem ter rendido nada a
mais. Agora existe `liquidoCompostoPct` (`Π(1 + r_i)`), e é ele que entra no
veredito. A soma continua exposta, com o nome do que ela é.

### Duas decisões que ficaram no código

- **O competidor não paga o pedágio da estratégia.** Comprar e não mexer paga
  uma ida e volta só; cobrar dele as quarenta da estratégia inventaria vantagem
  para o nosso lado. ⚠️ O competidor tem de ser difícil de bater — senão o
  veredito vira propaganda.
- **A janela termina na última vela FECHADA, e quem decide é o servidor.** Se o
  cliente mandasse `janelaAte`, poderia escolher a janela depois de saber o
  resultado — a forma mais educada de sobreajuste.

**Quebrado nos dois sentidos:** consumo desconhecido tratado como zero (2
vermelhos), teto de trabalho removido (1), portão da bancada exigindo `pro` —
a cicatriz do Free/ZION (1).

**Aberto:** fases 4 a 7. ⚠️ A 7 é gêmea da 3: no dia em que a `/pricing` falar da
bancada, ela tem de dizer os números da §6.2 nos quatro idiomas. Hoje ela não
fala, então não há contradição — mas a fase 4 (a UI) é o gatilho.

---

## 5.16 A BANCADA — fase 4, a tela do cliente (05/09)

`/laboratorio`, `components/bancada/Bancada.tsx`, entrada em `nav-items.ts`,
strings nos **quatro** locales. Uma pergunta por vez, o pedágio acima do botão
reagindo a cada tecla, o veredito antes do placar.

### ⚠️⚠️ A trava de 24/08 pegou de novo — desta vez ANTES de subir

`Bancada.tsx` (`"use client"`) importava `ChaveNaoMedido` de `veredito.ts`, e a
cadeia era:

```
components/bancada/Bancada.tsx → lib/bancada/veredito.ts
  → lib/bancada/motor.ts → lib/paper/engine.ts → lib/supabase/server.ts
```

⚠️ **A importação era de TIPO PURO — e não importa: o empacotador puxa o
MÓDULO, não a função.** É literalmente o defeito do `ÚlfhéðnarPanel` que em
24/08 derrubou o Z-SWAP inteiro em toda rota, achado pelo dono no celular
depois de type-check, lint, build e 1.696 testes passarem.

Desta vez quem achou foi `supabase/nao-vaza-para-o-cliente.test.ts`, escrito
justamente naquele dia. **O instrumento funcionou.**

O conserto foi extrair a convenção de saída para `paper/saida.ts` — puro, sem
nenhum import de servidor — com `engine.ts` reexportando para não mexer em
chamador nenhum. ⚠️ A regra que o arquivo encarna: *função pura morando ao lado
de um import de servidor é uma armadilha carregada*.

### O veredito voltava em português para uma tela em quatro idiomas

`julgar` devolve `titulo`, `porque` e `naoMedido` em português — certo para o
BANCO, que é registro nosso; errado para a tela. Agora ele devolve também
`naoMedidoChaves` (códigos), e a UI monta a frase pelo catálogo.

⚠️ E a exaustividade é do compilador: o mapa na tela é
`Record<ChaveNaoMedido, string>`, então **uma quinta razão de "não medido" sem
as quatro traduções quebra o `type-check`** — não renderiza `undefined` em
silêncio.

⚠️ **A exceção é o motivo da RECUSA, que vem do servidor e é mostrado como
veio:** ele carrega o número exato (o alvo mínimo, o teto do plano) que uma
tradução genérica apagaria.

### Duas decisões da tela

- **Sem `TierGate` em `/laboratorio`.** Quem separa os planos aqui é a COTA, e
  esconder a tela de quem tem dez testes por dia é a cicatriz do Free/ZION ao
  contrário. A rota exige SESSÃO; a cota responde quando acaba.
- **A regra do admin atravessa; o CSS não.** `corDoResultado` devolve
  `var(--adm-*)`, que não existe nesta árvore — sairia transparente numa tela em
  que a cor É a mensagem. O que atravessa é `classificarResultado`, e
  `CorDoCliente.ts` mapeia para a paleta do cliente.

**Aberto:** fases 5 (estratégias da casa), 6 (papel adiante no cron) e 7 (a
vitrine). ⚠️ **A 7 venceu agora:** a tela existe, então a `/pricing` precisa
falar da bancada com os números da §6.2 nos quatro idiomas.

---

## 5.17 ⚠️⚠️ A VITRINE VENDIA UM MODELO QUE NUNCA EXISTIU POR PLANO (05/09)

Eu tinha levantado isto como *"a página vende Sonnet 4.6 enquanto roda Kimi"*.
Ao ir consertar, o defeito era maior e mais antigo.

### O que eu achei

`app/api/zion/route.ts` lê o tier na **linha 158** e o modelo na **442**:

```
const { tier } = await getTierForWallet(...)      // 158 — COTA e PORTÃO
const model = process.env.ZION_MODEL ?? ativo.modelo;   // 442 — um só, global
```

⚠️ **Não existe, e nunca existiu, roteamento de modelo por plano.** O passe
Pilot (30 SOL ≈ $4.350) era vendido com **"Claude Opus 4.8"** contra o
**"Sonnet 4.6"** dos planos abaixo, e o código sempre entregou o mesmo modelo
para todos. Isso **não era efeito da pausa da Anthropic** — continuaria falso no
dia em que ela voltasse.

⚠️ É o espelho exato do achado do `op-tier.ts` (01/08): lá se vendia como
exclusivo de um plano algo entregue a todos; **aqui se vendia ao plano mais caro
um modelo melhor e se entregava o mesmo de todo mundo.**

### O conserto não foi trocar o texto

O nome estava escrito à mão em **~44 lugares** (4 locales × 11 chaves + um mapa
no `NormalPlansView`). Trocar os 44 moveria a mentira. O que ficou:

- **`lib/ai/vitrine.ts`** — `modeloDaVitrine()` deriva de `aiAtivo()`, **a mesma
  função que a rota usa para chamar o modelo**, e respeita `ZION_MODEL` porque a
  rota respeita. A vitrine não tem fonte própria, então não tem como divergir.
- **Nenhum card anuncia modelo por plano.** O campo `mesmoParaTodosOsPlanos`
  documenta o porquê e vira `false` no dia em que houver roteamento de verdade.
- **`vitrine-nao-mente.test.ts`** lê o FONTE das seis telas de venda e recusa
  qualquer nome de modelo literal. Comentário não conta — a nota que explica o
  defeito precisa citar os nomes.
- ⚠️ **Id desconhecido aparece cru.** Um nome comercial chutado é o mesmo
  defeito de novo, só mais difícil de achar.

### E a fase 7 entrou junto, porque é a mesma tela

`/pricing` e `/plans` passam a anunciar a bancada com os números vindos de
`BANCADA_COTAS` — nunca digitados. `vitrine-e-porta.test.ts` compara os dois
lados **em ambas as direções**: anunciar mesa de papel a quem o portão barra é o
Free/ZION; barrar quem tem mesa é o mesmo defeito com o sinal trocado.

⚠️ `capitalCurto()` formata sem `toLocaleString` de propósito: ele varia com o
ambiente, e servidor e navegador podem discordar — hidratação quebrada por um
separador decimal só aparece em produção.

**Quebrado nos dois sentidos:** nome de modelo digitado num card (1 vermelho),
vitrine ignorando `ZION_MODEL` (1), papel adiante anunciado no plano que o
portão barra (2), cota digitada em vez de lida (3).

### ⚠️ O que ficou ABERTO, e é decisão do dono

A página não promete mais modelo por plano — mas se a intenção comercial é que o
**Pilot realmente rode um modelo melhor**, isso é código que não existe e custa
dinheiro por chamada. Enquanto não existir, a vitrine está certa em não
prometer.

---

## 5.18 A BANCADA — fase 5: as estratégias da casa, e o CEMITÉRIO (06/09)

`lib/bancada/casa.ts` + a tira em `/laboratorio`. Sete entradas: três vivas
canônicas (média 50, canal 20, RSI 14), o Maker largo, e **três lápides** —
Maker de ±0,6%, Grade e Rotação — cada uma com o número, a data e o mecanismo.

### Por que o cemitério é o ativo, e não um constrangimento (§6.5)

Backtester é commodity. *"Esta perdeu 46,77% e aqui está o porquê"* não é. E o
argumento econômico é mais forte que o honesto: **custo marginal zero** (já
foram medidas e pagas), ninguém publica o que não funcionou, e ⚠️ **elas
REDUZEM custo** — quem lê "o pedágio comeu 67% do seu alvo" antes de rodar
cinquenta backtests gasta menos CPU e abre menos suporte.

### ⚠️ O par que é a aula inteira

| | alvo | praça | portão |
|---|---|---|---|
| Maker de Faixa (morto) | ±0,6% | Gate **spot taker** | **recusado** — pedágio come 67% do alvo |
| Maker de Faixa (vivo) | ±2,5% | Gate **futuros maker** | passa — pedágio come 5% |

**O gatilho é IDÊNTICO** (o teste afirma isso comparando os dois `entrada`).
Não foi a ideia que mudou, foi o tamanho do movimento contra o pedágio.
Carregar a morta faz o portão recusar na hora, com o número: a recusa é a aula.

### ⚠️ E a Rotação passa no portão E ESTÁ MORTA

−1,61% por período, com **ficar em caixa batendo**. Ela não morreu de taxa —
morreu do mercado daquela janela. É a prova, dentro do próprio catálogo, de que
o portão do pedágio **não é o único juiz**, e de que o veredito precisa do
competidor.

### O catálogo é conferido contra o MOTOR, não contra si mesmo

- todo `params` passa pelo **mesmo `lerEstrategia`** da rota — senão o botão
  "usar esta" preencheria o formulário com algo que o servidor recusaria, e o
  cliente levaria a culpa por um erro nosso;
- nenhuma **viva** é recusada pelo nosso próprio portão;
- toda **morta** carrega medição com data — ⚠️ lápide sem número é opinião;
- toda chave de texto existe nos quatro idiomas.

⚠️ **A medição da casa não é previsão para o cliente.** Cada número saiu de UMA
janela, com UM par de parâmetros, nas NOSSAS mesas — por isso o número nunca
aparece sem a data ao lado, e o botão só PREENCHE o formulário: nada roda
sozinho, e a estratégia morta não gasta cota para ensinar o que o portão ensina
de graça.

**Quebrado nos dois sentidos:** viva que o portão recusa (2 vermelhos), lápide
sem medição (1), chave de texto que ninguém criou (1).

---

## 5.19 A BANCADA — fase 6, o papel adiante. **AS SETE FASES FECHADAS** (06/09)

`lib/bancada/papel.ts` (puro), `tique.ts` (a costura), `/api/bancada/estrategias`
(salvar / listar / ligar), migrations `0039` e `0040`, e a UI de salvar + ligar
a mesa.

### ⚠️ Onde ele tick — e por que NÃO tem cron próprio

Está pendurado no **`/api/zion/backtest`** (30 min), que já está agendado no
cron-job.org e já roda o papel da própria casa.

⚠️ **Criar rota nova exige um passo FORA do repositório** — alguém abrir o
cron-job.org e criar o job. O `/api/dca/cron` ficou escrito e testado desde
26/08 esperando exatamente isso (RUNBOOK §2.1). Uma rota de cron que ninguém
agenda é *"atividade não é evidência de funcionamento"* esperando para acontecer.

⚠️ **O DCA JÁ FOI AGENDADO** — e três documentos e dois comentários de código
seguiam dizendo "nunca agendado" (achado A03). Medido em 15/09: `cron:dca:last`
há 3,2 min, na cadência de 5 minutos, três segundos depois do autopilot.

⚠️ E **não** vai no cron do autopilot, que move dinheiro real: um defeito no
papel de um cliente não pode chegar perto daquele caminho. Melhor-esforço, como
o papel da casa logo acima — uma mesa com problema não leva junto o flywheel.

### O que eu ia deixar como remendo, e virou migration

Eu ia guardar o instante da vela do sinal na coluna **`expira_em`**, com um
comentário pedindo desculpa. Duas razões para não:

1. `expira_em` significa outra coisa e a tela a mostra como expiração —
   escrever ali faz a interface mentir;
2. ⚠️ **usar `aberta_em` também não serve, e o erro é sutil:** uma posição
   aberta às 05h01 a partir da vela das 04h **bloquearia a vela das 05h**,
   porque 05h < 05h01. A guarda passaria a recusar sinais legítimos e ninguém
   veria — a mesa só ficaria quieta.

`0040` dá coluna própria (`vela_em`) ao dado próprio.

### ⚠️ O tier é relido A CADA TICK

Quem cai de `trader` para `pro` para de tickar sozinho. Se a checagem morasse só
no ato de LIGAR, ele continuaria consumindo cron para sempre depois de parar de
pagar — e **nada quebraria** para denunciar. O corte é determinístico (mais
antigas sobrevivem): por ordem arbitrária, a mesa do cliente pararia e voltaria
sem explicação a cada tick.

### ⚠️ Uma vela, um sinal

O cron roda a cada 30 min e a vela pode ser de 1h: sem a guarda, o tick das :00
e o das :30 leriam **o mesmo cruzamento** e abririam duas posições do mesmo
movimento — a inflação de amostra que o motor evita usando cruzamento, entrando
pela porta do relógio.

### A marca do `Dono` pegou fora do teste

`Mesa.dono` estava declarado `string`, e `abrirPosicao` **recusou em tempo de
compilação**. A trava da fase 1 fez o trabalho dela em código de produção, não
num exercício.

### E o que faltava para a fase 6 EXISTIR

Até aqui o `/laboratorio` montava e rodava, e o parâmetro morria na tela:
`salvarEstrategia` estava no store desde a fase 1 e **nenhuma rota o chamava**.
Sem estratégia salva não há o que tickar. A rota e a UI entraram junto — senão a
peça ficaria *"correta, testada e desconectada do caminho que decide"*.

**Quebrado nos dois sentidos:** teto só no ato de ligar (2 vermelhos), sem a
guarda de vela já avaliada (1), vela corrente decidindo (1), expirada no lucro
contada como ganho (1).

### ⚠️ O QUE FALTA AGORA É USO

As sete fases estão em produção e **nenhuma rodada real aconteceu**. As tabelas
`bancada_*` estão zeradas. Os 2537 testes provam as peças; o caminho completo
com dado real, não. A primeira rodada em `/laboratorio` é o teste que falta.

---

## 5.20 A MIGRAÇÃO DO NEXT 14 → 16 (06/09)

`next@14.2.35 → 16.3.4`, `react@18 → 19`, `eslint@8 → 9`, `@react-three/fiber@8
→ 9`. ⚠️ **O `next` não aparece mais no `npm audit`** — os 21 advisories que
motivaram tudo fecharam. Plano e verificação em `docs/PLANO-NEXT-16.md`.

### ⚠️ Eu superestimei o risco ao descrevê-lo, e a medição corrigiu três coisas

| eu disse | o que o levantamento mostrou |
|---|---|
| "os `params` viraram assíncronos e o repo tem 30+ rotas" | **3 rotas dinâmicas**, e **2 já estavam** no formato. Faltava **uma** |
| "`cookies()` vira assíncrono" | `auth/session.ts` **já fazia `await cookies()`** |
| "o fim do cache padrão toca o `revalidate: 3600` das velas" | `next: { revalidate }` explícito **continua valendo**. Muda só o padrão de quem não anota |

⚠️ **E o "risco de cache" que eu levantei também não existia.** Contei 53
fetches sem anotação; o `grep` excluía a anotação quando ela estava na linha
seguinte — que é onde ela está neste repositório. Contando a chamada inteira:
**71 anotados, 22 sem**, e os 22 são fetch de navegador, POST, ou decisão
deliberada de não cachear (o `funding` tem cicatriz de 06/08 sobre isso). **Não
havia nada a anotar** — fazer o trabalho para casar com o meu diagnóstico errado
teria mexido em 22 arquivos e enterrado duas decisões deliberadas.

### Dois achados que não eram da migração

**1. `serverComponentsExternalPackages` mudou de nome** e saiu de `experimental`.
Se tivesse deixado de valer em silêncio, o `ccxt` (3 MB, 100+ adaptadores)
voltaria para dentro do bundle do servidor.

**2. ⚠️ Um `<a href="/">` no Topbar.** O `eslint-config-next@16` passou a tratar
como erro, e com razão: `<a>` recarrega a página inteira e **derruba o estado do
cliente — carteira conectada, idioma, gaveta do ZION**. Virou `Link`. Esse
achado sozinho paga a migração.

### As 117 do React Compiler ficaram como AVISO, e o porquê está escrito

Seis regras novas, 117 ocorrências em código que roda há meses. Não são
regressão. Consertá-las agora seria refatorar estado em 30+ componentes de
carona numa troca de framework; desligá-las perderia o sinal que achou o `<a>`.
Ficaram visíveis e contáveis. ⚠️ `set-state-in-effect` (70) e `purity` (36)
merecem leva própria.

### ⚠️ O `--silent` do npm engoliu um `ERESOLVE`

`npm install next@16 --silent` **não instalou nada e não disse nada**. Só
apareceu porque eu conferi a versão depois. É a mesma família de "atividade não
é evidência de funcionamento": o comando rodou, o exit code foi 0, e o efeito
não aconteceu. **Não use `--silent` em install.**

### O que foi exercitado À MÃO — porque CI verde não prova App Router

Servidor de produção local: 9 páginas em 200, a rota de `params` assíncrono em
200, `/api/bancada/*` sem cookie em **401** (recusa, não explode), os **4 crons
sem `CRON_SECRET` em 401** nos quatro, todos os cabeçalhos de segurança
presentes — **inclusive o `same-origin-allow-popups`** sem o qual a carteira
Coinbase morre — e `/admin` em **404**, nunca 403.

---

## 5.21 ⚠️ A CLASSE DO TAILWIND QUE NÃO EXISTE NÃO VIRA CSS — E NÃO AVISA (06/09)

O dono abriu o `/laboratorio` no celular: *"essa parte da UI está horrível"*.
Estava, e além do layout havia um **defeito de verdade**.

### O defeito

Os `<input>` usavam **`bg-bg-0/60`**. A escala de fundo deste tema é
`bg` (DEFAULT), `bg-1`…`bg-4` — **`bg-0` não existe**.

⚠️ **Uma classe do Tailwind que não resolve não vira CSS nenhum.** Ela não
avisa, não quebra o `build`, não aparece no `type-check` e não falha em teste
algum: o elemento fica sem a propriedade. Os campos caíram no **branco padrão do
navegador**, e a tela ficou com quatro retângulos brancos contra o tema escuro.

⚠️ **Quem viu foi o dono, na tela.** Nossos 2.537 testes não tinham como — é a
mesma família de "duas fontes, uma silenciosa": o token existia na minha cabeça
e não no `tailwind.config.ts`.

### A trava, e o que ela achou sozinha

`components/token-de-cor-existe.test.ts` lê as escalas do `tailwind.config.ts` e
recusa qualquer `bg-|text-|border-…` que aponte para um degrau inexistente.

⚠️ **Na primeira execução ela achou um segundo, que eu não tinha visto:**
`text-bg-0` no botão RODAR — o texto do botão estava **sem cor definida** sobre
o gradiente ciano.

### O layout, e por que ele estava errado

| o que estava | por quê |
|---|---|
| 7 estratégias da casa abertas no topo | somavam uma tela inteira e empurravam a FERRAMENTA para fora da primeira dobra — quem chegava via um catálogo, não uma bancada. Agora recolhida, com a contagem no rótulo |
| gatilhos como botões de largura total com a frase dentro | três parágrafos empilhados não se leem como seletor, se leem como lista. Agora três fichas curtas (Média · Canal · RSI) com a frase inteira embaixo |
| um campo por bloco | "capital" e "intervalo da vela" tinham o mesmo peso visual. Agora agrupados: dinheiro+janela numa linha, direção+alvo+stop+tempo noutra |
| praça×papel como 6 botões combinados | quebravam em três linhas, e obrigavam a procurar a combinação em vez de escolher duas coisas |

⚠️ §2.4 do plano pede **uma pergunta por vez** — o que não é o mesmo que **um
campo por tela**, e eu tinha lido como se fosse.

**Conferido no HTML e no CSS gerados**, não no fonte: a regra
`.bg-bg-2\/80{background-color:#080b22cc}` existe no chunk que a página carrega.

---

## 5.22 ⚠️⚠️ A PRIMEIRA RODADA REAL ACHOU QUATRO DEFEITOS MEUS (06/09)

O dono clicou numa mesa. Os 2.569 testes estavam verdes; o banco contou outra
história. **Esta seção é a prova de que teste unitário não substitui uso.**

### 1. A janela encolhia EM SILÊNCIO — o grave

O cliente pediu **365 dias**. O cache tinha:

| | velas | dias cobertos |
|---|---|---|
| 1d | 366 | **365** ✓ |
| **1h** | 1600 | **66,6** ✗ |
| 4h | 1600 | 266 |

⚠️ **A mesa caminha sobre 1h.** Ela mediu 66 dias e o veredito saiu como se
fosse a janela pedida.

A causa: `MAX_VELAS_POR_BUSCA = 800` no `mercado/store.ts`, meu. O comentário
dizia *"800 dias cobre os 2 anos com folga"* — verdade para velas DIÁRIAS; em
1h, 800 são **33 dias**. E `fetchTimedCandles` **já paginava sozinho** até o
limite pedido: o 800 não protegia de rajada nenhuma, só cortava.

⚠️ **E duas rodadas idênticas a 30 segundos deram números diferentes**, porque a
segunda buscou mais 800 e mediu outro período. Nada explicava.

Conserto: teto de 10.000, **e a cobertura real comparada com a pedida** — abaixo
de 90% o `porqueIncompleta` diz, com os números, de que período o veredito fala.

### 2. A cota subcontava ~10×

`custo_velas: 365` gravado; a rodada leu **3.566 velas** (1h + 4h + 1d). O modo
mesa lê quatro prazos e a cota cobrava um — e pelo prazo errado, o `1d` marcado
na tela em vez do `1h` sobre o qual o seletor caminha.

### 3. O extrato mentia sobre o que foi rodado

`origem: "propria"` e `intervalo: "1d"` numa corrida de MESA. O histórico do
cliente descrevia uma estratégia dele, num prazo que a mesa não usa.

### 4. ⚠️ E o dono viu o que faltava: *"não aparece as entradas feitas"*

O motor produzia cada `Operacao` — entrada, saída, desfecho, qual playbook — e
`resumir()` **jogava tudo fora**. Um veredito sem as operações é um número sem
como conferir: o cliente lê "−1,85%" e não sabe se foram quatro entradas ruins
ou uma catástrofe.

E `bancada_posicao` era escrita pelo cron desde a fase 6 com **nenhuma tela
lendo**: a mesa tickava, abria, fechava, e o dono dela não via nada. É a mesma
família de *"a peça existe, é testada, e está desligada do caminho que decide"*
que esta base perseguiu a sessão inteira — agora do lado do cliente.

Migration `0041` guarda as operações; a tela mostra cada entrada com preço,
saída, desfecho e playbook, mais a seção **"Rodando agora"** com as mesas vivas
e suas posições abertas.

⚠️ **A tela diz a CADÊNCIA:** as mesas tickam a cada 30 minutos com o cron.
Chamar de "tempo real" o que anda de meia em meia hora criaria a expectativa
errada.

### ⚠️ Dois consertos meus nasceram SEM TESTE, e eu só descobri quebrando

Depois de corrigir o truncamento e a cota, quebrei os dois de propósito: **nada
acusou**. `mercado/store.ts` não tinha arquivo de teste nenhum. Os dois guardas
existem agora, e quebram.

E a trava de cor que escrevi ontem pegou um `bg-bg-0` que **acabei de escrever**
na seção nova — a terceira vez que ela acha um caso meu.

---

## 5.23 ⚠️⚠️ DEZ BOTÕES, UM SELETOR SÓ — E A TELA QUE ESQUECIA (07/09)

> *"cada teste que rodo sobrepõe o outro, e não mostra qual agente está
> rodando, não dá pra saber o que está rodando.... cadê a experiência Premium
> que tanto queremos oferecer ao cliente?"*

Três defeitos de tela, e **um quarto que só o banco mostrou**.

### O que a tela fazia de errado

`const [r, setR]` — a rodada era um ESTADO, não uma lista. Cada corrida escrevia
por cima da anterior, e o F5 apagava a tarde inteira. As linhas estavam gravadas
desde a fase 1 e **nenhuma tela as lia de volta**: a mesma família de
`bancada_posicao`. Agora há `GET /api/bancada/rodadas`, e cada cartão **nasce
antes da resposta**, já com nome — é isso que responde ao *"não mostra qual
agente está rodando"*.

E `"1 operações"` estava na tela: o plural era interpolado e servia para todo
`n`. Singular ganhou chave nos quatro idiomas, e `quatro-idiomas.test.ts` trava
paridade de chaves, paridade de `{placeholders}` e a forma singular/plural.

### ⚠️⚠️ O QUARTO: o botão prometia o que `mesa-real.ts` não faz

Lendo as rodadas do dono para conferir o conserto:

| hora | mesa clicada | líquido | n |
|------|--------------|---------|---|
| 08:35 | **FREYJA** (`strat_dex`) | `+2,140788280112371%` | 1 |
| 08:37 | **ULLR** (`ullr_launch`) | `+2,140788280112371%` | 1 |

Idêntico até a última casa decimal. **`rodarMesa` não recebe a mesa.** Ela roda
um caminho único — `candidateAttempts` com a política "primeiro playbook com
plano" — e o nome era o rótulo colado por cima. As quatro de arbitragem não
tomam trade direcional; a URÐR veta pelo histórico; a SKAÐI filtra clima; a ULLR
caça pool recém-nascida com bracket fixo 18%/9% e nem olha BTC.

É literalmente o que o cabeçalho de `mesas-da-casa.ts` proíbe — *"o cliente
rodando uma coisa achando que é outra, com a nossa marca"* — e entrou pela porta
do botão **três dias depois da frase ser escrita**. A lição não é "faltou um
teste": é que a regra estava escrita, em português, no topo do arquivo certo, e
mesmo assim não segurou — porque nada a executava.

`MESAS_QUE_A_RODADA_REPRODUZ` = `strat_mech` + `strat_dex`. As outras oito
continuam na vitrine. O filtro está na **rota**, não só no botão.

### O de sempre: uma escrita cujo erro ninguém lia

`gravarResultado` devolvia `Escrita<true>` e a rota **descartava**. Com
`supabase-js` resolvendo `{ data: null, error }` em vez de lançar, uma coluna
faltando apagaria a rodada do histórico sem log, sem erro na tela, e com a
resposta parecendo perfeita — o cliente só descobriria no F5 seguinte, que é
exatamente a queixa que o histórico foi feito para resolver.

Migration `0042` (`competidor_pct` nulo-é-nulo, `nao_medido_chaves` para a tela
traduzir) — **aplicada no banco**.

---

## 5.24 ⚠️⚠️ O INVESTIDOR LIA O PLACAR DA CASA — A INSTÂNCIA NÃO EXISTIA (07/09)

> *"apenas estamos pegando os resultados das mesas do painel e Admin e
> repetindo para o investidor... eu falei que tinha que ser isolado... vc tem
> que parar de ficar amontoando uma coisa em cima de outra por preguiça de
> separar"*

Ele estava certo, e a crítica é sobre **método**, não sobre uma tela. Eu tinha
empilhado três entregas que juntas PARECIAM a coisa:

| peça | o que ela era de fato |
|---|---|
| card da mesa, `+4,34%/op` | agregação de `zion_suggestions` — **o livro do admin** |
| botão "rodar esta mesa" | um **backtest**: passado obedecendo |
| papel adiante | vivo e isolado, mas só sabia `media\|canal\|rsi` |

Nenhuma das três é a instância do investidor. E o mais desconfortável: cada uma
delas foi entregue como resposta a uma crítica anterior dele. Três camadas em
cima do buraco, em vez do buraco.

### O que faltava, e agora existe

`bancada_estrategia.mesa` (0043) transforma uma linha em INSTÂNCIA de agente. O
tick bifurca por ela: `agente.ts` chama `computeIndicators` + `candidateAttempts`
— as MESMAS funções da mesa ao vivo — e a posição que nasce é do investidor.
`desempenho.ts` conta o extrato dele, **do zero**, sem tocar em
`zion_suggestions`.

### As decisões que a preguiça teria tomado errado

1. **`params` de uma instância é `{}`**, e `Mesa.params` virou
   `EstrategiaDoCliente | null`. Guardar uma estratégia de fachada com
   `alvoPct: 2.5` faria o tick abrir posições com um alvo que a mesa **nunca
   declarou** — o bracket dela é variável. `decidirAbertura` só aceita
   `MesaPropria`: passar uma instância de agente ali **não compila**.
2. **Uma coluna, não uma tabela nova.** Duas fontes para "o que este cliente tem
   ligado" é a receita para as duas discordarem.
3. **O vazio é uma resposta.** Quem contrata hoje vê "ainda sem nada decidido" e
   **nenhum número** — nem 0%. Preencher com a nossa amostra era o defeito.
4. **O placar da casa fica, rotulado**: *"o que a NOSSA mesa fez — não o seu"*.

### E de quebra, um defeito latente do caminho antigo

`decidirFechamento` relia o alvo da ESTRATÉGIA para fechar uma posição já
aberta: editar a estratégia movia o alvo **retroativamente**. Agora o bracket é
lido da POSIÇÃO (`decidirFechamentoDaPosicao`), e cada linha carrega o seu —
exigência do agente, cujas duas posições têm alvos diferentes.

### ⚠️ E o teto do tick mentia — achado ao dimensionar o agente

`MESAS_POR_TICK = 40` vinha com o comentário *"as que sobram pegam o tick
seguinte, e a ordem determinística garante que ninguém fique para trás para
sempre"*. Ele afirmava **o oposto do que o código fazia**: com a lista ordenada
por criação e um `.slice(0, 40)`, as mesmas 40 primeiras ganham em TODO tick e a
de número 41 **nunca roda**. Isso não é fila, é corte.

Só apareceu porque a instância de agente custa **3 leituras de vela por símbolo
mais `computeIndicators`**, contra 1 leitura da estratégia própria — 40 agentes
de 5 símbolos pedem 600 leituras dentro de uma função com `maxDuration = 60`
que antes disso já rodou o flywheel, o oráculo, o radar e o papel da casa. Ao
fazer essa conta o comentário caiu junto.

Dois consertos: `AGENTES_POR_TICK = 8` (orçamento próprio para a espécie cara) e
`aVezDeQuem()`, uma janela que **rola** a cada tick — a ordem continua
determinística, o ponto de partida anda, e em `n/teto` ticks todo mundo passou.
O teste que prova isso inclui a contraprova: com o `.slice` fixo, o último da
fila não aparece em 50 ticks.

E `adiadas` entrou no resumo e no evento do cron: sem esse número, a única forma
de descobrir que o teto está apertado seria um cliente reclamando que a mesa
dele não abre.

### A lição de método

Três críticas seguidas do dono sobre a mesma tela, e as três primeiras respostas
foram camadas. A pergunta que faltou nas três: *"o que ele pediu já existe como
peça, ou eu estou decorando o que já tem?"*. Nas fases 5, 6 e 7 a resposta era
"não existe" — e eu decorei.

---

## 5.25 O ATIRADOR QUE NUNCA ATIROU — e o instrumento que não sabia dizer por quê (08/09)

> *"o atirador cedo sumiu do celeiro, para onde ele foi?"* … *"vamos ver por que
> o pool_novo não achou nenhum pool"*

Ele não sumiu. O cron passou por ele **834 vezes** e ele examinou **5.004 pools
desde 21/08, aprovando ZERO**.

| | |
|---|---|
| examinados | 5.004 |
| nunca lidos (dexscreener/GoPlus não responderam) | **2.200 — 44%** |
| chegaram ao portão | 2.804 |
| barrados por *"liquidez não travada"* | **2.591 — 92,4%** |
| barrados por *"concentração não medida"* | 2.015 — 71,9% |
| falharam em UMA coisa só | 34 — e **27 deles só na concentração** |

### ⚠️ O defeito: `liquidezTravada` não sabia dizer "não medi"

Ela devolvia `boolean`, colapsando **"medi e NÃO está travada"** com **"a fonte
não me devolveu os detentores de LP"**. As duas reprovam — e é certo que
reprovem, porque para efeito de DECISÃO um pool cuja trava ninguém verificou é
indistinguível de um sem trava.

Mas para efeito de **diagnóstico** elas são opostas, e pedem ações opostas:

- *"o mercado da Base é assim mesmo"* → nada a fazer, o agente está certo em não
  atirar;
- *"a GoPlus não indexa LP nesta chain"* → trocar de fonte, ou apontar o agente
  para outra chain.

Com 92,4% das reprovações caindo numa frase só, **não havia como escolher entre
as duas**. Instrumento que não separa isso manda ajustar às cegas — e foi por
isso que 18 dias de silêncio pareceram normais.

⚠️ E a disciplina certa já estava **no mesmo arquivo**: `concentracaoTop10`
devolve `null` para "não medi" desde sempre. Uma das duas estava certa e a outra
errada, lado a lado.

Agora são três respostas, a decisão é a mesma (`null` reprova, igual a `false`),
e a recusa diz qual dos dois casos ocorreu. A próxima medição responde a
pergunta sozinha.

### O que NÃO foi possível verificar daqui

O proxy deste contêiner bloqueia `api.gopluslabs.io` (`CONNECT tunnel failed,
403`), então **não dá para testar a API ao vivo** e confirmar se ela devolve
`lp_holders`/`holders` para a Base. A instrumentação acima é o caminho honesto:
em vez de afirmar o que a fonte faz, deixar o próprio agente medir e dizer.

---

## 5.26 ⚠️⚠️ O RÓTULO FALA DE **A**, O NÚMERO VEM DE **B** — sete telas (08/09)

Uma caçada só, um formato só de defeito. Nenhum deles é conta errada: a conta
está certa e **descreve outra coisa** que não a que o rótulo promete. Foi a
família que o dono farejou três vezes dizendo *"está aparecendo resultado que
vem do painel ADMIN"* — não era vazamento (medido: `0 de 36` operações da
bancada compartilham preço de entrada com o admin), era a **tela** dizendo
errado, de um jeito diferente a cada vez.

| tela | dizia | vinha de | consequência |
|---|---|---|---|
| card do agente | "vela de 104 min atrás" | **abertura** da vela | dado de 44 min parecia velho — PR #410 (`velaFechaEm`) |
| vitrine das mesas | "nada decidido desde {dia}" | `created_at` (**emissão**) | até 72h de defasagem; a `hybrid_scan` decidiu 16/08 e o card dizia 13/08 |
| DCA (dinheiro real) | "Agendador vivo — há 3 min" | heartbeat gravado **antes** do gate | com `pause_dca` ligado, fila congelada com selo verde |
| carteira | "Carteiras acima são **demo**" | sobra do mock | saldo REAL do cliente, 12 linhas abaixo de "nada é fabricado" |
| painel | "Atividade · **30 dias**" | laço de **14** buckets | o "total" subestimava o volume do próprio cliente |
| terminal `/pro` | "última vela há 8s" | idade da **busca** | e `200` com `candles: []` acendia verde sobre gráfico vazio |
| terminal `/pro` | "**24h**" e "Vol 24h" | 250 velas = **4,2h** no 1m, 20,8h no 5m | erro de até 6× em número que decide ordem |
| card do agente | "trabalhando há 2h" | `papel_desde` reescrito ao **religar** | ao lado de 48 decididas de duas semanas |

### A regra que sai daí

**Todo instante na tela tem de vir do evento que o rótulo nomeia.** Não do
evento vizinho que estava à mão — a busca em vez da vela, a emissão em vez da
decisão, o religar em vez da contratação. As duas costumam existir no mesmo
objeto, a poucos caracteres uma da outra, e a errada quase sempre é a mais
fácil de alcançar.

E o corolário: **quando as duas idades importam, mostre as duas.** No selo do
`/pro` a fonte responder e o dado ser recente são perguntas distintas, e uma não
substitui a outra.

### O que virou trava

Módulos puros, com teste que quebra nos dois sentidos:
`diaDaDecisao` · `estadoDoAgendador` · `vivacidadeDoGrafico` · `janelaDoCabecalho`
· `inicioDaCobertura`. Nenhuma dessas decisões ficou em `if` dentro de JSX —
`vitest` roda em `node`, e o que mora em `.tsx` não é testado.

⚠️ **E um número escrito à mão num texto é uma afirmação que envelhece
sozinha**: "30 dias" e "24h" eram literais. Agora saem da constante que alimenta
o laço.

---

## 5.27 ⚠️⚠️ A AUDITORIA EXTERNA DE 30 ACHADOS — fechada (15/09)

Uma auditoria externa (ChatGPT) apontou **30 itens: 8 altos, 21 médios, 1
baixo**. Todos foram conferidos contra o código real, os reais foram corrigidos,
testados, quebrados nos dois sentidos e entregues. **PRs #419 a #445.**

### A família de defeito que dominou

Doze dos trinta tinham a MESMA forma:

> **a peça certa, testada, com a cicatriz escrita — e um caminho que não a usa.**

Não era código faltando. Era código existente, conferido num chamador e
ignorado noutro. Exemplos:

| a peça | onde era conferida | onde não era |
|---|---|---|
| `bumpSessionTrades` devolve `boolean` | os dois pontos do cron | a rota do navegador (#436) |
| guarda de impacto do swap | a cotação exibida | a cotação REASSINADA (#429, #432) |
| `savePendingOrder` devolve `false` | dois chamadores | o terceiro (#440) |
| chip "sem nada por trás" já removido | o chip do MEV | os dois vizinhos (#445) |

⚠️ **A lição operacional:** antes de mudar como um dado é interpretado, **ler
todos os chamadores, não só a função.** Eu mandei DUAS regressões nesta leva
pela causa oposta — consertei a função pura sem ler o caminho inteiro (#435,
#441). Ambas achadas pelo revisor, não por mim.

### O que eu aprendi sobre quebrar as próprias travas

- **Quebrar a guarda prova que ela pega o que mede — não que ela mede a coisa
  certa.** Os três defeitos que o revisor achou no MEU trabalho estavam todos no
  que eu não estava medindo. Em #435 todas as minhas quebras testaram que a
  guarda DISPARA; nenhuma testou que a entrada legítima SOBREVIVE — e a guarda
  transformou `pnl_usd` negativo em texto, quebrando a contabilidade em produção.
  **Toda negação precisa da gêmea positiva.**
- **Travador que roda sujo não é detecção.** Quatro quebras "passaram" porque o
  arquivo estava quebrado e o vitest nem rodava. Passou a valer: `type-check`
  limpo em CADA quebra, senão não conta.
- **Âncora textual pega o texto, não o código.** Cinco vezes uma trava casou com
  o próprio comentário que contava a cicatriz. Comentários saem antes de medir.
- **Trava textual sobre fonte de rota é a armadilha que a casa já tinha marcado.**
  Quando a conta dá para extrair, ela vira módulo puro com teste de verdade
  (`admin/atribuicao.ts`, `swap/fontes.ts`).

### Os cinco últimos, em 15/09

| # | achado | o que era |
|---|---|---|
| A06 | #442 | reverter um genoma fazia 4 escritas soltas; falhar no meio deixava o agente **sem genoma ativo**. Virou RPC atômica (0048). Inverter a ordem não era saída: o índice parcial devolve 23505 — medido |
| A07 | #443 | `/api/operations/record` aceita `confirmed` + taxa **sem sessão**; os painéis somavam tudo. **100% da arrecadação exibida** vinha de linha anônima |
| A05 | #444 | a restrição `motivo_saida = 'liquidacao'` existia em produção e **não no repo**: banco novo recusaria 23514 no fechamento de posição alavancada |
| A03 | #444 | cinco lugares diziam que `/api/dca/cron` "nunca foi agendado". Medido: `cron:dca:last` a 3,2 min, na cadência de 5 min |
| A02 | #445 | a home afirmava **"ZION considera seguro"** sem token escolhido, e **"14 rotas avaliadas"** com o 14 escrito à mão — sendo que no máximo UMA fonte dispara por par |

### O que ficou para o dono decidir

Nenhum destes é defeito — são escolhas que não são minhas:

1. as **3 carteiras admin legadas**;
2. a **TOCTOU de cota** (precisa de restrição no banco, não em código);
3. `liquidoCompostoPct` **compondo símbolos paralelos**;
4. a venue do **`maker_de_faixa`**;
5. ⚠️⚠️ **O BRAÇO DOS MODELOS DE IA PAROU INTEIRO.** Medido em 15/09 sobre
   `zion_suggestions` — 19 fontes já escreveram ali, e **só 4 escreveram nos
   últimos 10 dias**:

   | viva | última | | dormente | parada há |
   |---|---|---|---|---|
   | `strat_mech` | hoje | | `mistral_scan` (944 sugestões) | 11,6 d |
   | `strat_dex` | hoje | | `radar` | 11,5 d |
   | `strat_day` | hoje | | `grok_scan` (955) · `kimi_scan` (451) · `hybrid_scan` | 32,7 d |
   | `strat_ai` | 1,4 d | | `deepseek_scan` (774) · `self_scan` (875) | ~51 d |

   As quatro vivas são **todas `strat_*`** — as estratégias mecânicas. **Todo
   scanner de modelo de IA está parado**, incluindo `mistral_scan`, a única mesa
   que chegou a virar positiva. Isto é medição, não opinião, e é a pergunta mais
   cara em aberto.

   ⚠️ **Correção de um número que eu mesmo publiquei nesta sessão:** eu disse
   "19 das 22 mesas dormentes". O certo é **15 de 19 fontes**, e o recorte que
   importa não é a contagem — é que o corte separa `strat_*` de todo o resto.


## 6. O que custou caro aprender (além das 33 invariantes)

**Escrita de estado sem conferência, no autopilot — quatro de uma vez.**
(25/08.) `markServerExitArmed`, `reopenServerPosition`, `closeServerPosition` e
`applySessionPnl` devolviam `void`. O cliente do Supabase RESOLVE com
`{ error }`, então cada uma era indistinguível de sucesso — e cada falha tinha
consequência PRÓPRIA:

| falha | consequência |
|---|---|
| saída não marcada | a passada seguinte arma DE NOVO e vende duas vezes |
| posição não reaberta | fica presa apontando para ordem morta |
| posição não removida | o teto de exposição conta capital que já saiu |
| **P&L não contabilizado** | **o stop de perda diária não vê a perda** |

> O alerta carrega a CONSEQUÊNCIA, não o nome da função. "closeServerPosition
> falhou" não diz a ninguém o que fazer.

A trava (`escritas-conferidas.test.ts`) conta **chamadas**, não presença — foi
exatamente assim que estas passaram: cada função tinha um caminho conferido e
outro não.

**O instrumento que media o filtro ficava cego junto com ele.** (25/08.) O
filtro de regime do paper falha ABERTO de propósito — sem sinal, a entrada
passa. Se a corretora recusa as velas, tudo volta `null`, tudo passa,
`bloqueados` fica 0 — e o evento `paper_regime_tick`, que só gravava ao barrar,
nunca saía. Filtro trabalhando e filtro CEGO produziam o mesmo silêncio.

> Quando um instrumento só fala no caminho feliz, o silêncio dele não prova
> nada. Foi a outra sessão que apontou.



**Uma função PURA ao lado de um import de servidor derrubou a aplicação
inteira.** (24/08, minha, em produção, achada pelo dono no celular.)

`UlfhednarPanel.tsx` é `"use client"` e importou `estadoDa` — função pura, não
toca banco — de um módulo que na PRIMEIRA LINHA importava `getSupabaseAdmin`. O
empacotador puxa o **módulo**, não a função. A guarda de `supabase/server.ts`
lança quando avaliada no navegador, e como ela roda ao carregar o pacote do
cliente, não caiu o painel novo: caiu o **Z-SWAP em todas as rotas**, com
`supabase/server.ts must never be imported in the browser`.

⚠️ **AS QUATRO FERRAMENTAS PASSARAM VERDES NO COMMIT QUE QUEBROU** — `tsc`,
`lint`, `build` e 1.696 testes. Não é descuido delas: o defeito é de
**avaliação no navegador**, e nenhuma das quatro avalia nada num navegador. É a
mesma família do `Cross-Origin-Opener-Policy` que matou a Coinbase Wallet e
ficou semanas verde.

> Função pura morando ao lado de um import de servidor é armadilha carregada.
> Se um `"use client"` precisa de algo de um módulo, o módulo INTEIRO vai junto.

A trava é `src/lib/supabase/nao-vaza-para-o-cliente.test.ts`: percorre a árvore
de imports de todo componente cliente e falha imprimindo o CAMINHO. Tem que ser
**transitiva** — o caminho real tinha um salto no meio, e uma trava de primeiro
nível teria passado batido.

E ela **nasceu errada**: acusou um arquivo que não importa nada, porque casou a
frase `from "@/lib/supabase/server"` escrita DENTRO de um comentário. O
instrumento afirmando o que não sabe, de novo. Agora tira comentário antes de
varrer, e foi provada nos dois sentidos — no teste e no pacote gerado (com o
import errado a guarda aparece num chunk; com o conserto, em nenhum dos 183).

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
| ÚLFHÉÐNAR (a matilha) | `src/lib/ulfhednar/mensagens.ts` · `src/app/admin/api/ulfhednar/route.ts` · `UlfhednarPanel.tsx` |

---

## 7.1 Os documentos novos (19–23/08)

| documento | para quê |
|---|---|
| `PLANO-O-CELEIRO.md` | o desenho da segunda arena e a medição que a obriga |
| `PLANO-CELEIRO-AMBICIOSO.md` | **a correção de 22/08** — o Maker perdeu acertando 65%, e as três invariantes que faltavam |
| `AUDITORIA-MESAS-19-08.md` | por que o livro antigo é negativo ANTES do custo |
| `TROCAR-DE-PROVEDOR.md` | **Kimi ↔ Anthropic numa variável** — leia ao reabastecer |
| `PLANO-TAMANHO-E-REGIME.md` | do zettaceo: filtro de tendência e tamanho de posição |
| `PLANO-MURAL-DE-AGENTES.md` | como duas sessões coordenam sem se derrubar — as travas |
| `PLANO-ULFHEDNAR.md` | a aba do salão: o que ela mostra, e o que ela **não** mostra |

---

## 8. Rotina de encerramento

Antes de terminar qualquer entrega:

1. `tsc --noEmit` + `lint` + `npm test` localmente (o CI repete, mas achar
   depois do push custa um ciclo).
2. PR, esperar CI verde, **e mergear** — ver §3. Não existe mais deixar pronto
   e esperar ordem.
3. ⚠️ **Conferir na `main` POR CONTEÚDO**, não pelo estado do PR:
   `git pull && grep` nos arquivos que deviam ter mudado. O #381 já apareceu
   "pronto" estando vazio.
4. Conferir que o deploy de produção disparou (já falhou 1 vez em 17).
5. **Atualizar este documento** — estado, o que está aberto, e o que doeu.
6. Doc novo? Entra no `docs/README.md` no mesmo commit.
7. Migration nova? **Aplicar no banco** — código mergeado com tabela
   inexistente é uma tela que promete gravar e não grava.
