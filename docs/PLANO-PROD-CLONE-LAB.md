# RELEASE REHEARSAL — PROD-CLONE LAB

> **O que é:** o ensaio completo do release num clone local da produção, para
> cobrir o buraco entre **FIXED IN CODE** e **DEPLOYED/RETESTED/PROVED** enquanto a
> Vercel está bloqueada. Serve às FASES 23, 26 e 28 e prepara as 29–31 de
> `docs/PLANO-MESTRE-AUDITORIA.md` (§0C). **Não é uma "FASE 4"** — a FASE 4 do
> plano mestre é o Cofre CEX.
>
> **Status:** 🟡 **kit v1 pronto e ensaiado em ambiente sintético** (sem Docker,
> sem nada real — §6). Nenhuma etapa rodou contra produção. L0–L7 🔴 aguardando a
> auditoria do kit.
> **Gates de início:**
> - **Mural: PASS** — aviso publicado pelo dono, id `ee20b6a8-640b-4d65-a9aa-62e17765edf8`.
> - **Auditoria do kit:** 1ª auditoria = **PACKAGE AUDIT: FAIL — REVISION REQUIRED**
>   (LAB-B01…B06, H01, disco). Rev. 2 corrigida e reensaiada do zero (§6.2);
>   aguardando nova auditoria. O kit exige `ZSWAP_LAB_LIBERADO=1`.
>
> **Decisões do dono/auditor (28/09):**
> 1. Escopo = **banco + app local**.
> 2. Produção: **SCHEMA + MIGRATION METADATA**, somente leitura. Das linhas de
>    produção, só `supabase_migrations.schema_migrations` pode ser lida. Nenhuma
>    outra tabela com dados.
> 3. Venue de runtime = **falsa, determinística e local**. Nenhuma testnet nesta
>    campanha; egress para exchanges reais bloqueado por padrão.
> 4. IA = **sem chave**. O ZION degrada de forma controlada e o money-path não
>    pode depender dele.
>
> **Nomenclatura:** o primeiro alvo é o **PROD-CLONE LAB CANDIDATE**. Ele só vira
> *clone certificado* depois de provar, nesta ordem:
> - identidade do código implantado;
> - schema equivalente;
> - history real equivalente;
> - fingerprint esperado;
> - reprodução do skew/defeito atual.
>
> Só então começa o ensaio 0059→0067.

## 1. Travas — valem para todas as etapas

1. **Produção** (`vuvvftdsfmagmtbovzgq`): somente leitura. Sessão com
   `default_transaction_read_only=on` forçado no servidor, igual ao `ref-staging`
   da 3B. Nenhuma escrita, DDL, deploy, alteração de env ou trade.
2. **Nenhum dado de usuário sai de produção.** O dump é `--schema-only`. A única
   exceção são as linhas de `supabase_migrations.schema_migrations`, que são
   metadado de migration. As linhas de `public` não são copiadas; `admin_kv` e
   `tier_cache` recebem sementes sintéticas.
   - **Varredura de segredos antes de gravar.** Antes de persistir qualquer
     export, o kit inspeciona as colunas reais da tabela de history e faz secret
     scan do conteúdo, e também do dump de schema. Se aparecer senha, token,
     chave privada ou material de credencial, o kit **para sem gravar** e reporta.
   - **Onde fica o export:** fora do Git, só no Acer, na pasta de evidências, com
     `chmod 600`/`700`.
3. **O lab nunca recebe segredo real:**
   - nenhuma chave de exchange, com ou sem permissão de saque;
   - nenhuma service-role de produção;
   - nenhum token do Telegram de produção;
   - nenhuma chave de IA de produção.

   Todo segredo do lab é gerado na hora (`openssl rand`).
4. **Guarda de ambiente antes de subir o app** (`bin/guarda_env.sh`). Recusa se:
   - faltar o marcador `ZSWAP_LAB=1`;
   - `SUPABASE_URL` não for o gateway local do lab (`http://gw:8000`, ou loopback);
   - qualquer env contiver `supabase.co`, `vercel.app` ou o ref de produção,
     staging ou dos P2;
   - houver chave de IA, 0x, LI.FI, Telegram, Helius, Transak ou destino de taxa;
   - houver credencial de CEX no env (a do lab vive só na venue e no runner);
   - algum segredo do lab faltar ou for curto (< 32 caracteres);
   - `TIER_GATES_ENABLED` não for `false` ou `ADMIN_WALLETS` estiver vazio.
5. **Modos reais desligados:**
   - DCA **real** nunca é liberado (o runner prova o 403 — INV-9); o DCA
     **simulado** é aberto só no `admin_kv` do clone, para os ciclos rodarem;
   - kill-switches semeados em `false` (as mesmas sementes da 0006), e o INV-6
     prova que ligá-los fecha a rota de ordem;
   - Autopilot, Pilot e DCA real continuam **NO-GO** no produto; o lab não muda isso.
6. **Staging e P2** não são tocados. O backup da 3B e as evidências
   `~/zswap-p2-evidencias-v33` ficam intactos.
7. **Pasta de evidências própria** (`~/zswap-lab-evidencias-<timestamp>`),
   com SHA256 de tudo no fim, como na 3B.
8. Cada etapa tem gate **PASS/FAIL** registrado. Um FAIL bloqueia a etapa
   seguinte, e nada é corrigido para produzir o número esperado.
   - Cadeia **real** obrigatória: `preflight → l0 → l1 → l2 → l3 → l4 → l5 → l6 → final`
     (o `l6` exige o `l5`). O modo é gravado no `preflight`; misturar modos é recusado.
   - `final` só diz **FINAL OK** com a cadeia completa e sem FAIL; senão empacota
     a evidência e diz **FINAL FAIL** (rc 5) ou **FINAL INCOMPLETE** (rc 6).
   - O log do próprio `final` fica fora do `EVIDENCIAS.sha256` (declarado em
     `EVIDENCIAS.fora-do-manifesto.txt`); o manifesto confere depois do `final`.
9. **Secret scan sem atalho na execução real:** `ZSWAP_LAB_SCAN_ALLOW` aborta o kit
   fora do teste local.
10. **Disco:** o `preflight` registra `df -h` e `docker system df` e para antes de
    qualquer build com menos de 25 GiB livres para imagens e 5 GiB para o lab
    (30 GiB no mesmo disco).

## 2. Onde roda

No **Acer do dono** (Linux + Docker). O contêiner do construtor não tem daemon
Docker; ele prepara o kit e aplica o que for pedido.

Componentes:

- **`docker compose`** com a stack mínima (sem Supabase CLI — menos imagens,
  nada que o app não use): `db`, `rest` (PostgREST), `gw` (gateway `/rest/v1`),
  `venue`, `app` e `runner`. O app fala com o banco pelo `supabase-js`
  (PostgREST atrás do gateway) e a auth é própria (JWT HS256), então GoTrue,
  Kong, Studio, Realtime e Storage não são necessários.
  - Postgres **fixado** em `public.ecr.aws/supabase/postgres:17.6.1.127`, a
    imagem que já está no Acer (o kit não a baixa).
  - ⚠️ O `preflight` baixa `node:22-bookworm-slim` e `postgrest/postgrest:v12.2.12`,
    o que foi aceito pelo dono na escolha "banco + app".
- **Node 22** + `npm ci` do SHA em teste; app em `next build && next start`, sem
  modo dev. A imagem é construída de `git archive <SHA>` — a árvore exata do
  commit — e grava o SHA dentro dela (`/app/.lab-sha`), conferido antes de subir.
- **Rede fechada.** App, banco e venue falsa ficam numa rede Docker `internal`,
  sem rota para fora. O `npm ci` e o build acontecem antes, fora dessa rede.
  Qualquer chamada a exchange real, API pública de preço, RPC de chain ou IA
  falha por construção. Cada falha dessas é registrada como evidência de que o
  app degrada em vez de travar ou inventar dado.

### 2.1 Venue falsa — pela rede, sem tocar o código certificado
O app instancia o `ccxt` direto (`src/lib/cex/server.ts`, `execucao/venue-primitivo.ts`)
e **não tem ponto de injeção de venue**. Mudar o código para o lab alteraria o SHA
que está sendo certificado, então a venue falsa entra pela rede:

- **Resolução de nome.** Dentro da rede do lab, os hostnames da **Binance spot**
  (escolhida) resolvem para o contêiner da venue falsa (alias de rede). Inclui
  `data-api.binance.vision`, de onde o app lê o **preço de referência** — sem ele
  o DCA simulado e o guard de notional falham fechado e nada seria exercitado.
- **TLS.** A venue falsa serve HTTPS com um certificado de uma **CA de laboratório**
  gerada na hora. O app confia nela só por `NODE_EXTRA_CA_CERTS`, e só no lab.
- **API.** A venue implementa o subconjunto da API que o `ccxt` realmente chama:
  tempo, `exchangeInfo`/mercados, saldo, criar/consultar/cancelar ordem, `myTrades`,
  ticker e orderbook. As respostas seguem o formato real, então o **`ccxt` de
  verdade** faz o parse. Isso também prova o nosso tratamento das respostas, não
  só a lógica.
- **Assinatura.** A venue confere o **HMAC** de cada request assinado com o
  segredo da credencial de laboratório. Assinatura errada → erro de auth igual ao
  real.
- **Cenários** controlados por uma API de controle só do lab, com roteiro
  determinístico por `clientOrderId`:
  - aceito + `orderId`;
  - rejeitado;
  - **timeout depois de aceitar**;
  - ordem não encontrada;
  - fill parcial;
  - parcial + cancel;
  - fill atrasado;
  - retry duplicado;
  - `fetchOrder` divergindo de `myTrades`;
  - drift de saldo externo;
  - cancel externo;
  - fill externo.
- **Registro.** A venue grava cada request recebido, para a reconciliação
  independente (FASE 30): o que o app diz × o que a venue viu.
- ⚠️ **Risco declarado.** Endpoints que a venue não implementa respondem 501 e
  aparecem na evidência. O conjunto exato de endpoints é medido contra a versão do
  `ccxt` travada no `package-lock` antes de implementar. O mesmo desenho serve
  para o L3 (`25fc4b0`) e o L4 (`691bfdc`).

## 3. Etapas

### L0 — Freeze (somente leitura) · FASE 0
Coletar:

- **Produção, pela Vercel:** SHA implantado e deployment ID.
  - Hoje: `25fc4b0` / `dpl_C1AgJfvQQt38iMTcbDvNVi7aqCQJ`.
- **Produção, pelo banco:** history completo (versões, nomes, md5 dos
  statements), fingerprint `fp.sql` (esperado `864|74e742469c9088012d87caa88468dc9e`),
  ACL/RLS canônico e `pg_default_acl` — só catálogo e history.
  - ⚠️ **Nenhuma leitura de linhas de `public`, nem `COUNT(*)`** (sessões,
    intents, planos DCA, conexões ficam de fora): contagem é leitura de dado, e a
    autorização desta campanha é schema + `supabase_migrations.schema_migrations`.
    Fidelidade estrutural não depende delas.
- **Repositório:** SHA certificado do código, `691bfdc`. `platform-closure` depois
  dele é só documentação.

**Gate:** tudo registrado com timestamp. Se produção mudou desde o §Y do ledger,
o lab para e reconcilia antes de seguir. A sessão é conferida como read-only
(`show default_transaction_read_only = on`) antes da primeira leitura.

### L1 — Dump do schema de produção (somente leitura)
- `pg_dump -Fc --schema-only -n public -n supabase_migrations`, na sessão read-only.
- **Linhas de `supabase_migrations.schema_migrations`** (autorizado):
  - export à parte, que **preserva exatamente** o history real: versões por data,
    as 4 entradas só de produção e a colisão `0050`;
  - o history **não é reconstruído** a partir do repositório;
  - antes de gravar, o kit lista as colunas reais e faz o secret scan (§1.2). Se
    houver hit, para sem gravar.
- Prova do TOC e do render, como na v3.3.

**Gate:** sha256 do dump e TOC registrados; nenhuma entrada `TABLE DATA` de
`public` no TOC.

### L2 — Restaurar o clone · FASE 20
- Procedimento **v3.3**: neutralizar só os defaults da plataforma, restaurar e
  conferir, tudo numa transação. Sem ele, as tabelas financeiras reabrem (lição
  da Attempt 1).
- Sementes sintéticas mínimas: os kill-switches de `admin_kv` (valores da 0006).
  A carteira de teste é gerada pelo kit e entra por `ADMIN_WALLETS`;
  `TIER_GATES_ENABLED=false` dispensa `tier_cache`.
- Um **B0** do clone (dump completo) é tirado aqui, para o L6.

**Gate:**
- fp == `74e742469c9088012d87caa88468dc9e` (864);
- history == produção (contagem, nomes e md5, incluindo as entradas só de produção);
- ACL/RLS canônico == produção.

### L3 — Reproduzir o skew atual antes de corrigir · FASE 28
- App **`25fc4b0`**, o que está em produção, contra o clone.
- **Esperado:** reproduzir o P0 conhecido. `armSession` falha porque a coluna
  `creds_cipher` não existe (§Y.1 do ledger).
- Smoke das rotas de leitura, auth por carteira de teste e crons via HTTP com
  `CRON_SECRET`.

**Gate:** o clone se comporta como a produção, **incluindo o defeito**. Se o
defeito não aparecer, o clone não é fiel e o lab para.

### L4 — Ensaio do upgrade · FASES 20, 23, 28
- Aplicar **0059→0067** sobre o clone do jeito que o release fará: uma migration
  por transação, gravando o history com o conteúdo integral.
- **Gates do banco:**
  - fp == `925|e13840c5c6de8534ae8bd4f27c041a9b`;
  - arnês SQL de `supabase/tests` do commit certificado (01, 02, 08–12, 14)
    verde. Os de concorrência (04–06, 13) exigem processos locais ao banco e
    ficaram provados na 3B (staging); não entram no lab v1;
  - history: as linhas de produção **intactas** + 9 novas, cada uma com o md5
    do arquivo.
  - Depois do arnês, o clone volta a um **B1** (0067 limpo) pelo restore v3.3,
    para o runtime não herdar fixtures.
- Subir o app **do código certificado** (`691bfdc`).
- **Gates do runtime** (runner com login real por carteira; saída `PASS|FAIL|OBS`):
  - INV-1 toda ordem que a venue viu tem intent persistido;
  - INV-2 nenhum intent "falhou antes de enviar" com ordem existente na venue;
  - INV-3 timeout pós-aceite → dúvida/aberto/FILLED, nunca falha, sem 5xx;
  - INV-4 `anon` negado nas 5 tabelas financeiras pelo PostgREST local (a prova
    por papel que o MCP não consegue fazer); `service_role` lê;
  - INV-5 os crons (autopilot, DCA, backtest, radar, celeiro) sem segredo → 401;
  - INV-6 kill-switch `disable_cex` → 503 e a venue não recebe nada;
  - INV-7 `armSession` funciona sem `creds_cipher` e a sessão nasce ligada ao cofre;
  - INV-8 DCA **simulado** de ponta a ponta: cron 200 com `acao="simulou"`,
    **exatamente 1 ciclo** do plano (`status='feito'`, `simulado=true`) e zero
    ordens na venue — zero ciclos = FAIL;
  - INV-9 DCA real sem liberação → 403;
  - INV-10 sem IA, o cron do autopilot não cai e nenhuma ordem sai — **só é
    avaliada se o tick alcança a sessão**; com o ACHADO-AP-LOCK ela é
    **NOT EXERCISED** (nunca PASS) e o L4 diz "INV-1..9, INV-11 e INV-12 PASS;
    INV-10 NOT EXERCISED — ACHADO-AP-LOCK OPEN";
  - INV-11 rate limit durável ativo (9ª chamada/minuto → 429);
  - INV-12 env ausente → fail-closed (`CEX_RECOVERY_HMAC_KEY` ausente → ordem
    recusada, venue intocada);
  - cenários de ordem manual: aceite, recusa, timeout pós-aceite, parcial + fill
    externo + recovery, `fetchOrder` × `myTrades` divergentes, "não existe" após
    aceitar, fill atrasado, cancel externo, drift de saldo.

### L5 — Chaos (subconjunto viável localmente) · FASE 26
- **C1** app morto (SIGKILL) com a ordem aceita e a resposta pendurada → após o
  restart o intent está em dúvida (nunca falha) e o recovery por `intentId`
  converge para FILLED com a quantidade da venue, com **um único envio**.
- **C2** banco derrubado durante o cron do DCA → **503 `trava_indisponivel`,
  processed 0** (200 não satisfaz), nada à venue; banco de volta → o plano devido
  executa **exatamente 1 ciclo** simulado (vazio ou duplicado = FAIL).
- **C3** dois crons do DCA em paralelo sobre um plano devido → **exatamente 1
  ciclo** efetivo (nunca 0, nunca 2).
- **C4** resposta da venue truncada depois de aceitar → o intent nunca vira
  falha; o recovery converge.
- Retry duplicado: a venue recusa `clientOrderId` repetido de ordem aberta
  (provado contra o `ccxt` real); no app, o C1 prova que não há reenvio.
- A venue do caos é a **venue falsa local**; testnet está fora desta campanha.

### L6 — Ensaio de rollback · FASES 26, 28
- App de volta para `25fc4b0` e banco de volta para B0 (0058), com o restore v3.3
  já provado na 3B. Gates: fp, history e ACL/RLS == produção, e o app de
  produção volta a se comportar como produção (o P0 reaparece).
- Registrar o que isso significa: `25fc4b0` já é incompatível com 0058 por causa
  do P0. O rollback **de app** tem limite e precisa estar escrito no runbook.
- **Declaração obrigatória do L6** (o kit grava `l6_declaracao.txt`):
  - **ROLLBACK FIDELITY = PROVED** — volta fielmente ao estado atual de produção;
  - **SERVICE-RESTORING ROLLBACK = NOT PROVED** — o P0 de `creds_cipher` volta
    junto. É evidência de fidelidade, não de recuperação funcional.

### L7 — Runbook do cutover
Produto final do lab: a sequência exata, com os gates, as travas e o rollback,
para o release oficial quando a Vercel voltar. Esse runbook alimenta as FASES 29–31
(canário, reconciliação e certificação por módulo).

## 4. Decisões
**Resolvidas em 28/09** (ver cabeçalho):
- history autorizado com escopo estrito;
- venue falsa local;
- sem chave de IA;
- gate do mural antes da execução.

- venue falsa = **Binance spot** (o dono aceitou as recomendações do construtor).

- mural: **PASS**, aviso `ee20b6a8-640b-4d65-a9aa-62e17765edf8`;
- L0 sem nenhuma leitura de dados de `public` (nem contagens).

**Pendente:**
1. **Auditoria do kit pelo auditor.** Destrava a execução (`ZSWAP_LAB_LIBERADO=1`).
2. **ACHADO-AP-LOCK** (§6.1) — OPEN.

## 5. Estado
| etapa | status | evidência |
|---|---|---|
| mural | 🟢 PASS | aviso `ee20b6a8-640b-4d65-a9aa-62e17765edf8` |
| kit v1 (sem execução real) | 🟡 rev. 2 reensaiada do zero (§6.2); **aguardando nova auditoria** (1ª: FAIL — REVISION REQUIRED) | scratchpad do construtor; tgz + scripts.txt + MANIFEST para o auditor |
| L0 freeze | 🔴 | — |
| L1 dump do schema | 🔴 | — |
| L2 restore do clone | 🔴 | — |
| L3 reproduzir o skew | 🔴 | — |
| L4 ensaio do upgrade | 🔴 | — |
| L5 chaos | 🔴 | — |
| L6 rollback | 🔴 (esperado: fidelity PROVED · service-restoring NOT PROVED) | — |
| L7 runbook | 🔴 | — |

## 6. Ensaio do kit em ambiente sintético (antes da entrega)

Nada real: sem produção, sem staging, sem P2, sem Docker. No contêiner do
construtor:

- PostgreSQL 17.6 "tipo Supabase": `supabase_admin` superusuário, `postgres`
  **não** superusuário, papéis `anon/authenticated/service_role/authenticator`,
  default privileges da plataforma;
- uma "produção" sintética em 0058 (migrations do commit certificado), com
  history **datado**, 4 entradas só-de-prod e um dado de "usuário" plantado;
- PostgREST 12.2.12, o gateway, a venue falsa e o app **buildado de `git archive`**
  de `25fc4b0` e de `691bfdc`.

Resultado: `preflight → l0 → l1 → l2 → l3 → l4 → l5 → l6 → final` **PASS**, na ordem:
fp do clone == `864|74e742…`; o dado de "usuário" não aparece em nenhum export;
P0 reproduzido com `25fc4b0`; forward 0059→0067 com fp `925|e13840c5…`, history de
prod intacto + 9 com md5 do arquivo; arnês 8/8; INV-1…INV-12 e C1–C4 PASS com
`691bfdc`; rollback ao B0 e P0 de volta com `25fc4b0`.

Negativos provados: segredo plantado no history → L1 descarta sem gravar; SHA
implantado divergente → L0 FAIL; etapa fora de ordem → abortado; FAIL anterior →
nada mais roda; kit adulterado → abortado; sem a liberação (`ZSWAP_LAB_LIBERADO=1`; antes da correção de 28/09 o gate era do mural) → abortado.

**O que só o Acer prova:** a imagem Supabase real, `docker compose`, o isolamento
da rede `internal`, a leitura da produção real.

### 6.1 ACHADO-AP-LOCK — o lock do cron do autopilot nunca é adquirido

| campo | valor (classificação do auditor, provisória) |
|---|---|
| Severidade | **HIGH** — funcional/disponibilidade |
| Impacto financeiro imediato | fail-safe: nenhuma ordem enviada |
| Impacto funcional | o Autopilot background não processa a sessão |
| Regressão do release | **NÃO** |
| Presente em produção | o código indica **SIM**; não provado no PostgREST hospedado |
| Status | **OPEN** |
| Bloqueia | certificação do Autopilot background; INV-10 real; GO de Autopilot/Pilot |
| Não bloqueia | construção do clone; L0/L1/L2; prova estrutural 0058→0067 |

`tryLockSession` (`src/lib/autopilot/sessions.ts`) faz
`update(...).eq("id").or("locked_until.is.null,locked_until.lt.<agora>").select("id")`.
O PostgREST reaplica o filtro `or` no `SELECT` externo sobre o `RETURNING "id"`, e
o Postgres responde `42703 column autopilot_sessions.locked_until does not exist`.
O `tryLockSession` trata erro como `false`, e o cron relata
`"locked (already running)"` sem nunca trabalhar a sessão.

- Reproduzido no PostgREST 12.2.8, 12.2.12, 13.0.4 e 13.0.7 (SQL gerado capturado).
- **Mesmo código em `25fc4b0` (produção) e `691bfdc` (certificado)** — não é
  regressão do release.
- Falha no sentido seguro (nenhuma ordem sai), mas a função fica morta — e o INV-10
  ("sem IA o autopilot degrada") fica **não exercitado** enquanto isso existir.
- Não corrigido: o código certificado não muda no lab. O runner mede isso toda vez
  (`OBS ACHADO-AP-LOCK`). Confirmação no PostgREST hospedado e a decisão são do
  auditor.

### 6.2 Rev. 2 — correções da 1ª auditoria do pacote, reensaiadas do zero

| item | correção | prova no ensaio |
|---|---|---|
| LAB-B01 | `prod_setup <OUT>`: L0 usa `$LAB_EV`, L1 o tmpfs; OUT validado (absoluto, existente); o cliente Docker recusa OUT inválido | `test/pgclient-out.test.sh` PASS (e FAIL contra o kit anterior) |
| LAB-B02 | `l6` real exige `l5`; modo gravado; `final` = OK / FAIL (rc 5) / INCOMPLETE (rc 6) | negativos: l6 sem l5 recusado; sem l6 → INCOMPLETE; FAIL → FINAL FAIL com pacote; cadeia sem l3 → INCOMPLETE; modos misturados recusados |
| LAB-B03 | log corrente do `final` fora do manifesto, declarado | `sha256sum -c EVIDENCIAS.sha256` PASS depois do `final` |
| LAB-B04 | INV-8 exige 200 + `simulou` + exatamente 1 ciclo `feito`/`simulado` | ciclo real executado; negativo (DCA simulado fechado → zero ciclos) = FAIL INV-8 |
| LAB-B05 | C2: 503 `trava_indisponivel` + 1 ciclo após recovery; C3: exatamente 1 ciclo | PASS; negativos de zero ciclos = FAIL C2 / FAIL C3 |
| LAB-B06 | INV-10 = NOT-EXERCISED enquanto AP-LOCK; veredito do L4 em `bin/veredito_inv.sh` | runtime: `NOT-EXERCISED INV-10`; L4: "INV-1..9, INV-11 e INV-12 PASS; INV-10 NOT EXERCISED — ACHADO-AP-LOCK OPEN" |
| LAB-H01 | `ZSWAP_LAB_SCAN_ALLOW` aborta a execução real | negativo PASS |
| disco | `df -h` + `docker system df` no preflight; mínimos 25/5/30 GiB | negativo: tmpfs de 1 GiB → preflight para antes de gerar segredos |

Nota sobre os negativos de zero ciclos: "venue sem preço" **não** serve, porque o
app guarda o preço de referência por 30 s (`fetch` com `revalidate: 30`); o
negativo fecha o DCA simulado no `admin_kv` do clone e o cron responde
`sem_capacidade`.
