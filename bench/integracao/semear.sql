-- Semeadura do teste de integração CE-04/CE-11 — SÓ no Postgres descartável da campanha.
-- 8.761 velas de 1h (um ano + 1) para CE1, com cobertura total; 5.000 rodadas do dono ce-pilot nas últimas 24h.
\set ON_ERROR_STOP 1
delete from public.mercado_vela where simbolo = 'CE1';
delete from public.mercado_cobertura where simbolo = 'CE1';
delete from public.bancada_rodada where dono like 'ce-%' or dono = 'intruso';

-- T0 = 1.700.000.000.000 arredondado para a hora (igual ao teste).
insert into public.mercado_vela (simbolo, intervalo, abriu_em, high, low, close, volume)
select 'CE1', '1h', (1700000000000 - (1700000000000 % 3600000)) + g::bigint * 3600000,
       101 + g % 7, 99 - g % 5, 100 + (g % 11) * 0.1, 1000 + g
  from generate_series(0, 8760) g;

insert into public.mercado_cobertura (simbolo, intervalo, coberto_de, coberto_ate, fonte_esgotou)
values ('CE1', '1h', (1700000000000 - (1700000000000 % 3600000)),
        (1700000000000 - (1700000000000 % 3600000)) + 8760::bigint * 3600000, false);

insert into public.bancada_rodada (dono, chain, capital_usd, simbolos, intervalo, janela_de, janela_ate,
                                   praca, papel, custo_velas, status, criada_em)
select 'ce-pilot', 'evm', 100, array['BTC'], '1d', 1000, 2000, 'spot_gate', 'taker', 1, 'concluida',
       now() - interval '1 hour' - (g * interval '1 second')
  from generate_series(1, 5000) g;

select (select count(*) from public.mercado_vela where simbolo = 'CE1') as velas,
       (select count(*) from public.bancada_rodada where dono = 'ce-pilot') as rodadas;
