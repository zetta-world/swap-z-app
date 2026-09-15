-- ═══════════════════════════════════════════════════════════════════════
-- REVERTER UM GENOMA NÃO PODE DEIXAR O AGENTE SEM NENHUM — 15/09
--
-- ⚠️⚠️ ACHADO A06 DA AUDITORIA EXTERNA: o fechamento do Celeiro não era atômico
-- nem idempotente.
--
-- `fecharMutacao` fazia QUATRO escritas soltas, nesta ordem:
--
--   1. marca a mutação como julgada (e carimba `revertida_em`);
--   2. lê as duas últimas versões do genoma;
--   3. desativa a versão atual;
--   4. ativa a anterior.
--
-- ⚠️ ENTRE 3 E 4 O AGENTE FICA SEM GENOMA ATIVO. Não é um estado degradado —
-- é o agente sem os parâmetros com que opera. E nada denunciava: a função
-- devolvia `void` e o `error` de cada escrita era descartado, então quem chama
-- não tinha o que conferir.
--
-- ⚠️ POR QUE NÃO BASTA INVERTER A ORDEM. O índice parcial
-- `celeiro_genoma_um_ativo on (agente) where ativo` permite UMA versão ativa por
-- agente. Ativar a anterior antes de desativar a atual viola a restrição —
-- medido contra o banco de produção, que devolve 23505. A ordem segura não
-- existe fora de uma transação.
--
-- O corpo de uma função plpgsql roda numa transação só: as duas escritas
-- entram juntas ou nenhuma entra. É o mesmo motivo de `apply_session_pnl` e
-- `bump_session_trades` existirem.
--
-- ⚠️ IDEMPOTENTE POR CONSTRUÇÃO. Reexecutar não muda mais nada: a "anterior" é
-- calculada por `versao`, que não depende de `ativo`. Rodar duas vezes deixa o
-- mesmo genoma ativo que a primeira deixou — medido.
--
-- ⚠️ DEVOLVE A VERSÃO REATIVADA (ou NULL quando não há anterior), para quem
-- chama poder distinguir "reverti" de "não havia o que reverter" — que é
-- diferente de "falhou", e antes as três liam igual.
--
-- ⚠️ SEM `dono` NO FILTRO: `celeiro_genoma` é a cozinha da casa, não do cliente
-- — não há dado de cliente aqui para vazar. Mesma justificativa das irmãs.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.celeiro_reverter_genoma(p_agente text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior integer;
begin
  -- A versão imediatamente anterior à mais alta. `offset 1` em vez de
  -- `limit 2` na aplicação: a escolha vira parte da transação.
  select versao into v_anterior
    from public.celeiro_genoma
   where agente = p_agente
   order by versao desc
   offset 1 limit 1;

  if v_anterior is null then
    return null;   -- genoma de versão única: não há para onde voltar.
  end if;

  -- Desativa antes de ativar: o índice parcial não admite dois ativos, e
  -- dentro da transação o vazio intermediário não é observável de fora.
  update public.celeiro_genoma
     set ativo = false
   where agente = p_agente and ativo;

  update public.celeiro_genoma
     set ativo = true
   where agente = p_agente and versao = v_anterior;

  return v_anterior;
end;
$$;

comment on function public.celeiro_reverter_genoma(text) is
  'Reverte o genoma de um agente para a versao anterior, atomicamente. '
  'Devolve a versao reativada, ou NULL quando nao ha anterior. Achado A06.';
