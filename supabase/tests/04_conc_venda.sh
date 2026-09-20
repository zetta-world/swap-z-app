SOCK=/var/tmp/zswap-pg/pgsock
run() { runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A -c "$1"; }
# proc1 segura a linha por 2s dentro da transacao
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A > /var/tmp/zswap-pg/p1.out 2>&1 <<'Q' &
begin;
select 'A='||(public.autopilot_reservar_venda_do_intent('aaaaaaaa-0000-0000-0000-00000000000a', 0.01)->>'qtd');
select pg_sleep(2);
commit;
Q
sleep 0.5
runuser -u postgres -- psql -h $SOCK -p 55432 -U postgres -d zswap -t -A > /var/tmp/zswap-pg/p2.out 2>&1 <<'Q'
begin;
select 'B='||coalesce(public.autopilot_reservar_venda_do_intent('bbbbbbbb-0000-0000-0000-00000000000b', 0.01)->>'qtd',
                      'RECUSADA:'||(public.autopilot_reservar_venda_do_intent('bbbbbbbb-0000-0000-0000-00000000000b', 0.01)->>'motivo'));
commit;
Q
wait
echo "--- p1 ---"; grep -E "^A=" /var/tmp/zswap-pg/p1.out
echo "--- p2 ---"; grep -E "^B=" /var/tmp/zswap-pg/p2.out
run "select 'RESERVADO TOTAL: '||coalesce(sum(reservado_qty),0) from autopilot_position_effects where session_id='33333333-3333-3333-3333-333333333333' and base='BTC'"
