-- ═══════════════════════════════════════════════════════════════════════
-- "ADIADO PELO TETO" NÃO É "PAROU DE FUNCIONAR" — 07/09
--
-- ⚠️⚠️ ESTA FUNÇÃO EXISTE PARA IMPEDIR UM ALARME FALSO, e o defeito foi achado
-- numa auditoria do código que subiu HOJE.
--
-- `aVezDeQuem` (papel.ts) gira uma janela de `AGENTES_POR_TICK = 8` instâncias
-- por passagem. Com 10 agentes — o teto do plano `pilot` —, cada instância perde
-- a vez uma vez a cada cinco ciclos, e o intervalo entre duas avaliações cai
-- exatamente na fronteira dos 60 minutos que `saudeDoTique` usa para gritar
-- `atrasado`.
--
-- O resultado seria o pior tipo de alarme possível: o ÚNICO aviso que o
-- investidor tem disparando por limitação NOSSA, e culpando o agente DELE.
-- Depois de duas ou três vezes ele aprende a ignorar o aviso — que é o mesmo
-- efeito de não ter aviso, com mais ruído.
--
-- ⚠️ POR QUE UMA FUNÇÃO, E NÃO UM UPDATE DA APLICAÇÃO. O carimbo precisa entrar
-- no jsonb SEM apagar `simbolos`, que é a última avaliação de verdade e é o que
-- a tela mostra enquanto a próxima não chega. Ler-modificar-gravar por linha
-- seriam duas idas ao banco por instância adiada, dentro do laço do cron, com
-- uma janela em que duas passagens se sobrescrevem. `jsonb_set` resolve no
-- servidor, num UPDATE só, para todas as adiadas de uma vez.
--
-- ⚠️ SEM `dono` NO FILTRO, e é seguro: ela é chamada SÓ pelo cron, que não tem
-- sessão e varre o mundo — a mesma justificativa de `mesasLigadasParaOCron`. Ela
-- não lê nem devolve linha nenhuma: só carimba. Se aparecer numa rota de
-- cliente, é erro de revisão, não de segurança — não há dado a vazar.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.bancada_marcar_adiado(ids uuid[], em bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.bancada_estrategia
     set ultimo_tique = jsonb_set(
           -- ⚠️ `coalesce`: a instância adiada ANTES de alguma vez ser avaliada
           -- ainda não tem `ultimo_tique`. Sem isto, `jsonb_set` sobre NULL
           -- devolve NULL e o carimbo se perderia justamente em quem mais
           -- precisa dele — a recém-contratada que nunca ganhou a vez.
           coalesce(ultimo_tique, '{}'::jsonb),
           '{adiadaEm}',
           to_jsonb(em),
           true
         )
   where id = any(ids);
$$;

comment on function public.bancada_marcar_adiado(uuid[], bigint) is
  'Carimba `adiadaEm` nas instancias que o teto de trabalho do cron deixou de fora, sem apagar `simbolos`. Impede que "adiado pela casa" seja lido como "o agente parou".';

revoke all on function public.bancada_marcar_adiado(uuid[], bigint) from public, anon, authenticated;
