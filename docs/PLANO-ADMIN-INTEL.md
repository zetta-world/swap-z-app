# Plano — Admin Intelligence (Controles + Users + Growth)

> CEO (12/07): (1) Controles → conceder/revogar acesso ao painel ADM à vontade;
> (2) Users → raio-x financeiro por usuário (quanto ganha/perde/movimenta + tudo
> que faz); (3) Growth → separar joio do trigo (bot/humano/você, navegador,
> tempo por página, cliques). "Informação vale ouro." Status vivo.

## Track 1 — Controle de acesso ADMIN (conceder/revogar) — 🟢 FEITO
Migration `0016_platform_admins` aplicada · `requireAdmin` agora checa env OR
platform_admins OR legado (aditivo, ninguém trancado) · rota `admin/api/admins`
(GET/POST grant-revoke, auditado, guardas: sem auto-revoke, sem revogar env, sem
zerar admins) · painel **ADMIN ACCESS** nos Controles. Decisão de IP: hash.

### (spec original)
**Achado:** `requireAdmin` hoje libera qualquer carteira com tier `source='admin'`
→ conceder tier = conceder admin (acoplado). Vou **separar**.
- Migration aditiva `platform_admins` (wallet, granted_by, granted_at, note) + RLS.
- `requireAdmin` passa a checar `ADMIN_WALLETS` (env) OR `platform_admins` (novo)
  OR o legado `tier_cache.source='admin'` (compat — não quebra ninguém).
- Rota `admin/api/admins` (GET lista, POST grant/revoke) — auditada, com guardas:
  não revogar a si mesmo, não revogar admin de env, nunca deixar zero admins.
- Painel **ADMIN ACCESS** nos Controles: lista admins + conceder/revogar por wallet.

## Track 2 — Users raio-x (informação vale ouro)
Enriquecer `admin/api/users` + `UsersPanel`:
- **Lista:** por wallet → volume total, P&L realizado (ganho/perda separados),
  nº ops, tier, origem do tier, autopilot ativo?, 1ª vez / última vez, nº de
  page-views. Ordenável por volume / P&L / atividade.
- **Detalhe (?wallet):** já tem tier/sessions/ops/events. Somar:
  ganho bruto vs perda bruta, taxa de acerto, volume por chain/par, exposição
  autopilot aberta, P&L autopilot, depósitos/saques (operations kind), fees,
  timeline de páginas vistas (o que ele navegou), tempo de sessão.
- Nota: hoje há ~0 usuários reais (pré-launch) — isto é **capacidade** que
  popula quando o tráfego real chegar.

## Track 3 — Growth: joio do trigo
Enriquecer o beacon + MIDGARD para classificar cada visita:
- **Bot vs humano:** parse do User-Agent (padrões de crawler) + heurística
  (sem referrer + data-center + sem interação). Flag `bot` no evento.
- **É você / é admin:** page_view já grava a wallet quando logado → marcar
  visita de wallet admin. Sem login, casar o `cid` com um cid conhecido seu.
- **Navegador / OS:** parse do UA (Chrome/Brave/Safari/Firefox/Edge + SO).
- **Tempo por página (dwell):** beacon manda o tempo-na-página no `beforeunload`/
  `visibilitychange` → "que página prende mais".
- **Cliques:** novo evento `click` (elemento/rota) — mapa de calor simples.
- Painel MIDGARD ganha aba **VISITANTES**: tabela por cid — humano/bot/você,
  navegador, cidade, nº páginas, tempo total, última visita.

## ⚠️ DECISÃO PENDENTE (Track 3) — IP cru vs hash (LGPD)
Hoje **não guardamos o IP cru** — só `cid = sha256(ip|ua)` truncado (postura LGPD).
Isso já permite: bot/humano/você, navegador, cidade, visitantes únicos, dwell,
cliques. **Só NÃO dá o IP literal.** Guardar o IP cru muda a postura de
privacidade (precisa constar na política, implicações legais). Escolha do CEO:
- **A (recomendado):** manter hash — entrega 95% (tudo menos o IP literal).
- **B:** guardar IP cru — dá o IP exato, mas assume as implicações de LGPD.
- **C:** IP mascarado (ex.: `189.40.x.x`) — meio-termo, geo sem identificar.

## Ordem sugerida
T1 (controle admin) → T2 (users) → T3 (growth). T1/T2 não dependem da decisão de IP.
