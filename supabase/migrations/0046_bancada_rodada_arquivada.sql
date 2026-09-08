-- ═══════════════════════════════════════════════════════════════════════
-- ZERAR "MINHAS RODADAS" — e contar do zero a partir de hoje (08/09)
--
-- ⚠️⚠️ PEDIDO DO DONO, e o motivo dele é bom: *"deixa zerado a aba minhas
-- rodadas, quero que só apareça as rodadas abertas a partir de hoje"*.
--
-- As rodadas antigas do histórico dele estão poluídas de três formas, todas
-- consertadas HOJE, e nenhuma delas some retroativamente da linha gravada:
--
--   · duas levam nome de mesa que aquele código NÃO rodava (ULLR e FREYJA
--     devolveram o mesmo `+2,140788280112371%` da VÖLUNDR, com o mesmo
--     playbook, porque `rodarMesa` não recebia a mesa);
--   · algumas nasceram antes de o resultado guardar `competidor_pct` e
--     `nao_medido_chaves` (0042), então voltam sem a comparação e sem as
--     ressalvas traduzíveis;
--   · todas foram lidas sob o rótulo "mesa da casa", que descrevia a origem da
--     REGRA e se lia como a origem do NÚMERO — o dono leu assim duas vezes.
--
-- ⚠️ ARQUIVA, NÃO APAGA — e aqui isso não é preciosismo. `bancada_operacao` e
-- `bancada_resultado` apontam para estas linhas: deletar transformaria extrato
-- medido em órfão, e o cliente perderia a prova do que ele mesmo rodou. A linha
-- continua no banco, verificável; ela só sai da TELA.
--
-- ⚠️ E O CARIMBO É ÚNICO para todo o passado, aplicado num UPDATE só: um
-- `arquivada_em` diferente por linha sugeriria que cada uma foi arquivada por
-- um motivo próprio, quando o motivo é um só e é esta migration.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.bancada_rodada
  add column if not exists arquivada_em timestamptz;

comment on column public.bancada_rodada.arquivada_em is
  'Rodada fora da tela do cliente. A linha CONTINUA no banco (bancada_operacao e bancada_resultado apontam para ela); ela so nao e listada.';

-- ⚠️ O "zerar": tudo que existe hoje sai da tela. O que for rodado depois
-- nasce com `arquivada_em` NULO e aparece normalmente.
update public.bancada_rodada
   set arquivada_em = now()
 where arquivada_em is null;

-- ⚠️ O índice cobre a leitura da tela: "as minhas, não arquivadas, mais novas
-- primeiro". Sem ele, o filtro novo faria a listagem varrer o histórico inteiro
-- de todo cliente a cada abertura da aba.
create index if not exists bancada_rodada_vivas_idx
  on public.bancada_rodada (dono, criada_em desc)
  where arquivada_em is null;
