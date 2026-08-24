-- ─────────────────────────────────────────────────────────────────────────
-- A ORIGEM DO TIER PARA DE MENTIR — 11/08.
--
-- ⚠️ POR QUE ISTO EXISTE.
--
-- `tier_cache.source` só aceitava 'nft' | 'subscription' | 'admin'. O código
-- precisava gravar um quarto estado — "não foi checado" — e não tinha onde,
-- então gravou `'nft'` com um comentário admitindo a troca:
--
--     // "default" isn't a valid DB source; store the free fallback as an nft check.
--
-- Efeito: uma carteira EVM, para a qual a checagem de NFT NEM RODA (os passes
-- vivem na Solana), ficava registrada como `source: nft, tier: free` — que se
-- lê como "olhamos seus NFTs e você não tem nenhum". Ninguém olhou.
--
-- Em 11/08 o dono conectou uma carteira EVM, viu "SIGNED IN", ficou no plano
-- gratuito e perguntou por que não funcionava. O sistema estava certo; o
-- RÓTULO estava errado — e o rótulo era a única coisa que ele podia consultar.
--
-- É a invariante nº 6 da casa: "não medimos" não pode virar "medimos zero".
-- A restrição do banco forçou a mentira, então é o banco que muda.
--
-- ⚠️ DOIS ESTADOS NOVOS, não um:
--   'sem_pass'       — a checagem RODOU e a carteira não tem passe.
--   'nao_checado'    — a checagem NÃO rodou (cadeia sem passe, fonte fora do
--                      ar, backend não configurado). Isto é ausência de
--                      medição, e é o estado que faltava.
-- ─────────────────────────────────────────────────────────────────────────

alter table tier_cache drop constraint if exists tier_cache_source_check;

alter table tier_cache
  add constraint tier_cache_source_check
  check (source = any (array['nft','subscription','admin','sem_pass','nao_checado']));

comment on column tier_cache.source is
  'De onde veio o tier. nft/subscription/admin = concedido. sem_pass = checado e nao tem. nao_checado = a checagem nao rodou (ex.: carteira EVM, cujos passes vivem na Solana) — ausencia de medicao, NAO "nao tem".';

-- ⚠️ AS LINHAS JÁ GRAVADAS CONTINUAM COMO ESTÃO, de propósito. Reescrever
-- 'nft' para 'nao_checado' aqui seria adivinhar qual delas foi checada de
-- verdade — e adivinhar o passado é pior que um passado ambíguo declarado.
-- Elas se corrigem sozinhas: o cache expira em 5 minutos.
