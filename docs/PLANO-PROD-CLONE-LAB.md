# RELEASE REHEARSAL — PROD-CLONE LAB

> **O que é:** o ensaio completo do release num clone local da produção, para
> cobrir o buraco entre **FIXED IN CODE** e **DEPLOYED/RETESTED/PROVED** enquanto a
> Vercel está bloqueada. Serve às FASES 23, 26 e 28 e prepara as 29–31 de
> `docs/PLANO-MESTRE-AUDITORIA.md` (§0C). **Não é uma "FASE 4"** — a FASE 4 do
> plano mestre é o Cofre CEX.
>
> **Status:** 🔴 não iniciado — plano e preparação do kit **sem execução**.
> **Gate de início:** a construção/execução só começa depois de o dono confirmar
> que o aviso no mural (CLAUDE.md) foi publicado por uma sessão autorizada.
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
4. **Guarda de ambiente antes de subir o app.** O script recusa iniciar se:
   - `SUPABASE_URL` não for `http://127.0.0.1:*`;
   - qualquer env contiver `supabase.co`, `vuvvftdsfmagmtbovzgq` ou `nvbrzifyurslegudlhaz`;
   - houver uma chave de CEX preenchida.
5. **Modos reais desligados:**
   - DCA só `simulado`;
   - `pause_*` e kill-switches ligados por padrão;
   - Autopilot, Pilot e DCA real continuam **NO-GO**; o lab não muda isso.
6. **Staging e P2** não são tocados. O backup da 3B e as evidências
   `~/zswap-p2-evidencias-v33` ficam intactos.
7. **Pasta de evidências própria** (`~/zswap-lab-evidencias-<timestamp>`),
   com SHA256 de tudo no fim, como na 3B.
8. Cada etapa tem gate **PASS/FAIL** registrado. Um FAIL bloqueia a etapa
   seguinte, e nada é corrigido para produzir o número esperado.

## 2. Onde roda

No **Acer do dono** (Linux + Docker). O contêiner do construtor não tem daemon
Docker; ele prepara o kit e aplica o que for pedido.

Componentes:

- **Supabase CLI** com a stack local mínima. O app fala com o banco pelo
  `supabase-js` (PostgREST atrás do gateway) e a auth é própria (JWT HS256),
  então GoTrue não é necessário. Serviços excluídos (`-x`): studio, realtime,
  storage, imgproxy, edge-runtime, logflare, vector, mailpit, supavisor e gotrue.
  - Postgres **fixado** em `public.ecr.aws/supabase/postgres:17.6.1.127`, a
    imagem que já está no Acer.
  - ⚠️ Esta etapa **exige `docker pull`** das imagens da CLI, o que foi aceito
    pelo dono na escolha "banco + app".
- **Node 22** + `npm ci` do SHA em teste; app em `next build && next start`, sem
  modo dev, para ficar mais próximo do runtime real.
- **Rede fechada.** App, banco e venue falsa ficam numa rede Docker `internal`,
  sem rota para fora. O `npm ci` e o build acontecem antes, fora dessa rede.
  Qualquer chamada a exchange real, API pública de preço, RPC de chain ou IA
  falha por construção. Cada falha dessas é registrada como evidência de que o
  app degrada em vez de travar ou inventar dado.

### 2.1 Venue falsa — pela rede, sem tocar o código certificado
O app instancia o `ccxt` direto (`src/lib/cex/server.ts`, `execucao/venue-primitivo.ts`)
e **não tem ponto de injeção de venue**. Mudar o código para o lab alteraria o SHA
que está sendo certificado, então a venue falsa entra pela rede:

- **Resolução de nome.** Dentro da rede do lab, o hostname da exchange escolhida
  (proposta: **Binance spot**, a venue principal do produto, `gru1`) resolve para
  o contêiner da venue falsa (alias de rede).
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
  ACL/RLS canônico, `pg_default_acl` e contagens (sessões, intents, planos DCA,
  conexões).
- **Repositório:** SHA certificado do código, `691bfdc`. `platform-closure` depois
  dele é só documentação.

**Gate:** tudo registrado com timestamp. Se produção mudou desde o §Y do ledger,
o lab para e reconcilia antes de seguir.

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
- Sementes sintéticas mínimas: `admin_kv`, `tier_cache` e uma carteira de teste
  admin.

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
  - arnês `supabase/tests` 01–14 verde. O T13 segue a regra do plano mestre: o
    original não conta como PASS; vale a prova sincronizada.
- Subir o app **do código certificado** (`691bfdc`).
- **Gates do runtime:**
  - build verde;
  - smoke;
  - crons DCA, autopilot, backtest e radar via HTTP;
  - DCA **simulado** de ponta a ponta;
  - `armSession` passa a funcionar sem `creds_cipher`;
  - `pause_*` e kill-switches fecham os executores;
  - env ausente → fail-closed (por exemplo, `CEX_RECOVERY_HMAC_KEY` ausente → ordem
    manual real recusada);
  - rate limit durável ativo;
  - `anon` sem acesso às 5 tabelas financeiras pelo PostgREST local (a prova por
    papel que o MCP não consegue fazer).

### L5 — Chaos (subconjunto viável localmente) · FASE 26
- Banco derrubado no meio do cron.
- Cron duplicado em paralelo.
- Restart do app com intent em `SUBMITTING` → tem de virar `UNKNOWN` e
  reconciliar, nunca `FAILED`.
- Request duplicado.
- Resposta de venue com campos ausentes.
- ⚠️ A venue do caos é uma **venue falsa local**, sem exchange de verdade. O uso
  de testnet é decisão pendente (§4).

### L6 — Ensaio de rollback · FASES 26, 28
- App de volta para `25fc4b0` e banco de volta para B0 (0058), com o restore v3.3
  já provado na 3B.
- Registrar o que isso significa: `25fc4b0` já é incompatível com 0058 por causa
  do P0. O rollback **de app** tem limite e precisa estar escrito no runbook.

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

**Pendentes:**
1. **Exchange da venue falsa.** Proposta: Binance spot. Alternativa: Gate.io,
   que tem API menor mas é menos central no produto.
2. **Confirmação do aviso no mural.** Destrava a construção.

## 5. Estado
| etapa | status | evidência |
|---|---|---|
| kit (sem execução) | 🟡 em preparação | — |
| L0 freeze | 🔴 | — |
| L1 dump do schema | 🔴 | — |
| L2 restore do clone | 🔴 | — |
| L3 reproduzir o skew | 🔴 | — |
| L4 ensaio do upgrade | 🔴 | — |
| L5 chaos | 🔴 | — |
| L6 rollback | 🔴 | — |
| L7 runbook | 🔴 | — |
