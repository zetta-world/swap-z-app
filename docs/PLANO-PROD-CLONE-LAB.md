# RELEASE REHEARSAL — PROD-CLONE LAB

> **O que é:** o ensaio completo do release num clone local da produção, para
> cobrir o buraco entre **FIXED IN CODE** e **DEPLOYED/RETESTED/PROVED** enquanto a
> Vercel está bloqueada. Serve às FASES 23, 26 e 28 e prepara as 29–31 de
> `docs/PLANO-MESTRE-AUDITORIA.md` (§0C). **Não é uma "FASE 4"** — a FASE 4 do
> plano mestre é o Cofre CEX.
>
> **Status:** 🔴 não iniciado — plano (28/09/2026).
> **Decisões do dono (28/09):** escopo = **banco + app local**; leitura do
> **schema** de produção **autorizada, sem dados**.

## 1. Travas — valem para todas as etapas

1. **Produção** (`vuvvftdsfmagmtbovzgq`): somente leitura. Sessão com
   `default_transaction_read_only=on` forçado no servidor, igual ao `ref-staging`
   da 3B. Nenhuma escrita, DDL, deploy, alteração de env ou trade.
2. **Nenhum dado de usuário sai de produção.** O dump é `--schema-only`. As
   linhas de `public` não são copiadas; `admin_kv` e `tier_cache` recebem
   sementes sintéticas.
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
- Mais a **tabela de history**, que é metadado de migration e não dado de
  usuário. O history é necessário para reproduzir a divergência real: versões
  por data, 4 entradas só de produção e a colisão `0050`.
  - ⚠️ Pende confirmação explícita do dono de que o history entra na
    autorização "só schema".
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

## 4. Decisões pendentes do dono
1. **History de migrations no dump (L1):** confirmar que entra na autorização
   "só schema".
2. **Venue para runtime e caos (L4/L5):** venue falsa local (recomendado para
   começar) × testnet de exchange (Binance testnet, sem dinheiro real).
3. **Chaves de IA no lab:** sem chave (ZION degrada) × chave de laboratório com
   teto de gasto.

## 5. Estado
| etapa | status | evidência |
|---|---|---|
| L0 freeze | 🔴 | — |
| L1 dump do schema | 🔴 | — |
| L2 restore do clone | 🔴 | — |
| L3 reproduzir o skew | 🔴 | — |
| L4 ensaio do upgrade | 🔴 | — |
| L5 chaos | 🔴 | — |
| L6 rollback | 🔴 | — |
| L7 runbook | 🔴 | — |
