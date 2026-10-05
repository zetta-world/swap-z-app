-- CE-10 — semeadura do teste de carga dos desks de papel. SÓ no Postgres descartável da campanha.
-- Uso: psql -v desks=3250 -f semear-papel.sql
--
-- Mistura do DIREITO contratado (CE-09): Trader 750 × 3 = 2.250 e Pilot 100 × 10 = 1.000 → 69,2% / 30,8%.
-- Donos: '0xa…' = trader (3 desks), '0xb…' = pilot (10 desks). Metade das mesas é estratégia própria (1h),
-- metade é instância de agente (strat_mech / strat_dex). 1 a 3 símbolos por mesa, de 20 pares.
-- Velas: 20 pares × 1h (700) + 4h (460) + 1d (420), com cobertura total até o fim da semeadura.
\set ON_ERROR_STOP 1
\if :{?desks}
\else
  \set desks 3250
\endif

delete from public.bancada_posicao where dono like '0xa%' or dono like '0xb%';
delete from public.bancada_estrategia where dono like '0xa%' or dono like '0xb%';
delete from public.admin_kv where key like 'bancada:tique:%';
delete from public.mercado_vela where simbolo like 'P%';
delete from public.mercado_cobertura where simbolo like 'P%';

-- T_FIM = 1.790.000.000.000 arredondado para o DIA (todas as séries fecham juntas) + 12h de folga para os ticks.
create temp table k as
select (1790000000000 - (1790000000000 % 86400000))::bigint as t_fim, 3600000::bigint as h;

insert into public.mercado_vela (simbolo, intervalo, abriu_em, high, low, close, volume)
select 'P' || lpad(s::text, 2, '0'), iv.nome, k.t_fim + 12 * k.h - g::bigint * iv.dur,
       100 * (1 + 0.02 * sin(g / 17.0 + s)) * 1.004,
       100 * (1 + 0.02 * sin(g / 17.0 + s)) * 0.996,
       100 * (1 + 0.02 * sin(g / 17.0 + s)),
       1000 + (g % 50)
  from k, generate_series(1, 20) s,
       (values ('1h', 3600000::bigint, 700), ('4h', 14400000::bigint, 460), ('1d', 86400000::bigint, 420)) iv(nome, dur, n),
       lateral generate_series(0, iv.n - 1) g
 where (k.t_fim + 12 * k.h - g::bigint * iv.dur) % iv.dur = 0;

insert into public.mercado_cobertura (simbolo, intervalo, coberto_de, coberto_ate, fonte_esgotou)
select simbolo, intervalo, min(abriu_em), max(abriu_em), true
  from public.mercado_vela where simbolo like 'P%' group by simbolo, intervalo;

-- As mesas: d = 0 … desks-1. Trader até 69,2%, Pilot depois.
insert into public.bancada_estrategia (dono, chain, nome, params, praca, papel, papel_adiante, simbolos, intervalo,
                                       papel_desde, mesa, criada_em)
select case when d < round(:desks * 0.6923)
            then '0xa' || lpad((d / 3)::text, 39, '0')
            else '0xb' || lpad(((d - round(:desks * 0.6923)::int) / 10)::text, 39, '0') end,
       'evm', 'carga ' || d,
       case when d % 2 = 0
            then '{"entrada":{"tipo":"media","n":20},"direcao":"compra","alvoPct":2,"stopPct":1,"horasLimite":48,"praca":"spot_gate","papel":"taker"}'::jsonb
            else '{}'::jsonb end,
       'spot_gate', 'taker', true,
       (select array_agg('P' || lpad((((d * 7 + j * 3) % 20) + 1)::text, 2, '0')) from generate_series(0, d % 3) j),
       '1h', now() - interval '30 days',
       case when d % 2 = 0 then null when d % 4 = 1 then 'strat_mech' else 'strat_dex' end,
       now() - interval '30 days' + (d * interval '1 second')
  from generate_series(0, :desks - 1) d;

-- Posições ABERTAS em 1/3 das mesas (uma por mesa — a regra da casa), bracket largo para seguirem abertas:
-- exercita o laço de FECHAMENTO, que lê velas por posição.
insert into public.bancada_posicao (dono, estrategia_id, simbolo, lado, entrada, tamanho_usd, alvo_pct, stop_pct,
                                    expira_em, status, aberta_em, vela_em, horas_limite)
select e.dono, e.id, e.simbolos[1], 'long', 100, 1000, 50, 50,
       to_timestamp((k.t_fim + 900 * k.h) / 1000.0), 'aberta',
       to_timestamp((k.t_fim - 50 * k.h) / 1000.0), k.t_fim - 51 * k.h, 900
  from public.bancada_estrategia e, k
 where (e.dono like '0xa%' or e.dono like '0xb%') and (substring(e.nome from 7)::int % 3) = 0;

select count(*) as mesas, count(distinct dono) as donos,
       count(*) filter (where mesa is null) as proprias,
       (select count(*) from public.mercado_vela where simbolo like 'P%') as velas,
       (select count(*) from public.bancada_posicao where status = 'aberta' and (dono like '0xa%' or dono like '0xb%')) as abertas
  from public.bancada_estrategia where dono like '0xa%' or dono like '0xb%';
