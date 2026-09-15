-- ═══════════════════════════════════════════════════════════════════════
-- O TIER DA SESSÃO TEM PRAZO DE VALIDADE — achado A111.
--
-- ⚠️⚠️ O QUE ACONTECIA. O plano era conferido UMA VEZ, ao armar a sessão. A
-- sessão dura horas. Assinatura cancelada, rebaixada ou reembolsada no meio do
-- caminho não chegava a lugar nenhum: o robô seguia operando com a permissão
-- de um plano que a pessoa já não tem.
--
-- ⚠️ E A POLÍTICA PRECISA SER EXPLÍCITA, porque os dois extremos são ruins:
--
--   revalidar a cada passada       uma instabilidade do provedor de assinatura
--                                  derruba a automação de todo mundo — o
--                                  briefing chama isso de transformar
--                                  dependência comercial em indisponibilidade
--                                  de segurança
--
--   nunca revalidar                o que existe hoje
--
-- A escolha: SNAPSHOT COM PRAZO. O tier é carimbado na sessão; enquanto o
-- carimbo for recente, ele vale. Vencido, o worker revalida. Se a revalidação
-- NÃO responder, o carimbo antigo continua valendo até o PRAZO DURO — e depois
-- dele nenhuma ENTRADA nova passa.
--
-- ⚠️ SAÍDA NUNCA É BARRADA, pela mesma razão do certificado: barrar a venda
-- prenderia o cliente numa posição por causa de uma cobrança.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.autopilot_sessions
  add column if not exists tier_snapshot text;
alter table public.autopilot_sessions
  add column if not exists tier_checked_at timestamptz;

comment on column public.autopilot_sessions.tier_snapshot is
  'Plano carimbado na ultima revalidacao. Vencido e sem resposta = so saidas (A111).';
comment on column public.autopilot_sessions.tier_checked_at is
  'Quando o tier foi conferido pela ultima vez. NULL = nunca revalidado desde o armar.';
