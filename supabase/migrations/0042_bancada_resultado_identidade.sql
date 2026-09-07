-- ═══════════════════════════════════════════════════════════════════════
-- O RESULTADO PRECISA SOBREVIVER À RECARGA DA PÁGINA — 07/09
--
-- O dono, diante de duas rodadas seguidas na bancada: *"cada teste que rodo
-- sobrepõe o outro, e não mostra qual agente está rodando, não dá pra saber o
-- que está rodando"*. A rodada e o resultado JÁ estavam gravados; o que faltava
-- era a tela poder relê-los — e, relendo, dizer a mesma coisa que dizia na
-- hora.
--
-- Duas colunas separam "a tela lembra" de "a tela reconstrói por chute":
--
--  1. `competidor_pct` — quanto rendeu FICAR EM CAIXA na mesma janela. Ele já
--     ia na resposta HTTP e morria com ela. Sem gravá-lo, o histórico teria de
--     escolher entre não mostrar a comparação (perdendo a metade que importa do
--     veredito — a Rotação rendeu −1,61% e ficar parado bateu) ou inventá-la.
--     ⚠️ NULO É "NÃO MEDIDO", NUNCA ZERO: zero afirmaria que o mercado ficou
--     parado, e `Number(null)` é 0 e passa em `isFinite` — a cicatriz mais
--     barata de repetir nesta base.
--
--  2. `nao_medido_chaves` — as CHAVES do que não foi medido, não a prosa.
--     `nao_medido` guarda frases em português, escritas quando só havia uma
--     tela em português. A bancada fala quatro idiomas. Guardar a chave
--     (`derrapagem`, `gas`, `bracketVariavel`, `competidor`) deixa a tradução
--     do lado de quem lê — e as duas colunas convivem: a prosa continua sendo o
--     registro legível de quem abrir o banco, e ela ainda carrega os problemas
--     de leitura ("BTC 1h: só chegaram 66% da janela") que não têm chave.
--
-- ⚠️ AS DUAS SÃO ADITIVAS E TOLERAM O PASSADO. Rodada gravada antes de hoje não
-- tem competidor: ela fica NULA, e a tela mostra "—". Preencher com 0 seria
-- reescrever a história com um número que ninguém mediu.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.bancada_resultado
  add column if not exists competidor_pct numeric;

comment on column public.bancada_resultado.competidor_pct is
  'Retorno de FICAR EM CAIXA na mesma janela, em %. NULO = não medido, nunca 0.';

alter table public.bancada_resultado
  add column if not exists nao_medido_chaves jsonb not null default '[]'::jsonb;

comment on column public.bancada_resultado.nao_medido_chaves is
  'As chaves de `NAO_MEDIDO` (veredito.ts), para a tela traduzir. A prosa fica em `nao_medido`.';
