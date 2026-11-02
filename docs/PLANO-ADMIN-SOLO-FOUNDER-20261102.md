# PLANO — Admin Command Center 2.0: SOLO FOUNDER MODE (02/11/2026)

Status: 🟡 CURRENT_DEVELOPMENT — implementação em `feat/admin-solo-founder-mode`
(worktree `/home/zetta/Documentos/ZETTA_WORLD/zswap-local/worktrees/admin-solo-founder-mode-20261102`).
**Não autoriza** merge, deploy, migration no banco hospedado, variável na Vercel, conta real, despesa nem ativação.

| campo | valor |
|---|---|
| PHASE_BASE_SHA | `1123b3851004e298cbdf5cb35b01cbc7e345b213` (`origin/main`, merge do PR #452) · tree `4d5ae269ff1067e4eaeaa935f7bcfab0a592fe3f` |
| código em produção (fonte: ledger "ADMIN-CC2 — rollout em produção") | `main` `770f60c`, `CERTIFIED_FEATURE_SHA=bb8d838`, `ADMIN_AUTH_MODE` ausente (= `legacy`); 0079–0087 aplicadas |
| autorização | missão do dono "ADMIN COMMAND CENTER 2.0 — SOLO FOUNDER MODE" (02/11/2026, chat): código, testes e docs; PARAR antes de merge/deploy |

## 1. Problema (medido)

O R1 (login corporativo) está implantado e **desligado**. Para ligá-lo, o primeiro `superadmin` exige **três
identidades distintas**, por construção no banco:

- `supabase/migrations/0083_admin_private_identidade_rbac.sql:68` — `granted_by uuid not null`;
- `:75` — `check (granted_by <> identity_id)` (ninguém concede a si);
- `:76` — `check (approved_by is null or (approved_by <> granted_by and approved_by <> identity_id))`;
- `:78` — `check (role not in ('superadmin','security_admin') or approved_by is not null)`.

Logo: alvo ≠ quem concede ≠ quem aprova. O próprio runbook admite (`docs/ADMIN-SSO-MFA-RBAC-DESIGN.md:613-614`) e o
ledger registra como pendência ("3 identidades para o 1º superadmin, pelo CHECK da 0083"). Além disso o gate de `corp`
pede "≥ 2 superadmins + 1 `security_admin`" (design §7) e a API recusa conceder papéis de topo
(`src/app/admin/api/identidades/route.ts:122`, 409 `dupla_autorizacao`). Um fundador sem equipe não tem como cumprir
isso sem identidades fictícias — o que a missão proíbe.

## 2. Desenho

Dois **modos de governança** (ortogonais aos modos de autenticação `legacy`/`dual`/`corp`, que não mudam):

| modo | quem governa | papéis de topo | estado inicial |
|---|---|---|---|
| `multi_admin` | RBAC + segunda pessoa (comportamento atual de R1) | exigem aprovador ≠ concedente ≠ alvo | **padrão** (linha criada pela migration) |
| `solo_founder` | **uma** identidade, a do fundador | o fundador recebe `superadmin` por bootstrap único | só por bootstrap |

A verdade do modo fica no **banco** (`admin_private.admin_governance`, linha única), não numa env: trocar env não
troca governança.

### 2.1 Bootstrap do fundador (substitui as 3 identidades, uma única vez)

Fatores exigidos, todos ao mesmo tempo:

1. **configuração do servidor** nomeia o fundador: `ADMIN_FOUNDER_EMAIL` (env só do servidor; nunca `NEXT_PUBLIC_*`);
2. **identidade verificada**: identidade `active` em `admin_identities`, vinculada por `provider` + `sub` do IdP
   (o e-mail é só sinal — D-6), com fator TOTP matriculado;
3. **MFA recente**: sessão corporativa `active`, `aal2`, step-up nos últimos 5 min;
4. **autorização operacional independente da sessão**: token de uso único `zfb_…` (256 bits) gerado offline pelo
   dono (`scripts/admin-founder-token.mjs`); a Vercel guarda só o **sha256** (`ADMIN_FOUNDER_BOOTSTRAP_SHA256`) e uma
   janela `ADMIN_FOUNDER_BOOTSTRAP_UNTIL` (≤ 24 h). Quem só tem a sessão não tem o token, e quem só tem o token não tem
   a sessão;
5. **RPC transacional** `admin_private.founder_bootstrap` (só `service_role`), com trava (`pg_advisory_xact_lock` +
   `FOR UPDATE` na linha de governança) que **re-confere tudo no banco**, consome o token (PK — não reusa), grava a
   atribuição `grant_kind='founder_bootstrap'`, muda o modo para `solo_founder` e escreve `admin_audit` — tudo ou nada;
6. **uma vez só**: índice único parcial em `grant_kind='founder_bootstrap'` (para sempre, mesmo revogado) + linha de
   governança com `founder_identity_id`. Depois disso a rota responde 404 para bootstrap.

Nenhum login, cadastro, carteira ou atualização de perfil cria privilégio. Sem env válida, a rota não existe (404).

### 2.2 Autorização em `solo_founder`

Lida em `authz.ts` só quando `ADMIN_AUTH_MODE` ≠ `legacy` (em `legacy` — produção hoje — nada muda, byte a byte):

- só a identidade do fundador decide como principal corporativo; outra identidade, mesmo com papel gravado por SQL,
  é **negada** (`solo_nao_fundador`);
- classe de risco por ação (`src/lib/admin/risco.ts`, derivada de `ACOES[*].risco`):

| classe | ações | em `solo_founder` |
|---|---|---|
| baixo | `risco: read` | sessão com MFA |
| moderado | `risco: write` | sessão com MFA |
| alto | `sensitive_write`, `identity`, `financial` | **step-up obrigatório** (5 min) + trilha durável fail-closed (já existente) + evento de segurança aguardado `admin_solo_alto_risco` (sinal fora do painel) |
| segregado | `trading.automation.write` (liberação de automação com dinheiro real); concessão de admin legado (`/admin/api/admins` grant); concessão de papel (`identidades` `conceder`) | **BLOQUEADO** (404 + trilha `denied`) — sem segunda pessoa não há controle compensatório adequado |

Revogações (sessão, identidade, papel, admin legado) continuam permitidas: são **protetoras**.

- governança ilegível: em `corp` nega; em `dual` a decisão legada continua **mas ações segregadas são negadas**
  (falha fechada no que importa).

### 2.3 Recuperação (sem segunda pessoa)

Perda do TOTP do fundador → `recuperar_mfa` em `/api/admin-auth/fundador`, exigindo **todos**:
carteira com sessão SIWE listada em `ADMIN_WALLETS` (config do servidor) · token de recuperação de uso único
(`ADMIN_FOUNDER_RECOVERY_SHA256` + `…_UNTIL` ≤ 24 h, gerado offline) · governança `solo_founder`. Efeito
(RPC `admin_private.founder_mfa_reset`, transacional e auditada): identidade do fundador volta a `invited` com novo
código de ativação (mostrado uma vez), fator e sessões revogados; o papel de fundador **fica** (é a mesma
identidade, mesmo `sub`). O fator antigo é apagado no Supabase Auth (best-effort, auditado). Alerta `high`.
Conta do IdP **e** TOTP comprometidos ao mesmo tempo: contenção por revogação de sessões; restauração do papel é
roteiro SQL do dono (design §6 "último recurso"), documentado — limitação declarada.

### 2.4 Transição para `multi_admin`

`transicionar_multi` em `/api/admin-auth/fundador`: sessão do fundador com step-up + RPC
`admin_private.governance_to_multi`, que exige no banco o gate de `corp` do desenho §7: ≥ 2 identidades `active`
com MFA e `superadmin`, sendo ≥ 1 concessão `standard` com aprovador, e ≥ 1 `security_admin` ativo com MFA.
**Só ida**; não concede nada a ninguém; auditada. Novos admins entram pelos fluxos já existentes (convite, MFA,
papéis com segunda pessoa).

### 2.5 Migration nova `0088_admin_solo_founder.sql` (aditiva)

`admin_governance`, `admin_founder_authorizations`, `grant_kind` + `founder_authorization` em
`admin_role_assignments`, CHECKs reescritos **por nome** (os da 0083 são localizados pela definição e trocados por
equivalentes nomeados que preservam a regra para `grant_kind='standard'`), 3 RPCs `security invoker`, `EXECUTE` só
para `service_role`. Rollback testado: `0088_…_rollback.sql` (fora da cadeia, em `supabase/rollback/`). A 0083 não é
editada.

## 3. Autenticação e custo (recomendação)

Reaproveitar o R1 inteiro (Supabase Auth OAuth com PKCE no servidor + TOTP `aal2` do Supabase). O IdP prova "quem é";
o TOTP do Supabase é o segundo fator independente. Conta Google **pessoal** não serve: o vínculo exige a claim de
tenant (`hd`) — `src/lib/admin/corp/auth-cliente.ts:93-95`, `fluxo.ts:110`. Opções para o fundador: Google Workspace
(se já existir no domínio, custo marginal zero) ou Microsoft Entra ID Free (tenant próprio, sem licença para registro
de app single-tenant — a confirmar no portal). Detalhe e preços com fonte: `docs/ADMIN-SOLO-FOUNDER-MODE.md` §3.

## 4. Testes obrigatórios (missão §8) → onde

| # | prova | arquivo |
|---|---|---|
| 1–6 | bootstrap: sucesso com 1 identidade; usuário comum, identidade não verificada, sem MFA, repetido, concorrente | `src/lib/admin/corp/fundador.test.ts` + `supabase/tests/29_admin_solo_founder.sql` + `29b_…_concorrencia.sh` |
| 7 | sessão expirada sem acesso | `fundador.test.ts` |
| 8 | endpoints rejeitam não autorizado | `fundador.test.ts` (rota) + `solo-authz.test.ts` |
| 9 | operações críticas: alto exige step-up; segregado bloqueado | `solo-authz.test.ts` |
| 10 | transição para MULTI sem quebrar RBAC | `fundador.test.ts` + SQL 29 + suíte existente (`r1`, `identidades`, `autorizacao`) |
| 11 | SIWE/SIWS intactos | suíte `src/app/api/auth/**` e `src/lib/auth/**` sem diff |
| 12 | nada administrativo no frontend | `solo-authz.test.ts` (varredura `NEXT_PUBLIC_*` e imports de cliente) |

## 5. Status

| item | status |
|---|---|
| reconciliação | 🟢 feita (evidências neste plano e no doc final) |
| migration 0088 + teste SQL | 🔴 |
| código (fundador, authz, rotas, página) | 🔴 |
| testes | 🔴 |
| docs (`ADMIN-SOLO-FOUNDER-MODE.md`, ledger, CURRENT-STATE) | 🔴 |
| merge / deploy / migration hospedada / env Vercel | ⛔ fora desta missão |
