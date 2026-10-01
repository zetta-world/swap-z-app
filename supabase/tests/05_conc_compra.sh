SOCK=/var/tmp/zswap-pg/pgsock
run() { runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A -c "$1"; }
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A > /var/tmp/zswap-pg/b1.out 2>&1 <<'Q' &
begin;
select 'D='||(public.autopilot_reservar_exposicao_do_intent('dddddddd-0000-0000-0000-00000000000d', 10, 200)::text);
select pg_sleep(2);
commit;
Q
sleep 0.5
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A > /var/tmp/zswap-pg/b2.out 2>&1 <<'Q'
begin;
select 'E='||(public.autopilot_reservar_exposicao_do_intent('eeeeeeee-0000-0000-0000-00000000000e', 10, 200)::text);
commit;
Q
wait
echo "--- D ---"; grep -E "^D=" /var/tmp/zswap-pg/b1.out
echo "--- E ---"; grep -E "^E=" /var/tmp/zswap-pg/b2.out
run "select 'EXPOSICAO '||coalesce(sum(cost_usd),0)||' + COMPROMETIDO '||(select coalesce(sum(reservado_usd),0) from autopilot_position_effects where session_id='33333333-3333-3333-3333-333333333333' and side='buy') from autopilot_positions where session_id='33333333-3333-3333-3333-333333333333'"
