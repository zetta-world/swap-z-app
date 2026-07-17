# Arquivo de rodadas de teste (17/07) — 🟢

> Gatilho: CEO religou todos os agentes em 17/07 08:32 UTC e pediu pra
> **arquivar a rodada 1** — os números do dashboard não podem misturar o
> experimento antigo (prompt pré-cirurgia + bugs já corrigidos do arbiter)
> com a medição nova.

## Desenho: época por `archived_at` (nunca DELETE)

- `zion_suggestions.archived_at` e `paper_positions.archived_at`
  (`timestamptz`, NULL = rodada viva). O histórico FICA no banco —
  flywheel honesto exige que a rodada 1 continue auditável — mas some de
  todo painel/digest/stat.
- **Fronteira da rodada 2**: sugestões com `created_at < 2026-07-17 08:32 UTC`
  (momento do unpause) são rodada 1. Paper: tudo aberto/fechado até o
  momento da migration (atômico com o reset das carteiras).
- Posições de papel ainda ABERTAS da rodada 1 (94) são fechadas flat
  (`exit_reason='archived'`, PnL 0) — senão o motor as resolveria depois
  creditando nas carteiras já zeradas.
- Todas as `paper_accounts` resetam pra `starting_usd`/0/0.

## Quem filtra `archived_at IS NULL` (leitores de stats)

`admin/api/backtest` · `admin/api/tournament` (sugestões + paper fechadas) ·
`admin/api/paper` (abertas + fechadas) · `admin/api/command` ·
`getBacktestStats` (backtest.ts) · `flywheelDigestBlock` (watchdog.ts).

## Quem NÃO filtra (de propósito)

- `resolveOpenSuggestions` / `resolvePaperPositions` — operam por
  `status='open'`; rodada arquivada não tem open.
- Dedup do paper engine (`held` set) — precisa ver TODAS as posições.
- Cota mensal do sniper e teto diário do arbiter — janelas por data.

## Como arquivar a rodada N no futuro

Uma migration com o mesmo par de UPDATEs (novo cutoff) + reset das
carteiras. Nada de código — o mecanismo é só dado.
