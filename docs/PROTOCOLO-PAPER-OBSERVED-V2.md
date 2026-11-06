# Protocolo prospectivo — paper-observed-v2

Status: CURRENT_DEVELOPMENT. Preparado em 06/11/2026 antes da coleta prospectiva.
Não é comprovação de rentabilidade nem autorização para aumentar risco real.

## Fronteira e identidade

A coorte ainda NÃO começou. O horário de corte não será retroativo nem inferido da data do commit.
Depois da certificação e publicação autorizada, registrar fora do repo um manifesto com:
SHA servido, deployment, horário UTC verificado, fim das execuções antigas em voo,
versão `paper-observed-v2`, hash deste protocolo, configuração efetiva e versões dos genomas.
A fronteira será posterior à drenagem dos workers antigos. Sem essa evidência, a coorte não é elegível.

Classificar por instante de ABERTURA/criação, nunca somente por fechamento. Posições abertas
antes da fronteira são legado, mesmo que fechem depois. Não zerar bancos/saldos, apagar perdas,
liberar capital sem reconciliação ou chamar o resultado histórico da versão nova de prospectivo.
Como não há coluna de coorte nova, a seleção é externa e auditável, por IDs e fronteira UTC;
salvar hash do conjunto selecionado e contagens. Mudança de código/configuração/genoma encerra
aquela coorte e exige outra identidade. Não misturar os dois conjuntos.

## Elegibilidade e contenções

- Funding, Convergência e Pool Novo ficam fora do placar econômico e sem novas entradas,
  fechamentos legados ou mutações por seus writers. Posições existentes continuam registradas,
  pendentes de reconciliação; não transformá-las em lucro zero nem contabilizá-las como medidas.
- Demais modelos continuam sendo simulações. Elegibilidade para observar não significa
  modelagem financeira completa ou prova de vantagem. Taxas e regras precisam acompanhar cada resultado.
  O varredor dos modelos restantes do Celeiro ainda decide por preço do tick (`varrerAbertas`/
  `deveFechar`), sem reconstruir os toques entre execuções. Não atribuir a ele a garantia de
  cobertura contínua implementada em Paper/torneio/bancada; é pendência própria da medição.
- Mutações e promoções automáticas ficam congeladas durante a calibração. O cull não escolhe
  campeão novo; Paper não aplica bônus do campeão histórico. Travas antigas de orçamento permanecem.
- OHLC usa abertura + duração explícita. Vela em andamento, lacuna, toque ambíguo na vela de
  entrada/vencimento ou ausência de preço no prazo não autorizam desfecho econômico.
- Torneio termina cobertura insuficiente como `unresolvable` depois da carência, P&L nulo.
  Paper/bancada mantêm posições sem prova pendentes, sem devolver capital fictício. Isso pode
  reduzir a capacidade de novas entradas e deve aparecer no relatório.
- Expiração não alinhada ao fechamento de vela não tem preço exato demonstrável por OHLC.
  Não usar preço atual tardio para resolvê-la. Antes de ampliar a experiência, projetar um
  contrato de expiração observável (com preço/instante efetivo persistidos) e certificar separadamente.

## Relatório obrigatório por motor, estratégia e versão

Registrar universo de oportunidades/entradas, recusas, abertas, fechadas com prova,
pendentes vencidas, insolúveis e causas de exclusão. Mostrar fração sem cobertura e capital
preso separadamente. Não avaliar apenas o subconjunto resolvido como se fosse toda a estratégia.

Para resultados demonstráveis: bruto, taxas de entrada/saída, slippage, funding e gas aplicáveis,
líquido, custos desconhecidos como desconhecidos, saldo, patrimônio com marcação a mercado,
exposição média/máxima e tempo exposto. Não usar drawdown só de fechamentos como drawdown da carteira.
Sem cotações/curva suficientes, drawdown e patrimônio são não medidos, nunca zero.

Comparar caixa, referência de aluguel hipotética e comprar/manter com capital, período e
exposição declarados. Rendimento hipotético não é rendimento realizado. Torneio direcional
gross não é saldo negociável; descontar custos em análise separada sem cobrar duas vezes.
Stress de custo: custo configurado, 1,5× e 2×, mantendo operações e parâmetros fixos.
Apresentar distribuição, concentração por semana/ativo, número de operações e perdas,
não apenas retorno agregado ou taxa de acerto. Dados pessoais/segredos não entram no relatório.

## Janelas e decisão

Primeiro diagnóstico prospectivo após 28 dias completos, mesmo que a amostra seja pequena.
Não interromper cedo por resultado positivo. Incidente de segurança/integridade interrompe
por motivo registrado. Dados insuficientes ou seleção por cobertura tornam o resultado inconclusivo.
Essa janela é de calibração do instrumento, NÃO gate automático de promoção.

Nenhum ajuste de parâmetro com base nessa janela poderá depois ser avaliado nela como holdout.
Uma hipótese de melhoria requer protocolo congelado, janela futura distinta e controles antes
de abrir os resultados. Promoção depende de revisão específica de cobertura, custo, risco e
suficiência amostral; a constante de calibração não será ligada por tempo decorrido.

## Release e rollback

Antes de publicar: candidato C1, npm ci, build padrão, tipos, lint, suíte inteira e arneses
SQL relevantes no SHA exato. Não há migration nesta mudança; os writers mantêm o schema.
Revisão independente tentada nesta rodada ficou indisponível por limite de uso; não alegar
que a revisão do próprio autor a substitui. Registrar essa limitação na aceitação de release.

Antes de promover: confirmar SHA/árvore alvo, deployment servido e candidato de rollback
atuais (os IDs de 04/11 não são verificação atual), smoke sem trades reais e sem chamadas
GET/POST a crons que escrevam no banco como se fossem leitura. Registrar as pendências acima.
Rollback de código não desfaz lançamentos já gravados: preservar eventos/IDs e reconciliar
separadamente. Nenhuma migração, reset de cron, serviço ou histórico é parte deste protocolo.
