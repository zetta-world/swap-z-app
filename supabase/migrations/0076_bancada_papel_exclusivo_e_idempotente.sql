-- ═══════════════════════════════════════════════════════════════════════════
-- 0076 — PAPEL ADIANTE: tique EXCLUSIVO, abertura IDEMPOTENTE e estado do sinal PERSISTIDO
-- (AUDIT REMEDIATION do cost engineering round, RM-01/RM-02/RM-03/RM-05).
-- NÃO aplicada em produção. Lane B, local. Prova: supabase/tests/23_bancada_papel_idempotente.sql
-- (+ 23b_bancada_papel_concorrencia.sh, integração bench/integracao/papel-concorrencia.integration.ts).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ — três achados da auditoria independente sobre o HEAD 14e5a20:
--
--   1. A TRAVA DO TIQUE NÃO ERA TRAVA. `/api/bancada/tique` (e o cron do backtest) faziam SELECT em
--      `admin_kv` → decidiam no app → UPSERT. Duas invocações simultâneas liam "livre" e rodavam juntas.
--   2. POSIÇÃO DUPLICADA. `abrirPosicao` era um INSERT comum, sem identidade da oportunidade nem UNIQUE:
--      dois tiques que viam "nenhuma posição" abriam duas posições do MESMO sinal.
--   3. A GUARDA DE VELA SUMIA COM A POSIÇÃO. "Esta mesa já avaliou esta vela" era derivado só das posições
--      ABERTAS; a posição fechava, o próximo tique não a carregava, e a mesma vela podia abrir de novo.
--
-- O QUE MUDA:
--
--   · `bancada_arrendamento` + `bancada_tique_arrendar` / `bancada_tique_liberar`: arrendamento (lease) com
--     validade, tomado por `INSERT … ON CONFLICT DO UPDATE … WHERE vencido` — UMA instrução, e a linha
--     conflitante é travada pelo próprio Postgres: duas chamadas simultâneas não ganham as duas. Queda do
--     processo = o lease vence pelo TTL (recuperação sem intervenção). Liberar só apaga o lease do MESMO dono.
--   · IDENTIDADE CANÔNICA DA ABERTURA = (estratégia, intervalo da decisão, vela do sinal). Estratégia é
--     imutável depois de salva (editar = nova linha), então o `estrategia_id` já é a versão; o dono é o da
--     estratégia (conferido); o símbolo NÃO entra — a mesa abre no máximo UMA posição por vela, qualquer que
--     seja o símbolo (regra do tique, "uma posição por mesa"). Gravada em `bancada_posicao.chave_entrada`
--     (`v1:<estrategia_id>:<intervalo>:<vela_em>`) com UNIQUE parcial: linhas legadas ficam NULL.
--   · `bancada_estrategia.ultima_vela_aberta`: o estado AUTORITATIVO de "já abri nesta vela", que sobrevive
--     a posição fechada, restart, outro worker, replay. Preenchido aqui com o maior `vela_em` histórico.
--   · `bancada_abrir_posicao_papel`: abre numa transação, com a linha da estratégia travada (FOR UPDATE):
--     confere o dono, devolve `ja_registrada` (sucesso idempotente, sem inserir) se a chave já existe, recusa
--     vela já avaliada e mesa com posição aberta, insere e avança `ultima_vela_aberta`.
--
-- ⚠️ PRÉ-CONDIÇÃO (RM-05): esta migration EXIGE 0073 + 0074 + 0075 aplicadas e recusa rodar sem elas — a
--    unidade de release 0073→0076 não pode ficar com buraco no meio. Ver a matriz de compatibilidade em
--    `docs/COST-ENGINEERING-AUDIT-REMEDIATION-REPORT.md` §11.
-- ⚠️ ADITIVA: uma tabela nova, duas colunas anuláveis, um índice parcial, três funções. Nada existente muda.
-- ⚠️ ACL: security definer + search_path fixo; EXECUTE só service_role (padrão 0055; guarda rpcs-acl).
-- ROLLBACK (documentado, não executado): drop das três funções, `drop index bancada_posicao_chave_entrada_uq`,
--   `alter table bancada_posicao drop column chave_entrada`, `alter table bancada_estrategia drop column
--   ultima_vela_aberta`, `drop table bancada_arrendamento`. Perde só o estado novo; nenhuma posição é apagada.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'bancada_rodada' and column_name = 'custo_unidades')
     or to_regprocedure('public.bancada_reservar_rodada(text,text,uuid,text,numeric,text[],text,bigint,bigint,text,text,jsonb,integer,bigint,integer,bigint,bigint)') is null then
    raise exception '0076 exige a 0073 (reserva atômica) aplicada antes' using errcode = '55000';
  end if;
  if to_regprocedure('public.bancada_gravar_ultimos_tiques(jsonb)') is null then
    raise exception '0076 exige a 0074 (último tique em lote) aplicada antes' using errcode = '55000';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'bancada_rodada'
         and column_name in ('duracao_ms', 'velas_da_fonte', 'velas_do_cache')) <> 3 then
    raise exception '0076 exige a 0075 (métricas da rodada) aplicada antes' using errcode = '55000';
  end if;
end;
$$;

-- ── 1. Arrendamento do tique ────────────────────────────────────────────────

create table if not exists public.bancada_arrendamento (
  escopo       text primary key,
  dono         text        not null,
  ate          timestamptz not null,
  adquirido_em timestamptz not null default now()
);
alter table public.bancada_arrendamento enable row level security;
comment on table public.bancada_arrendamento is
  'Lease de exclusão mútua das passagens do cron (RM-01). Uma linha por escopo; vence em `ate`. Só via RPC.';

create or replace function public.bancada_tique_arrendar(p_escopo text, p_dono text, p_ttl_ms integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dono text;
  v_ate  timestamptz;
begin
  if p_escopo is null or p_escopo !~ '^[a-z0-9_]{3,40}$' then
    raise exception 'bancada_tique_arrendar: escopo inválido' using errcode = '22023';
  end if;
  if p_dono is null or length(p_dono) < 8 or length(p_dono) > 128 then
    raise exception 'bancada_tique_arrendar: dono do lease inválido' using errcode = '22023';
  end if;
  if p_ttl_ms is null or p_ttl_ms < 1000 or p_ttl_ms > 900000 then
    raise exception 'bancada_tique_arrendar: ttl fora de 1 s … 15 min' using errcode = '22023';
  end if;

  -- ⚠️ UMA instrução: quem chega segundo espera a linha e reavalia o WHERE na versão nova — não ganha.
  insert into public.bancada_arrendamento as a (escopo, dono, ate, adquirido_em)
  values (p_escopo, p_dono, clock_timestamp() + p_ttl_ms * interval '1 millisecond', clock_timestamp())
  on conflict (escopo) do update
     set dono = excluded.dono, ate = excluded.ate, adquirido_em = excluded.adquirido_em
   where a.ate <= clock_timestamp()
  returning a.dono, a.ate into v_dono, v_ate;

  if v_dono = p_dono then
    return jsonb_build_object('ok', true, 'ate', (extract(epoch from v_ate) * 1000)::bigint);
  end if;

  select a.ate into v_ate from public.bancada_arrendamento a where a.escopo = p_escopo;
  return jsonb_build_object('ok', false, 'motivo', 'ocupado',
                            'ate', (extract(epoch from v_ate) * 1000)::bigint);
end;
$$;

create or replace function public.bancada_tique_liberar(p_escopo text, p_dono text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  -- ⚠️ Só o dono do lease libera: uma passagem atrasada não solta o lease de quem já a substituiu.
  delete from public.bancada_arrendamento where escopo = p_escopo and dono = p_dono;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke execute on function public.bancada_tique_arrendar(text, text, integer) from public, anon, authenticated;
grant execute on function public.bancada_tique_arrendar(text, text, integer) to service_role;
revoke execute on function public.bancada_tique_liberar(text, text) from public, anon, authenticated;
grant execute on function public.bancada_tique_liberar(text, text) to service_role;

-- ── 2. Identidade canônica da abertura + estado do sinal ────────────────────

alter table public.bancada_posicao
  add column if not exists chave_entrada text;
comment on column public.bancada_posicao.chave_entrada is
  'Identidade canônica da abertura (RM-02): v1:<estrategia_id>:<intervalo>:<vela_em>. UNIQUE parcial; NULL em linha legada.';

create unique index if not exists bancada_posicao_chave_entrada_uq
  on public.bancada_posicao (chave_entrada) where chave_entrada is not null;

alter table public.bancada_estrategia
  add column if not exists ultima_vela_aberta bigint;
comment on column public.bancada_estrategia.ultima_vela_aberta is
  'Vela (unix ms) da última abertura desta mesa (RM-03). Autoritativo: não depende de a posição seguir aberta.';

-- Estado inicial: o maior vela_em já aberto por cada estratégia (abertas E fechadas).
update public.bancada_estrategia e
   set ultima_vela_aberta = m.mx
  from (select estrategia_id, max(vela_em) as mx
          from public.bancada_posicao where vela_em is not null group by estrategia_id) m
 where e.id = m.estrategia_id
   and (e.ultima_vela_aberta is null or e.ultima_vela_aberta < m.mx);

create or replace function public.bancada_abrir_posicao_papel(
  p_dono         text,
  p_estrategia_id uuid,
  p_simbolo      text,
  p_lado         text,
  p_entrada      numeric,
  p_tamanho_usd  numeric,
  p_alvo_pct     numeric,
  p_stop_pct     numeric,
  p_expira_em    timestamptz,
  p_vela_em      bigint,
  p_intervalo    text,
  p_playbook     text,
  p_horas_limite numeric
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dono   text;
  v_ultima bigint;
  v_chave  text;
  v_id     uuid;
begin
  if p_dono is null or length(p_dono) = 0 or p_estrategia_id is null
     or p_simbolo is null or length(p_simbolo) = 0 or p_vela_em is null or p_vela_em <= 0
     or p_intervalo is null or p_intervalo !~ '^[0-9]+[mhdw]$' then
    raise exception 'bancada_abrir_posicao_papel: identidade da abertura incompleta' using errcode = '22023';
  end if;

  -- ⚠️ Serializa as aberturas DA MESMA MESA até o fim da transação.
  select e.dono, e.ultima_vela_aberta into v_dono, v_ultima
    from public.bancada_estrategia e where e.id = p_estrategia_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_estrategia');
  end if;
  if v_dono <> p_dono then
    return jsonb_build_object('ok', false, 'motivo', 'dono_divergente');
  end if;

  v_chave := 'v1:' || p_estrategia_id::text || ':' || p_intervalo || ':' || p_vela_em::text;

  -- Replay / retry / segundo worker da MESMA oportunidade: sucesso idempotente, nada novo.
  select p.id into v_id from public.bancada_posicao p where p.chave_entrada = v_chave;
  if found then
    return jsonb_build_object('ok', true, 'criada', false, 'motivo', 'ja_registrada', 'id', v_id);
  end if;

  if v_ultima is not null and p_vela_em <= v_ultima then
    return jsonb_build_object('ok', false, 'motivo', 'vela_ja_avaliada');
  end if;
  if exists (select 1 from public.bancada_posicao p
              where p.estrategia_id = p_estrategia_id and p.status = 'aberta') then
    return jsonb_build_object('ok', false, 'motivo', 'ja_tem_posicao');
  end if;

  insert into public.bancada_posicao (
    dono, estrategia_id, simbolo, lado, entrada, tamanho_usd, alvo_pct, stop_pct, expira_em,
    vela_em, playbook, horas_limite, status, chave_entrada
  ) values (
    p_dono, p_estrategia_id, p_simbolo, p_lado, p_entrada, p_tamanho_usd, p_alvo_pct, p_stop_pct, p_expira_em,
    p_vela_em, p_playbook, p_horas_limite, 'aberta', v_chave
  ) returning id into v_id;

  update public.bancada_estrategia set ultima_vela_aberta = p_vela_em where id = p_estrategia_id;

  return jsonb_build_object('ok', true, 'criada', true, 'id', v_id);
exception
  -- Defesa em profundidade: a UNIQUE parcial é a última palavra mesmo que a trava acima falhe.
  when unique_violation then
    select p.id into v_id from public.bancada_posicao p where p.chave_entrada = v_chave;
    return jsonb_build_object('ok', true, 'criada', false, 'motivo', 'ja_registrada', 'id', v_id);
end;
$$;

revoke execute on function public.bancada_abrir_posicao_papel(
  text, uuid, text, text, numeric, numeric, numeric, numeric, timestamptz, bigint, text, text, numeric
) from public, anon, authenticated;
grant execute on function public.bancada_abrir_posicao_papel(
  text, uuid, text, text, numeric, numeric, numeric, numeric, timestamptz, bigint, text, text, numeric
) to service_role;
