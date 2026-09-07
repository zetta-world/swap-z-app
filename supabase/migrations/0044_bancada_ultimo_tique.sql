-- ═══════════════════════════════════════════════════════════════════════
-- O AGENTE PRECISA SABER DIZER O QUE ELE ACABOU DE FAZER — 07/09
--
-- ⚠️⚠️ O DONO, DEPOIS DE CONTRATAR A FREYJA: *"ao contratar o agente deveria
-- aparecer aí no próprio agente, as informações e resultados em tempo real"*.
--
-- O que o card conseguia dizer era "esperando setup". Verdadeiro e inútil: ele
-- não distingue as três coisas que o investidor precisa separar —
--
--   · o agente VERIFICOU e decidiu ficar de fora (e existe um motivo);
--   · o agente não verificou ainda (contratado há 3 minutos, o cron é de 30);
--   · o agente está QUEBRADO e ninguém sabe.
--
-- As três desenham a mesma tela. É a mesma família de defeito que fez o Maker
-- de Faixa ficar dois dias sem abrir posição sem ninguém notar — e ali éramos
-- NÓS, com acesso ao banco. O investidor não tem nem isso.
--
-- ⚠️ UMA COLUNA JSONB, não três colunas escalares. O que precisa ser guardado é
-- POR SÍMBOLO: uma instância vigia até cinco, e cada um tem o seu motivo e o seu
-- último preço visto. Três colunas obrigariam a escolher um símbolo para
-- representar os outros — e a tela mentiria por omissão sobre os quatro
-- restantes.
--
-- ⚠️ E ELA GUARDA O QUE O TIQUE VIU, não uma cotação ao vivo. O cron anda de 30
-- em 30 minutos; o preço aqui é o fechamento da última vela que ELE leu. A tela
-- diz a idade do dado junto com o dado, sempre. Chamar isso de "tempo real"
-- sem o carimbo seria criar a expectativa errada — a mesma nota que já existe
-- na seção das mesas vivas.
--
-- ⚠️ MELHOR-ESFORÇO NA ESCRITA: falhar aqui NÃO pode derrubar o tique. Perder o
-- registro do que aconteceu é ruim; perder a posição que ia abrir é pior.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.bancada_estrategia
  add column if not exists ultimo_tique jsonb;

comment on column public.bancada_estrategia.ultimo_tique is
  'O que o cron viu na ultima passagem por esta linha: { em: unix_ms, simbolos: { BTC: { preco, motivo, abriu } } }. NULO = ainda nao foi verificada.';
