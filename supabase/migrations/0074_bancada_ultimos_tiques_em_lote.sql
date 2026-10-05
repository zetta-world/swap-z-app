-- ═══════════════════════════════════════════════════════════════════════════
-- 0074 — TIQUE DA BANCADA: o "último tique" de MUITAS mesas numa escrita só (CE-09/CE-12, cost engineering round).
-- NÃO aplicada em produção. Lane B, local. Prova: supabase/tests/21_bancada_ultimos_tiques_em_lote.sql
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POR QUÊ: o tique gravava `ultimo_tique` com um PATCH por mesa avaliada. Com a fila consertada (todas as mesas
-- entram, não só as 200 mais antigas), avaliar 3.250 desks viraria 3.250 requisições de escrita por tique —
-- o novo gargalo do tique, medido no teste de carga (CE-10). Esta função recebe o lote e faz um UPDATE só.
--
-- ⚠️ A POSSE CONTINUA CONFERIDA POR LINHA: cada item traz `id` E `dono`, e só atualiza quando os dois batem —
-- a mesma guarda de `gravarUltimoTique` (`.eq("dono", dono).eq("id", id)`). Item sem par não escreve nada.
-- ⚠️ Mesmo formato do valor gravado hoje: `{ em, simbolos }` — a leitura (`ultimo-tique.ts`) não muda. Uma marca
-- `adiadaEm` anterior (0045) é SUBSTITUÍDA, igual ao PATCH antigo, porque a mesa acabou de ser avaliada.
-- ⚠️ ACL: security definer + search_path fixo; EXECUTE só para service_role (padrão 0055; guarda rpcs-acl).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.bancada_gravar_ultimos_tiques(p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'bancada_gravar_ultimos_tiques: itens precisam ser um array' using errcode = '22023';
  end if;

  update public.bancada_estrategia e
     set ultimo_tique = jsonb_build_object('em', (i->>'em')::bigint, 'simbolos', coalesce(i->'simbolos', '{}'::jsonb))
    from jsonb_array_elements(p_itens) i
   where e.id = (i->>'id')::uuid
     and e.dono = i->>'dono';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.bancada_gravar_ultimos_tiques(jsonb) from public, anon, authenticated;
grant execute on function public.bancada_gravar_ultimos_tiques(jsonb) to service_role;
