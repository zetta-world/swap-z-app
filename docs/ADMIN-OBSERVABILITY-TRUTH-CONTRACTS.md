# ADMIN — Contratos de verdade operacional (kill switches · auditoria · finanças · custo de IA)

Status: 🟡 DIAGNÓSTICO + DESENHO (Fase A / R0). **Nada aqui está implementado.** Entregável nº 4 de
`docs/PLANO-ADMIN-COMMAND-CENTER-2-20261025.md` §12.
Base: branch `claude/admin-command-center-2-20261025` @ `ec63cb9` (= `main` `10ebd12` + doc do plano), 26/10/2026;
o HEAD seguinte `5e27a66` só acrescenta 4 docs da Fase A — o código citado é o mesmo.
Fontes: **[C]** código no SHA acima · **[DB]** Supabase hospedado, `SELECT` agregado somente leitura, sem PII
(26/10/2026). Números do handoff são retrato de 25/10 e foram reconferidos; diferenças em §8.

Companheiros: `ADMIN-COMMAND-CENTER-INVENTARIO.md` (rotas), `ADMIN-API-AUTHORIZATION-MATRIX.md` (permissões),
`ADMIN-SSO-MFA-RBAC-DESIGN.md` (identidade e `admin_audit`), `ADMIN-UI-INVENTARIO.md` (painéis). Este documento não
repete as tabelas deles; cobre a **semântica de falha** e os **contratos de dado**.

---

## 0. Resumo

| # | Achado | Evidência | Gravidade |
|---|---|---|---|
| T-01 | `GET /admin/api/killswitch` devolve **200 `{switches:{}}`** em erro de `admin_kv`; os dois painéis desenham tudo **OFF / rodando** | `killswitch/route.ts:41-44`; `KillSwitchesPanel.tsx:16-20,32,88`; `AiControlsPanel.tsx:63-66` | P0 (ADM-004) |
| T-02 | Gates do flywheel (`pause_*`) falham **ABERTOS e em silêncio**: o `{ error }` nem é lido, não há `lido`, nem evento de segurança | `gates.ts:67-81` (`:75`, `:79`) | P0 p/ `pause_dca`/`pause_zion`, P1 resto |
| T-03 | `pause_agent_a` é **interruptor fantasma**: zero consumidores, mas aparece no painel, entra no corte automático de custo e foi virado **11 vezes** no log | `backtest/route.ts:214-216`; `AiControlsPanel.tsx:22`; `gate-keys.ts:90`; [DB] `admin_audit_log` | P1 |
| T-04 | `logAdminAction` engole `{ error }` e exceção; **6 de 10** chamadas vêm depois de escrita **não conferida** → o log pode registrar o que não aconteceu | `require.ts:110-123`; `liberacao.ts:158-168,223-227`; `tier/route.ts:106`; `ai-circuit/route.ts:56`; `margin/route.ts:79-82` | P0 (ADM-005) |
| T-05 | `paper-reset`, `paper-repair`, `paper-recap`, `ledger/export` e o **auto-kill do watchdog** mudam estado sem **nenhum** registro de ator | `paper-reset/route.ts:32-51`; `ledger/export/route.ts:15-36`; `watchdog.ts:130-145` | P0/P1 |
| T-06 | Custo de IA: `limit(100_000)` sem `order` sobre **5.034** eventos; o PostgREST corta em *max-rows* (padrão 1000) → painel vê ≤ 19,9% das linhas. Total estimado US$ 84,01; as 1000 mais antigas somam US$ 21,91 | `finance/route.ts:34`; `margin/route.ts:22`; [DB] | P0 (AI Center) |
| T-07 | `ReceitaPanel` **nunca lê** o campo `falha` que a rota devolve: falha de banco vira "DECLARADO $0 · nenhuma operação com retenção" | `receita/route.ts:192-197,214-215`; `ReceitaPanel.tsx:18,137-145` | P0 (ADM-014) |
| T-08 | `/command` (tela do CEO): todas as leituras sem `error`; `winRate` sobre `zion_suggestions` vivas **sem paginação** — 1.513 linhas hoje → recorte de ≤1000 | `command/route.ts:21-45,42,65` ; [DB] | P1 |
| T-09 | Saúde: "Supabase ok" = **cliente existe** (`!!db`), não banco respondendo; leitura de heartbeat falha vira "never"; `dca` fora da lista | `health/route.ts:11,42`; `health.ts:110-122` | P1 |
| T-10 | Exposição aberta do autopilot vira **US$ 0** quando a leitura falha | `operations/route.ts:14-31` | P1 (autopilot desligado hoje: 0 sessões [DB]) |
| T-11 | Rótulos do painel prometem o que o código não faz: "Show maintenance page to all users" (não há página nem middleware), "Disable all swap execution" (só bloqueia a cotação firme) | `KillSwitchesPanel.tsx:10-12`; `src/middleware.ts` sem referência; `quote/route.ts:244-252` | P1 |
| T-12 | Uso de IA sem medição: `narratives`, `audit-ai` e `celeiro/investigar` chamam modelo e **não gravam** `zion_analysis`; 0/5.034 eventos têm latência | `narratives/route.ts:243-265`; `audit-ai.ts:129,195`; `investigar.ts:252`; [DB] | P1 (AI Center) |

O repositório **já tem** os padrões certos — falta generalizá-los: leitura tri-estado `LeituraKv`
(`early-access/gate.ts:38-40,73-96`, com timeout de 3 s e `kv_valor_invalido`), capacidades com `undefined`≠`null`
(`dca/capacidade.ts:90-118`), paginação que **declara** corte (`supabase/paginar.ts:17-42`, `truncado`), auditoria
conferida que **recusa entregar** sem registro (`early-access/export/route.ts:82-84`, `store.ts:440-454`) e RPC
transacional com evento na mesma transação (`store.ts:371-397`, `early_access_transicionar`).

---

## 1. Método (reprodutível)

| Artefato | O que faz | Saída |
|---|---|---|
| `scratchpad/admin-cc2/killswitch-map.cjs` | AST: leitores (`checarKillSwitches`, `lerKillSwitches`, `getFlywheelGates`, `checar` do executor) e uso de cada chave; chaves derivadas de `gate-keys.ts` | `killswitch-map.json` |
| `scratchpad/admin-cc2/truth-scan.cjs` | AST: desestruturação sem `error`, escrita com resultado descartado, `?? 0/[]/{}`, `catch` que engole, leitura sem limite / `limit` > 1000 | `truth/truth-scan.json` (236 ocorrências em 28 arquivos; julgamento à mão em §4) |
| `scratchpad/admin-cc2/truth/mutations.cjs` | rotas admin × método mutante × `logAdminAction` × escritas | `truth/mutations.json` |
| [DB] 5 consultas agregadas | contagens, distribuição modelo/source, custo estimado com a tabela de `ai-cost.ts:38-73` reescrita em SQL, máximo por dia, `rolconfig` | `truth/db-agregados.json` |

Contagens [C]: **66** `route.ts` em `/admin/api`; **33** com método mutante; **7** chamam `logAdminAction` (**10**
chamadas). `POST /killswitch` aceita **22** chaves (3 de plataforma + 19 gates, `killswitch/route.ts:21`).

---

## 2. Kill switches

### 2.1 O que a API devolve em cada falha (hoje)

| Cenário | `GET /admin/api/killswitch` | `KillSwitchesPanel` | `AiControlsPanel` |
|---|---|---|---|
| `getSupabaseAdmin()` nulo | 503 `db_unavailable` (`:34`) | erro vermelho **e** os 3 toggles "OFF" (estado inicial `false`, `:16-20`; `:87` desenha mesmo com erro) | erro + 19 gates "ON" (inicial `false`, `:48-50`) |
| `{ error }` (tabela ausente, permissão negada, timeout do PostgREST) | **200 `{ switches: {}, note: "admin_kv not yet migrated" }`** (`:41-44`) | `switches = {}` → `isOn = undefined` → **"OFF"** + nota âmbar enganosa ("não migrado") | `!!undefined` → todos **"ON"** (`:63-66`) |
| Banco lento (sem teto de tempo na rota) | pendura até o PostgREST/fetch desistir (~20 s no ensaio X05 citado em `early-access/gate.ts:63-70`), depois cai na linha acima | shimmer, depois "OFF" | idem |
| Linha ausente | `false` (`:47`) — correto para plataforma (seed `0006:36-40`) e para gate (ausente = rodando) | OFF | ON |
| Valor fora de `"true"/"false"` (`"TRUE"`, `"1"`) | `false` (`:49`) — silencioso | OFF | ON |
| `POST` com `upsert` recusado | 500 `nao_gravou` (`:82-92`) ✅ | erro; estado local não muda ✅ | idem ✅ |
| Dois admins clicam ao mesmo tempo | sem compare-and-set: `next = !estadoLocal` (`KillSwitchesPanel.tsx:44`, `AiControlsPanel.tsx:92`) → o segundo **desfaz** o primeiro | — | — |
| Mesmo comando repetido | grava de novo e audita de novo (sem chave de idempotência) | — | — |

Os painéis **nunca releem** depois de montar (ver `ADMIN-UI-INVENTARIO.md` linha 180): outro admin muda e a tela não
sabe. [DB] hoje: 0 valores inválidos; as 3 chaves de plataforma existem e valem `false`.

### 2.2 Consumidores — interruptores de plataforma

Leitor: `lerKillSwitches` (`kill-switches.ts:58-74`) devolve `lido:false` em banco nulo, `{ error }` ou exceção; a
direção é escolhida por rota (`:86-104`) e a falha vira `logSecurity("killswitch_read_failed","high")` (`:117-119`,
fire-and-forget). Sem teto de tempo.

| Chave | Consumidor | Direção na falha de leitura | Bloqueia | NÃO bloqueia |
|---|---|---|---|---|
| `disable_swap` | `/api/quote` só `mode=quote` (`quote/route.ts:244-252`) | **ABERTA** (`usuario_confirma`) — exceção documentada `kill-switches.ts:26-31` | payload assinável novo | `mode=list` (proposital, `:226-235`); tx já cotada e assinada (`/api/solana/transmitir` não consulta); broadcast EVM (feito pela carteira) |
| `disable_cex` | `/api/cex/order` (`:127-133`); armar autopilot (`autopilot/session/route.ts:81-87`); executor no limiar (`executor.ts:336-340`, cobre `cex/order`, `autopilot/cron`, `dca/cron`, inclusive simulado) | **FECHADA** (`dinheiro_sai`) | ordem nova, armar, passada de DCA/autopilot | `cex/order/cancel`, `cex/revogar` (reduzem risco), leituras de saldo |
| `maintenance_mode` | os 4 acima | igual à rota | igual | **não existe página de manutenção**: `src/middleware.ts` não lê; o rótulo `KillSwitchesPanel.tsx:12` é falso |

Testes existentes: `kill-switches.test.ts:25-140` (decisões puras + presença do consumidor e da direção por fonte).
Não há teste de **timeout**, de **valor inválido**, nem do contrato do GET.

### 2.3 Consumidores — gates do flywheel (19)

Leitor único `getFlywheelGates` (`gates.ts:67-81`): desestrutura só `{ data }` (`:75`), `catch` vazio (`:79`) →
qualquer falha = **todos `false` = rodando**, sem sinal. A regra "ausente nunca pausa" (`gates.ts:52-53`) é
deliberada para mesa interna (pior caso: gastar token); o defeito é a falha ser **muda** e valer igual para gates com
dinheiro de cliente ou receita.

| Gate | Gasta token (`gate-keys.ts:88-123`) | Consumidor(es) | Observação |
|---|---|---|---|
| `pause_backtest` | não | `zion/backtest/route.ts:107,343`; `watchdog.ts:191,255` | master só das varreduras; resolução, cull, retro, paper e bancada **continuam** (`:257-340`) |
| `pause_agent_a` | **sim** | **nenhum** | Agent A aposentado em 27/07 (`backtest/route.ts:214-216`). Painel mostra (`AiControlsPanel.tsx:22`); o auto-kill "pausa" e anuncia no Telegram (`watchdog.ts:131-143`); [DB] 11 eventos `killswitch.pause_agent_a` |
| `pause_agent_b` | sim | `backtest/route.ts:232` | também depende de `HYBRID_B_ENABLED` (rótulo `:23`) |
| `pause_tournament` | sim | `backtest/route.ts:233`; `watchdog.ts:191` | |
| `pause_paper` | não | `backtest/route.ts:273` | roda mesmo com master pausado |
| `pause_radar` | sim | `radar/route.ts:75` | cron do radar, **independente** do master |
| `pause_sniper` | sim | `radar/route.ts:84` | só tem efeito com `SNIPER_LEGACY=on` |
| `pause_arbiter` · `pause_arbiter2` · `pause_arbiter2_lev` | não | `radar/route.ts:52,57,58` | cron do radar |
| `pause_oracle` | sim | `backtest/route.ts:244` | a marca `oracle:last_day` é gravada sem conferir (`:250`) |
| `pause_ragnarok` · `_ai` · `_dex` · `pause_urdr` · `pause_ullr` | só `_ai` | `backtest/route.ts:117,129,148,176,194` | |
| `pause_zion` | sim | `zion/route.ts:104-111` (rota do usuário) | falha abre o gasto; amortecido pelo teto diário `rateLimitDurable` (`zion/route.ts:112`), que cai para limitador em memória por instância se o banco falhar (`rate-limit.ts:99-111`) |
| `pause_bancada` | não | `bancada/tique/route.ts:56-57`; `backtest/route.ts:306`; tela do cliente `bancada/agentes/route.ts:105-106` | pausa **receita**; a tela do cliente diz "não pausado" na falha (documentado como honesto, `:102-104`) |
| `pause_dca` | não | `dca/cron/route.ts:185,197-199`; tela `dca/planos/route.ts:75-76` | **dinheiro real**. Falha do gate deixa entrada nova seguir; o que segura é `lerLiberacao("dca")` (fecha na falha, `liberacao.ts:96-110`) e o `disable_cex` do executor — todos na mesma `admin_kv`, então falhas tendem a ser correlacionadas, mas **a direção do próprio `pause_dca` não está declarada** |

[DB]: 14 gates têm linha (todas `false`); 5 sem linha (= rodando): `pause_zion`, `pause_urdr`, `pause_arbiter2_lev`,
`pause_bancada`, `pause_dca`. Último `zion_analysis` em **2026-09-15** (0 nos últimos 30 dias): "ON" no painel ≠
"está rodando" — o painel não mostra o estado **observado pelo consumidor**.

Painel: com o master ligado, **todos** os outros cartões ficam esmaecidos como "moot" (`AiControlsPanel.tsx:121-122`),
inclusive os que não dependem dele (`pause_radar`, `pause_arbiter*`, `pause_sniper`, `pause_paper`, `pause_bancada`,
`pause_dca`, `pause_zion`). Nenhuma confirmação ao pausar `pause_dca`/`pause_bancada`/`pause_zion` (`:91-104`).

### 2.4 Outras travas em `admin_kv` (fora do `POST /killswitch`)

| Chave | Leitor | Direção | Escrita |
|---|---|---|---|
| `autopilot_cex_liberado` / `dca_liberado` (+ `:motivo`) | `lerLiberacao` `liberacao.ts:96-118` | **FECHADA** (`indisponivel`/`sem_registro`) ✅ | `registrarLiberacao` `:147-170` — **2 upserts sem conferir**, devolve `ok:true` |
| `autopilot_cex_pilotos` / `dca_pilotos` | `lerPilotos` `:203-218` | fechada (lista vazia) ✅ | `gravarPilotos` `:220-228` — upsert sem conferir; **e** a rota faz leitura-modifica-grava (`autopilot-liberacao/route.ts:77-107`): leitura falha → `[]` → grava lista só com o novo piloto, **apagando os outros**, sem registro da remoção |
| `dca_simulado_liberado` / `dca_real_liberado` | `lerCapacidades` `dca/capacidade.ts:90-118` | tri-estado (`undefined` = falhou, `null` = ausente) ✅ | só SQL do dono |
| `disable_early_access` | `lerChaveGate` `early-access/gate.ts:73-96` | **FECHADA** em tudo, valor inválido incluso, timeout 3 s ✅ [DB] `true` | fora do painel de kill switches |
| `cb:<provedor>` (disjuntor) | `circuit.ts:114-125` | **ABERTA** (documentado `:8-10`) | `write` sem conferir (`:127-136`) |

### 2.5 Exceções fail-open — o que está decidido e o que falta decidir

| Exceção | Status |
|---|---|
| `disable_swap`/`maintenance_mode` na cotação | **decidida** e documentada (`kill-switches.ts:26-31`, `quote/route.ts:237-239`), com teste de direção. Falta teste de timeout. |
| Gates do flywheel em geral | decidida (`gates.ts:52-53`); falta **sinal** (evento + estado `unknown` no painel). |
| Disjuntor de IA | decidida (`circuit.ts:8-10`). |
| `pause_zion` | **não declarada** para o caso "leitura falhou"; amortecida por teto diário. Decisão D-KS-1. |
| `pause_dca` | **não declarada**; dinheiro real de cliente. Proposta: ler com `lido` e tratar falha como "pausado para entrada nova" (o recovery já roda pausado, `dca/cron/route.ts:170-182`). Decisão D-KS-2 — **não alterar política financeira sem o dono** (plano R0.3). |
| `pause_bancada` | declarada como honesta para a tela (`bancada/agentes/route.ts:102-104`); o tique segue rodando na falha. |

---

## 3. Auditoria

### 3.1 Implementação e esquema

`logAdminAction` (`require.ts:110-123`): `db` nulo → `return` mudo (`:118`); `await insert` mas o `{ error }`
resolvido pelo `supabase-js` não é lido (`:119`); exceção engolida (`:120-122`); `Promise<void>` → quem chama não tem
como saber. Eventos de segurança (`logSecurity`, `track.ts:48-53`) e `recordEvent` (`track.ts:15-30`,
`.then(() => undefined)`) têm o mesmo perfil.

`admin_audit_log` (`supabase/migrations/0005_admin_audit_log.sql:5-21`):

| Coluna | Tipo | Falta para o plano §6 |
|---|---|---|
| `id` uuid PK `gen_random_uuid()` · `actor_wallet` text NOT NULL · `action` text NOT NULL · `target` text · `payload` jsonb · `created_at` timestamptz NOT NULL `now()` | — | `actor_identity_id`, `actor_session_id`, `actor_role_at_time`, `request_id`, `idempotency_key`, `outcome` (intenção/executado/falhou/negado), `authz_decision`, `failure_code`, `before/after` redigidos, `origin` |

Índices: `(actor_wallet, created_at desc)` (`:15`), `(action, created_at desc)` (`:17`). RLS ligada, **0 policies**
(`:19-21`). Grants: `revoke all … from public, anon, authenticated` (`0070_acl_tabelas_operacionais.sql:40`), prova em
`supabase/tests/17_acl_tabelas_operacionais.sql`. **Append-only só por convenção**: `service_role` pode
`UPDATE/DELETE/TRUNCATE`; não há gatilho que impeça (a proteção está desenhada em `ADMIN-SSO-MFA-RBAC-DESIGN.md` §4.8,
`admin_private.admin_audit`).

[DB]: 54 linhas, 2 atores, último registro **2026-08-31**; `killswitch.*` 40 (`pause_agent_a` 11, `pause_agent_b` 9,
`pause_tournament` 9, `pause_backtest` 6, `pause_sniper` 2, `pause_radar` 2, `pause_oracle` 1), `ai_circuit.reset` 12,
`tier.grant` 1, `admin.grant` 1 (de `scratchpad/admin-cc2/auth/db-auth-agregados.json`).

### 3.2 Ações sensíveis × trilha (todas as chamadas)

| Ação (`action`) | Rota | Escrita antes do log | Log | Defeito |
|---|---|---|---|---|
| `admin.grant` | `admins/route.ts:64-79` | upsert **conferido** (`:68-74`) | `:76` best-effort | log pode faltar |
| `admin.revoke` | `admins/route.ts:132-165` | deletes **conferidos** (`:136-150`) | `:161` | idem; a trava "último admin" lê sem `error` (`:90-93`) — falha conta só admins de ENV (direção segura se houver ENV) |
| `tier.grant` / `tier.revoke` | `tier/route.ts:59-109` | grant conferido (`:99-104`); **revoke não** (`:106`) | `:109` | log "revogou" com delete recusado; revoke de `tier_cache.source='admin'` remove admin sem `admin.revoke` (AUTH-04) |
| `killswitch.<chave>` | `killswitch/route.ts:82-94` | conferida | `:94` | log pode faltar; sem `antes`, sem idempotência |
| `ai_circuit.reset` | `ai-circuit/route.ts:56-58` | delete **não conferido** | `:57` | log + `ok:true` com reset recusado |
| `autopilot.liberacao` | `autopilot-liberacao/route.ts:115-127` | `registrarLiberacao` **não confere** (`liberacao.ts:158-168`) | `:125` | log "fechou/abriu" sem prova; a resposta relê o estado (`:130`), o log não |
| `autopilot.piloto.autorizar/remover` | `:77-107` | `gravarPilotos` **não confere** (`liberacao.ts:223-227`) | `:85`, `:105` | + perda de pilotos na leitura falha (§2.4) |
| `margin.set.<chave>` | `margin/route.ts:79-83` | upsert **não conferido** | `:83` | custo de infra/caixa "gravado" sem prova |
| `early_access.transition` | `early-access/transition/route.ts:69-76` | RPC transacional com evento próprio (`store.ts:371-397`) ✅ | `:76` espelho best-effort | aceitável |
| `early_access.export` | `early-access/export/route.ts:82-84` | — | `registrarExport` **conferido, fail-closed** ✅ (`store.ts:440-454`) | modelo a copiar |
| *(sem ação)* paper reset | `paper-reset/route.ts:32-51` | arquiva posições e zera conta (`paper/reset.ts:102-118`) | nenhum; só `admin_kv paper_reset:last` sobrescrito e sem conferir (`:122-129`) + `recordEvent` (`:130`) | **sem ator**; só o último reset sobrevive |
| *(sem ação)* paper repair / recap | `paper-repair/route.ts:61-81`; `paper-recap` | `reconcile.ts:456`; `recapitalize.ts:182` | nenhum | sem ator |
| *(sem ação)* export contábil | `ledger/export/route.ts:15-36` | — | nenhum | CSV com carteira completa, sem trilha; erro de leitura → CSV só com cabeçalho; `limit(10_000)` acima do teto |
| *(sem ação)* auto-kill de custo | `watchdog.ts:130-145` | upsert **não conferido** (`:136-139`) | nenhum (`admin_audit_log`); Telegram diz "PAUSADO" mesmo sem gravar | ator `system` inexistente na trilha |
| *(sem ação)* mensagem ao agente | `ulfhednar/route.ts:94-117` | conferida | `recordEvent` aguardado, sem ator | baixo |

### 3.3 Desenho A — durabilidade **sem migration** ("intenção antes de executar")

Usa só `public.admin_audit_log` como está (colunas livres em `payload`). Novo módulo proposto
`src/lib/admin/auditoria-duravel.ts`:

```ts
export type Fase = "intencao" | "executado" | "falhou" | "negado";
export interface RegistroAuditoria {
  ator: string; acao: string; alvo?: string | null;
  fase: Fase; idem: string; req: string;          // idempotência + correlação
  ref?: string;                                   // id da linha de intenção
  antes?: unknown; depois?: unknown; codigo?: string; // redigidos, sem segredo
}
/** Confere `{ error }`, teto de 3 s (mesmo orçamento de GATE_KV_TIMEOUT_MS). Nunca lança. */
export async function registrarAuditoria(r: RegistroAuditoria): Promise<{ ok: true; id: string } | { ok: false; erro: string }>;

/** 1) grava `intencao`; sem ela, NÃO executa (503 `auditoria_indisponivel`).
 *  2) executa (a função já confere a própria escrita);
 *  3) grava `executado`/`falhou` com `ref`; se ESTA falhar, responde o resultado real com
 *     `auditoria: "intencao_sem_desfecho"` + logSecurity high (a intenção já prova a tentativa). */
export async function comandoAuditado<T>(ctx: {...}, executar: () => Promise<{ ok: boolean; valor?: T; codigo?: string }>): Promise<...>;
```

- `action` mantém o nome atual (`killswitch.disable_swap`…) — `AuditLogPanel` continua lendo; `payload.fase` distingue.
- Idempotência: antes da intenção, `select id … where action=? and payload->>'idem'=?` (54 linhas hoje; sem índice
  serve). Repetição devolve o desfecho anterior.
- Compare-and-set no `POST /killswitch`: corpo `{ key, enabled, esperado }`; servidor relê; divergente → 409
  `conflito` (fecha a corrida de §2.1).
- **Direção protetora** (ligar `disable_*`/`maintenance_mode`, pausar gate): sem intenção gravada, **executa mesmo
  assim** e responde `auditoria:"falhou"` + alerta — parar a plataforma num incidente vale mais que a trilha.
  **Direção permissiva** (desligar kill switch, `liberar` automação, `admin.grant`, piloto, export, reset de paper,
  reset de disjuntor): **falha fechada**. Decisão D-AUD-1 (proposta, o dono confirma).
- Converter primeiro: `killswitch` POST, `autopilot-liberacao` (+ conferir as escritas de `liberacao.ts`), `admins`,
  `tier`, `ai-circuit`, `margin`, `paper-reset/repair/recap`, `ledger/export` (registrar antes de entregar, igual
  `early-access/export`), auto-kill do watchdog (ator `system:watchdog`).
- Limite honesto: duas escritas em transações separadas — o estado pode mudar com o desfecho não gravado. O
  reconciliador lê `admin_kv.updated_at` × última intenção. Fecha ADM-005 no sentido do plano ("sem trilha não
  confirma"), não no sentido transacional.

### 3.4 Desenho B — **com migration** (local, aplicação só com autorização do dono)

Alinha com `admin_private.admin_audit` de `ADMIN-SSO-MFA-RBAC-DESIGN.md` §4.7-4.8 (campos `outcome`,
`idempotency_key` único com `action`, gatilhos anti-UPDATE/DELETE/TRUNCATE).

```sql
-- supabase/migrations/00NN_admin_kv_auditado.sql (proposta; NÃO aplicada)
create unique index if not exists admin_audit_idem
  on admin_private.admin_audit (action, idempotency_key) where idempotency_key is not null;

create or replace function admin_private.kv_definir_auditado(
  p_key text, p_valor text, p_esperado text, p_ator text, p_acao text,
  p_idem text, p_req uuid, p_payload jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_antes text; v_id uuid;
begin
  select value into v_antes from public.admin_kv where key = p_key for update;   -- trava a chave
  if p_esperado is not null and v_antes is distinct from p_esperado then
    insert into admin_private.admin_audit(action, outcome, failure_code, actor_ref, idempotency_key, request_id, before_redacted)
      values (p_acao, 'failed', 'conflito', p_ator, null, p_req, to_jsonb(v_antes));
    return jsonb_build_object('ok', false, 'erro', 'conflito', 'atual', v_antes);
  end if;
  insert into admin_private.admin_audit(action, outcome, actor_ref, idempotency_key, request_id, before_redacted, after_redacted, payload)
    values (p_acao, 'succeeded', p_ator, p_idem, p_req, to_jsonb(v_antes), to_jsonb(p_valor), p_payload)
    on conflict (action, idempotency_key) where idempotency_key is not null do nothing
    returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', true, 'repetido', true); end if;
  insert into public.admin_kv(key, value, updated_at) values (p_key, p_valor, now())
    on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  insert into public.admin_audit_log(actor_wallet, action, target, payload)        -- espelho p/ o painel atual (modo dual)
    values (p_ator, p_acao, null, p_payload || jsonb_build_object('audit_id', v_id));
  return jsonb_build_object('ok', true, 'audit_id', v_id, 'antes', v_antes, 'depois', p_valor);
end $$;
revoke all on function admin_private.kv_definir_auditado(text,text,text,text,text,text,uuid,jsonb) from public, anon, authenticated;
grant execute on function admin_private.kv_definir_auditado(text,text,text,text,text,text,uuid,jsonb) to service_role;
```

- Uma transação: ou o switch muda **e** a trilha existe, ou nada muda (ADM-005 literal). Efeito externo (Telegram,
  broadcast) só depois do `commit`.
- Mesmo molde para `admins` (upsert/delete em `platform_admins` + `tier_cache`), `tier`, liberação e pilotos (lista
  JSON com `p_esperado` = versão anterior), e o auto-kill do watchdog (`p_ator='system:watchdog'`).
- `security invoker` porque quem chama é `service_role` (dono dos privilégios); sem `SECURITY DEFINER` novo.
- Prova: `supabase/tests/NN_kv_auditado.sql` no padrão de `17_acl_…`: (a) gatilho de teste que faz o `insert` da
  auditoria falhar → `admin_kv` inalterado; (b) mesma `idempotency_key` 2× → 1 linha; (c) `p_esperado` divergente →
  `conflito`, sem escrita; (d) `anon`/`authenticated` sem `EXECUTE`.

### 3.5 Testes de aceitação desta frente

ADM-003 (auditor no POST — depende de R2), ADM-004 (§5.4), ADM-005 (A: intenção falha → nada executa na direção
permissiva; B: transação aborta), ADM-009 (último admin — já há trava, falta evento auditado), mais: escrita do switch
recusada não gera linha `executado`; reset de disjuntor recusado não responde `ok`; liberação com upsert recusado
devolve 503 e loga `falhou`; leitura de pilotos falha → `POST piloto` recusa (não sobrescreve).

---

## 4. Verdade nos endpoints prioritários

### 4.1 Onde falha/ausência vira 0, `{}`, `[]`, "saudável" ou "OFF"

| Endpoint | Ponto | Vira | Deveria ser |
|---|---|---|---|
| `GET /killswitch` | `route.ts:41-44` · `:47` · `:49` | `{}` → OFF/ON; ausente → false; inválido → false | `unavailable` (503) · `off` com `persistido:null` · `invalido` |
| `GET /ai-circuit` | `ai-circuit/route.ts:28` (sem `error`), `:35` (JSON inválido → padrão) | todos "● ok", `fails:0` (`AiControlsPanel.tsx:168-170`); se a rota falhar a seção some (`:70-74`) | `unavailable` / `invalido` por provedor |
| `GET /health` | `health/route.ts:42` | "Supabase" `ok:true` se o cliente existe | ping real (`select 1` com teto) |
| | `health.ts:115,120` | heartbeat ilegível = "never" (stale) | `unavailable` ≠ `stale` |
| | `health/route.ts:11` | `dca` ignorado (o watchdog tem, `watchdog.ts:36`) | uma tabela única de crons (hoje são 3: health 3 crons, command 2 `command/route.ts:9`, watchdog 4) |
| | `health.ts:11-21` | heartbeat gravado sem conferir | conferir; falha = evento |
| `GET /finance` | `finance/route.ts:29-38` | custo IA $0, volume $0, `tierCounts {}` | `unavailable` por fonte |
| | `:34` `limit(100_000)` sem `order` | ≤1000 de 5.034 linhas, recorte arbitrário | paginação declarada ou agregação SQL; `partial` |
| | `:35`, `:36` sem limite | `operations` 19, `tier_cache` 5 hoje — corta em 1000 no futuro | idem |
| | `:49-51` | 14 barras pré-zeradas: falha e "sem gasto" têm o mesmo gráfico | `unavailable` sem barras |
| | `:111-117` | "receita" = tiers × preço de passe, inclui concessões admin | `quality:"declared"`/"atribuída", nunca receita |
| `GET /receita` | `receita/route.ts:55-81,192-197` | 200 com zeros + `falha` | 503 ou `state` por bloco — e o painel **lê** `falha` (`ReceitaPanel.tsx:18` só tipa) |
| `GET /operations` | `operations/route.ts:14-31` | `positions []`, `openExposure 0` | `unavailable`; exposição nunca 0 por falha |
| `GET /stats` | `stats/route.ts:17-41,71-82` | contagens `?? 0`; `chainSplit {}`, `tierDist {}` | `unavailable`; `users` 4 hoje |
| `GET /command` | `command/route.ts:21-45,76-85` | tudo `?? 0`; `winRate` sobre ≤1000 de 1.513 (`:42,65`) | `partial`; agregação no banco |
| `GET /margin` | `margin/route.ts:21-27,31-42` | custo IA $0 → margem melhor | `unavailable` derruba a margem para `null` |
| | `margin.ts:61-80,98` | KV ilegível = "falta preencher" (`incomplete`) | distinguir `unavailable` de `empty` |
| `GET /ledger` | `ledger/route.ts:14-34` | totais 0; `count ?? length` | `unavailable`/`partial` |
| `GET /ledger/export` | `ledger/export/route.ts:20-27` | CSV só com cabeçalho | 503; sem arquivo |
| `GET /launch-gate` | `launch-gate.ts:202-204,219-221` | conta ilegível → `starting 1000`, `realized 0` | `unavailable` por mesa; `selectAllRows` já lança (500) ✅ |
| `GET /admins` | `admins/route.ts:20-23` | lista só com admins de ENV | `unavailable` (o operador re-concederia) |
| `requireAdmin` (auth) | `require.ts:68-87` | erro de leitura → 404 + alerta de intrusão (AUTH-07) | já no plano R1/R2 |
| `GET /audit` | `audit/route.ts:14-15` | `limit=abc` → `NaN` no `range` | validar; o erro de leitura já vira 500 ✅ (`:23`) |
| watchdog | `watchdog.ts:68-71,76,97-100` | erro = 0 erros, $0 de IA → não alerta nem corta | alerta "não consegui medir" |

### 4.2 Paginação e truncamento

| Leitura | Tabela | Linhas hoje [DB] | Risco |
|---|---|---|---|
| `finance/route.ts:34`, `margin/route.ts:22` `limit(100_000)` | `platform_events` `zion_analysis` | **5.034** (desde 2026-06-27; máx. 452/dia) | **ativo** se *max-rows* = 1000 |
| `command/route.ts:42` | `zion_suggestions` vivas | **1.513** (5.938 total) | **ativo** |
| `watchdog.ts:70` (24 h) | `zion_analysis` | máx. 452/dia | latente (corte em 1000/24 h) |
| `ledger/export/route.ts:23` `limit(10_000)` | `operations` | 19 | latente |
| `finance:35`, `ledger:15`, `command:35`, `receita` (paginada ✅) | `operations` | 19 | latente |
| `stats:33-34` | `users`/`tier_cache` | 4 / 5 | latente |
| `selectAllRows` (`paginate.ts:38-62`) | 31 chamadas (grep, fora de testes; o comentário do arquivo diz 32) | — | para em `maxRows=100_000` **sem sinalizar**, ao contrário de `lerTodasPorChave` (`paginar.ts:17-42`, `truncado`) |

*Max-rows* do PostgREST não está em `pg_roles.rolconfig` (`authenticator` só tem `statement_timeout=8s`) — é
configuração da API; **confirmar no painel do Supabase**. O próprio repo assume 1000 (`paginate.ts:4-8`).

---

## 5. Contrato alvo — `OperationalMetric<T>` adaptado ao repo

### 5.1 Tipo (proposta: `src/lib/admin/metrica.ts`, módulo puro, importável por painel client)

```ts
export type DataState = "ok" | "zero" | "empty" | "stale" | "partial" | "unavailable" | "error";
export type Quality   = "verified" | "measured" | "estimated" | "declared" | "simulated";
export type ErrorCode =
  | "db_indisponivel" | "leitura_falhou" | "excecao" | "tempo_esgotado"
  | "truncado" | "valor_invalido" | "config_ausente" | "upstream";

export interface OperationalMetric<T> {
  state: DataState;
  value: T | null;                 // null = desconhecido; NUNCA 0 implícito
  quality: Quality;
  source: string;                  // "platform_events/zion_analysis", "admin_kv", "coingecko"
  asOf: string | null;             // quando a fonte foi lida (ou o dado, se for heartbeat)
  coverage?: { expected: number | null; observed: number; truncated: boolean };
  errorCode?: ErrorCode;           // sem stack, PII ou segredo
  staleAfterSec?: number;
}
```

Nomes de fio iguais ao plano §6 (as outras frentes os citam); construtores em português, no estilo de
`decidirGate`/`lerChaveGate`:

| Construtor | Entrada (tipo que já existe) | Regra |
|---|---|---|
| `deContagem(r, fonte)` | `{ count, error }` do supabase-js | `error` → `unavailable/leitura_falhou`; `count===0` → `zero`; `count==null` → `error` |
| `deLeitura(l, fonte, agregar)` | `LeituraPaginada<T>` (`paginar.ts:17`) | `erro` → `unavailable`; `truncado` → `partial` + `coverage.truncated`; 0 linhas → `empty` |
| `deKv(l, dominio)` | `LeituraKv` (`early-access/gate.ts:38`) | `lido:false` → `unavailable`; `valor:null` → `empty`; fora do domínio → `error/valor_invalido` |
| `deBatimento(iso, staleAfterSec)` | heartbeat `cron:*:last` | ausente → `empty` ("nunca visto"); velho → `stale`; ilegível → `unavailable` |
| `combinar(ms)` | várias métricas | qualquer `unavailable`/`partial` → `partial` (não soma como total) |
| `comTeto(p, ms)` | qualquer promessa | estouro → `unavailable/tempo_esgotado` (orçamento padrão 3 s, `early-access/gate.ts:70`) |

### 5.2 Regras

1. `zero` só quando a fonte respondeu e o número é 0. Proibido `?? 0` sobre `count`/`data` não conferidos (o
   `truth-scan` aponta 53 `?? 0`/`|| 0` e 49 desestruturações sem `error` nos 28 arquivos varridos).
2. Soma de fontes com uma falha = `partial`, nunca total.
3. `estimated` (tabela de preço), `declared` (navegador/tier), `simulated` (paper) aparecem como rótulo, não rodapé.
4. HTTP: fonte **principal** indisponível → 503 com corpo `{ state:"unavailable", errorCode, source }` (nunca `{}`);
   fonte acessória indisponível → 200 com aquela métrica `unavailable`.
5. Compatibilidade: as rotas ganham um campo `metricas` ao lado das chaves atuais; painéis migram um a um; as chaves
   antigas saem quando nenhum painel as ler (teste de fonte).

### 5.3 Contrato de kill switch

```ts
export type EstadoInterruptor = "on" | "off" | "unknown" | "invalid";
export interface InterruptorObservado {
  key: string;                          // "disable_swap" | "pause_dca" | …
  estado: EstadoInterruptor;            // unknown = leitura falhou; invalid = valor fora de "true"/"false"
  persistido: string | null;            // valor bruto (null = sem linha)
  atualizadoEm: string | null;          // admin_kv.updated_at
  direcaoNaFalha: "fecha" | "abre";     // do mapa de §2.2/§2.3, gerado do código
  consumidores: string[];               // "api/quote:244", … — vazio = interruptor fantasma (falha de CI)
}
// GET /admin/api/killswitch → 200 { state, asOf, interruptores: InterruptorObservado[] }
//                           → 503 { state: "unavailable", errorCode } — nunca { switches: {} }
```

Painel: `unknown` = cinza "DESCONHECIDO — não consegui ler" e **toggle desabilitado** (não se calcula `!undefined`);
`invalid` = âmbar com o valor bruto; o POST envia `esperado`. Releitura ao receber o broadcast `killswitch`.

### 5.4 Testes de contrato

ADM-004: mock do cliente com `{ error }`, exceção e atraso > teto → GET 503/`unavailable`; painel não mostra OFF.
ADM-014: `/finance` com `count 0`, `data null + error` e `db null` → três representações distintas. Teste de fonte:
nenhuma rota de §4.1 desestrutura `{ data }`/`{ count }` sem `error` (estender `escritas-conferidas.test.ts`). Teste
de completude: cada chave de `FLYWHEEL_GATE_KEYS` tem ≥1 consumidor fora de `admin/` (hoje falharia em
`pause_agent_a` — de propósito).

---

## 6. Lista priorizada de conversão

| # | Pri. | Alvo | Mudança | Prova | Toca dinheiro? |
|---|---|---|---|---|---|
| C1 | P0 | `GET/POST /killswitch` + `KillSwitchesPanel` + `AiControlsPanel` | §5.3; CAS; releitura; confirmação para `pause_dca`/`pause_bancada`/`pause_zion`; esmaecer só os gates realmente sob o master | ADM-004, conflito 409 | não (só leitura/escrita de flag) |
| C2 | P0 | auditoria dos comandos (§3.2) | Desenho A agora; B como migration local | ADM-005, testes §3.5 | não |
| C3 | P0 | `liberacao.ts:158-168,220-228` + `autopilot-liberacao/route.ts:77-107` | conferir as escritas; leitura de pilotos falha → recusa | teste de fonte (padrão `escritas-conferidas`) | controle de dinheiro; **não muda a política** |
| C4 | P0 | `/finance` + `AiCostPanel` | métricas por fonte; agregação paginada declarada; rótulo ESTIMADO; renderizar `bySource`/tokens (hoje calculados e não exibidos, `AiCostPanel.tsx:20-22`) | ADM-014, ADM-007 | não |
| C5 | P0 | `/receita` + `ReceitaPanel` | ler e mostrar `falha`; zeros só com `state:"ok"` | ADM-014, ADM-006 | não |
| C6 | P1 | `getFlywheelGates` | devolver `lido` + `logSecurity` na falha (comportamento igual: continua abrindo); D-KS-1/D-KS-2 para `pause_zion`/`pause_dca` | unitário | `pause_dca` só após decisão |
| C7 | P1 | `/health` + `health.ts` | ping real do banco com teto; `unavailable`≠`stale`; tabela única de crons com `dca` | unitário | não |
| C8 | P1 | `/command` | `partial`/`unavailable`; `winRate` por agregação no banco | unitário | não |
| C9 | P1 | `/operations`, `/stats`, `/ledger`, `/ledger/export`, `/margin`, `/launch-gate`, `/admins` GET | §4.1 | unitário | não |
| C10 | P1 | `ai-circuit` GET/POST | conferir delete; `unavailable` por provedor | unitário | não |
| C11 | P1 | watchdog | conferir o upsert do auto-kill; auditar como `system:watchdog`; alerta "não consegui medir" | unitário | não |
| C12 | P1 | rótulos dos interruptores | descrever o que cada um bloqueia (§2.2), gerado do mapa | teste de fonte | não |
| C13 | P2 | `selectAllRows` | devolver/lançar `truncado` ao bater `maxRows` | unitário | não |
| C14 | P2 | `pause_agent_a` | decidir: remover da UI e do corte (mantendo a chave por histórico) ou marcar "APOSENTADO — sem efeito" | teste de completude §5.4 | não |

Fora daqui: decisões de política de dinheiro (D-KS-1, D-KS-2, D-AUD-1) ficam com o dono.

---

## 7. Custo de IA — dados existentes e lacunas para o AI Control Center

### 7.1 O que existe

| Peça | Onde | Fato |
|---|---|---|
| Normalização de tokens | `provider.ts:19-24` (`inTokens` = não cacheado, `outTokens`, `cachedTokens` = leitura, `cacheWriteTokens` = escrita); OpenAI-compat `entradaOpenAICompat` `:186-198` (sem dupla contagem de cache, CE-07/RM-08) | ✅ |
| Preço | `ai-cost.ts:38-97`, lista pública por regex do modelo; default Sonnet | estimativa; sem versão de preço por evento |
| Reserva de modelo | `modelo-reserva.ts:150-235` — `r.model` = modelo da tentativa que respondeu | ✅ atribuição em fallback |
| Disjuntor | `circuit.ts` (`cb:<id>` em `admin_kv`, classe da falha `:79-94`) | só contagem consecutiva |
| Cache de resposta do ZION | `zion/cache-de-resposta.ts` (TTL 60 s, em memória; `acertos`/`faltas` por instância `:66-67`) | evento `cacheHit:true` só na rota do usuário (`zion/route.ts:494-497`) |
| Evento | `platform_events` (`event_type`, `wallet_address`, `path`, `metadata` jsonb, `created_at`), `event_type='zion_analysis'` | [DB] 5.034 linhas; 5.034 com `model` e `source`; 5.026 com `cacheWriteTokens`; **0** com latência; **0** `cacheHit` |
| Painel | `AiCostPanel.tsx` via `/admin/api/finance` | hoje/7d/mês/projeção, barras 14 d, tabela por modelo, aviso "≈ ESTIMATIVA" ✅ (`:93-96`) |

[DB] modelos: `mistral-large-latest` 1501 · `deepseek-chat` 902 · `grok-4.3` 623 · `kimi-k2.6` 612 ·
`mistral-medium-latest` 597 · `deepseek-v4-pro` 331 · `claude-sonnet-4-6` 304 · `claude-opus-4-8` 164. Tokens:
29,1 M não cacheados, 3,04 M saída, 27,8 mil leitura de cache, 2,40 M escrita de cache. Custo estimado total
US$ 84,01 (tabela atual — **não é fatura**).

### 7.2 Defeitos de medição atuais

| ID | Defeito | Evidência | Efeito |
|---|---|---|---|
| AI-01 | Leitura truncada sem ordem | `finance/route.ts:34`, `margin/route.ts:22` | "TOTAL" e custo mensal da margem sobre ≤1000 linhas |
| AI-02 | Rota do usuário grava `cacheWriteTokens: 0` fixo | `zion/route.ts:526`, embora `anthropicStream` devolva o valor (`provider.ts:142`) | com `AI_PROVIDER=anthropic`, a escrita de cache (≈24% da conta, `ai-cost.ts:4-6`) some |
| AI-03 | Saída soma `reasoning_tokens` sempre | `provider.ts:252-253` (o comentário diz "quando não incluído") | dupla contagem em provedor cujo `completion_tokens` já inclui o raciocínio (padrão OpenAI); conferir por provedor |
| AI-04 | `model` = id **pedido**, não o devolvido pela API | `provider.ts:83,137,246,385` | alias `*-latest` (2.098 eventos Mistral) nunca resolvido para a versão real |
| AI-05 | Evento perdido em silêncio | `track.ts:23-30` ignora `{ error }`; chamadas não aguardadas em `backtest.ts:231,253,382` | custo some sem sinal |
| AI-06 | Gastadores sem evento e sem gate | `narratives/route.ts:243-265` (só `console.log`), `audit-ai.ts:129,195`, `celeiro/investigar.ts:252` | fora do painel e do corte automático |
| AI-07 | `source` de custo ≠ `source` de qualidade | custo `backtest_${id}` (`backtest.ts:219`) × sugestão `${id}_scan` (`zion/backtest/route.ts:233-237`); [DB] 20 rótulos de custo, 19 de sugestão, poucos coincidem | custo por decisão útil não se junta |
| AI-08 | Histórico contaminado | radar carimbado como `backtest_mistral` antes do conserto (`backtest.ts:205-217`) | série antiga por mesa não é confiável |
| AI-09 | Preço recalculado na leitura | `estimateCost` aplica a tabela de hoje a todo o passado | mudar a tabela reescreve a história (RM-08 já mudou Kimi/DeepSeek) |
| AI-10 | `bySource`, `tokens`, `calls` calculados e não exibidos | `finance/route.ts:66-95` × `AiCostPanel.tsx:78-127` | o painel não mostra cache nem produto |
| AI-11 | `callGeoModel` sem chamador | `registry.ts:257-270` | código morto (não medir) |

### 7.3 Lacunas × métricas do plano (§3 "ZETTA AI CONTROL CENTER")

| Métrica do plano | Hoje | Falta |
|---|---|---|
| chamadas por produto/capacidade | `source`+`op` heterogêneos | mapa canônico `produto`/`capacidade` (proposta: `flywheel.torneio` ← `backtest_*`,`*_scan`; `flywheel.ferrari` ← `hybrid*`; `radar` ; `ragnarok.mimir` ← `strat_ai`; `volva` ← `oracle_*`; `zion.usuario` ← `user`; `autopilot` ← `cron`; legado ← `backtest`,`self_scan`,`oracle_self`,`sniper`) + instrumentar AI-06 |
| tokens uncached/cache_read/cache_write/output | ✅ no evento | AI-02, AI-03; separar `reasoning` |
| modelo real executado / fornecedor | modelo pedido; fornecedor só em `strat_ai` (`strategist-ai.ts:337`) | `model_executed` da resposta, `provider`, `fallback_from` |
| custo estimado | ✅ na leitura | `price_version` e `est_cost_usd` gravados no evento |
| faturado | ❌ | importação manual/console por provedor (`billed_usd`, período); Mistral no plano gratuito hoje superestimado (`ai-cost.ts:62-67`) |
| latência p50/p95 | ❌ (0/5.034) | `latency_ms`, `ttft_ms` (stream) |
| falha/timeout | parcial: `logError` com `where` (`backtest.ts:236-239`), disjuntor | `outcome` por chamada (`ok/erro/timeout/abortado/cache_hit`) + `error_class` de `classificarFalha` |
| economia por cache | `cachedTokens` (prompt cache); cache de resposta só em memória | `cache_hit` persistido; economia = tokens × (entrada − leitura) |
| oportunidade filtrada sem IA | ticks soltos (`strat_dex_tick`, `ullr_tick`) | contador "descartado antes do LLM" por produto |
| custo por decisão útil | ❌ | `run_id` comum entre evento de custo e `zion_suggestions` (AI-07) |
| qualidade/edge fora da amostra | ✅ em `zion_suggestions`/flywheel (filtros honestos) | junção por `run_id`/`source` canônico |
| projeção mensal | ✅ linear (`finance/route.ts:98-100`) | sobre dado completo (AI-01) |
| diferença contra orçamento | só tetos 24 h em env (`watchdog.ts:21-22`) | orçamento mensal por produto; exibir no painel |

### 7.4 Registro proposto

- **Sem migration**: `metadata.v = 2` em `zion_analysis` (mesma tabela; `finance` lê v1 e v2):
  `{ v, produto, capacidade, source, provider, model_requested, model_executed, fallback_from, outcome, error_class,
  latency_ms, ttft_ms, inTokens, outTokens, reasoningTokens, cachedTokens, cacheWriteTokens, price_version,
  est_cost_usd, run_id }`. Um único helper `registrarUsoDeIa()` aguardado, que confere `{ error }`; falhas também
  geram evento (`outcome:"erro"`, tokens 0). Leitura: agregação paginada declarada (`lerTodasAsPaginas`) ou RPC de
  agregação.
- **Com migration** (local primeiro): `public.ai_calls` (colunas acima tipadas; índices `(created_at)`,
  `(produto, created_at)`; RLS ligada sem policy; `revoke all … from public, anon, authenticated`) + RPC
  `ai_custo_agregado(de, ate, por)` para o painel não trafegar linhas; `ai_billing` (fatura importada) e `ai_budget`.
- Nunca enviar dado de usuário a LLM por causa disto; o evento não guarda prompt nem resposta.

---

## 8. Diferenças em relação ao handoff (25/10)

| Item do handoff | Leitura 26/10 | Diferença |
|---|---|---|
| GET killswitch "pode devolver `switches:{}`" | confirmado, **200**, nota "admin_kv not yet migrated" (`:41-44`); efeito é OFF num painel e ON no outro | ampliado |
| `kill-switches.ts` "fail-open em certos cenários de swap" | confirmado: só `/api/quote mode=quote`; CEX/autopilot/DCA fecham | precisado |
| finance `limit(100_000)` "avaliar" | 5.034 eventos; corte efetivo no *max-rows* (padrão 1000, não verificável por SQL) | quantificado |
| AiCostPanel "consumo por modelo/fonte, tokens cacheados e projeção" | por **modelo** e projeção sim; **fonte e tokens são calculados e não exibidos** | divergente |
| `logAdminAction` best-effort | confirmado; 10 chamadas/7 rotas; 6 após escrita não conferida | quantificado |
| 54 eventos em `admin_audit_log`, 680 em `admin_kv`, 19 operações | 54 / 680 / 19 | igual |
| — | `pause_agent_a` sem consumidor (11 viradas auditadas); `ReceitaPanel` ignora `falha`; `command` trunca `zion_suggestions` (1.513); auto-kill sem auditoria | novo |

## 9. Decisões pendentes (não inventadas aqui)

| ID | Decisão | Proposta |
|---|---|---|
| D-KS-1 | `pause_zion` com leitura falha | manter aberto + evento; teto diário já amortece |
| D-KS-2 | `pause_dca` com leitura falha | fechar entrada nova (recovery continua) |
| D-AUD-1 | auditoria indisponível em comando **protetor** | executar e alertar; permissivo falha fechado |
| D-AUD-2 | aplicar o Desenho B no banco hospedado | só com autorização explícita, após R4 |
| D-AI-1 | fonte de faturamento por provedor | importação manual do console até haver API |
