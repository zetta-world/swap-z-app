# PLANO — Chave da Jupiter (L-062A, 16/10/2026)

Status: 🟡 código certificado em `feat/jupiter-api-key@37666e9` (gates + CI 38932931702 + preview autenticado, 0 × 401/403/429); **produção aguarda autorização do dono** · rodada: L-062A

## Contexto

- 16/10 (L-061): 429 "Too many requests" em rajadas na `lite-api` (sem chave, 0,5 req/s) — inclusive em produção.
- 16/10: o dono criou a chave em portal.jup.ag e cadastrou `JUPITER_API_KEY` na Vercel (Production + Preview).
  O segredo vive **só na Vercel**; o código nunca o contém, não o loga, não o devolve.
- Docs Jupiter (16/10): todos os planos usam o mesmo host `api.jup.ag` com header `x-api-key`; Free = 1 req/s,
  sem chave = 0,5 req/s. `api.jup.ag` **não** significa "nível pago" (o comentário antigo em `jupiter.ts` dizia isso).

## Escopo

1. 🟢 `configJupiter()` (`src/lib/api/jupiter.ts`), lido a cada chamada:
   - chave → `https://api.jup.ag/swap/v1` + `x-api-key`; `JUPITER_BASE_URL` só vale se `https://api.jup.ag/...`,
     qualquer outro host é ignorado (a chave nunca sai para ele) e vira `incoerencia`;
   - sem chave → `JUPITER_BASE_URL` ou `lite-api`; base em `api.jup.ag` sem chave é ignorada (daria 401).
2. 🟢 `jupFetch()` é o único que monta URL e aplica headers comuns, sem sobrescrever os da chamada
   (`Accept` no GET; `Content-Type` + `Accept` no POST).
3. 🟢 Chave recusada (401/403) → refaz UMA vez na `lite-api` sem a chave + callback (padrão do LI.FI).
4. 🟢 Telemetria: `JupiterError {tipo: limite|chave|http|conexao, modo: autenticada|sem-chave, status}` e log
   `[jupiter] {modo,tipo,status,host}`; a chave é censurada até do corpo de erro da Jupiter.
5. 🟢 `/api/quote`: produção sem chave → alerta `jupiter:sem-chave`; incoerência → `jupiter:config`;
   recusa → `jupiter:chave-recusada`. Nenhum deles para o swap.
6. 🟢 Sonda de saúde (`admin/deps.ts`) usa a mesma base e a mesma chave.

## Fora do escopo

Swap V2 (rodada futura) · taxa Solana / tiers / contas de taxa (intocados, só testados) · LI.FI · EVM · Founder,
DCA, Autopilot, CEX · variáveis na Vercel · produção.
