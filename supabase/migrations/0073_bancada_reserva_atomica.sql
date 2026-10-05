-- ═══════════════════════════════════════════════════════════════════════════
-- 0073 — COTA DA BANCADA: reserva ATÔMICA da rodada, contada NO BANCO (CE-04/CE-05, cost engineering round).
-- NÃO aplicada em produção. Lane B, local. Prova: supabase/tests/20_bancada_reserva_atomica.sql
-- (+ 20b_bancada_reserva_concorrencia.sh).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ — dois defeitos medidos no caminho antigo (`consumoDaJanela` + `abrirRodada` em `bancada/store.ts`):
--
--   1. CONTAGEM NO APP, CORTADA PELO max_rows. O app lia TODAS as linhas da janela de 24h e contava em
--      JavaScript. O PostgREST corta toda leitura em `db-max-rows` (1000 no Supabase hospedado e no
--      laboratório: `infra/compose.yml` PGRST_DB_MAX_ROWS=1000). A cota do Pilot é 5.000: a contagem
--      saturava em 1.000 e o limite NUNCA era alcançado — Pilot sem teto de fato.
--   2. LER-DECIDIR-GRAVAR SEM TRAVA (TOCTOU). A rota lia o consumo, decidia em memória e só depois inseria.
--      N requisições simultâneas liam o MESMO consumo e passavam todas; o freio de rajada (12/min) só limita
--      o tamanho do estouro, não o impede.
--
-- O QUE MUDA: uma função faz as três coisas numa transação, serializada POR DONO (advisory lock de
-- transação), com o relógio DO BANCO (uma régua só para a janela, não o relógio de cada instância serverless):
--
--   · conta as rodadas que consomem cota (status ≠ 'recusada') desde now() - janela — `count(*)` no banco,
--     sem max_rows; usa o índice existente `bancada_rodada_dono_idx (dono, criada_em desc)`;
--   · soma as UNIDADES DE COMPUTAÇÃO da mesma janela (CE-05) — o orçamento por trabalho, não por contagem;
--   · se couber, insere a rodada como 'rodando' e devolve o id; se não, devolve o motivo sem inserir.
--
-- Rodada 'recusada' (portão do pedágio) continua NÃO consumindo cota e continua sendo gravada pelo caminho
-- antigo (`abrirRodada` + `fecharRodada`), fora desta função — ela não reserva nada.
--
-- ⚠️ FALHA FECHADA: a rota trata erro desta função como "consumo desconhecido" (503), nunca como cota livre.
-- ⚠️ ACL: security definer + search_path fixo; EXECUTE revogado de public/anon/authenticated, só service_role
--    (padrão da 0055; registrada na guarda `src/lib/cex/execucao/rpcs-acl.test.ts`).
-- ⚠️ ADITIVA: nenhuma coluna existente muda. `custo_unidades` nasce com default 0; linhas antigas contam no
--    orçamento pelo maior entre `custo_unidades` e `custo_velas` (transição sem buraco).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.bancada_rodada
  add column if not exists custo_unidades bigint not null default 0;

alter table public.bancada_rodada drop constraint if exists bancada_rodada_custo_unidades_nao_negativo;
alter table public.bancada_rodada add constraint bancada_rodada_custo_unidades_nao_negativo
  check (custo_unidades >= 0);

comment on column public.bancada_rodada.custo_unidades is
  'Unidades de computação reservadas pela rodada (CE-05): velas lidas × peso do modo. Soma da janela de 24h = orçamento.';

create or replace function public.bancada_reservar_rodada(
  p_dono               text,
  p_chain              text,
  p_estrategia_id      uuid,
  p_origem             text,
  p_capital_usd        numeric,
  p_simbolos           text[],
  p_intervalo          text,
  p_janela_de          bigint,
  p_janela_ate         bigint,
  p_praca              text,
  p_papel              text,
  p_params             jsonb,
  p_custo_velas        integer,
  p_custo_unidades     bigint,
  p_limite_rodadas     integer,
  p_orcamento_unidades bigint,
  p_janela_ms          bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde    timestamptz;
  v_rodadas  bigint;
  v_unidades bigint;
  v_id       uuid;
begin
  -- Entradas impossíveis viram erro, nunca cota livre.
  if p_dono is null or length(p_dono) = 0 then
    raise exception 'bancada_reservar_rodada: dono ausente' using errcode = '22023';
  end if;
  if p_limite_rodadas is null or p_limite_rodadas < 0
     or p_orcamento_unidades is null or p_orcamento_unidades < 0
     or p_janela_ms is null or p_janela_ms <= 0
     or p_custo_unidades is null or p_custo_unidades < 0
     or p_custo_velas is null or p_custo_velas < 0 then
    raise exception 'bancada_reservar_rodada: parâmetros de cota inválidos' using errcode = '22023';
  end if;

  -- ⚠️ Serializa as reservas DO MESMO DONO até o fim desta transação. Donos diferentes não se esperam.
  perform pg_advisory_xact_lock(hashtextextended('bancada_cota:' || p_dono, 0));

  v_desde := now() - (p_janela_ms * interval '1 millisecond');

  select count(*),
         coalesce(sum(greatest(r.custo_unidades, r.custo_velas::bigint)), 0)
    into v_rodadas, v_unidades
    from public.bancada_rodada r
   where r.dono = p_dono
     and r.criada_em >= v_desde
     and r.status <> 'recusada';

  if v_rodadas >= p_limite_rodadas then
    return jsonb_build_object('ok', false, 'motivo', 'cota_esgotada',
                              'rodadas', v_rodadas, 'unidades', v_unidades);
  end if;

  if v_unidades + p_custo_unidades > p_orcamento_unidades then
    return jsonb_build_object('ok', false, 'motivo', 'orcamento_esgotado',
                              'rodadas', v_rodadas, 'unidades', v_unidades);
  end if;

  insert into public.bancada_rodada (
    dono, chain, estrategia_id, origem, capital_usd, simbolos, intervalo,
    janela_de, janela_ate, praca, papel, params, custo_velas, custo_unidades, status
  ) values (
    p_dono, p_chain, p_estrategia_id, p_origem, p_capital_usd, p_simbolos, p_intervalo,
    p_janela_de, p_janela_ate, p_praca, p_papel, coalesce(p_params, '{}'::jsonb),
    p_custo_velas, p_custo_unidades, 'rodando'
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id,
                            'rodadas', v_rodadas + 1, 'unidades', v_unidades + p_custo_unidades);
end;
$$;

revoke execute on function public.bancada_reservar_rodada(
  text, text, uuid, text, numeric, text[], text, bigint, bigint, text, text, jsonb, integer, bigint, integer, bigint, bigint
) from public, anon, authenticated;
grant execute on function public.bancada_reservar_rodada(
  text, text, uuid, text, numeric, text[], text, bigint, bigint, text, text, jsonb, integer, bigint, integer, bigint, bigint
) to service_role;
