-- ═══════════════════════════════════════════════════════════════════════
-- ESTRATÉGIA CERTIFICADA — FASE 5. Achado A110.
--
-- ⚠️⚠️ O QUE NÃO EXISTIA. Hoje, autorizar uma CARTEIRA equivale a autorizar
-- QUALQUER estratégia a movimentar o dinheiro dela. São coisas diferentes:
--
--     "o usuário está autorizado"   ≠   "esta estratégia pode operar"
--
-- Um intent autônomo precisa dizer QUAL estratégia, em QUAL versão, e apontar
-- para a evidência que qualificou aquela versão. Sem isso, "o robô comprou" é
-- uma frase sem sujeito — e revogar uma estratégia ruim não tem onde pegar.
--
-- ⚠️ O CERTIFICADO É SOBRE A VERSÃO, NÃO SOBRE A ESTRATÉGIA. Mudar um parâmetro
-- cria outra hipótese: a evidência da anterior não vale para ela. É por isso
-- que `strategy_hash` existe — ele amarra o certificado ao conteúdo exato dos
-- parâmetros, e uma alteração silenciosa deixa de casar.
--
-- ⚠️ REVOGAR TEM DE SER INSTANTÂNEO E FAIL-CLOSED. `revoked_at` preenchido
-- impede intent NOVO daquela estratégia (INVARIANTE 14). Não mata ordem viva —
-- isso é reconciliação, não revogação — mas fecha a torneira.
-- ═══════════════════════════════════════════════════════════════════════

create table if not exists public.strategy_certificates (
  id                   uuid primary key default gen_random_uuid(),

  strategy_id          text        not null,
  strategy_version     integer     not null check (strategy_version > 0),
  /**
   * ⚠️ O HASH DOS PARÂMETROS QUE DEFINEM A ESTRATÉGIA. É o que impede um
   * certificado de cobrir uma estratégia que mudou por baixo dele.
   */
  strategy_hash        text        not null,
  certificate_version  integer     not null default 1,

  -- ── A EVIDÊNCIA ────────────────────────────────────────────────────────
  /**
   * ⚠️ O CERTIFICADO TEM DE PODER PROVAR O QUE O QUALIFICOU. `evidence` carrega
   * OOS, walk-forward e papel; `sample_size` e `cost_assumptions` ficam em
   * coluna própria porque são as duas que esta casa já viu mentirem sozinhas:
   * amostra pequena demais e custo subestimado transformam ruído em estratégia.
   */
  evidence             jsonb       not null,
  sample_size          integer              check (sample_size is null or sample_size >= 0),
  cost_assumptions     jsonb,

  -- ── OS LIMITES ─────────────────────────────────────────────────────────
  /**
   * ⚠️ LIMITES NO CERTIFICADO, não só na sessão. A sessão diz quanto o USUÁRIO
   * aceita arriscar; o certificado diz dentro de que envelope a evidência foi
   * colhida. Operar fora do envelope é usar a evidência para outra coisa.
   * Vale o MENOR dos dois — ver `certificado.ts`.
   */
  risk_limits          jsonb       not null,
  allowed_venues       text[]      not null,
  allowed_symbols      text[]      not null,

  -- ── A VALIDADE ─────────────────────────────────────────────────────────
  valid_from           timestamptz not null default now(),
  valid_until          timestamptz,
  revoked_at           timestamptz,
  revoked_reason       text,

  created_at           timestamptz not null default now(),
  created_by           text,
  notes                text,

  constraint cert_janela_coerente
    check (valid_until is null or valid_until > valid_from),
  -- ⚠️ Revogar sem dizer por quê é revogar sem deixar rastro.
  constraint cert_revogacao_tem_motivo
    check (revoked_at is null or revoked_reason is not null)
);

comment on table public.strategy_certificates is
  'Certificado por VERSAO de estrategia. Autorizar carteira != autorizar estrategia. Achado A110.';

-- ⚠️ UM CERTIFICADO VIVO POR VERSÃO. Dois vivos para a mesma versão fariam a
-- pergunta "sob qual envelope isto rodou?" deixar de ter resposta.
create unique index if not exists idx_cert_um_vivo_por_versao
  on public.strategy_certificates (strategy_id, strategy_version)
  where revoked_at is null;

create index if not exists idx_cert_por_estrategia
  on public.strategy_certificates (strategy_id, valid_from desc);

-- ⚠️ RLS ligada, ZERO políticas: o padrão da casa. Acesso só server-side.
alter table public.strategy_certificates enable row level security;

-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ O ELO É OBRIGATÓRIO PARA INTENT AUTÔNOMO — INVARIANTE 13.
--
-- Um intent com `autonomous = true` e sem `certificate_id` é exatamente o
-- estado que o A110 descreve: dinheiro movido por "alguma estratégia". A trava
-- fica no BANCO porque código de aplicação não pode ser a única barreira do
-- caminho de dinheiro — o executor confere antes, e esta constraint garante que
-- nenhum caminho futuro consiga contornar.
--
-- ⚠️ MANUAL NÃO PRECISA, de propósito: ali existe um humano decidindo cada
-- ordem, e é ele o sujeito da frase.
--
-- ⚠️ SIMULADO TAMBÉM NÃO, e isto é decisão consciente com custo declarado:
-- nenhum dinheiro se move, e o veredito da auditoria lista DCA simulado como
-- GO. Exigir certificado ali pararia a única coisa que hoje pode rodar sem
-- risco. O preço é que `simulated = true` vira um campo que importa — ele é
-- escrito server-side a partir de `dca_planos.modo`, nunca vem do cliente.
--
-- ⚠️ CONSEQUÊNCIA DIRETA E PRETENDIDA: enquanto não existir certificado
-- nenhum, TODA execução autônoma REAL é recusada pelo banco. É o fail-closed
-- que o veredito pede (Autopilot NO-GO, Pilot NO-GO, DCA real NO-GO) — e ele
-- passa a ser propriedade do esquema, não lembrete de quem configura.
-- ═══════════════════════════════════════════════════════════════════════
alter table public.cex_execution_intents
  drop constraint if exists cex_intent_autonomo_tem_certificado;
--
-- ⚠️⚠️ E A SAÍDA É ISENTA — a decisão mais delicada deste arquivo.
--
-- Certificado porteia ENTRADA, que é tomar risco. Exigi-lo para VENDER seria
-- exigir uma licença para REDUZIR exposição: uma sessão cujo certificado
-- expirou ou foi revogado ficaria com a posição presa, sem poder sair
-- sozinha. Um mecanismo de segurança que cria exatamente o perigo que existe
-- para evitar não é conservador — é perigoso com cara de rigor.
--
-- O risco aceito em troca: uma estratégia revogada ainda consegue emitir
-- ordens de VENDA. É o comportamento desejado — queremos que ela consiga sair.
alter table public.cex_execution_intents
  add constraint cex_intent_autonomo_tem_certificado
  check (not autonomous or simulated or side = 'sell' or certificate_id is not null);

alter table public.cex_execution_intents
  drop constraint if exists cex_intent_certificado_fk;
alter table public.cex_execution_intents
  add constraint cex_intent_certificado_fk
  foreign key (certificate_id) references public.strategy_certificates(id)
  on delete restrict;
