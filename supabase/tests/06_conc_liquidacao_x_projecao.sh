SOCK=/var/tmp/zswap-pg/pgsock
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A > /var/tmp/zswap-pg/l1.out 2>&1 <<'Q' &
begin;
select 'LIQ='||(public.autopilot_liquidar_saida_armada('66666666-6666-6666-6666-666666666666', 0.01, 100)::text);
select pg_sleep(2);
commit;
Q
sleep 0.4
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A > /var/tmp/zswap-pg/l2.out 2>&1 <<'Q'
begin;
select 'PROJ='||(public.autopilot_projetar_efeito_do_intent('66666666-6666-6666-6666-666666666666')::text);
commit;
Q
wait
grep -E "^LIQ=|^PROJ=" /var/tmp/zswap-pg/l1.out /var/tmp/zswap-pg/l2.out
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A -c "
select 'pnl_today='||pnl_today||' | aplicado='||(select pnl_aplicado_usd from autopilot_position_effects where intent_id='66666666-6666-6666-6666-666666666666')||' | posicoes_LTC='||(select count(*) from autopilot_positions where session_id='33333333-3333-3333-3333-333333333333' and base='LTC')
  from autopilot_sessions where id='33333333-3333-3333-3333-333333333333'"
