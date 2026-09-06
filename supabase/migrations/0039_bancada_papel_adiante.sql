-- ── O PAPEL ADIANTE: o que a estratégia precisa para TICKAR ─────────
--
-- Fase 6 de docs/PLANO-BANCADA-DO-CLIENTE.md.
--
-- ⚠️⚠️ ESTE É O ÚNICO CUSTO DA BANCADA QUE RECORRE (§6.3), e por isso ele
-- começa em `trader` e não em `pro`: pôr o custo permanente no plano pago mais
-- barato inverte a margem. Backtest é o passado obedecendo; papel adiante é o
-- presente discordando, e é isso que se paga para ver.
--
-- ⚠️ O QUE FALTAVA em `bancada_estrategia` (0037): ela guardava a REGRA
-- (gatilho, alvo, stop, praça) e nada sobre ONDE e COM QUE GRANULARIDADE
-- aplicá-la. Para um backtest isso vinha no pedido; para uma mesa que tick a
-- cada 30 minutos, precisa morar na linha.

alter table public.bancada_estrategia
  -- ⚠️ O INTERRUPTOR, e ele nasce DESLIGADO. Uma estratégia salva não começa a
  -- consumir cron por ter sido salva: ligar é ato explícito do cliente, e é o
  -- ato que a cota de mesas conta.
  add column if not exists papel_adiante boolean not null default false,

  -- Os símbolos que esta mesa acompanha. ⚠️ Vazio = a mesa não tem o que
  -- tickar, e o cron a ignora em vez de adivinhar um símbolo.
  add column if not exists simbolos text[] not null default '{}',

  -- A granularidade da vela que o gatilho lê.
  add column if not exists intervalo text not null default '1h',

  -- ⚠️ QUANDO A MESA FOI LIGADA. Serve para a tela dizer há quanto tempo ela
  -- roda — um resultado de papel adiante sem o tempo decorrido é o mesmo
  -- defeito do número sem amostra.
  add column if not exists papel_desde timestamptz;

-- ⚠️ O ÍNDICE QUE O CRON USA. Ele varre "todas as mesas ligadas" a cada 30
-- minutos; sem isto varreria a tabela inteira de estratégias salvas, que
-- cresce com cada cliente e nunca encolhe (arquivar não apaga).
create index if not exists bancada_estrategia_papel_idx
  on public.bancada_estrategia (papel_adiante, dono) where papel_adiante;

comment on column public.bancada_estrategia.papel_adiante is
  'Interruptor da mesa viva. Nasce DESLIGADO: ligar e ato explicito do cliente, e e o ato que a cota de mesas (BANCADA_COTAS.mesasDePapel) conta.';
comment on column public.bancada_estrategia.simbolos is
  'Simbolos que a mesa acompanha. Vazio = o cron ignora, em vez de adivinhar.';
