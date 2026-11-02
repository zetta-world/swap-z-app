# Admin Command Center 2.0 — SOLO FOUNDER MODE

Status: 🟡 **IMPLEMENTADO E VALIDADO LOCALMENTE — AGUARDANDO AUTORIZAÇÃO DE PRODUÇÃO.** Nada disto está em produção:
nenhuma migration aplicada no banco hospedado, nenhuma variável na Vercel, nenhuma conta criada.
Branch `feat/admin-solo-founder-mode` (a partir de `1123b3851004e298cbdf5cb35b01cbc7e345b213`). Plano:
`docs/PLANO-ADMIN-SOLO-FOUNDER-20261102.md`. Desenho de origem (preservado): `docs/ADMIN-SSO-MFA-RBAC-DESIGN.md`.

---

## 1. Por que existe

A Z-SWAP é administrada pelo fundador, sem equipe. O R1 (login corporativo, Admin CC 2.0) foi desenhado para uma
equipe: o primeiro `superadmin` exige **três identidades distintas**, por construção no banco
(`supabase/migrations/0083_admin_private_identidade_rbac.sql:68-78`: `granted_by` obrigatório, `granted_by ≠ alvo`,
`approved_by ≠ granted_by ≠ alvo`, papel de topo exige `approved_by`). Cumprir isso sozinho exigiria identidades
fictícias. Este modo troca a "segunda e terceira pessoas" por **fatores independentes e controles compensatórios**,
sem baixar o nível do login e sem fechar a porta para a governança com várias pessoas.

## 2. Arquitetura

Dois eixos **independentes**:

| eixo | valores | onde fica | o que decide |
|---|---|---|---|
| autenticação | `legacy` · `dual` · `corp` | env `ADMIN_AUTH_MODE` (R1, inalterado) | **como** alguém prova quem é |
| governança | `multi_admin` · `solo_founder` | banco: `admin_private.admin_governance` (linha única, 0088) | **quantas pessoas** governam |

- `legacy` (produção hoje): a governança **nem é lida**. A decisão do Admin é byte a byte a de antes (teste
  `solo-authz.test.ts` › "legacy").
- `multi_admin` é o estado inicial que a 0088 grava: tudo continua como no R1.
- `solo_founder` só nasce do **bootstrap** (§4) e só volta para `multi_admin` pela **transição** (§9). Trocar uma env
  não troca a governança.

Peças:

| peça | arquivo |
|---|---|
| migration (governança, autorizações de uso único, `grant_kind`, imutabilidade das atribuições, 3 RPCs) | `supabase/migrations/0088_admin_solo_founder.sql` |
| repositório da governança e das RPCs | `src/lib/admin/corp/governanca-repo.ts` |
| classes de risco (derivadas da matriz) | `src/lib/admin/risco.ts` |
| decisão (governança no ponto único) | `src/lib/admin/authz.ts` |
| bootstrap · recuperação · transição | `src/lib/admin/corp/fundador.ts` |
| rota | `POST /api/admin-auth/fundador` (`src/app/api/admin-auth/fundador/route.ts`) |
| tela | `/admin-acesso/fundador` |
| gerador offline da autorização | `scripts/admin-founder-token.mjs` |

## 3. Modelo de autenticação escolhido (e custo)

**Escolha: reaproveitar o R1 inteiro, sem serviço novo.** Supabase Auth OAuth com PKCE executado no servidor
(Google ou Microsoft) + **TOTP do Supabase (`aal2`)** como segundo fator independente do IdP + sessão administrativa
opaca, curta e revogável (8 h absolutas, 30 min de inatividade, step-up de 5 min).

| opção | serve? | custo conhecido | observação |
|---|---|---|---|
| **Microsoft Entra ID Free** (tenant próprio, app single-tenant) | sim, sem mudar código | US$ 0 para registro de app e login (fontes de terceiros; **confirmar no portal**) | o caminho de custo zero; o usuário admin é criado no próprio tenant |
| **Google Workspace** (1 usuário) | sim, sem mudar código | Business Starter ≈ US$ 7/usuário/mês (anual) ou US$ 8,40 (flexível), sem impostos (fontes de terceiros, conferir na página do Google) | custo marginal zero se o domínio já tiver Workspace |
| **Conta Google pessoal** (gmail) | **não** | — | o vínculo exige a claim de tenant (`hd`), que conta pessoal não tem (`auth-cliente.ts:93-95`, `fluxo.ts:110`). Mudar isso seria afrouxar o login — não feito |
| **Supabase Auth e-mail + senha + TOTP** | possível, **não recomendado agora** | US$ 0 | exigiria rotas novas de senha e de reset por e-mail (nova superfície); o R1 já resolve com IdP |
| **SMS / Phone MFA** | não usado | add-on do Supabase (≈ US$ 75/mês no primeiro projeto, segundo a página de preços) | SMS é fator fraco; TOTP é grátis |

TOTP do Supabase está incluído no plano gratuito. **Recomendação:** Entra ID Free (zero) ou o Workspace que já
existir. Em ambos o fundador ativa também o MFA do próprio IdP (gratuito), além do TOTP do Supabase.

## 4. Bootstrap do fundador (uma vez)

Substitui as três identidades por **cinco condições simultâneas**, nenhuma suficiente sozinha:

1. **Configuração do servidor** nomeia o fundador: `ADMIN_FOUNDER_EMAIL` (só servidor; uma variável
   `NEXT_PUBLIC_*` com esse nome é ignorada — teste "a variável PÚBLICA não serve").
2. **Identidade verificada**: identidade `active` em `admin_identities`, vinculada no 1º login por `provider` + `sub`
   do IdP (o e-mail é só sinal), com TOTP matriculado.
3. **MFA recente**: sessão `active`, `aal2`, step-up nos últimos 5 minutos.
4. **Autorização operacional de uso único**, independente da sessão: o dono gera offline um token `zfb_…` (256 bits)
   com `scripts/admin-founder-token.mjs`; a Vercel recebe **só o sha256** (`ADMIN_FOUNDER_BOOTSTRAP_SHA256`) e uma
   janela `ADMIN_FOUNDER_BOOTSTRAP_UNTIL` (≤ 24 h; vencida = recurso desligado). Quem rouba a sessão não tem o
   token; quem tem o token não tem a sessão.
5. **RPC transacional** `admin_private.founder_bootstrap`: trava (`pg_advisory_xact_lock` + `FOR UPDATE` na
   governança), **re-confere tudo no banco** (identidade, MFA, sessão, e-mail, uso do token), consome o token, grava a
   atribuição `grant_kind='founder_bootstrap'`, muda a governança para `solo_founder` e escreve `admin_audit`. Tudo
   ou nada.

"Uma vez só" vale no banco: índice único parcial `ara_fundador_uma_vez` (para sempre, mesmo se a linha for revogada)
e linha de governança com `founder_identity_id`. O `service_role` **não escreve** governança nem autorizações (só
`SELECT`); a única escrita é a RPC. Uma atribuição não pode ser "movida" para outra identidade (gatilho
`ara_imutavel_salvo_revogacao`). Nenhum login, cadastro, carteira ou perfil cria privilégio.

## 5. RBAC e operações em `solo_founder`

- Só a identidade do fundador decide como principal corporativo. Outra identidade, **mesmo com papel gravado por
  SQL**, é negada (`admin_solo_nao_fundador`).
- Classes de risco (derivadas de `ACOES[*].risco`, a matriz testada):

| classe | origem | exemplos | regra no solo |
|---|---|---|---|
| baixo | `read` | métricas, consultas, logs | sessão com MFA de login |
| moderado | `write` | estudos de laboratório, sincronizações, sondas | sessão com MFA de login |
| alto | `sensitive_write` · `identity` · `financial` | kill switch, margem/taxas, plano de usuário, exports, convite/revogação | **step-up de 5 min** + trilha durável fail-closed (já existente) + evento de segurança aguardado `admin_solo_alto_risco` |
| **segregado** | lista explícita (`SEGREGADAS_SOLO`) | liberar automação com dinheiro real (`trading.automation.write`); conceder admin por carteira (`identity.admins.write`); conceder papel corporativo (`identidades` → `conceder`) | **BLOQUEADO** (404 + trilha `denied` + alerta alto) |

Por que bloqueadas e não "compensadas": liberar automação mexe no capital de clientes em corretora (e o modo real
segue NO-GO); conceder acesso a terceiros é exatamente o que exige a segunda pessoa. Não existe controle compensatório
técnico adequado com uma pessoa só. **Revogações** (sessão, identidade, papel) seguem permitidas: são protetoras.

- Carteira legada em `dual`+`solo_founder`: só a do dono (fonte `env`, `ADMIN_WALLETS`); `panel`/`tier` negadas; e
  **sem alto risco** (MFA obrigatório para acesso privilegiado), exceto conter incidente (`security.killswitch.set`).
- Governança **ilegível** (banco fora, 0088 não aplicada): restringe como `solo_founder` — segregado negado, carteira
  legada restrita; em `corp`, a sessão corporativa é negada (só break-glass). Na dúvida, fecha.
- O painel **não tem** caminho para chaves de clientes: nenhuma rota sob `src/app/admin` lê conexões CEX, chaves
  privadas ou assina transação (varredura registrada no plano). A Z-SWAP é não custodial.

## 6. MFA

TOTP do Supabase, `aal2`, provado no servidor (`provaDeMfa`); máx. 5 tentativas por 15 min, com reserva de tentativa
antes do teste (R1). Step-up (5 min) para tudo que é alto no solo, para o bootstrap e para a transição. Fatores: o
fundador pode matricular um segundo TOTP de reserva no Supabase (máx. 2), guardado offline.

## 7. Auditoria

- `admin_private.admin_audit` (append-only, gatilhos impedem UPDATE/DELETE/TRUNCATE): bootstrap, recuperação,
  transição e toda recusa (`authz_decision='deny'` com o motivo real; o navegador recebe sempre o mesmo `recusado`).
- Eventos de segurança **aguardados** (com teto): `admin_fundador_bootstrap`, `admin_fundador_recusado`,
  `admin_fundador_mfa_reset`, `admin_governanca_multi`, `admin_solo_alto_risco`, `admin_solo_segregado`,
  `admin_solo_nao_fundador`, `admin_solo_fonte_legada`, `admin_solo_alto_exige_mfa`, `admin_governanca_ilegivel`.
- Comandos do Admin continuam com a trilha durável fail-closed (`comandoAuditado`, ADM-005).

## 8. Recuperação de acesso

| situação | caminho | exige |
|---|---|---|
| perdeu o celular do TOTP | `recuperar_mfa` em `/admin-acesso/fundador` | carteira (SIWE) em `ADMIN_WALLETS` + autorização de RECUPERAÇÃO de uso único (`ADMIN_FOUNDER_RECOVERY_SHA256` + `…_UNTIL` ≤ 24 h, gerada offline). Efeito (RPC `founder_mfa_reset`): identidade volta a `invited` com **novo código de ativação mostrado uma vez**, sessões revogadas, fator antigo apagado no Supabase; o papel de fundador fica (mesmo `sub`). Depois: login no IdP + código + novo TOTP |
| IdP fora do ar | break-glass do R1 (`ADMIN_BREAKGLASS_UNTIL`, só em `corp`) | carteira em `ADMIN_WALLETS` + janela; pode conter (kill switch) e gerir identidades |
| conta do IdP **e** TOTP comprometidos | contenção: break-glass → revogar sessões/identidade; voltar `ADMIN_AUTH_MODE` para `legacy` | restaurar o papel de fundador numa identidade nova = roteiro SQL do dono no painel do Supabase (com MFA da conta Supabase), registrado em `admin_audit` com `actor_kind='system'` — **limitação declarada**: não há caminho automatizado, de propósito |
| tudo falhou | `ADMIN_AUTH_MODE` ausente (= `legacy`) + carteira de `ADMIN_WALLETS` | acesso à Vercel; nada no `admin_private` é apagado |

## 9. Migração futura para `multi_admin`

1. Convidar as pessoas novas (`identidades` → `convidar`; permitido no solo: não concede nada).
2. Cada uma entra pelo IdP, usa o código de ativação e matricula o TOTP.
3. Papéis de topo pelo roteiro SQL do R1 (aprovador ≠ concedente ≠ alvo — já com pessoas reais).
4. O fundador, com step-up, chama `transicionar_multi`. A RPC `governance_to_multi` exige no banco: **≥ 2
   superadmins ativos com MFA** (≥ 1 por concessão `standard` **com aprovador**) e **≥ 1 `security_admin`** ativo
   com MFA. Só ida; não concede nada a ninguém; auditada.
5. Em `multi_admin` vale o RBAC do R1 (papéis, step-up, regras de duas pessoas). A concessão de fundador continua
   registrada e válida; o bootstrap não reabre.

## 10. Dependências e custos

| item | custo | estado |
|---|---|---|
| Supabase Auth (OAuth Google/Azure, TOTP) | incluído no projeto existente (TOTP grátis) | provedores **não** configurados |
| IdP: Entra ID Free **ou** Google Workspace | US$ 0 ou ≈ US$ 7–8,40/mês (§3) | decisão do dono |
| Vercel (variáveis do servidor) | incluído | **não** configuradas |
| migrations 0083–0087 (já no hospedado) e **0088** (nova) | — | 0088 **não aplicada** |
| nenhuma dependência npm nova | — | — |

## 11. Variáveis de ambiente (nomes; valores só com o dono)

| variável | conteúdo | quando |
|---|---|---|
| `ADMIN_AUTH_MODE` | `dual` (ativação) → `corp` (alvo) | R1 |
| `ADMIN_SESSION_ENC_KEY` | 32 bytes aleatórios em base64 | R1 |
| `ADMIN_ORIGIN` | origem canônica do Admin (https) | R1 |
| `ADMIN_IDP_PROVIDERS` | `azure` ou `google` | R1 |
| `ADMIN_LEGACY_SOURCES` | `env` (no solo, só a carteira do dono) | R1, em `dual` |
| `ADMIN_WALLETS` | carteira do dono (já existe) | recuperação e break-glass |
| `ADMIN_FOUNDER_EMAIL` | e-mail da identidade do fundador no IdP | este modo |
| `ADMIN_FOUNDER_BOOTSTRAP_SHA256` · `ADMIN_FOUNDER_BOOTSTRAP_UNTIL` | sha256 do token e janela ≤ 24 h | só durante o bootstrap; **remover depois** |
| `ADMIN_FOUNDER_RECOVERY_SHA256` · `ADMIN_FOUNDER_RECOVERY_UNTIL` | idem, para recuperação | só durante uma recuperação |
| `ADMIN_BREAKGLASS_UNTIL` | janela de emergência | só em incidente |

Nenhuma delas é `NEXT_PUBLIC_*` (teste `solo-authz.test.ts` › "nada administrativo no navegador").

## 12. Procedimento de ativação (cada passo com ⛔ exige autorização explícita do dono)

> ⚠️ **Deploy automático por push:** `vercel.json` não tem `git.deploymentEnabled` nem `ignoreCommand`; se a integração
> Git da Vercel estiver ligada, **enviar esta branch ao GitHub cria um deploy de preview**. Contenção atual: a branch é
> local, sem upstream, e nunca foi enviada (`git ls-remote` vazio). O push em si exige autorização do dono.


1. ⛔ Merge da branch e deploy de um SHA marcado `RELEASE_CANDIDATE` (com `ADMIN_AUTH_MODE` ausente, nada muda).
2. ⛔ Aplicar a **0088** no banco hospedado (backup + restauração validada antes, como na rodada 0079–0087).
3. ⛔ IdP: criar o app (Entra single-tenant **ou** Google Internal) e configurar o provedor no Supabase (design R1 §9).
4. ⛔ Supabase: "Allow new users to sign up" OFF; TOTP ligado; Redirect URL exata; expor `admin_private` no Data API.
5. ⛔ Vercel: `ADMIN_AUTH_MODE=dual`, `ADMIN_SESSION_ENC_KEY`, `ADMIN_ORIGIN`, `ADMIN_IDP_PROVIDERS`,
   `ADMIN_LEGACY_SOURCES=env`, `ADMIN_FOUNDER_EMAIL` + redeploy.
6. Com a carteira de `ADMIN_WALLETS`, convidar a própria identidade corporativa (`/admin` → identidades) e guardar o
   código de ativação.
7. Entrar em `/admin-acesso` pelo IdP, digitar o código, matricular o TOTP (e um de reserva).
8. Offline: `node scripts/admin-founder-token.mjs bootstrap 2` → ⛔ colocar o SHA256 e o UNTIL na Vercel + redeploy.
9. `/admin-acesso/step-up?volta=/admin-acesso/fundador` → código do TOTP → colar o token → **Bootstrap do fundador**.
10. ⛔ Remover `ADMIN_FOUNDER_BOOTSTRAP_*` da Vercel. Ensaiar: recuperação de MFA (com token de recuperação de teste),
    revogação de sessão, conta não convidada recusada, break-glass com janela curta.
11. ⛔ `ADMIN_AUTH_MODE=corp` só depois dos ensaios.

## 13. Validação (02/11/2026, local)

| prova | resultado |
|---|---|
| banco: cadeia 0001→0088 em `supabase/postgres:17.6.1.127` descartável, sem rede | aplica limpa; testes SQL 26/27/28/**29** PASS (29: 10 blocos) |
| concorrência real (29b, dois `psql`) | `P1=ok · P2=ja_feito · 1 superadmin de fundador` |
| rollback (29c) | volta à 0083 (teste 27 PASS de novo); recusado depois de um bootstrap; 0088 reaplica e 29 passa |
| `fundador.test.ts` + `solo-authz.test.ts` | 40 testes PASS; mutação de 2 guardas centrais detectada (cada uma derruba 1 teste) |
| suíte completa (`vitest run`) em `036efda61b34bd05521d5456539cc7d9598adcaa` | **360 arquivos / 5522 testes PASS** (1ª rodada: 1 FAIL na trava de lista de migrations — 0088 não registrada; corrigido no commit `036efda`, sem retry) |
| `tsc --noEmit` · `eslint .` | 0 erros (eslint: 126 avisos pré-existentes, **nenhum** nos arquivos desta fase) |
| `next build` | **NÃO VALIDADO**: interrompido pelo vigia de memória (disponível caiu a 314 MB < 350 MB) na etapa "Creating an optimized production build" — a máquina (3,7 GiB) roda as stacks do laboratório e o bot de produção; parar as stacks exige autorização do dono. Pendente antes de qualquer release |
| SIWE/SIWS dos usuários | `git diff 1123b38..HEAD -- src/app/api/auth src/lib/auth src/middleware.ts` vazio; suítes `src/app/api/auth` e `src/lib/auth` PASS |

## 14. Riscos residuais

- **Uma pessoa continua sendo uma pessoa**: os controles compensatórios (MFA recente, autorização offline, eventos,
  trilha imutável) reduzem, não eliminam, o risco de um fundador coagido ou com todos os fatores comprometidos.
- O sinal "fora do painel" depende de alguém ler os eventos de segurança (alertas do watchdog/Telegram).
- Comprometimento simultâneo de IdP + TOTP: restauração do papel é manual (§8).
- A janela da autorização (≤ 24 h) depende do dono **remover** as variáveis depois; vencida, o recurso desliga sozinho.
- Ensaios com IdP e contas reais **não** foram feitos (proibido nesta missão).
