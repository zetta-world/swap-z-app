-- ── DE QUAL VELA VEIO O SINAL ───────────────────────────────────────
--
-- ⚠️⚠️ CONSERTO DE UM REMENDO QUE EU IA DEIXAR (06/09).
--
-- O tick do papel adiante precisa saber de QUAL VELA nasceu a posição, para não
-- abrir duas vezes no mesmo sinal: o cron roda a cada 30 minutos e a vela pode
-- ser de 1h, então sem essa marca o MESMO cruzamento seria lido duas vezes.
--
-- Eu ia guardar isso em `expira_em`, com um comentário pedindo desculpa. Duas
-- razões para não:
--
--   1. `expira_em` significa outra coisa e a tela a mostra como expiração —
--      escrever ali faz a interface mentir;
--   2. ⚠️ usar `aberta_em` (quando a LINHA foi criada) também não serve, e o
--      erro é sutil: uma posição aberta às 05h01 a partir da vela das 04h
--      bloquearia a vela das 05h, porque 05h < 05h01. A guarda passaria a
--      recusar sinais legítimos, e ninguém veria — a mesa só ficaria quieta.
--
-- O instante da VELA é um dado próprio, e ganha coluna própria.

alter table public.bancada_posicao
  add column if not exists vela_em bigint;

comment on column public.bancada_posicao.vela_em is
  'Instante de ABERTURA da vela que disparou o sinal (unix ms). E ele que impede o mesmo cruzamento de abrir duas vezes quando o cron tick mais rapido que a vela fecha. NAO confundir com aberta_em (quando a linha foi criada) nem com expira_em.';
