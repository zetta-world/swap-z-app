-- ═══════════════════════════════════════════════════════════════════════
-- A SESSÃO PRECISA DIZER QUAL ESTRATÉGIA ELA RODA — achado A110, parte 2.
--
-- ⚠️⚠️ `autopilot_sessions` guardava risco, tetos, símbolos e credencial — e
-- NENHUMA identidade de estratégia. Ou seja: a sessão dizia "quanto" e "onde",
-- nunca "o quê". Sem isso, o certificado da migration 0052 não tem a que se
-- ligar, e "o robô comprou" continua sendo frase sem sujeito.
--
-- ⚠️ NULÁVEL DE PROPÓSITO, e o default é a recusa. As sessões que já existem
-- não têm estratégia declarada; torná-las inválidas por `not null` quebraria o
-- esquema sem fechar nada. O que fecha é o motor de política:
-- SEM `strategy_id` E `strategy_version`, NENHUMA entrada autônoma passa.
--
-- É a mesma direção do resto desta leva — a ausência de prova é recusa, não
-- permissão — e é o fail-closed que o veredito pede para o Autopilot.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.autopilot_sessions
  add column if not exists strategy_id text;
alter table public.autopilot_sessions
  add column if not exists strategy_version integer;
/**
 * ⚠️ O HASH DOS PARÂMETROS COM QUE ESTA SESSÃO VAI RODAR. É o que permite ao
 * certificado recusar quando os parâmetros mudaram por baixo dele — a evidência
 * é de outra hipótese.
 */
alter table public.autopilot_sessions
  add column if not exists strategy_hash text;

comment on column public.autopilot_sessions.strategy_id is
  'Identidade da estrategia. NULL = nenhuma entrada autonoma passa (achado A110).';

-- ⚠️ Meia identidade é pior que nenhuma: `strategy_id` sem versão não aponta
-- para certificado nenhum, e dá a impressão de que a sessão está identificada.
alter table public.autopilot_sessions
  drop constraint if exists sessao_estrategia_completa;
alter table public.autopilot_sessions
  add constraint sessao_estrategia_completa
  check ((strategy_id is null and strategy_version is null)
      or (strategy_id is not null and strategy_version is not null));
