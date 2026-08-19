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
> **Última atualização:** 19/08/2026, após o dono confirmar no navegador que a
> Coinbase Smart Wallet voltou a conectar — #314 verificado em produção.

---

## 1. Onde o projeto está

| | |
|---|---|
| `main` | `9859394` — em produção, headers conferidos por `curl` |
| CI | verde · **1.443 testes** · 103 arquivos |
| PRs abertas | só a `#141` do Dependabot (setup-node 6→7), não é minha |
| Banco | Supabase `vuvvftdsfmagmtbovzgq` (projeto **z-swap**) |

Últimos commits, do mais novo:

```
9859394  ESTADO-ATUAL: main em f4317ed, o COOP e o contador fechados (#315)
f4317ed  A Coinbase Smart Wallet nunca funcionou — COOP nos dois sentidos (#314)
1c3ff48  ESTADO-ATUAL.md — o ponto de retomada quando o contexto acaba (#313)
1e0c54c  O botão que faltava no contador — invariante nº 32, 3ª aparição (#312)
ba30cc2  Auditoria 18/08: a regressão que ninguém viu, e 5 buracos fechados (#311)
f04f654  As descartadas: o teto de credibilidade julgado com livro lido (#310)
f1c0b38  A derrapagem — o último buraco do modelo de custo (#309)
```

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
(`require()` de ESM) e o local é 22.11. `tsc --noEmit`, `npm run lint` e
`npm run build` funcionam. **Quem decide sobre testes é o CI.**

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

⚠️ **O ref de rastreio da branch MENTE.** Em 19/08, `git fetch origin <branch>`
rodou sem erro e `origin/claude/...` continuou apontando cinco PRs para trás. Se
eu tivesse conferido o `--force-with-lease` contra esse ref, teria comparado
contra a baseline errada — que é exatamente a classe de erro que apagou a GERI
em #304. **Antes de qualquer force-push, pergunte ao servidor, não ao cache:**

```bash
git ls-remote origin claude/swap-z-recovery-deploy-b7y2cw   # a verdade
git rev-parse origin/claude/swap-z-recovery-deploy-b7y2cw   # o que você acha
```

Divergiu? `git fetch origin --prune` e confira de novo. E ancore o lease no SHA
que o `ls-remote` devolveu, nunca no nome da branch:
`git push --force-with-lease=<branch>:<sha-do-ls-remote>`.

Como a branch é sempre squash-merged, o normal é o remote dela ficar com UM
commit órfão de conteúdo idêntico à `main`. Confirme que é isso antes de forçar:
`git diff <sha-remoto> origin/main --stat` tem que sair **vazio**.

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

1. **Decidir sobre o `next`.** A única correção é a **16.3.1** — major 14 para
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

### Decisões dele, não minhas

2. **A pilha das 24 mesas para ~7 motores** (parte 3 do "item B"). Crítica dele:
   *"vc fez a porra toda junto e misturado"*. O Setor E foi o primeiro corte.
   `runBacktestScanForProvider` é UMA função por 6 modelos; `selectPlaybook` é
   UMA biblioteca por 5 políticas; `arbiter2` é UM motor por 3 alavancagens.
3. **A fronteira de custo no ledger de papel** (`FRONTEIRA_CUSTO_ISO`): arquivar
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

## 8. Rotina de encerramento

Antes de terminar qualquer entrega:

1. `tsc --noEmit` + `lint` + `build` localmente (testes: **CI**).
2. PR, esperar CI verde, mergear só com ordem dele.
3. Conferir que o deploy de produção disparou (já falhou 1 vez em 17).
4. **Atualizar este documento** — estado, o que está aberto, e o que doeu.
5. Doc novo? Entra no `docs/README.md` no mesmo commit.
