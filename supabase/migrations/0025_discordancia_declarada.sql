-- DISCORDÂNCIA DECLARADA — a terceira saída que o texto oferecia e não existia.
--
-- ⚠️ `conferirLivro` sempre disse que uma discordância entre o registro e o
-- livro tem três saídas: remedir, corrigir o registro, ou — "se a discordância
-- for de propósito, escrevê-la". A terceira não tinha ONDE ser escrita.
--
-- Sem campo, uma discordância PENSADA e uma ESQUECIDA acusam igual, para
-- sempre. E um alarme que não pode ser respondido é um alarme que se aprende a
-- ignorar — aí ele deixa de valer para a linha que importa.
--
-- ⚠️ TEXTO, NÃO BOOLEANO. `discorda: true` calaria o alarme sem obrigar
-- ninguém a defender a posição, e daqui a três meses ninguém saberia se foi
-- decisão ou preguiça. Preencher isto é caro de propósito.
--
-- ⚠️ E A COLUNA EXISTE PARA SER LIDA. O detector funciona a partir do registro
-- em código; esta coluna é o que leva o motivo até a TELA, no mesmo lugar onde
-- a discordância aparecia. Silenciador que ninguém consegue ler é a invariante
-- nº 14 outra vez, agora dentro do próprio detector.

alter table public.lab_strategies
  add column if not exists disagrees_with_ledger_why text;

comment on column public.lab_strategies.disagrees_with_ledger_why is
  'Por que o registro discorda do último veredito do livro, DE PROPÓSITO. '
  'Preenchido só quando a leitura humana vence o resumo automático; dispensa '
  'apenas a discordância de estado, nunca veredito-sem-parcela nem rodada '
  'pendurada.';
