-- ÚLFHÉÐNAR — renomeia a caixa de recados dos agentes.
-- (docs/PLANO-ULFHEDNAR.md)
--
-- ⚠️ POR QUE UMA MIGRATION NOVA E NÃO UMA EDIÇÃO DA 0029.
--
-- A 0029 já rodou neste banco. Editá-la faria o arquivo descrever um estado
-- que o banco nunca teve, e a próxima máquina que rodasse a suíte do zero
-- chegaria num lugar diferente do de produção. Migration aplicada é histórico,
-- não rascunho.
--
-- ⚠️ POR QUE O NOME MUDOU. `einherjar` já era o tier pago de US$ 159/mês em
-- `pricing/plans.ts` ("escolhido de Valhalla"), e eu batizei a aba com o mesmo
-- nome sem conferir. Duas coisas com um nome só no mesmo produto é confusão
-- plantada: quem grepasse "einherjar" acharia o plano do cliente e o mural dos
-- agentes na mesma busca.
--
-- E `berserkir` — o primeiro substituto — teria sido pior: `Berserkr` também é
-- tier. Úlfhéðnar ("os de pele de lobo") não colide com nenhum dos três
-- (Drengr / Berserkr / Einherjar).
--
-- Zero linhas na tabela no momento do rename, conferido — é a hora barata.

alter table if exists public.einherjar_mensagens
  rename to ulfhednar_mensagens;

-- Índices seguem a tabela no rename, mas o NOME deles não. Um índice chamado
-- `einherjar_*` numa tabela `ulfhednar_*` é exatamente o tipo de resíduo que
-- faz a próxima pessoa procurar uma tabela que não existe mais.
alter index if exists public.einherjar_nao_lidas_idx
  rename to ulfhednar_nao_lidas_idx;
alter index if exists public.einherjar_recentes_idx
  rename to ulfhednar_recentes_idx;

-- ⚠️ E A CHAVE PRIMÁRIA TAMBÉM. O `rename to` da tabela não toca no índice
-- implícito da PK, que continuou `einherjar_mensagens_pkey` — só apareceu
-- porque eu fui conferir no banco em vez de confiar no `success: true`.
alter index if exists public.einherjar_mensagens_pkey
  rename to ulfhednar_mensagens_pkey;

-- RLS acompanha a tabela: segue habilitada, com ZERO políticas (padrão da
-- casa). O acesso continua só pela service key, atrás de `requireAdmin`.
