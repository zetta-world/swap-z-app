# ADMIN UI — inventário dos painéis, estados e lacunas (R3 / R0.2)

> **Classe proposta:** SUPPORTING_REFERENCE (inventário gerado do código). **Não** é estado atual, **não** é
> certificação e **não** autoriza mudança. Autoridade de estado: `docs/START-HERE.md` + `CURRENT-STATE.md`.
>
> **Base:** branch `claude/admin-command-center-2-20261025` @ `ec63cb9` (= `main` `10ebd12` + plano). Gerado em
> 25/10/2026 e **reverificado em 26/10/2026** contra o mesmo SHA (scanners re-executados com saída idêntica; cada
> achado P0/P1 relido no código; correções na seção 10). Plano: `docs/PLANO-ADMIN-COMMAND-CENTER-2-20261025.md`
> (R3, R0.2). Dado bruto por painel: `panels.json` (scratchpad da missão, seção 11).
>
> **Mobile e acessibilidade são INFERIDOS do código**, não medidos em dispositivo nem com leitor de tela. O banco
> hospedado **não** foi consultado nesta etapa (inventário de UI); riscos de truncamento são estruturais, não contagens.

## 1. Números — reconciliação com o handoff

| Item | Handoff (§1) | Medido no código | Diferença | Evidência |
|---|---|---|---|---|
| `*Panel.tsx` | 57 | **57** | 0 | `src/components/admin/panels/` |
| `ModuleId` / `MODULE_REGISTRY` | — | **57 / 57** | — | `src/lib/admin/modules.ts:3-60`, `:102-656` |
| Entradas em `PANELS` | — | **57** (todas importadas) | — | `src/components/admin/panel-map.tsx:76-134` |
| Áreas | 9 | **9** | 0 | `src/lib/admin/areas.ts:69-138` |
| `route.ts` em `/admin/api` | 66 | **66** | 0 | `find src/app/admin/api -name route.ts` |
| Rotas com consumidor na UI | — | **65** (1 órfã: `POST /admin/api/tendencia`) | — | 59 por fetch literal em painel + `stats` (`useAdminStats.ts:40`) + `lab/ultima` (`AvisoRodadaNova.tsx:32`) + 4 via `` `/admin/api/${rota}` `` (`LigasPanel.tsx:84`) |
| Páginas `/admin` | — | 4 `page.tsx` + `layout.tsx`; **0** `error.tsx` | — | `src/app/admin/{page,layout}.tsx`, `area/[area]/page.tsx`, `area/[area]/[painel]/page.tsx`, `mural/page.tsx` |
| Testes de guarda da UI admin | — | **16 arquivos · 161 testes · PASS** | — | `npx vitest run` (lista na seção 8), 26/10 |

Painéis por área (`contagemPorArea()`, executado via jiti): comando **3** · mesas **8** · celeiro **1** · ulfhednar **1** ·
medicoes **15** · dinheiro **7** · operacao **4** · pessoas **5** · sistema **13** = 57. Só `platform-events` nasce
desligado (`defaultEnabled: false`, `modules.ts:521`). **MEDIÇÕES está no teto** de `areas.test.ts:116` (>15 reprova):
o próximo painel de medição quebra o teste.

## 2. Como a UI é montada hoje

| Camada | Arquivo | Papel |
|---|---|---|
| Registro | `src/lib/admin/modules.ts` | id, título, ícone, `category` (11), ordem, ligado por padrão |
| Áreas | `src/lib/admin/areas.ts` | `AREA_DA_CATEGORIA` (`:148-160`) + exceções por nome `MESAS`/`CELEIRO`/`ULFHEDNAR` (`:183-218`) |
| Desenho | `src/components/admin/panel-map.tsx` | `id → <Painel/>` (fonte única) |
| Casca | `src/components/admin/AdminShell.tsx` | header (carteira, LIVE/SYNC/POLL, ⌘K) + `AreaNav` + `<main>` + `AdminCommandBar` |
| Rotas de tela | `src/app/admin/page.tsx` (9 cartões de área) · `area/[area]/page.tsx` (LISTA ou `?all=1`) · `area/[area]/[painel]/page.tsx` (tela cheia + migalha + ‹ ›) · `mural/page.tsx` | |
| Grade | `ModuleGrid.tsx` via `DashboardClient.tsx` | só usada em `?all=1` (com `only`) |
| Moldura | `TerminalPanel.tsx` | título, fonte, "há Xs", ↻, bolinha "desligar painel" |
| Atualização | `useAutoRefresh.ts` (pausa com aba oculta, estrangula pings) · `useAdminStats.ts` · `AdminRealtimeProvider.tsx` (broadcast `admin:refresh`) | |
| Layout salvo | `src/lib/store/admin-layout.ts` (`admin-layout-v1` em localStorage, `reconciliar` testado) | |
| Isolamento de erro | **nenhum** | sem `error.tsx` em `src/app/admin`, sem `ErrorBoundary` em `components/admin`: um `throw` de render em 1 painel cai no `src/app/global-error.tsx` e some a tela inteira |

## 3. Tabela dos 57 painéis

Legenda — **Atualiza:** `I45` = `setInterval` 45 s **sem** pausa de aba · `A90` = `useAutoRefresh` 90 s · `S60` =
`useAdminStats` (60 s, um fetch **por instância**) · `M` = só na montagem · `D` = sob demanda (botão) · `F+RT` = por filtro
+ realtime. **Falha de fetch (cliente):** `E` = erro explícito · `E+V` = erro **e** dado anterior sem rótulo de velho ·
`E+falso` = erro **e** controles renderizados com estado inventado · `S→falso` = silencioso (sem `res.ok`), mostra
estado falso · `crash` = JSON de erro derruba o render. **Servidor (rota):** `C` = confirmado que engole o `error` do
Supabase e devolve 200 com 0/vazio · `P` = parcial (livro principal falha fechado, leituras auxiliares ou truncamento
não) · `N` = não mascara (5xx ou estado explícito) · `—` = n/a. `·W` = painel tem escrita.
**Risco "falha vira zero":** ver seção 4.

| # | Área | Módulo | Painel | Rotas `/admin/api` | Atualiza | Falha fetch | Servidor | Risco |
|---|---|---|---|---|---|---|---|---|
| 1 | comando | `command` | CommandPanel | command | I45 | E+V | C | **P0** |
| 2 | comando | `mural-global` | MuralPanel | mural | I15 | E | C | **P2** |
| 3 | comando | `tier-hub` | TierHubPanel | tier-hub | M | E | N | **OK** |
| 4 | mesas | `aprendizado` | AprendizadoPanel | aprendizado | A120 | E | P | **P2** |
| 5 | mesas | `launch-gate` | LaunchGatePanel | launch-gate | I300 | E | P | **P2** |
| 6 | mesas | `arbiter-cohort` | ArbiterCohortPanel | arbiter-cohort, arbiter-median, paper-reset, venue-truth ·W | A90 | E | P | **P2** |
| 7 | mesas | `paper` | PaperPanel | paper, paper-recap, paper-repair ·W | I60/90 | E | P | **P2** |
| 8 | mesas | `ragnarok` | RagnarokPanel | ragnarok | I180 | E | P | **P2** |
| 9 | mesas | `tournament` | TournamentPanel | tournament | I120 | E | P | **P2** |
| 10 | mesas | `rendimento` | RendimentoPanel | rendimento ·W | D | E | N | **OK** |
| 11 | mesas | `ligas` | LigasPanel | depth-census, perp-census, maker-backtest, venue-probe ·W | D | E | N | **OK** |
| 12 | celeiro | `celeiro` | CeleiroPanel | celeiro | A60 | E | P | **P2** |
| 13 | ulfhednar | `ulfhednar` | UlfhednarPanel | ulfhednar ·W | M | E | N | **OK** |
| 14 | medicoes | `lab` | LabPanel | lab | A90 | E | P | **P2** |
| 15 | medicoes | `playbook-backtest` | PlaybookBacktestPanel | playbook-backtest ·W | D | E | N | **OK** |
| 16 | medicoes | `backtest` | BacktestPanel | backtest | I120 | E | P | **P2** |
| 17 | medicoes | `calibration` | CalibrationPanel | calibration ·W | D | E | N | **OK** |
| 18 | medicoes | `what-worked` | WhatWorkedPanel | what-worked ·W | D | E | N | **OK** |
| 19 | medicoes | `funding` | FundingPanel | funding ·W | D | E | N | **OK** |
| 20 | medicoes | `combinacao` | CombinacaoPanel | combinacao ·W | D | E | N | **OK** |
| 21 | medicoes | `taxa-cex` | TaxaCexPanel | taxa-cex | D | E | N | **OK** |
| 22 | medicoes | `derrapagem` | DerrapagemPanel | derrapagem | D | E | N | **OK** |
| 23 | medicoes | `descartadas` | DescartadasPanel | descartadas | D | E | N | **OK** |
| 24 | medicoes | `variancia` | VarianciaPanel | variancia ·W | D | E | N | **OK** |
| 25 | medicoes | `dex-cex` | DexCexPanel | dex-cex ·W | D | E | N | **OK** |
| 26 | medicoes | `liquidez` | LiquidezPanel | liquidez ·W | D | E | N | **OK** |
| 27 | medicoes | `pro-piscinas` | ProPiscinasPanel | pro-piscinas ·W | D | E | N | **OK** |
| 28 | medicoes | `rotacao-grade` | RotacaoGradePanel | rotacao-grade ·W | D | E | N | **OK** |
| 29 | dinheiro | `ai-cost` | AiCostPanel | finance | I300 | E+V | C | **P1** |
| 30 | dinheiro | `margin` | MarginPanel | margin ·W | A90 | E | C | **P1** |
| 31 | dinheiro | `tier-dist` | TierDistPanel | stats (hook) | S60 | E | C | **P2** |
| 32 | dinheiro | `market-volume` | MarketVolumePanel | api.llama.fi (externo, direto do navegador) | M | E | — | **P2** |
| 33 | dinheiro | `ops-ledger` | OperationsLedgerPanel | ledger | I60 | E+V | C | **P1** |
| 34 | dinheiro | `receita-taxa` | ReceitaPanel | receita | A90 | E | C | **P0** |
| 35 | dinheiro | `finance` | FinancePanel | finance, ledger/export (link CSV) | I120 | E+V | C | **P1** |
| 36 | operacao | `autopilot-activity` | AutopilotPanel | stats (hook) | S60 | E | C | **P1** |
| 37 | operacao | `autopilot-liberacao` | LiberacaoPanel | autopilot-liberacao ·W | M | E | N | **OK** |
| 38 | operacao | `live-ops` | OperationsPanel | operations | I30 | E+V | C | **P1** |
| 39 | operacao | `cex-sessions` | CexSessionsPanel | stats (hook) | S60 | E | C | **P1** |
| 40 | pessoas | `wallets-kpi` | WalletsKpiPanel | stats (hook) | S60 | E | C | **P2** |
| 41 | pessoas | `users-explorer` | UsersPanel | users | M | E | C | **P2** |
| 42 | pessoas | `growth` | GrowthPanel | growth | I120 | E | N | **OK** |
| 43 | pessoas | `traffic` | TrafficPanel | traffic | I120 | E | C | **P2** |
| 44 | pessoas | `early-access` | EarlyAccessPanel | early-access, …/export, …/transition ·W | F+RT | E | N | **OK** |
| 45 | sistema | `alerts` | AlertsPanel | alerts, alert-test ·W | I60 | E | C | **P2** |
| 46 | sistema | `audit-bench` | AuditBenchPanel | audit-bench ·W | D | E | — | **OK** |
| 47 | sistema | `platform-events` | PlatformEventsPanel | analytics | I60 | E | C | **P2** |
| 48 | sistema | `swap-guard` | SwapGuardPanel | swap-guard ·W | I120 | E | P | **P2** |
| 49 | sistema | `admin-access` | AdminAccessPanel | admins ·W | M | E | C | **P1** |
| 50 | sistema | `tier-control` | TierControlPanel | tier ·W | D | E | P | **OK** |
| 51 | sistema | `whitelist` | WhitelistPanel | whitelist | M | S→falso | — | **P1** |
| 52 | sistema | `ai-controls` | AiControlsPanel | killswitch, ai-circuit ·W | M | E+falso | C | **P0** |
| 53 | sistema | `kill-switches` | KillSwitchesPanel | killswitch ·W | M | E+falso | C | **P0** |
| 54 | sistema | `swap-allowlist` | SwapAllowlistPanel | swap-allowlist ·W | M | S→falso / crash | C (POST) | **P1** |
| 55 | sistema | `audit-log` | AuditLogPanel | audit | I30 | E | N | **OK** |
| 56 | sistema | `logs-security` | LogsSecurityPanel | logs | I45 | E+V | C | **P1** |
| 57 | sistema | `system-health` | SystemHealthPanel | health | I45 | E+V | P | **P1** |

Totais: **P0 4 · P1 12 · P2 18 · OK 23.** Dado fictício/mock: **nenhum** (grep `mock|fake|Math.random|lorem|demo`).
Conteúdo estático que pode mentir: `whitelist` (texto de política), `tier-dist` (rodapé), `finance` (rótulo), seção 4.

## 4. "Falha vira zero" — lista priorizada

**P0 — controle ou dinheiro com estado inventado na falha**

| # | Painel | O que o operador vê quando a leitura falha | Evidência |
|---|---|---|---|
| 1 | KillSwitchesPanel | Os 3 interruptores **OFF** e clicáveis. A rota devolve `200 {switches:{}, note}` em erro de `admin_kv`; o painel parte de `false`; o toggle calcula `next = !undefined` → envia `enabled:true` (ADM-004). Nunca relê (só montagem). | `KillSwitchesPanel.tsx:16-20`, `:32`, `:44`, `:87-109`; `killswitch/route.ts:41-44` |
| 2 | AiControlsPanel | Os 19 gates **ON (rodando)**, inclusive `pause_dca`, `pause_bancada` (dinheiro real) e `pause_zion`. Disjuntores somem. Toggle **sem confirmação**; reset de disjuntor falha em silêncio. | `AiControlsPanel.tsx:48-50`, `:63-66`, `:70-74`, `:79-89`, `:91-104`, `:119-141` |
| 3 | ReceitaPanel | Falha de leitura **ou truncamento** → rota 200 com `falha`; o bloco **VERIFICADO NA REDE some** (`verificacao=null`), **DECLARADO $0**, VOLUME REAL $0 / 0 operações e a frase "nenhuma operação com retenção gravada ainda". `falha` está no tipo e **nunca é renderizada** (ADM-014). | `ReceitaPanel.tsx:18`, `:109`, `:136-144`; `receita/route.ts:111-112`, `:142`, `:192-197`, `:214-215` |
| 4 | CommandPanel | **"ALL CLEAR"** verde se a leitura de segurança falhar; usuários, volume, P&L e custo de IA = 0. `operations` e `zion_analysis` 24h sem `range` (teto 1000) → P&L "ALL" e custo parciais. Sub-rótulo "Claude usage" para custo multi-modelo. | `CommandPanel.tsx:40`, `:53-55`, `:67`; `command/route.ts:21-45`, `:35-36`, `:76-85` |

**P1 — KPI financeiro, operacional ou de segurança vira 0/vazio/✓, ou amostra vira total**

| # | Painel | Sintoma | Evidência |
|---|---|---|---|
| 5 | SwapAllowlistPanel | Sem `res.ok`: corpo não-JSON → "⚠ OBSERVANDO — allowlist DESLIGADA" (estado de segurança inventado); **503 JSON → `data?.enforcing.targets` lança TypeError → tela inteira cai no global-error** (inferido); coleta POST sem `r.ok` → "✓ 0 coletadas" | `SwapAllowlistPanel.tsx:35`, `:41-43`, `:50`, `:69-73`; `swap-allowlist/route.ts:69` |
| 6 | LogsSecurityPanel | 0/0/0 e "No errors or security events in 24h. ✓" | `LogsSecurityPanel.tsx:66`; `logs/route.ts:35-49` |
| 7 | AdminAccessPanel | Leitura de `platform_admins`/legado falha → lista só os admins de ENV; quem não aparece não pode ser revogado | `admins/route.ts:20-23`, `:41-43`; `AdminAccessPanel.tsx:113` |
| 8 | WhitelistPanel | Sem `res.ok`: qualquer falha → "No ADMIN_WALLETS env var set — tier_cache.source='admin' is the only gate." (falso); o texto omite `platform_admins` | `WhitelistPanel.tsx:13-16`, `:28-35` |
| 9 | SystemHealthPanel | Supabase "up" com `ok: !!db` (sem consulta); heartbeat ilegível vira "never" (desconhecido ≠ nunca rodou) | `health/route.ts:42`; `lib/admin/health.ts:114-120`; `SystemHealthPanel.tsx:23` |
| 10 | OperationsPanel | Exposure $0 e "No open autopilot positions." (exposure soma só 50 posições) | `OperationsPanel.tsx:59`, `:69`; `operations/route.ts:14-31` |
| 11 | OperationsLedgerPanel | "No operations recorded yet."; `count: exact` (completo) ao lado de volume/P&L somados de ≤1000 linhas | `ledger/route.ts:14-15`, `:22-34` |
| 12 | FinancePanel | 0 SOL, $0 volume; "ALL-TIME" sobre amostra truncada; "ATTRIBUTED REVENUE" soma concessões de admin. **CSV contábil** (`⤓ CSV`): rota ignora `error` (CSV só com cabeçalho), `.limit(10_000)` acima do teto → truncado sem aviso, sem `logAdminAction`, carteira completa | `finance/route.ts:29-36`, `:111-118`; `FinancePanel.tsx:56`, `:68-79`, `:88`; `ledger/export/route.ts:20-23` |
| 13 | AiCostPanel | $0 em todos os períodos e "nenhuma chamada ainda"; `.limit(100_000)` sem ordem → recorte arbitrário de 1000 | `AiCostPanel.tsx:81-98`; `finance/route.ts:34` |
| 14 | MarginPanel | Custo de IA $0 → margem otimista. Edição: `.catch(()=>{})` sem `res.ok`; a rota não confere o `upsert`, responde ok **e audita** (padrão A25) | `MarginPanel.tsx:37-45`, `:98`; `margin/route.ts:21-26`, `:79-84` |
| 15 | AutopilotPanel | 0 sessões ativas, PNL $0, volume $0 | `stats/route.ts:17-41`, `:69-86` |
| 16 | CexSessionsPanel | "No autopilot sessions recorded yet." (esconde sessão ativa) | `CexSessionsPanel.tsx:29-34`; `stats/route.ts:40` |

**P2 — crescimento, telemetria ou laboratório (simulado)**

| Painel | Sintoma | Evidência |
|---|---|---|
| AlertsPanel | "No alerts fired yet. ✓" (também sem banco) | `alerts/route.ts:13-17` |
| WalletsKpiPanel / TierDistPanel | 0 signups / 0% por plano; rodapé "unexpired entries" é falso (a rota lê `tier_cache` sem filtro de validade) | `stats/route.ts:30-34`; `TierDistPanel.tsx:67-69` |
| UsersPanel · TrafficPanel · MuralPanel · PlatformEventsPanel | lista vazia / 0 acessos / 0 praças / `?? 0` por célula; `.limit(5_000|50_000)` no teto 1000; Traffic: falha ao ler admins → tráfego de admin contado como humano | `users/route.ts:80-86`; `traffic/route.ts:27-37`; `mural/route.ts:59-65`; `PlatformEventsPanel.tsx:108-110` |
| MarketVolumePanel | campo ausente vira "$0" (`?? 0`); dado de terceiro sob a faixa "REAIS da plataforma" | `MarketVolumePanel.tsx:25`; `areas.ts:120` |
| Tournament · Ragnarok · Paper · Backtest · Aprendizado · ArbiterCohort · LaunchGate | livro principal via `selectAllRows` (lança → 500 → erro na tela); leituras auxiliares sem `error` — ex.: `paper_accounts` falha → capital inicial vira $1000 padrão no torneio | `tournament/route.ts:147`, `:161-171`; `ragnarok/route.ts:77-88`; `paper/route.ts:47-67`; `lib/admin/launch-gate.ts:202-212` |
| LabPanel | última rodada ilegível → "nunca medida"; conferência que falha vira `[]`; o **GET grava** (`syncRegistry`) a cada poll de 90 s | `lab/route.ts:67-68`, `:85-88`; `lib/lab/store.ts:293-307` |
| CeleiroPanel | erro honesto (500), mas `.limit(20_000)` no teto 1000 → soma sobre recorte sem aviso | `celeiro/route.ts:93-101` |
| SwapGuardPanel | parcial: uma leitura confere `error`; POST da sonda sem `res.ok` | `SwapGuardPanel.tsx:42-44` |

**Causa raiz comum (server-side).** Rotas desestruturam `{ data }`/`{ count }` sem `error` e aplicam `?? 0`/`?? []`.
Leituras sem `range()` ou com `.limit(N)` acima do `db-max-rows` = 1000 (medido, `docs/COST-ENGINEERING-ROUND-REPORT.md:107`)
devolvem recorte sem aviso: **17 leituras em 13 arquivos** com `.limit` > 1000 (lista em `panels.json → shell`). A trava
`src/lib/supabase/read-safety.test.ts:49` só cobre `paper_positions`, `zion_suggestions`, `platform_events`,
`admin_audit_log` e aceita a anotação `// leitura-limitada:` — que hoje legitima o "ALL-TIME" de `finance/route.ts:32-34`.

**Referências corretas já no repo, para generalizar (sem reinventar):**
- `GrowthPanel` + `lib/admin/growth.ts`: `estado: completo|parcial|indisponivel`, `null → "—"`, faixa INCOMPLETO e 503 (`GrowthPanel.tsx:19`, `:58-62`; `growth/route.ts:51-55`).
- `LiberacaoPanel` + `lib/autopilot/liberacao.ts`: `causa: aberto|fechado_por_decisao|sem_registro|indisponivel`, com "NÃO consegui ler o banco (isto é infraestrutura, não decisão)" (`LiberacaoPanel.tsx:30-34`; `liberacao.ts:100-110`).
- `AuditLogPanel`/`TierHubPanel`: a rota devolve 5xx no erro e o painel mostra (`audit/route.ts:23`; `tier-hub/route.ts:96-99`).
- `selectAllRows` (`lib/supabase/paginate.ts:38-62`, lança em vez de devolver parcial) e `lerTodasPorChave` (`lib/supabase/paginar.ts:64`).

## 5. Padrões transversais (medidos)

| Tema | Número | Evidência / efeito |
|---|---|---|
| Polling por `setInterval` **sem** pausa de aba | **19** painéis | contraria `useAutoRefresh.ts:85-109` (aba oculta não sonda) |
| `useAutoRefresh` direto / via `useAdminStats` | 6 / 4 | `useAdminStats` guarda estado por instância: 2 fetches de `/admin/api/stats` na grade `?all=1` de OPERAÇÃO |
| Só montagem · sob demanda · por filtro | 10 · 17 · 1 | KillSwitches/AiControls nunca relêem: outro admin muda e a tela não sabe |
| `realtime.subscribe` direto, sem estrangulador | **4** (AuditLog, EarlyAccess, LogsSecurity, PlatformEvents) | canal `admin:refresh` criado sem `private: true` (`AdminRealtimeProvider.tsx:66-77`); cada ping = refetch |
| Painéis que mostram frescor ("há Xs") | **4/57** (os de `useAdminStats`) | 29 rotas devolvem `fetchedAt`; **nenhum** painel o exibe |
| Erro depois de dado carregado | 7 painéis `E+V` | dado velho continua, sem rótulo STALE |
| `fetch` sem checar `res.ok` | **5 chamadas em 4 painéis** | `MarginPanel.tsx:40`; `SwapAllowlistPanel.tsx:35`, `:41`; `SwapGuardPanel.tsx:42`; `WhitelistPanel.tsx:13` |
| Mesma rota em dois painéis | finance (AiCost+Finance), killswitch (KillSwitches+AiControls), stats (×4) | sem cache compartilhado |
| Escritas com `useAdminConfirm` | **4** painéis (AdminAccess, EarlyAccess, KillSwitches só ao ligar, TierControl) | — |
| Escrita sensível **sem** diálogo | ArbiterCohort "⌫ zerar os ledgers" (`paper-reset`), AiControls (19 gates, inclui DCA real), Paper repair, **Liberação do autopilot CEX ao público** (só motivo ≥15) | `ArbiterCohortPanel.tsx:107-125`, `:470-471`; `PaperPanel.tsx:167-172`; `LiberacaoPanel.tsx:56-72` |
| Escrita que falha em silêncio | Margin save, SwapAllowlist coleta, AiControls reset, ArbiterCohort zerar, Paper repair, Liberação (falha de rede sem `catch`) | `MarginPanel.tsx:37-45`; `AiControlsPanel.tsx:79-89`; `PaperPanel.tsx:167-172`; `LiberacaoPanel.tsx:56-69` |
| Diálogo de confirmação com foco em CONFIRM | `autoFocus` no botão destrutivo → Enter confirma | `useAdminConfirm.tsx:83-88` |
| Rótulo de custo de IA | 3 versões: "≈ ESTIMATIVA… NÃO é a fatura" × "medido… real" × "Claude usage" | `AiCostPanel.tsx:94`; `MarginPanel.tsx:98`; `CommandPanel.tsx:67` |
| Título divergente do registro | FinancePanel diz "RECEITA" (registro "FINANCE"), ao lado de "RECEITA DE TAXA" na mesma área | `FinancePanel.tsx:50`; código morto `:95-111` |
| Idioma | EN e PT misturados nos estados vazios ("No alerts fired yet" × "nenhuma chamada ainda") | — |

## 6. Recursos de UX existentes (verificado)

| Recurso | Existe? | Onde | Limitação |
|---|---|---|---|
| Busca / ⌘K | Sim | `AdminShell.tsx:22-34`, `AdminCommandBar.tsx` | **Não navega**: Enter/clique **liga/desliga** o painel no layout local (`AdminCommandBar.tsx:28-34`) — e na LISTA e na tela do painel isso não tem efeito visível (só `?all=1` lê `enabled`); filtra só título+subtítulo, sem área/id, sem normalizar acento; input sem rótulo; `listbox` sem `aria-activedescendant`; sem trap de foco |
| Favoritos | **Não** | — | `reorderModule`/`resetLayout` existem no store e **não têm UI** (`admin-layout.ts:118-128`) |
| Migalha | Parcial | `area/[area]/[painel]/page.tsx:50-57` | só na tela do painel; não é `<nav aria-label>`; sem `aria-current` |
| Vizinhos ‹ › | Sim | `[painel]/page.tsx:62-77` | nome acessível = emoji + `title` |
| Filtros | Parcial | chips de categoria em `ModuleGrid.tsx:58-93` | **chips e faixas lab/bancada/mercado estão mortos**: `DashboardClient` só é usado com `only` (`area/[area]/page.tsx:73`), que esconde os chips; filtros locais (EarlyAccess, dias em Backtest/Tournament/Ragnarok, horas em SwapGuard) não vão para a URL |
| Deep link | Sim | `/admin/area/<área>`, `?all=1`, `/admin/area/<área>/<módulo>` (404 se área errada, `[painel]/page.tsx:40`), `/admin/mural` | aba/filtro interno sem URL; título da aba "Control Panel · Z-SWAP" em toda área/painel (`layout.tsx:6` + template raiz; inferido) |
| Contagem por área | Sim | `AreaNav.tsx:54-59`, `page.tsx:58-60` | — |
| Indicador realtime | Sim | `AdminHeader.tsx:33-44` | — |
| Layout persistido | Sim | `admin-layout-v1` (localStorage) | por navegador, não por identidade; `setItem` sem `try/catch` |
| Painel declarado e não desenhado | Sim | `PainelSozinho.tsx:31-58` + teste | — |
| Bolinha "desligar painel" | Sim | `TerminalPanel.tsx:32-38` | na tela do painel sozinho nada some (`PainelSozinho` ignora `enabled`), mas o painel some da grade `?all=1` sem aviso |
| Logout / sessão no header | **Não** | `AdminHeader.tsx` mostra só a carteira truncada | R1 |
| Isolamento de falha por painel | **Não** | sem `error.tsx`/`ErrorBoundary` | um painel que lança derruba a tela (ver SwapAllowlist) |

## 7. Acessibilidade e mobile (inferidos do código)

**Acessibilidade**

| Achado | Número | Evidência |
|---|---|---|
| Cabeçalhos `<h1>-<h6>` no shell/páginas/painéis | **0** (só `TierHubPanel`, 2, e `MuralView`) | títulos são `<span>` (`TerminalPanel.tsx:44`) |
| `aria-live` / `role=status|alert` para erro e sucesso | **0** | mensagens de erro são `<div>` coloridos |
| `onClick` em elemento não-botão | **14** (8 `tr`, 5 `div`, 1 `span`) em 14 painéis | ex.: `UsersPanel.tsx:169`, `LaunchGatePanel.tsx:71-72`, `MarginPanel.tsx:62` (valor editável só por mouse) |
| Campos sem `label`/`aria-label` | **15/17** (só `LiberacaoPanel.tsx:144-147` e `PaperPanel.tsx:384-387` envolvem em `<label>`) | AdminAccess 2, EarlyAccess 5, Liberacao 3, Ulfhednar 2, Margin, TierControl, Users |
| Tabelas com `<caption>`/`scope` | **0/54** | — |
| Botão focável dentro de `aria-hidden` | 1 (bolinha "desligar painel", em todos os 57) | `TerminalPanel.tsx:32-38` |
| Interruptores sem `role=switch`/`aria-pressed` | KillSwitches, AiControls | estado só por cor + texto |
| Navegação sem `aria-current` | AreaNav e migalha | `AreaNav.tsx:45-61` |
| Skip link | Não | `AdminShell.tsx` |
| `prefers-reduced-motion` | **não** em `admin.css` (9 `animation:`: cometa, valknut, pulso, shimmer…); carrossel de 6 s no TierHub | só `mural.css:257`, `:338` |
| Fonte < 10 px em CSS | **22 regras** (ex.: `.adm-panel-subtitle` 9 px, `.adm-panel-title` 10 px no limite, `.adm-table th` 8 px) | `admin.css`; `legibilidade.test.ts:120-124` só varre `fontSize` inline |
| Lint de a11y | `eslint-config-next` liga só **6** regras de `jsx-a11y` (alt-text, aria-props, aria-proptypes, aria-unsupported-elements, role-has-required-aria-props, role-supports-aria-props); `eslint.config.mjs` não acrescenta nenhuma | sem `click-events-have-key-events`, `no-static-element-interactions`, `label-has-associated-control`: por isso os 14 `onClick` e 15 campos passam no lint |

**Mobile (360 px)**

| Achado | Evidência |
|---|---|
| `?all=1` usa `minmax(400px, 1fr)` → **coluna maior que a tela** (overflow horizontal); o `@media (max-width: 860px)` "collapse to single column" só mexe no header | `ModuleGrid.tsx:100`; `admin.css:836-851` |
| Menu de áreas = 10 links que quebram linha; "menu de bandeja" pendente | `AreaNav.tsx:31-62`; `PLANO-PAINEL-POR-AREA.md:108` |
| Subtítulo do painel com `flex-shrink: 0` → o **título** vira "…" primeiro (até 560 px, onde o subtítulo some) | `admin.css:186-205`, `:846-849` |
| Rolagem aninhada (página + `.adm-panel` 78vh + `.adm-panel-body` `overflow:auto`) | `admin.css:221-227` |
| Grades `repeat(4,1fr)` e larguras fixas | `SwapGuardPanel.tsx:113`; `PaperPanel.tsx:534`; `TournamentPanel.tsx:430`; `AprendizadoPanel.tsx:109-112` (150+130 px); `EarlyAccessPanel.tsx:243` (min 260) |
| Tabelas largas | 54 `<table>` rolam **dentro** do corpo do painel — não estouram a página; `CeleiroPanel.tsx:464` usa `minWidth: 700` |

## 8. Testes de guarda existentes (16 arquivos, 161 testes, PASS em 26/10)

| Arquivo | Trava |
|---|---|
| `src/lib/admin/areas.test.ts` | todo módulo em 1 área; toda categoria mapeada; MESAS≠MEDIÇÕES; sem id fantasma; ≤15 por área; área não vazia; pergunta; avisos |
| `src/lib/admin/painel-desenhado.test.ts` | registro ↔ `panel-map` ↔ imports ↔ `ModuleId`; alcançável por exatamente uma área |
| `src/lib/store/admin-layout.test.ts` | `reconciliar`: módulo novo entra no lugar, layout do dono sobrevive |
| `src/app/admin/admin-css.test.ts` | toda classe `adm-*` usada existe no CSS |
| `src/app/admin/botoes-distintos.test.ts` | rótulos de botão únicos entre painéis; recapitalizar desabilitado sem motivo |
| `src/app/admin/tabela-com-amostra.test.ts` | tabela que ranqueia mostra o n |
| `src/lib/admin/legibilidade.test.ts` | contraste dos tokens; `fontSize` inline ≥10; teto de altura do painel |
| `src/lib/admin/cor-resultado.test.ts` | perder dinheiro nunca é verde |
| `src/lib/admin/mesa-contra-segurar.test.ts` | cor das mesas contra "segurar" (`TournamentPanel`) |
| `src/components/admin/refresh-gap.test.ts`, `rodada-nova.test.ts` | estrangulador; aviso de rodada nova |
| `src/components/admin/panels/early-access-panel.test.ts` | contrato do painel de early access (AbortController) |
| `src/app/admin/api/admins/revogar-nao-pode-mentir.test.ts` | revogação conferida e auditada depois (lê `AdminAccessPanel`) |
| `src/app/admin/api/receita/arrecadacao.test.ts`, `src/lib/admin/atribuicao.test.ts` | arrecadado = soma de parcela; anônimo fora (lê `ReceitaPanel`/`MuralView`) |
| `src/lib/supabase/read-safety.test.ts` | leitura sem `range` em 4 tabelas que crescem precisa de anotação |

**Faltam travas para:** (a) painel/rota que transforma falha em 0 (ADM-004, ADM-014) — nenhum teste lê `falha`
no `ReceitaPanel`; (b) `fetch` sem `res.ok` e escrita sensível sem confirmação; (c) piso de fonte nas regras de **CSS**;
(d) regras de a11y do `jsx-a11y` acima; (e) `read-safety` sobre `operations`, `users`, `tier_cache`, `autopilot_*` e
`.limit(N > 1000)`; (f) isolamento de erro por painel.

## 9. Lacunas por área (R3) e AI Control Center

| Área (pergunta) | n | Lacuna contra o handoff §3/R3 | Proposta reaproveitando o que existe |
|---|---|---|---|
| COMANDO ("o que precisa da minha atenção agora?") | 3 | Sem fila de atenção (top-5, dono, última evidência) e sem "alterações recentes"; cartões sem semântica (verificado/declarado/estimado/indisponível); "ALL CLEAR" de 2 sinais e mascarável; `tier-hub` é vitrine comercial | contrato de estado no `CommandPanel`; bloco de alterações recentes lendo `/admin/api/audit` (já honesto) |
| SISTEMA ("travas, auditoria, saúde e registro") | 13 | Mistura identidade (`admin-access`, `whitelist`, `tier-control`), controles, bancada e logs; kill switch sem tri-state nem "estado observado pelo consumidor"; Supabase sem ping; audit log só com HORA, 30 linhas, sem filtro/payload (`AuditLogPanel.tsx:84`) | subgrupos por ordem na mesma área (sem área nova); fundir o texto de `whitelist` no `admin-access` (a rota já devolve as 3 fontes) |
| DINHEIRO ("quanto entrou, quanto custou, quanto sobrou?") | 7 | Dois "RECEITA"; `market-volume` (terceiro) sob a faixa "REAIS da plataforma" (`areas.ts:120`, `AREA_DA_CATEGORIA.mercado`); custo de IA com 3 rótulos; sem abas verificado/conciliação/custos/projeção; CSV por `<a>` direto, truncado e sem trilha | rótulos ESTIMATED/BILLED; export auditado e paginado; mover `mercado` exige decisão (teste de área) |
| OPERAÇÃO ("o autopilot e as sessões estão saudáveis?") | 4 | Sem execução real de swap (cotação→assinatura→envio→confirmado/incerto), reconciliador, filas/locks; crons estão em SISTEMA; liberação ao público sem diálogo | `LiberacaoPanel` como padrão de estado + `useAdminConfirm`; reutilizar crons de `/admin/api/health` |
| PESSOAS ("quem usa, quanto cresce, em que plano?") | 5 | `users-explorer` expõe carteira (truncada na tela, completa na resposta) + caminhos navegados por carteira; `early-access` mostra e-mail; sem segregação de papel | R2: `users.support.read`/`analytics.read` + mascaramento no servidor |
| MEDIÇÕES | 15 | **No teto do teste**; rodapé de metodologia/janela heterogêneo; `LabPanel` grava a cada GET | decidir teto ou divisão antes de novo painel |
| MESAS · CELEIRO · ÚLFHÉÐNAR | 8·1·1 | manter (handoff §3); "zerar" sem confirmação; Celeiro truncado no teto | `useAdminConfirm` + `paper.manage` (R2); paginação |

**AI Control Center — já existe, espalhado:** `AiCostPanel` (DINHEIRO) · `AiControlsPanel` com 19 gates e disjuntores
(SISTEMA, `/admin/api/ai-circuit`) · "AI COST 24H" no `CommandPanel` · linha de IA no `MarginPanel` ·
`lib/admin/ai-cost.ts` (`estimateCost`). A rota `finance` **já calcula e o painel não mostra**: `calls` por período,
`bySource` e `tokens {input, output, cacheRead, cacheWrite}` (`finance/route.ts:66-95`; o painel só mostra chamadas por
modelo). O evento `zion_analysis` já grava `cacheHit` (`src/app/api/zion/route.ts:494-496`), base para "economia por
cache". **Não existe** latência no evento (p50/p95 exige instrumentação), nem fatura de fornecedor (BILLED), nem
orçamento. Integração recomendada: **um módulo** (não área nova) que reaproveita `finance` + `ai-circuit` + gates, com
rótulo ESTIMATED explícito e paginação real de `platform_events`.

## 10. Reverificação de 26/10 — o que mudou em relação à versão de 25/10

| Item | 25/10 | 26/10 (medido) | Evidência |
|---|---|---|---|
| Campos sem rótulo | 17/17 | **15/17** | `LiberacaoPanel.tsx:144-147`, `PaperPanel.tsx:384-387` |
| Testes de guarda | 12 arquivos · 118 | **16 arquivos · 161** (os 12 seguem 118 PASS) | +`revogar-nao-pode-mentir`, `arrecadacao`, `atribuicao`, `mesa-contra-segurar` |
| ReceitaPanel na falha | "0 verificadas" | bloco VERIFICADO **some** | `ReceitaPanel.tsx:109`; `receita/route.ts:142` |
| SwapAllowlistPanel | só "allowlist DESLIGADA" | + **crash** de render no 503 | `SwapAllowlistPanel.tsx:50` |
| FinancePanel | — | CSV sem `error`, truncado, sem auditoria | `ledger/export/route.ts:20-23` |
| CeleiroPanel | OK | **P2** (teto 1000 sob `.limit(20_000)`) | `celeiro/route.ts:93-99` |
| Mesas/medições "H" | heurístico | **P** confirmado (livro falha fechado; auxiliares não) | seção 4 |
| Users/Traffic | H | **C** confirmado | `users/route.ts:80-86`; `traffic/route.ts:27-36` |
| Liberação autopilot | "motivo mínimo" | escrita de dinheiro real **sem diálogo**; rede sem `catch` | `LiberacaoPanel.tsx:56-72` |
| Totais de risco | P0 4 · P1 12 · P2 17 · OK 24 | **P0 4 · P1 12 · P2 18 · OK 23** | `panels.json → meta.risk_totals` |

Números do handoff (57 · 66 · 9): **sem diferença**.

## 11. Reprodução (READ-ONLY)

Scratchpad: `/tmp/claude-0/-home-user-swap-z-app/c62ab438-c421-58a6-a196-4f9e1f49d474/scratchpad/admin-cc2/`

| Script | Saída |
|---|---|
| `node areas-dump.cjs <repo>` (jiti, executa `areas.ts`) | `areas-dump.json` (módulo → área, contagens) |
| `python3 -I scan_panels.py <repo> raw-scan.json` | fatos por painel (fetch, escrita, polling, tabelas) |
| `python3 -I scan_routes.py <repo> .` | `routes-scan.json` (66 rotas, indicadores de mascaramento) |
| `python3 -I verify_counts.py <repo> verify/counts.json` | recontagem: polling, onClick, campos, tabelas, CSS, `fetchedAt` |
| `python3 -I scan_nook.py <repo>` | `fetch` sem `res.ok` |
| `python3 -I build_panels_v2.py .` | `panels.json` (scan + revisão manual com file:line + `shell`) |
| `python3 -I table_md_v2.py` | tabela da seção 3 |

Testes: `npx vitest run` nos 16 arquivos da seção 8 → 161 PASS. Nenhum arquivo do repositório foi alterado além deste.
