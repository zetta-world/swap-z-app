# Retomada dos testes em papel — 04/11/2026

Status: CURRENT_DEVELOPMENT. Autorização: dono pediu retomar testes e ajustes para precisão/lucratividade nesta conversa. Escopo: correções locais de medição e ensaios de simulação; nenhuma ordem real. Não é certificação nem autorização automática de release.

PHASE_BASE_SHA=85cd4a6afb9e90869f89cd1c084ae1e03c0f2f49

## Evidência e problema

Auditoria somente leitura em `zswap-local/reports/mesas-20261104/RELATORIO.md`: última coleta econômica em 15/09; 3 posições Paper e 8 Celeiro abertas/vencidas, 38 sugestões abertas. Os gates armazenados não provam execução. Produção serve 85cd4a6, deployment dpl_H9eexHqcuvu37w3LLZozrmePX4AA, READY. Não houve logs backtest no recorte recente consultado; cron-job.org ainda não inspecionado.

Riscos reproduzíveis do código: fallback Paper pode fechar posição vencida usando spot atual; Celeiro usa taxa de funding mais recente para todo intervalo parado; cull conta unresolvable no denominador; crédito de aluguel após longo silêncio usa 6h sem observação. Retomar diretamente contaminaria a evidência.

## Implementação desta rodada

1. Avaliar admissão dos crons após interrupção longa. **Revisão de 04/11: protótipo retirado do produto** porque o bloqueio por heartbeat não possui bootstrap/reconciliação segura e pode impedir a recuperação de instalação nova ou pausada. Código preservado somente na evidência externa `continuity-prototype-not-for-release.json`. Nesse subconjunto de 04/11 as duas rotas permaneceram idênticas à base; a continuação de 05/11 altera apenas a rota Celeiro para contenção de funding.
2. Remover resultados unresolvable do julgamento econômico do torneio (sem converter ausência de preço em perda).
3. Corrigir fallback Paper vencido sem caminho observado: nenhuma saída inventada com spot tardio. Corrigir aluguel após gap para marcar período não observado, sem juro retroativo. O funding retrospectivo permanece bloqueador enquanto não houver replay por período e por símbolo; não promover o motor com esse bloqueador aberto.
4. Executar testes determinísticos existentes e novos, um worker. Preparar experimento temporal barato, comparável ao controle, sem ajustar parâmetros após observar o teste. Se o harness ou os dados não permitirem validação honesta, registrar a limitação em vez de promover.
5. Revisão independente, typecheck/lint relevantes, relatório e hashes fora do repo. Nenhum deploy, alteração no agendador ou reescrita de extratos pelo agente. **Atualização:** o dono retomou os jobs no cron-job.org durante a rodada; os cinco tiveram sucesso às 20h30. Não confundir essa retomada do código existente com publicação das correções locais.

## Estado após a retomada pelo dono

Leitura às 23:44 UTC de 04/11: 8 posições antigas do Celeiro encerradas desde 23h UTC, 9 posições novas e 0 posições Paper novas; `autopilot_sessions=0` e `cex_execution_intents=0`. Backtest chegou a eventos posteriores à fila (inclusive `bancada_papel_tique`). Há execução, mas ainda não há certificação econômica. Fechamentos de posições anteriores à pausa ficam em coorte separada e pendentes de reconciliação histórica.

Correções mantidas: retirar desfechos sem preço do denominador do cull, preservar `neutral` legado com preço, impedir fallback ao spot tardio em Paper sem velas e não creditar aluguel retroativo após intervalo maior que 6h. Revisão independente identificou a omissão de `neutral`; corrigida com teste de regressão. Nenhum parâmetro de estratégia, alavancagem ou regra de promoção foi ajustado para fabricar rentabilidade.

Validação completa de tipos permanece pendente: tentativas com heap de 768 e 1536 MB falharam por OOM e estão preservadas. Verificações locais por escopo e suítes não substituem recertificação do SHA. Evidência em `zswap-local/evidence/paper-resume-20261104`; relatório em `zswap-local/reports/paper-resume-20261104/RELATORIO.md`.

## Critérios

- Futura admissão por continuidade precisa de bootstrap/reconciliação explícita, sem se desbloquear por retry. Não há guard novo nas rotas nesta entrega.
- Nenhum resultado unresolvable afeta expectativa/cull.
- Posição vencida sem velas na janela não fecha ao spot de hoje. **Limitação:** validar cobertura completa de uma janela parcialmente preenchida continua pendente.
- Testes sem credencial, sem escrita em hospedado, sem LLM pago, sem ordem real.
- Melhoria de lucro só será declarada com evidência líquida e fora da seleção; aprovação de código não é aprovação financeira.

## Continuação autorizada — 05/11

O dono pediu continuar. A rodada permanece local, sem nova fase certificada ou publicação. Primeiro subconjunto validado: 506 testes/35 arquivos, lint e typecheck por escopo aprovados; typecheck global segue pendente por OOM. Snapshot em `VALIDATION.json` da evidência.

Próximo trabalho concreto nesta mesma rodada:

1. Corrigir disponibilidade temporal de OHLC na bancada: `VelaComTempo.t` é abertura; decisão de 1h só usa candles de prazos maiores fechados nesse instante. Entrada simulada no fechamento observado, saída só com vela concluída e sem atravessar lacuna histórica. Registrar instante real observado de saída, preservando custo e regra stop-first.
2. Aplicar o mesmo critério de fechamento no preparo do agente em papel, preservando identificadores de deduplicação existentes. Não editar referências congeladas: igualdade com o comportamento antigo deixa de ser prova de correção temporal e ganha testes explícitos do novo contrato.
3. Analisar reparo mínimo de funding por período/símbolo e idempotência. Nenhuma migration hospedada ou reescrita de legado. Só integrar após contrato e testes locais suficientes; registrar pendências concretas.
4. Testar regressões temporais antes/depois, custos, saídas e preparo compartilhado; execução sequencial. Reavaliar a rodada sem declarar aumento de lucro por mudança de medição.

### Contenção local do funding legado

Consulta somente leitura em 05/11 às 08h52 UTC confirmou BTC +1,80 USDT simulado em 00h30 UTC: `periodos=150`, `taxaPct=0,0012`, `porDia=3`. Esse lançamento reproduz o defeito de aplicar uma taxa recente a 50 dias; não será atribuído à coorte nova nem reescrito.

Enquanto não existir posição explícita por símbolo com capital reservado e recibo de liquidação atômico/idempotente, retirar da rota local os lançamentos implícitos de entrada/funding. Preservar a análise das oportunidades, distinguir elegibilidade de entrada real (`entra=false`) e retornar estado explícito `pendente_reconciliacao`. Os demais agentes continuam com suas rotinas. O replay puro em arquivo novo será testado isoladamente e não será conectado ao writer legado. Nenhuma contenção é aplicada à produção nesta rodada.

### Achado da revisão temporal — prazo exibido pelo tique

`tique.ts` envia `expiraEm` calculado da abertura da vela do sinal, embora a posição só nasça depois que o sinal foi observado. O mesmo defeito ocorre em estratégia própria e agente. O fechamento efetivo já usa `aberta_em + horas_limite`; o campo de expiração exibido deve usar o instante do tique que solicita a abertura, preservando `velaEm` exclusivamente como identidade/deduplicação. Corrigir os dois caminhos e testar a integração com banco falso, inclusive tique atrasado e sinal de 4h. Nenhuma posição antiga ou migration será alterada. O timestamp de registro do banco ainda pode diferir pela latência da chamada; esta correção não declara paridade integral entre paper ao vivo e replay.

### Validação concluída nesta continuação

1.698 testes distintos/101 arquivos, lint e typecheck por escopo aprovados. Typecheck completo do código-fonte aprovado em tentativa com proteção de recursos e heap de 2.048 MB; falhas anteriores preservadas, sem reclassificá-las. Tipos gerados por build e recertificação de SHA não estão cobertos por esse resultado.

Build local permanece não aprovado após correção do ambiente de dependências: Turbopack/PostCSS não conseguiu abrir porta IPC, inclusive na tentativa autorizada. Preservar FAILs; não há candidato ou publicação. Próximo gate de release exige ambiente de build compatível, suíte global e recertificação no candidato. A coleta hospedada de 05/11 23h27–23h30 UTC já tem fechamentos da nova coorte, registrados separadamente no relatório; não é evidência da correção local.

## Próximo passo autorizado — 06/11

O dono autorizou avançar. Continuação da mesma campanha local, sem candidato/release. O preflight confirmou que o ambiente restrito ainda bloqueia IPC/DNS; na execução com permissões adicionais, bind temporário em 127.0.0.1 e leitura pública do Google Fonts passaram. Essa mudança verificável de ambiente justifica nova tentativa do build padrão Turbopack, com guarda de recursos, sem trocar bundler/configuração do produto e sem credenciais hospedadas. Falhas anteriores permanecem preservadas.

Em paralelo, preparar ensaio econômico reproduzível com candles públicos reais e protocolo congelado antes dos resultados: cobertura, custos, exposição, resultados sem resolução, comparação com controles e separação cronológica. Não promover estratégia a partir do recorte já observado; não ajustar parâmetros depois de abrir o resultado. Evidência desta continuação: `zswap-local/evidence/paper-next-step-20261106`.

### Resultado do próximo passo — 06/11

Build padrão Turbopack PASS (70,61 s, exit 0) após comprovar que o ambiente permitido aceita IPC/fontes; primeira tentativa desta continuação preservada como incompleta por término143 sem captura final. Suíte completa 5.589/5.589 em 367 arquivos, ESLint completo zero erros/126 avisos e TypeScript completo com tipos gerados pelo build PASS. Sem mudança de produto adicional ou parâmetros nesta continuação. Não é recertificação: ainda sem C1/npm ci.

Ensaio BTC do arquivo local com protocolo/hash congelado antes do resultado: seis semanas, custos declarados, controles caixa/comprar-manter. Sete fechamentos corrigidos  +US$ 51,59 a custo 0,50% e nocional fixo US$1.000/operação; referência legada −38,84 / 5; comprar/manter +208,60 com exposição distinta. Diagnóstico conhecido, não holdout. Referência temporal separada confirmou as operações. Resultado concentrado/mediana negativa; nenhuma promoção. Matriz dos demais motores e limites no relatório atual `zswap-local/reports/paper-next-step-20261106/RELATORIO.md`.

## Fechamento autorizado para candidato — 06/11

O dono aprovou a recomendação: fechar lacunas de medição, preparar candidato/recertificação e só então publicação controlada e coorte prospectiva em papel. Esta etapa prepara a evidência local antes de qualquer ação externa. Sem operações reais, alteração de parâmetros por lucro observado ou reescrita de extratos antigos.

1. Paper/torneio: inspecionar duração e abertura das velas nos chamadores; impedir resolução após lacunas, vela não fechada ou vencimento sem cobertura até o prazo. Manter stop-first, estados não resolvidos e regressões para dados completos.
2. Celeiro: conter a execução e julgamento econômico dos modelos Convergência (perna única), Pool Novo (custos incompletos) e Funding (sem recibo atômico), com estado explícito não comparável e sem apagar histórico. Fechar caminhos alternativos que contornem a contenção.
3. Separar versão/coorte corrigida de resultados legados; preparar protocolo prospectivo com custos, exposição, drawdown, controles e critérios de cobertura. Não exigir prova de lucratividade para publicar correções de contabilidade.
4. Revisão adversarial independente, testes alvo e globais sequenciais com guarda de recursos; commit candidato C1 seguido de npm ci/build/tipos/lint/suíte integral no SHA exato. Falhas preservadas. Atestação documental somente após PASS.
5. Preparar alvo/rollback/plano de publicação por SHA. Produção só após gates e escopo autorizado; nenhuma promoção baseada no ensaio histórico de sete operações.

Evidência desta etapa: `zswap-local/evidence/paper-closure-20261106`. Artefatos de 04–06/11 anteriores permanecem snapshots preservados.

### Estado pré-commit do fechamento

949 testes alvo PASS, ESLint completo zero erros/126 avisos, tipos por escopo (36 arquivos
alterados e imports transitivos) PASS. Tipos globais passaram no snapshot inicial, mas ambas
as verificações finais foram interrompidas pelas guardas de memória do host (inclusive
com GC compacto); falhas preservadas. Não repetir global sem capacidade adequada.
Suíte global restrita: 5613/5617 PASS, quatro falhas em testes de subprocessos (EPERM/saída
ausente). Os quatro arquivos (39 testes) passaram no ambiente com subprocessos permitidos;
essa mudança de ambiente foi comprovada antes de repetir a suíte global, com evidência separada.
Nenhum teste foi removido/enfraquecido por essas falhas.

Checkpoint local C1 não é release nem certificação. Recertificação precisa de instalação
limpa e ambiente com capacidade para o TypeScript completo, além de build e todos os gates.
CELEIRO-TICK-PATH permanece aberto; as contenções de Funding/Convergência/Pool Novo não
representam correção integral de modelagem. Protocolo prospectivo preparado, ainda não iniciado.

Suíte global no ambiente com subprocessos permitidos: **5.617/5.617 testes em 370 arquivos**, zero falhas/pendências, 259,83 s, um worker, guardas preservadas. A rodada restrita FAIL continua preservada. Resultado pré-commit, não recertificação de SHA.
