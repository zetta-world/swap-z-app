-- ─────────────────────────────────────────────────────────────────────────
-- Z-SWAP — search_path fixo nas três funções do schema public
-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ ACHADO NA AUDITORIA DE 18/08. O linter do Supabase
-- (`function_search_path_mutable`) acusa as três funções que este repo define:
--
--     consume_rate_limit(p_bucket text, p_max int, p_window_secs int)
--     apply_session_pnl(p_id uuid, p_delta numeric, p_today text)
--     bump_session_trades(p_wallet text, p_exchange text, p_n int)
--
-- Sem `search_path` fixo, o resolvedor de nomes dentro do corpo obedece ao
-- `search_path` de QUEM CHAMA. Um schema plantado na frente do `public` faz
-- `rate_limits` (ou qualquer tabela citada sem qualificação) apontar para outro
-- objeto, e a função passa a operar sobre dados que não são os dela.
--
-- ⚠️ O RISCO REAL AQUI É BAIXO, E DIZER ISSO IMPORTA. As três são
-- SECURITY INVOKER, não DEFINER — não há escalada de privilégio embutida, e o
-- acesso é service-role a partir do servidor. O ataque clássico desta classe
-- (função DEFINER sequestrada por schema plantado) NÃO se aplica.
--
-- Então por que consertar: porque o custo é uma linha por função e o benefício
-- é o linter voltar a ficar limpo. Um alerta permanente que "a gente sabe que
-- pode ignorar" é como o painel aprende a ser ignorado inteiro — e este
-- projeto já pagou caro por sinal virando ruído (ver `arb_window_empty`, que
-- virou 2.266 eventos antes de ganhar dedup).
--
-- `pg_temp` fica por ÚLTIMO de propósito: primeiro na lista, ele permitiria a
-- um objeto temporário sombrear uma tabela real dentro da própria transação.
-- ─────────────────────────────────────────────────────────────────────────

alter function public.consume_rate_limit(text, integer, integer)
  set search_path = public, pg_temp;

alter function public.apply_session_pnl(uuid, numeric, text)
  set search_path = public, pg_temp;

alter function public.bump_session_trades(text, text, integer)
  set search_path = public, pg_temp;
