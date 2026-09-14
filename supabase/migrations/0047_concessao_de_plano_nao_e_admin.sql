-- ⚠️⚠️ CONCEDER UM PLANO CRIAVA UM ADMIN (14/09) — achado A04 da auditoria externa,
-- confirmado no banco.
--
-- `tier_cache.source` carregava DOIS significados no mesmo valor `'admin'`:
--
--   (a) "este plano foi definido por um admin"   ← o que POST /admin/api/tier grava
--   (b) "esta carteira É um admin"               ← o que src/lib/admin/require.ts LÊ
--
-- O painel concede um plano `trader` a um cliente, grava `source: 'admin'`, e a
-- partir daí `requireAdmin` devolve `{ wallet }` para ele: painel inteiro, gates,
-- kill-switches, concessão de tier, mural.
--
-- Medido em 14/09: das 4 carteiras com `source = 'admin'`, TRÊS não estão em
-- `platform_admins` — duas delas dormentes (uma nunca sequer entrou).
--
-- ⚠️ ESTA MIGRAÇÃO NÃO MEXE EM LINHA NENHUMA, de propósito. Ela só abre o valor
-- `'concessao'` no CHECK para que a rota possa parar de gravar `'admin'`. Quem é
-- admin hoje continua sendo — trocar o valor das linhas existentes revogaria
-- acesso sem decisão humana, e uma delas é de quem concedeu admin ao dono.
--
-- O caminho LEGÍTIMO de conceder admin é `platform_admins`, por
-- POST /admin/api/admins — esse não muda.
alter table tier_cache drop constraint if exists tier_cache_source_check;

alter table tier_cache add constraint tier_cache_source_check
  check (source = any (array[
    'nft'::text,
    'subscription'::text,
    -- ⚠️ MANTIDO: as linhas legadas ainda usam este valor, e `requireAdmin`
    -- ainda o honra como ponte. Ele só não é mais ESCRITO por concessão de
    -- plano — então o conjunto de admins-por-legado só pode encolher.
    'admin'::text,
    -- O plano que um admin concedeu. Diz QUEM decidiu o plano, e nada sobre
    -- quem a carteira é.
    'concessao'::text,
    'sem_pass'::text,
    'nao_checado'::text
  ]));
