# RUNBOOK — Operação Z-SWAP

> Referência operacional única: todas as env vars, os crons, e o playbook de
> incidente. Gerado na rodada de melhorias da auditoria (M5, 2026-07-02).
> Atualizar quando uma env var nascer ou morrer.

---

## 1. Env vars (Vercel → Settings → Environment Variables)

### Núcleo / infra
| Var | O que é | Default se ausente |
|-----|---------|--------------------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Banco (server-only; service key NUNCA vira NEXT_PUBLIC) | app roda sem DB (best-effort) |
| `SUPABASE_ANON_KEY` | Realtime broadcast do painel admin | realtime off |
| `AUTH_JWT_SECRET` | Sessão por carteira assinada | login quebra |
| `CRON_SECRET` | Bearer dos 4 crons (backtest/autopilot/radar/**dca**) | crons retornam 401 |
| `DCA_MAX_CICLO_USD` | teto por ciclo de DCA | **padrão 500** — ausente NÃO é "sem limite" |
| `DCA_MAX_DIARIO_USD` | teto diário somando TODOS os planos da carteira | **padrão 1000** |
| `DCA_MIN_ORDEM_USD` | mínimo aceito pela corretora; abaixo disso o plano encerra | **padrão 5** |
| `ADMIN_WALLETS` | Allowlist de carteiras admin (CSV) | só tier_cache source=admin entra |
| `HELIUS_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC` | RPC Solana | RPC público (lento) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alertas Odin | alertas mudos |
| `AUTOPILOT_ENC_KEY` | Cripto das credenciais CEX server-side | autopilot background off |
| `LIFI_API_KEY`, `ZEROX_API_KEY`, `TRANSAK_*` | Agregadores/on-ramp | fallbacks/feature off |
| `QUOTE_GLOBAL_MAX` | Teto GLOBAL de chamadas ao upstream pago (0x/LiFi) por min — backstop de flood distribuído no `/api/quote`; abaixar se ligar WAF/alerta | `3000`/min |
| `QUOTE_DAILY_MAX` | Teto GLOBAL **por dia** do `/api/quote`. O teto por minuto é backstop de disponibilidade, não de conta: 3000/min sustentados são 4,32 M de chamadas/dia e uma enchente logo abaixo do limite nunca dispara. Falha ABERTO se o banco cair | `250000`/dia |
| `ZION_DAILY_MAX` | Teto GLOBAL **por dia** do `/api/zion` — o caminho mais caro (LLM por chamada). O disjuntor do watchdog é reativo (mede 24h e corta na conferência seguinte); este freia antes. Falha ABERTO | `20000`/dia |
| `NEXT_PUBLIC_SOLANA_JITO` | `on` envia os swaps de Solana por **bundle privado** (block engine da Jito) em vez do RPC público, com gorjeta dimensionada em 5% da exposição a MEV. **Nasce desligado**: o caminho nunca foi exercitado contra o engine real. Falha do Jito cai para o RPC normal e a tela diz qual caminho foi usado | off |
| `NEXT_PUBLIC_ALLOWED_SWAP_TARGETS` / `NEXT_PUBLIC_ALLOWED_SWAP_SPENDERS` | Allowlist de router/spender por chain (`1:0xA,0xB;137:0xC`). **Popular com endereços VERIFICADOS** do 0x/LiFi → vira bloqueio de dreno. Vazio = desligado (não quebra swap) | vazio |
| `NEXT_PUBLIC_ZEROX_INFINITE_APPROVAL` | `true` restaura a aprovação infinita do 0x (UX antiga). Default agora aprova só o valor do swap | off (aprova exato) |
| `ZSWAP_COLLECTION_ADDRESS` | Coleção NFT (launch) | mint gate off |
| `NEXT_PUBLIC_SITE_URL`, `BASE_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | Site/SEO/wallets | — |

### IA — Anthropic (Agent A + CEO)
| Var | O que é | Default |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | Chave única (Sonnet + Opus) | toda análise ZION off |
| `ZION_MODEL` | Modelo primário do ZION | `claude-sonnet-4-6` |
| `ZION_FALLBACK_MODEL` | Fallback N1 | `claude-haiku-4-5-20251001` |
| ~~`HYBRID_ORCH_MODEL`~~ · ~~`HYBRID_ORCH_FALLBACK_MODEL`~~ | **Obsoletas em 27/07** — o CEO da Ferrari saiu da Anthropic; use `HYBRID_CEO` | — |
| `HYBRID_B_ENABLED` | Master do Agent B (`false` desliga) | **on** (27/07: sem Anthropic, ficou barato) |
| `HYBRID_CEO` | Força o provedor do assento CEO do Agent B | `deepseek` (chain: deepseek→kimi→mistral) |
| `HYBRID_BRAIN` | Força o assento técnico (rascunho) | `mistral` (chain: mistral→kimi) |
| `NARRATIVES_MODEL` | Clustering de narrativas | — |

### IA — provedores diretos (torneio + especialistas)
Cada provedor: `<X>_API_KEY` (liga), `<X>_BASE_URL`, `<X>_MODEL` (opcionais).
`DEEPSEEK_*` · `KIMI_*` · `MISTRAL_*` · `LLAMA_*` · `XAI_*` (Grok).
Sem chave = provedor simplesmente ausente (dormente, sem erro).

**Modelo aposentado = breaker re-tripando de hora em hora.** O alerta do
breaker classifica a causa (modelo inválido / auth / cota / upstream) — se
disser "MODELO INVÁLIDO", troque o `<X>_MODEL` no painel da Vercel, sem
deploy. Defaults atuais: `deepseek-v4-pro` (25/07: `deepseek-chat` foi
aposentado; `deepseek-v4-flash` é o swap rápido/barato) · `kimi-k2.6` ·
`mistral-large-latest` · `grok-4.3`.

### Flywheel / medição
| Var | O que é | Default |
|-----|---------|---------|
| `BACKTEST_COST_PCT` | Custo round-trip descontado da expectancy | `0.2` (%) |
| `BACKTEST_MIN_SAMPLE` | Amostra mínima confiável | `100` |
| `BACKTEST_RESOLVE_INTERVAL` | Velas da resolução | `5m` |
| `BACKTEST_REGIME_FILTER` | Gate de regime no ledger (RANGING = nada; contra-tendência confirmada = rejeita). `off` desliga | on |
| `BACKTEST_MIN_RR` | Reward:risk mínimo do bracket no ledger | `2` |
| `ARB_DAILY_CAP` / `ARB2_DAILY_CAP` | Round-trips/dia (soltos p/ medir edge no papel; apertar p/ dinheiro real) | `240` / `120` |
| `ARB_ORDERBOOK_CHECK` | `on` liga a F2: caminha a profundidade real do orderbook da melhor oportunidade e loga `arb_realism` (net teórico vs realista) | off |
| `TOURNAMENT_CULL` | Corte automático de agente no vermelho com amostra (`culled:<source>` no admin_kv; apagar a chave = anistia) | on |
| `PAPER_CHAMPION_MULT` | Multiplicador de posição do campeão no paper | `2` |
| `ORACLE_HORIZON_H` | Horizonte das teses do Oráculo | `240` (10d) |
| `ORACLE_MIN_STOP_PCT` | Stop mínimo da tese (fora do ruído diário) | `4` (%) |
| `ORACLE_MIN_RR` | RR mínimo do perfil tese | `1.5` |
| `ORACLE_MAX_OPEN` | Teses abertas simultâneas por modelo | `3` |
| `ORACLE_STOP_COOLDOWN_D` | Dias de cooldown por símbolo após stop (por modelo) | `7` |
| `ORACLE_MAX_PER_SYMBOL` | Teses abertas por símbolo na mesa inteira | `2` |
| `SNIPER_MIN_STOP_ATR` | Piso do stop do sniper em múltiplos do ATR 1h | `1.5` |
| `SNIPER_MIN_STOP_PCT` | Piso absoluto do stop do sniper | `1.2` (%) |
| `SNIPER_COOLDOWN_H` | Cooldown por símbolo do sniper | `12` (h) |
| `AGENT_RETRO` | Auto-Retro (agente reflete sobre os próprios trades a cada N decididos; `off` desliga) | on |
| `RETRO_EVERY_N` | Decididos entre reflexões | `10` |
| `RETRO_LESSON_CHARS` | Tamanho máx. da lição (220 cortava a receita no meio) | `400` |
| `BACKTEST_MIN_STOP_ATR` | Piso do stop dos scanners em múltiplos do ATR 1h | `1.5` |
| `BACKTEST_MIN_STOP_PCT` | Piso absoluto do stop dos scanners | `1.2` (%) |
| `ARB2_STARTING_USD` | Saldo inicial da simulação do Arbiter 2.0 (cenário real) | `300` |
| `ARB2_SIZE_USD` | Tamanho por perna (ciclo trava 2×) | `50` |
| `ARB2_COST_PCT` | Custo do ciclo completo (4 pernas + basis) | `0.45` (%) |
| `ARB2_EXIT_SPREAD_PCT` | Spread de convergência (fecha o hedge) | `0.05` (%) |
| `ARB2_MAX_HOLD_H` | Timeout do hedge | `48` (h) |
| `SNIPER_MIN_RR` | RR mínimo do sniper (alinhado ao ledger) | `2` |
| `RADAR_TRIGGER_PCT` | Gatilho do radar T3 | `1.5` (%) |
| `TIER_GATES_ENABLED` | Gate de tier no ZION user-facing (M7 — ligar pré-marketing) | off |

### Watchdog / proteção
| Var | O que é | Default |
|-----|---------|---------|
| `ALERT_AI_BUDGET_USD` | Alerta de custo IA 24h | `20` |
| `ALERT_AI_KILL_USD` | **Auto-pausa** o torneio acima disso (0 = off) | `30` |
| `AI_CB_THRESHOLD` | Falhas seguidas p/ tripar o breaker | `3` |
| `AI_CB_COOLDOWN_MIN` | Cooldown do breaker | `60` min |
| `ALERT_ERROR_SPIKE` / `ALERT_SEC_FLOOD` / `ALERT_LARGE_OP_USD` | Limiares de alerta | `10` / `5` / `5000` |

### Acesso ao painel admin

Três origens dão acesso, e **qualquer uma basta**:

| origem | como se concede | quando usar |
|---|---|---|
| `ADMIN_WALLETS` (env) | vírgula-separada, no Vercel | a que sobrevive a banco vazio |
| tabela `platform_admins` | pelo próprio painel | o caminho normal |
| `tier_cache.source='admin'` | legado | quem foi cadastrado antes da tabela existir |

⚠️ **Quem decide é `requireAdmin`, e só ele.** O middleware confere apenas se
existe SESSÃO válida — não confere permissão. Ele já decidiu no passado, com
base só na env, e isso trancou o dono para fora do próprio painel: as
concessões por `platform_admins` eram gravadas, mostravam sucesso e nunca
valiam nada, porque o 404 acontecia antes de `requireAdmin` rodar.
Ver `src/lib/admin/portao.test.ts` — há teste exigindo que o middleware não
volte a decidir.

⚠️ **Negativa é 404, nunca 403**, e fica registrada como `admin_access_denied`.
Se alguém legítimo levar 404, procure esse evento no painel de segurança: ele
diz qual carteira tentou.

### Taxa da plataforma (Fase 9)
| Var | O que é | Default |
|-----|---------|---------|
| `SWAP_FEE_RECIPIENT` | Para onde vai a taxa nas cadeias EVM. **Ausente = usa o endereço do código** (`0x904126D2…3c1F`), que é o comportamento correto | *(vazio)* |
| `SWAP_FEE_ACCOUNT_SOLANA` | Conta de token (ATA) da Solana. **Ausente = Solana não cobra taxa**, que é a decisão vigente | *(vazio)* |

⚠️ O endereço EVM mora no **código**, não no ambiente, de propósito: endereço de
recebimento é público por construção e o que ele precisa é ser conferível numa
revisão de PR. A variável existe só para trocar sem deploy — e se ela estiver
preenchida, é **ela** que recebe, não o código.

⚠️ Na Solana, `SWAP_FEE_ACCOUNT_SOLANA` exige uma **conta de token**, nunca uma
carteira. Pôr um endereço de carteira ali faz a Jupiter recusar a cotação. Os
quatro motivos de a Solana estar desligada estão em `MOTIVOS_SOLANA_SEM_TAXA`
(`src/lib/tier/fees.ts`) — é decisão, não pendência.

🔴 **A cobrança ainda não foi conferida na cadeia.** O protocolo está em
`docs/TESTE-DA-TAXA-EVM.md`. Até ele passar, o painel 💵 RECEITA DE TAXA mostra
aritmética sobre volume anterior à cobrança existir.

---

## 2. Crons (cron-job.org — fonte ÚNICA de agendamento)

| Endpoint | Cadência | Auth | Stall alert |
|----------|----------|------|-------------|
| `POST /api/autopilot/cron` | 5 min | header `Authorization: <CRON_SECRET>` (com ou sem `Bearer `) | >12 min |
| `POST /api/dca/cron` | 5 min | mesmo `CRON_SECRET` | >20 min | ⚠️ **AINDA NÃO AGENDADO** — ver §2.1 |
| `POST /api/zion/backtest` | 30 min | idem | >75 min |
| `POST /api/radar` | 1 min | idem | >5 min |

GitHub Actions: `schedule` DESATIVADO nos dois workflows (só `workflow_dispatch`
manual). NÃO reativar sem desligar o cron-job.org — daria tick duplicado.

### 2.1 Como agendar o cron do DCA (pendente)

**Enquanto este job não existir, nenhum plano de DCA roda.** A tela do usuário
avisa isso em vermelho, mas o recurso está pronto e parado.

No **cron-job.org**, criar um job novo:

| campo | valor |
|---|---|
| Title | `z-swap · DCA` |
| URL | `https://swap-z-app.vercel.app/api/dca/cron` |
| Schedule | a cada **5 minutos** (`Every 5 minutes`) |
| Request method | **POST** |
| Header | `Authorization` = o valor de `CRON_SECRET` |
| Timeout | 60 s (a rota declara `maxDuration = 60`) |
| Treat redirects as success | **não** |
| Save responses | sim — ajuda a ler o `resumo` quando algo estranhar |

⚠️ **O header vai SEM `Bearer `**, igual aos outros três. O `autorizado()` da
rota aceita os dois formatos, mas manter o padrão evita que alguém "conserte" o
que não está quebrado.

⚠️ **NÃO reaproveitar o job do autopilot mudando a URL.** São produtos
separados de propósito: se um cair, o outro tem de seguir.

**Conferir que pegou**, nesta ordem:

1. cron-job.org → histórico do job → HTTP **200** com corpo `{"ok":true,...}`.
   `401` = header errado. `{"ok":true,"paused":true}` = o `pause_dca` está
   ligado no painel.
2. Admin → **SISTEMA · System Health** → o heartbeat `dca` tem de aparecer com
   data de minutos atrás.
3. Sem plano nenhum, o corpo é `{"ok":true,"processed":0,"resumo":[]}`. Isso é
   o esperado — **não** é sinal de problema.

⚠️ **O watchdog só acusa `dca` parado desde 24/08**, quando a chave entrou em
`CRON_STALE_MIN`. Antes disso o RUNBOOK dizia ">20 min" e o código não fazia
nada — documento afirmando o que o código não faz.

### 2.2 T3 do cofre de credenciais — remover `creds_cipher`

Último passo da virada descrita em `docs/PLANO-DCA-AUTOMATICO.md` §2.
**Depende de MEDIÇÃO, não de calendário.**

**O que já está feito (T1 e T2):** a chave vive em `cex_conexoes`; armar uma
sessão de autopilot grava nos DOIS lugares; a leitura prefere o cofre e cai em
`autopilot_sessions.creds_cipher` quando não há elo; e cada passada do cron
grava um evento `cofre_origem_credencial` com a conta.

**O critério, e ele é único:**

```sql
select
  sum((metadata->>'cofre')::int)  as pelo_cofre,
  sum((metadata->>'sessao')::int) as pelo_campo_velho,
  sum((metadata->>'erro')::int)   as erro,
  count(*)                        as passadas,
  min(created_at)                 as desde
from platform_events
where event_type = 'cofre_origem_credencial'
  and created_at > now() - interval '7 days';
```

Só seguir quando, por **sete dias corridos**:

- `pelo_campo_velho = 0`
- `erro = 0`
- `passadas > 0` ⚠️ **e esta é a que se esquece.** Zero passadas significa que
  a medição nunca aconteceu — não que ela deu zero. É a invariante nº 33, e é
  exatamente a situação de hoje: o banco tem ZERO sessões de autopilot, então o
  contador nunca gravou nada.

**Se `pelo_campo_velho > 0`:** existe sessão sem elo com o cofre. Achar com

```sql
select id, wallet_address, exchange_id, updated_at
  from autopilot_sessions
 where is_active and conexao_id is null;
```

O conserto é o dono re-armar aquela sessão — a escrita dupla cria o elo. **Não**
fazer backfill à mão sem conferir que a chave da sessão ainda é a boa: se ela
foi rotacionada fora do app, copiar o campo velho para o cofre propaga uma
credencial morta.

**Quando o critério bater**, nesta ordem:

1. Migration `alter table autopilot_sessions alter column creds_cipher drop not null;`
   e nada mais. **Não apagar dado ainda.**
2. Deploy que remove `decryptSessionCreds` e o ramo de queda em
   `credenciaisDaSessao` — a leitura passa a exigir `conexao_id`.
3. **Esperar mais sete dias** com isso em produção. É a janela de arrependimento:
   o dado velho ainda está lá se algo aparecer.
4. Só então `alter table autopilot_sessions drop column creds_cipher;`

⚠️ **O passo 3 não é excesso de zelo.** Entre 2 e 4 o `rollback` é um deploy;
depois de 4 é restaurar backup do banco. A diferença entre os dois é a razão de
o passo existir.

---

## 3. Playbook de incidente

**"AI model down — auth rejected/no credits" (Telegram)**
1. O note agora distingue: `no credits / billing` → recarregar no console do
   provedor; `auth rejected` → conferir a chave na Vercel.
2. O circuit breaker já parou de martelar o provedor (pula por 60min).
3. Consertou? Painel admin → AI CONTROLS → CIRCUIT BREAKERS → **RESET**.
4. Não quer usar o provedor agora? AI CONTROLS → TORNEIO **OFF**.

**"Cron stalled" (Telegram)**
1. cron-job.org → conferir se o job disparou e o status HTTP.
2. 401 = `CRON_SECRET` divergente. Timeout do pinger é normal (rota responde
   em <1s com waitUntil; se o pinger diz timeout mas o heartbeat anda, ignora).
3. Heartbeat visível em SYSTEM HEALTH no painel.

**"AI budget KILL — tournament AUTO-PAUSED"**
1. Ver FINANCE (estimativa) e o console dos provedores (real).
2. Foi legítimo (rodada cara)? subir `ALERT_AI_KILL_USD` e religar o torneio.
3. Foi loop/bug? investigar `platform_events` antes de religar.

**Backtest com 0 cards / expectancy estranha**
1. BACKTEST panel → aba FEED: tem sugestão nova? status?
2. Suspeita de preço podre → conferir `ref_price` das linhas novas vs mercado.
3. Guardas ativas: escala >25% off = rejeitado; R:R<1 = rejeitado; vela 5min;
   stop-first pessimista. Tudo coberto por testes (`npm test`).

**Deploy quebrado**
1. CI roda lint + type-check + testes em todo push no main — ver a aba Actions.
2. Rollback: Vercel → Deployments → promote no anterior.

---

## 3b. Erros de cliente (telemetria)

Crashes de browser (`window.onerror` / `unhandledrejection`) são enviados a
`/api/telemetry/error` (5/min/IP, máx 5 por page-load, campos whitelisted) e
caem em `platform_events` como `error` com `meta.source = "client"` — visíveis
no painel LOGS & SECURITY e cobertos pelo alerta de error-spike do watchdog.
**Upgrade opcional:** instalar `@sentry/nextjs` + DSN quando quiser stack
traces agrupados/sourcemaps; o reporter atual é deliberadamente leve (zero deps).

## 4. Comandos úteis

```bash
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npm test             # vitest (money-math)
```
