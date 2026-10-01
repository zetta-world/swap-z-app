# Z-SWAP — Claude Code Entry Point

**Canonical entry: `docs/START-HERE.md`.** Before doing any work:

1. Read `docs/START-HERE.md` completely.
2. Follow `docs/AI-OPERATING-RULES.md`.
3. Verify `pwd`, `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`, `git status --short`.
4. If they disagree with START-HERE, **STOP** and report.
5. If the task depends on GitHub, `git fetch origin --tags --prune` first.
6. Do not treat `PLANO-*.md` or `AUDITORIA-*.md` as current unless
   `docs/DOCUMENT-AUTHORITY.md` says so.
7. GitHub state, Acer runtime and production are **separate facts**.
8. Never push, merge, deploy, touch the production DB, real credentials, real
   trading or public exposure without **explicit owner authorization**.
   Nothing goes to production automatically: deploy only from a SHA marked
   `RELEASE_CANDIDATE` in `docs/RELEASE-CHAIN.md`, with PASS certification and
   explicit owner authorization (the 31/08 "always to production" rule is
   **suspended** — `docs/AI-OPERATING-RULES.md` §6).
9. No phase is complete until: audit → fixes → pre-commit validation →
   **candidate commit C1 → full recertification at the exact SHA of C1 →
   docs-only attestation commit C2** (records `CERTIFIED_FEATURE_SHA=<C1>`;
   C2 is never called CERTIFIED). A failed recert means no PASS attestation:
   fix + new commit C1b + full recert of C1b (no retry-to-pass). Full
   lifecycle: `docs/AI-OPERATING-RULES.md` §5.

The rest of this file is the code map and house rules. It does not describe
the current state.

---

# Z-SWAP — mapa do repo

DEX aggregator multi-chain (Solana + ~10 EVM) com assistente de trading IA
(ZION), arquitetura multi-modelo ("Ferrari"), flywheel de backtest sombra e
painel admin tipo terminal. Next.js 16.3.6 App Router · Supabase (Postgres) ·
Vercel serverless · TypeScript estrito.

## Onde está cada coisa

| Área | Caminho |
|------|---------|
| ZION núcleo (prompt, backtest/flywheel, radar, modelos) | `src/lib/zion/` (`foundation.ts`, `backtest.ts`, `radar.ts`, `model.ts`, `parse.ts`, `card-mapping.ts`) |
| Seam de provedores IA (Anthropic + OpenAI-compat) | `src/lib/ai/provider.ts` · registry/geo-routing `src/lib/ai/registry.ts` · circuit breaker `src/lib/ai/circuit.ts` |
| Indicadores de mercado (RSI/MACD/ATR/ADX, regime, score) | `src/lib/api/market-indicators.ts` |
| Guarda de dinheiro do autopilot | `src/lib/autopilot/price-guard.ts` |
| Admin: watchdog/alertas, custo IA, gates, health | `src/lib/admin/` |
| Crons (auth `CRON_SECRET`, timing-safe) | `src/app/api/autopilot/cron` (5min) · `src/app/api/zion/backtest` (30min) · `src/app/api/radar` (1min) — agendados no cron-job.org, NÃO no GitHub Actions |
| Rotas admin (todas com `requireAdmin`, 404 nunca 403) | `src/app/admin/api/*` |
| Painéis do terminal admin | `src/components/admin/panels/*` + registro em `src/lib/admin/modules.ts` + `DashboardClient.tsx` |
| Migrations (RLS default-deny: habilitada, ZERO policies de propósito) | `supabase/migrations/` |
| i18n — SEMPRE 4 locales (en/pt/es/zh) | `src/lib/i18n/messages.ts` |
| Nav (única fonte: sidebar/mobile/⌘K) | `src/components/layout/nav-items.ts` |

## Regras que este repo segue

- **Documentar ANTES de implementar**: todo trabalho começa num plano em
  `docs/PLANO-*.md` com status (🔴/🟡/🟢/⏸️) atualizado a cada entrega.
- **Best-effort só onde não há dinheiro nem permissão em jogo**:
  telemetria/observabilidade não crítica pode ser best-effort **onde o código
  já foi desenhado assim** (ex.: `recordRuns` em `autopilot/sessions.ts`,
  `logAdminAction` em `admin/require.ts`). Isso **não** é licença para
  fail-open: registro que é requisito de segurança confere o resultado (ex.:
  o log de export em `early-access/store.ts` recusa o arquivo se falhar).
- **Falha fechada em tudo que importa**: autorização, estado financeiro,
  risco, ordem, settlement, credencial, recovery e qualquer caminho que possa
  mover dinheiro falham FECHADO conforme os gates atuais. Exemplos no código:
  `price-guard.ts` (sem preço de referência = rejeita), kill-switch de
  `/api/cex/order` em `admin/kill-switches.ts` (falha de leitura = bloqueia),
  credencial em `cex/conexoes.ts` (fail-closed), portão do early access em
  `early-access/gate.ts`, e os gates em `extractSuggestion`. Exceção
  documentada no próprio código: o kill-switch de `/api/quote` falha ABERTO
  (devolve transação que o usuário ainda assina) e a falha de leitura vira
  evento de segurança — ver o cabeçalho de `kill-switches.ts`. Não criar
  exceção nova sem esse nível de justificativa. Na dúvida, feche.
- **Flywheel honesto**: expectancy LÍQUIDA de custo, `expired` ≠ win/loss,
  amostra mínima, guarda de escala, stop-first pessimista. Não "melhorar"
  números sem entender esses filtros — eles existem por cicatriz.
- **Saída de cards**: JSON `{"cards":[...]}` (schema forçado nos caminhos
  Anthropic; `extractCards` tem fallback triplo). O streaming user-facing ainda
  usa blocos `[[ACTION]]`.
- **admin_kv** é o KV de operação: kill-switches, gates (`pause_*`), breaker
  (`cb:<id>`), locks (`lock:*`), refs do radar, dedup de alertas.
- **Segredos só em `process.env`** server-side; service key nunca em
  `NEXT_PUBLIC_*`. Zero segredo hardcoded (auditado).

## Comandos

```bash
npm run dev · npm run build · npm run lint · npm run type-check · npm test
```
CI (`.github/workflows/ci.yml`) roda lint + type-check + testes em todo push.

## ⚠️ Falar com o outro agente

> ⛔ **Revisão 3 (01/10/2026): NÃO usar `scripts/mural.mjs` automaticamente.**
> Ele lê `SUPABASE_SERVICE_ROLE_KEY` do `.env.local` e escreve no **Supabase
> hospedado**, com credencial real. Só use com **autorização explícita do
> dono** para o Supabase hospedado. Sem ela, registre a coordenação no
> ledger (`docs/LAUNCH-READINESS-LEDGER.md`), na documentação ou no chat
> corrente. O texto abaixo é o desenho original, preservado como referência.

Mais de uma sessão trabalha neste repositório. **O `ListAgents` NÃO enxerga
sessões de outra máquina** — uma no Windows do dono e outra num contêiner
remoto não se veem, e isso é do arcabouço, não deste código.

O canal que funciona entre elas é o banco:

```bash
node scripts/mural.mjs ler --para vscode     # ou nuvem — LER MARCA COMO LIDO
node scripts/mural.mjs escrever --de nuvem --para vscode --assunto "..." --corpo "..."
node scripts/mural.mjs responder --id <uuid> --texto "..."
```

É a mesma caixa que a aba **ÚLFHÉÐNAR** do admin mostra. Precisa de
`SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_SUPABASE_URL` — o script lê
`.env.local` sozinho.

**Antes de mexer em algo grande, declare em que arquivos vai pisar** — no
mural só com a autorização acima; senão, no ledger ou no chat corrente. Em
24/08 as duas sessões só não colidiram porque a interseção foi conferida à
mão — disciplina, não trava.

## Retomada de sessão

**`docs/START-HERE.md` primeiro** (estado atual, SHA, o que está bloqueado).
Depois `docs/ESTADO-ATUAL.md` para as lições e as armadilhas desta máquina.
Ele é SUPPORTING_REFERENCE: o topo dele não define o estado atual. Ao fim de
cada entrega, atualizar `docs/CURRENT-STATE.md` e
`docs/LAUNCH-READINESS-LEDGER.md`.

## Referências

- Env vars + playbooks de incidente: `docs/RUNBOOK.md`
- Arquitetura IA completa: `docs/ARQUITETURA-IA.md`
- Índice de docs (vivos vs históricos): `docs/README.md`
- Auditoria + notas: `docs/AUDITORIA-GERAL.md`
