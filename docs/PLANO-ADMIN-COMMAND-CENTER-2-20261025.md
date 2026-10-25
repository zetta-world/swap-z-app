# PLANO — Admin Command Center 2.0 (25/10/2026)

Status: 🟡 EM EXECUÇÃO — missão contínua R0–R5 pedida pelo dono em 25/10 (handoff abaixo, íntegro).
PHASE_BASE_SHA: `10ebd12721f7d20b83a366cdb87a9a0dc1a53f2e` (tree `f7c83c619acc6ae1c40c98d1779bae342670e3da`, = `main` = produção).
Branch: `claude/admin-command-center-2-20261025` (nova, isolada do trabalho Phantom/Lighthouse/blockhash).

## Decisões de execução (Claude, 25/10)

- **Uma missão, um ciclo.** Plano → implementação por escopo (commits pequenos) → UMA auditoria adversarial
  independente no fim → correções → validação → C1 → recert completa no SHA exato → C2 só de docs → PR. Sem pedir
  autorização por arquivo (pedido do dono). Pedido de autorização UMA vez no fim, só para o que exige: IdP real, contas
  humanas, MFA real, migrations no banco hospedado, variáveis Vercel, deploy/merge.
- **Nada em produção.** Sem deploy, sem merge em `main`, sem migration aplicada no Supabase hospedado, sem variável
  Vercel. Supabase hospedado: SÓ LEITURA de catálogo/agregados (autorizado pelo dono: "reconcilie o estado real do
  GitHub, Supabase e documentação"), sem dados pessoais.
- **Acesso admin atual intacto.** Todo mecanismo novo (RBAC, sessão corporativa) entra em modo de COMPATIBILIDADE por
  padrão: o comportamento de `requireAdmin` em produção não muda até o dono ligar o modo novo, com duas contas
  corporativas testadas (R5).
- **Sem reinventar.** As 9 áreas, os 57 painéis, `modules.ts`/`areas.ts`/`panel-map.tsx`, `admin_kv`, `admin_audit_log`,
  `ai-cost.ts` e o `AiCostPanel` são a base; a reforma corrige e estende.
- **Fora de escopo absoluto:** swaps (Jupiter/0x/LI.FI, W1/W3/W4, Lighthouse/blockhash), taxas, contas de taxa, tiers,
  Founder Pass, CEX/autopilot/DCA (nada é religado), dados de usuários para LLM.

## Ordem

A (descoberta, inventários gerados do código e do banco) → R0 (verdade + kill switches + auditoria durável) → R2 núcleo
(decisão de autorização única, matriz por rota com teste de completude) → R1 (SSO corporativo + MFA + sessão admin
separada, parametrizado e desligado por padrão) → R3 (navegação/estados/AI Control Center) → R4 (inventário ACL real +
migration LOCAL + testes de papéis em Postgres isolado) → R5 (plano + modo de observação das fontes legadas, sem
desligar nada).

---

## Handoff do dono (íntegro, 25/10/2026)

## Handoff técnico, auditoria atual e plano integral para execução pelo Claude

**Data:** 25/10/2026 (America/Sao_Paulo)  
**Repositório principal:** `zetta-world/swap-z-app`  
**HEAD consultado:** `10ebd12721f7d20b83a366cdb87a9a0dc1a53f2e` (consultar novamente antes de editar)  
**Supabase consultado:** projeto `vuvvftdsfmagmtbovzgq`; leituras agregadas, somente leitura  
**Estado deste artefato:** PLANO / HANDOFF / EVIDÊNCIAS — não é certificado de produção nem autorização de migração  
**Destino sugerido no repo:** `docs/PLANO-ADMIN-COMMAND-CENTER-2-20261025.md`  
**Responsáveis:** proprietário autoriza; Claude implementa e testa; revisor independente audita mudanças críticas.

---

## 0. Mandato executivo

Transformar o Admin atual da Z-SWAP num **centro de comando corporativo, auditável e operacional**: CISO, CEO, CTO, CFO, suporte, compliance, análise de IA, trading e operações, com acesso segregado por responsabilidade, transparência dos dados e controles comprováveis. A interface NÃO é uma DEX para administradores; é uma plataforma de observabilidade, controle e prestação de contas.

**A reforma não começa do zero.** Existem nove áreas, dezenas de painéis, registros de eventos, kill switches, métricas, auditoria e controle de acesso. Devem ser preservados e corrigidos antes de adicionar abstrações novas. O usuário expressou preferência por **uma missão executada integralmente** em vez de inúmeras rodadas de prompts; executar uma trilha contínua de trabalho com commits pequenos e gates de segurança, sem pedir autorização para cada ajuste de código. Somente parar quando houver operação de produção com consequências materiais, perda de acesso, migração destrutiva, alteração de privilégios efetivos, custos ou credenciais.

### Resultados desejados

1. **Verdade operacional:** indisponível, desconhecido e sem dados nunca equivalem automaticamente a zero, saudável, desligado ou aprovado.
2. **Admin seguro:** autenticação corporativa com Google Workspace / Microsoft Entra ID, MFA efetivo, identidade individual, RBAC testado em todas as rotas e capacidade de recuperação.
3. **Controle financeiro íntegro:** receitas comprovadas on-chain separadas de valores declarados, paper e atribuição comercial; nenhuma contabilidade inferida de mera intenção.
4. **Auditoria durável:** toda ação privilegiada sensível comprovadamente registrada e atribuída; efeitos colaterais não críticos não bloqueiam operações que não movimentam fundos, mas comandos sensíveis sem trilha confiável devem falhar fechados.
5. **Visibilidade de risco:** alertas e incidentes categorizados, infraestrutura e crons com evidência de frescor, reversibilidade e impacto.
6. **Eficiência da IA:** centro único de custo/token/latência/modelo/qualidade por produto, conectado ao plano de IA determinística, sem transformar estimativa em despesa faturada.
7. **Experiência corporativa:** navegação limpa por áreas, módulos com hierarquia, acessibilidade, mobile útil e desktop denso sem sobreposição.
8. **Governança:** produção sob controle do fundador, trilha de rollout e rollback que preservam acesso.

---

## 1. Fontes, método e grau de confiança

- **[C] Código observado no GitHub (`main` SHA acima):** evidência de arquitetura e comportamento previsto, não necessariamente execução em ambiente real.
- **[DB] Banco Supabase de produção, consulta SQL agregada READ ONLY em 25/10/2026:** evidência de estado de esquema e contagens, não validação completa de permissões efetivamente exploráveis.
- **[H] Relatos e decisões anteriores do proprietário:** história do projeto; confirmação operacional nova é necessária.
- **[P] Proposta para desenvolvimento:** não existe ainda; não tratar como implementado.

**Atenção:** houve mudanças na `main` após o PR #448 e há trabalho paralelo em carteiras/Phantom/Lighthouse/blockhash. **Não usar SHAs antigos como baseline corrente**. Rodar `git status`, `git branch --show-current`, `git rev-parse HEAD`, `git fetch` não destrutivo e comparar Vercel/GitHub. Se houver worktree ativo de outra frente, criar um novo e isolar a missão.

### Fontes primárias a abrir em sequência

1. `docs/START-HERE.md`, `docs/CURRENT-STATE.md`, `docs/DOCUMENT-AUTHORITY.md`, `docs/AI-OPERATING-RULES.md`, `docs/RELEASE-CHAIN.md`, `docs/LAUNCH-READINESS-LEDGER.md`.
2. `docs/ADMIN-COMMAND-CENTER.md`, `docs/PLANO-ADMIN-INTEL.md`, `docs/PLANO-PAINEL-POR-AREA.md`, `docs/PLANO-PAINEL-SINCRONIZADO.md`.
3. `src/lib/admin/require.ts`, `src/lib/auth/session.ts`, `src/app/api/auth/verify/route.ts`, `src/app/admin/layout.tsx`, `src/app/admin/api/admins/route.ts`.
4. `src/lib/admin/modules.ts`, `src/lib/admin/areas.ts`, `src/components/admin/panel-map.tsx`, `src/components/admin/AdminShell.tsx`, `src/components/admin/DashboardClient.tsx`.
5. `src/app/admin/api/{killswitch,finance,receita,operations,health,audit,stats,ai-circuit}/route.ts`, `src/lib/admin/{kill-switches,audit,health,ai-cost}.ts`, painéis correspondentes.
6. Migrations e ACL reais do Supabase; configurações existentes da Vercel, sem divulgar valores sensíveis.

### Achados do estado atual, 25/10/2026

| Evidência | Constatação | Risco/ação |
|---|---|---|
| [C] árvore GitHub | **66** handlers `/admin/api/**/route.ts`; **57** componentes `*Panel.tsx` e **9** áreas (`comando`, `mesas`, `celeiro`, `ulfhednar`, `medicoes`, `dinheiro`, `operacao`, `pessoas`, `sistema`). | Redesenhar navegação/contratos existentes, não criar novo Admin paralelo. |
| [C] `src/lib/admin/require.ts` | `requireAdmin` aceita três fontes: `ADMIN_WALLETS`, `platform_admins` e `tier_cache.source='admin'`. | Superfície de privilégios legados; construir identidade e RBAC antes da desativação. |
| [C] `src/lib/auth/session.ts` | JWT próprio por carteira (`AUTH_JWT_SECRET`, cookie httpOnly); W4 usa **12h** sem “manter” e **30 dias** com “manter”. | Não repetir avaliação antiga de que todo cookie é sempre 30 dias. Admin exige política própria de autenticação/step-up. |
| [C] `src/app/admin/api/admins/route.ts` | Gestão de concessão/revogação baseada em carteira, guardas de autorrevogação, ENV e último admin; sem papéis granulares nesse mecanismo. | Separar “pode entrar” de “pode executar ação”. |
| [C] `src/lib/admin/require.ts` | `logAdminAction` é best effort, engole falhas inclusive retorno `{ error }` do cliente Supabase. | Ações críticas podem ocorrer sem comprovação de auditoria; priorizar durabilidade. |
| [C] `src/app/admin/api/killswitch/route.ts` | Em erro de consulta a `admin_kv`, a resposta GET pode devolver `switches: {}` com nota de migração ausente; POST já verifica erros de upsert. | UI/operador pode interpretar indisponibilidade como tudo OFF; preservar tri-state. |
| [C] `src/lib/admin/kill-switches.ts` | Leitura de switches possui `lido` e caminhos de falha distintos, inclusive comportamento fail-open em certos cenários de swap; histórico de exceções. | Não converter globalmente para fail-closed sem medir consequências; especificar por rota financeira. |
| [C] `src/app/admin/api/finance/route.ts` | `platform_events` filtrados por `zion_analysis` com `limit(100_000)`; atribuição de receita vinculada a tiers, distinguida de caixa realizado pelo painel. | Avaliar completude/paginação; evidenciar receita atribuída ≠ recebida. |
| [C] `src/components/admin/panels/AiCostPanel.tsx` | Já existem consumo por modelo/fonte, tokens cacheados e projeção. | Ampliar, sem duplicar, para custo por produto/resultado útil e faturamento de fornecedores. |
| [DB] SQL em produção | **54** tabelas públicas; **54** com RLS; **0** policies `public`. | Acesso real depende de grants/roles; não desativar RLS nem inventar `auth.uid()` onde Auth não é usada. |
| [DB] SQL em produção | **34** tabelas apresentam privilégios SQL sensíveis nos testes agregados de TRUNCATE/REFERENCES/TRIGGER para `anon`/`authenticated`. | ACL explícitas com prova de não-regressão e `ALTER DEFAULT PRIVILEGES` conforme escopo. |
| [DB] SQL em produção | **36** funções `SECURITY DEFINER` em `public`; leitura agregada encontrou **0** sem `search_path` em `proconfig` sob o filtro usado. | Revisar `EXECUTE` e código/caminhos de cada função; `search_path` não garante isolamento suficiente. |
| [DB] SQL em produção | **0** usuários em `auth.users`; **1** registro em `platform_admins`; **54** eventos no `admin_audit_log`; **680** linhas em `admin_kv`; **19** operações. | SSO corporativo NÃO está estabelecido no Supabase Auth. Contagens são pontuais, sem dados pessoais. |
| [DB] Advisor Supabase | `rls_enabled_no_policy` em 54 tabelas — nível INFO no relatório. | NÃO interpretar automaticamente como vulnerabilidade de SELECT; combinar RLS+grants+Data API+SECURITY DEFINER. |
| [H] auditoria anterior | Métricas confundiam falhas de leitura e `0`; ações de switches exigiam prova; escopo RBAC/SSO separado. | Reconstruir testes contra o estado atual; não importar diagnóstico histórico como certeza. |

**Se qualquer número variar na implementação, registrar nova leitura e a diferença**. Não “corrigir” o relatório por suposição.

---

## 2. Modelo de ameaças e princípios de segurança

### Ativos e fronteiras

- **Identidades:** carteira do cliente (EVM/Solana), sessão da plataforma, identidade pessoal do funcionário, identidade da organização (Google Workspace/Entra), privilégios de Admin. Esses conceitos não são intercambiáveis.
- **Segredos:** credenciais de Supabase, assinaturas JWT, chaves CEX/servidor, credenciais de IA e alertas, valores financeiros e dados pessoais.
- **Ações privilegiadas:** grant/revoke de acesso, alterações em kill switches, rotas de execução, níveis de permissão, mudanças de configuração, exportação de dados, reprocessamento financeiro, operações de banco.
- **Riscos principais:** sessão roubada, conta revogada ainda válida, troca de carteira, confusão de papel, spoofing de e-mail, CSRF, replay, IDOR/BOLA, funções `SECURITY DEFINER` invocáveis indevidamente, logging best-effort, ambientes preview/production compartilhando dados, custo/receita falsamente verificados, vazamento de dados/segredos via dashboard.

### Políticas invariantes

1. Servidor valida autenticação **e autorização por ação** antes de tocar recursos; esconder botão não cria proteção.
2. Privilégio mínimo e negação padrão; sem self-grant, sem concessão indireta via tier comercial.
3. MFA com prova técnica de nível alcançado, não apenas “provedor suporta MFA”. Google OAuth consumidor não comprova, sozinho, MFA corporativo.
4. Administração não assume controle das carteiras não custodiais do cliente; nenhuma chave privada ou seed phrase no painel.
5. Audit log de ações críticas durável e vinculado à identidade corporativa/sessão; sem “sucesso” se gravação financeira/controle não foi efetivada.
6. Toda leitura reporta `state = ok | zero | empty | stale | partial | unavailable | error`, `asOf`, origem e cobertura quando relevante.
7. Idempotência para comandos; auditoria sem duplicação; proteção contra concorrência.
8. Mudanças reversíveis e com plano de recuperação de login; não desligar a autorização antiga até testar duas contas administrativas novas independentes.
9. Permissões no banco devem ser testadas com papéis reais (`anon`, `authenticated`, `service_role`) e SQL funcional, não apenas verificadas por presença de RLS.
10. Operações financeiras e proteção do cliente têm prioridade sobre estética e economia de IA.

---

## 3. Visão do produto — Admin Command Center 2.0

Reutilizar as nove áreas atuais. NÃO apagar `mesas`, `celeiro`, `ulfhednar` e `medicoes`: sua separação é uma decisão de produto já codificada. Melhorar a experiência por camadas, mantendo URLs e deep links compatíveis.

### Área COMANDO (CEO)

- **Resumo executivo:** receitas efetivamente recebidas, custos por provedor, incidentes abertos, status de releases, liquidez/execução e saúde dos serviços.
- **Cartões com semântica explícita:** confirmado on-chain; declarado; estimado; simulado; sem dados; indisponível. Separar `total de usuários cadastrados` de `ativos`, e `redes suportadas` de `redes conectadas`.
- **Fila de atenção:** top 5 problemas classificados por risco, impacto, usuário atingido, hora da última evidência, dono operacional e ação recomendada.
- **Alterações recentes:** alterações críticas, identidade do operador, before/after seguro e link para evento auditável.

### Área SISTEMA (CTO/CISO)

- Saúde de API/RPCs, Helius/Jupiter/0x/LiFi, conexões Supabase/Vercel, cron heartbeats com idade, incidentes, degradação e limites de cota.
- Painel de kill switches, com estado observado pelo consumidor, último valor persistido, quando foi testado e quais rotas realmente respeitam o switch. Exibir `UNKNOWN` em falha de leitura.
- Auditoria e segurança: log de acesso, tentativas não autorizadas, alteração de papéis, alertas de dependências, status de backup/restore, monitor de chaves sem exibir segredos.
- Dependências: diferenciar `provedor sem crédito`, `chave inválida`, `modelo indisponível`, `rate limit`, `rede`, `configuração ausente`; não rotular toda falha como “offline”.

### Área DINHEIRO (CFO)

- Livro financeiro com dimensões separadas: `status financeiro` (on-chain confirmado / pendente / declarado / divergente) e `identidade atribuída` (comprovada / autenticada / sem atribuição).
- Receita líquida verificada pela conta de taxas, por cadeia, operação e token; precificação com origem/timestamp; conversão em USD estimada separada de liquidação.
- Custos de IA, Vercel, Supabase, RPC, APIs, uso CEX e custos de suporte; preço público estimado vs fatura real.
- Controles de reconciliação: diferença entre dados do navegador, DB, recibo/transação e provedores. Nada de receita falsa advinda de operação paper ou conta do próprio fundador.
- Exportações CSV/contábeis só para `finance.view/export`, com trilha e minimização de dados.

### Área OPERAÇÃO (COO/Trading)

- Estado de execução real: cotação → assinatura → envio → confirmado/erro/incerto; diferença entre rota pronta e operação realmente disponível.
- Autopilot CEX desligado quando o estado real estiver desligado; paper / live em áreas e rótulos distintos.
- Health e incidentes de ordens, retries e locks; cada alerta com severidade e vínculo com operação sem expor credenciais.

### Área PESSOAS (Suporte/Growth)

- Dados de cliente por privilégio: suporte vê contexto mínimo para resolver incidentes; financeiro vê valores necessários; CISO vê trilha de segurança; marketing vê agregados e métricas respeitando LGPD.
- Exportações justificadas, registradas e com retenção definida; não mostrar carteira completa ou dados de visita para papéis sem necessidade.
- Growth: humanos/bots/admin separados com incerteza explícita; não converter heurística de UA em identidade garantida.

### Áreas MESAS, CELEIRO, ÚLFHÉÐNAR, MEDIÇÕES

- Manter layout/semântica específicos. O primeiro e o terceiro não devem ser confundidos com o Laboratório retrospectivo.
- Papel `analyst` de leitura; operações de paper e resets exigem `strategy.manage` e dupla confirmação para ações destrutivas.
- Proteger métricas de datas/janelas diferentes e séries cuja metodologia tenha mudado; mostrar data e regras aplicadas.

### ZETTA AI CONTROL CENTER (visão integrada dentro de DINHEIRO/SISTEMA)

**Otimização de IA complementa o Admin, não cria outra aplicação administrativa.** Aproveitar `src/lib/admin/ai-cost.ts`, `src/lib/ai/provider.ts`, `src/lib/ai/registry.ts`, `src/lib/zion/cache-de-resposta.ts`, `src/components/admin/panels/AiCostPanel.tsx` e os planos de IA determinística.

Métricas: chamadas por produto/capacidade, tokens (uncached, cache_read, cache_write, output), modelo real executado, fornecedor, custo estimado, faturado quando houver integração, latência p50/p95, resposta falha/timeout, economia por cache, oportunidade filtrada sem IA, custo por decisão útil, qualidade/edge medido fora da amostra, projeção mensal e diferença contra orçamento.

Cortes de custo devem respeitar qualidade e os gates: scanner determinístico antes de LLM; LLM gera interpretação e não define sozinho autorização de dinheiro. Métricas de IA e custo só podem ser atribuídas a modelos efetivamente executados, inclusive em fallback.

---

## 4. Plano executável — frentes R0 a R5

**Ordem de dependência recomendada:** R0 (verdade+controle) → R1 (identidade) → R2 (RBAC) → R3 (interface) → R4 (ACL por contratos) → R5 (desativação do legado), com R4 discovery iniciada em paralelo desde R0. Execução contínua numa missão única, com commits verificáveis. Nenhum release de autenticação que possa causar lockout sem recovery testado.

### R0 — Confiabilidade e controles (P0)

**R0.1 Inventário funcional de 66 rotas:** tabela por método, sessão, permissão exigida, fonte de dados, tipo (read/write/financial/high risk), comportamento sem DB, logs, dependências, consumidores e testes. Identificar rotas inativas/legadas sem apagá-las de imediato.

**R0.2 Estados verdadeiros (tri-state ou richer):** estabelecer contrato tipado `{ status, value, asOf, source, coverage, errorCode }`, inclusive estados parciais. Converter endpoints/painéis prioritários de Saúde, Kill Switches, Finance, Receita, Operações, AI Cost, Auth e Launch Gate. Não formatar falha de fetch como 0.

**R0.3 Kill switches:** testar `GET` de `admin_kv` inexistente, permissão negada, timeout, leitura incompleta, value inválido, upsert recusado, dupla gravação; impedir que `switches:{}` signifique seguro. Mapear consumidores de `disable_swap`, `disable_cex`, `maintenance_mode` e gates de flywheel, com as exceções de fail-open explicitadas e validadas por rota. Provar eficácia da chave contra caminho real com testes controlados. Não alterar política financeira global sem decisão específica.

**R0.4 Auditoria durável:** `logAdminAction` tem falha best-effort; substituir nos comandos críticos por registro confiável preferencialmente numa transação DB com ação/ator/idempotency key/resultado; distinguir intenção, execução, tentativa falha e confirmação. Não gravar segredos. Para comandos comuns, continuar telemetria best-effort se apropriado.

**R0.5 Testes de erro:** desconexão de Supabase, `503`, resposta parcial, stale > TTL, provider 429, mudanças concorrentes, uma operação declarada mas não verificada, dados paper misturados com live, histórico legado.

**Gate R0:** rota crítica não mente sobre resultado e não realiza comando sensível sem autorização/auditoria; painéis mostram indisponibilidade corretamente; nenhum cliente liberado indevidamente.

### R1 — Identidade corporativa e MFA (P0/P1)

**Decisão arquitetural a demonstrar:** Auth corporativa **separada** da identidade da carteira do cliente. Estudar Supabase Auth OAuth/OIDC para Google Workspace + Microsoft Entra ID ou IdP corporativo capaz de cumprir requisitos. Não configurar nada com nomes inventados; testar com conta de desenvolvimento. Autenticação é diferente de autorização.

Requisitos:
- Acesso apenas por contas corporativas **pré-aprovadas/convite**. Verificação de domínio é sinal adicional, não concessão de Admin.
- Provar verificação de e-mail e MFA de nível adequado; exigência de step-up/reautenticação nas ações financeiras e de segurança. TOTP/WebAuthn conforme capacidades verificadas do provedor.
- Sessões curtas e revogáveis por servidor, políticas de expiração/idle timeout, proteção contra CSRF, fixação de sessão, replay/OAuth state+PKCE, audit trail de login/logout/revogue.
- Bloquear acesso após desprovisionamento; não confiar exclusivamente em claims long-lived em cache.
- Separar sessão corporativa de `zswap_session` por nome, domínio, purpose/audience e escopo. Zero reutilização do mesmo cookie da carteira como sessão Admin de alto privilégio.
- **Duas identidades humanas independentes** testadas, ambas com MFA e procedimentos documentados de recuperação, antes de alterar `requireAdmin` legado.
- Preservar o fluxo de conexão de carteira dos clientes, W4 e as assinaturas das transações.

**Gate R1:** contas corporativas convidadas entram, MFA e revogação funcionam, conta não convidada não entra, rollback preserva acesso, nenhuma carteira cliente ganha admin por ser autenticada.

### R2 — RBAC e segregação de funções (P0/P1)

Proposta inicial sujeita a decisão do proprietário:

| Papel | Exemplo de privilégios | Restrições |
|---|---|---|
| `superadmin` | gerenciar papéis/políticas, break-glass | sempre MFA, step-up, auditoria forte, sem autoelevação por API |
| `security_admin` | segurança, incidentes, kill switches, auditoria | não altera receita nem concede superadmin sem dupla autorização |
| `operations` | acompanhar health, operações e crons | não executa fundos/autopilot por simples privilégio de painel |
| `finance` | receita confirmada, conciliação, exportações | sem grants administrativos ou mudanças de política de execução |
| `support` | atendimento com dados mínimos | sem exportação massiva ou visão de segredos |
| `analyst` | laboratório, backtest, paper e métricas | sem dinheiro real e sem troca de políticas de segurança |
| `auditor` | leitura de evidência e auditoria | nenhum POST/PUT/PATCH/DELETE |
| `growth` | analytics agregados | sem PII bruto/financeiro individual |

**Permissões atômicas**, exemplos: `admin.view`, `security.read`, `security.killswitch.write`, `identity.invite`, `identity.revoke`, `roles.grant`, `roles.revoke`, `finance.read`, `finance.export`, `ops.read`, `ops.control`, `paper.manage`, `ai.read`, `ai.budget.write`, `audit.read`, `users.support.read`, `analytics.read`. Definir lista exaustiva de endpoints e mudanças.

Implementação proposta: serviço central de autorização server-side com um único *decision point*; matriz de permissões testada; permissões armazenadas em DB privado e avaliadas na requisição; *deny by default*; sessão requer identidade humana válida e MFA. Painéis ocultam opções para UX, **rotas negam** de forma independente. Suporte a funções de origem em escopo produto sem misturar `tier_cache` comercial.

**Provas obrigatórias:** para cada rota, role permitido vs negado, sem sessão, token expirado/revogado, MFA ausente, CSRF, duas contas, troca de carteira, race de grant/revoke, privilégios após revogação.

**Gate R2:** nenhum endpoint administrativo acessível a papel não autorizado e nenhuma autorização deriva automaticamente de tier ou cookie wallet legado.

### R3 — UI/UX corporativa (P1)

Manter estética ZETTA sofisticada, porém reduzir excesso de estilo terminal que prejudica densidade/leitura. Preservar navegação e ID de módulos existentes e adicionar pesquisa, favoritos, breadcrumbs, estados/etiquetas semânticos, atalhos de acessibilidade, notificações claras, filtros persistentes por sessão, layouts responsivos. Cada área responde a uma pergunta operacional, não é uma grade homogênea.

- Homepage `COMANDO` com scorecard e incidentes, links para causa e último dado.
- `SISTEMA`: visão de serviços, SLA interno, fila de incidentes, estado de controls.
- `DINHEIRO`: abas de receita verificada, conciliação, custos infra/IA, projeção e exportação controlada.
- `PESSOAS`: privilégios de suporte e métricas anonimizadas.
- `OPERAÇÃO`: realtime de swap, reconciliador, CEX, filas, crons.
- `MEDIÇÕES`: comparativos por metodologia/regime, fonte de dados e janela.
- `AI CONTROL CENTER`: KPIs atuais + cache hits e custo por decisão útil, com benchmark e etiqueta ESTIMATED/BILLED.
- Componentização por `ModuleId`, `AREA_DA_CATEGORIA` e `panel-map.tsx`. Testar invariante de registro↔renderização. Não duplicar dados administrativos entre telas.

**Gate R3:** mobile em 360px, tablet, desktop em 1440px; sem corte de tabelas e overlays, teclado navega, leitor de tela recebe rótulos, estados de erro claros, 9 áreas acessíveis, telas sem operadores falsos.

### R4 — ACL, RLS, DB e arquitetura de dados (P0 em descoberta, mudanças pós-validação)

**NÃO executar `REVOKE` genérico de 34 tabelas.** Inventariar tabela por tabela: APIs existentes, consumers, políticas, grants diretos e default grants, functions `SECURITY DEFINER`/EXECUTE, storage, public Data API e service role. Parte da arquitetura usa `service_role`, que não equivale a cliente Supabase Auth.

Requisitos:
- Design de schemas privados para identidade/roles/audit; evitar exposição desnecessária em `public`.
- Default privileges e grants explícitos em migrações novas; testes com roles `anon` e `authenticated` para DML **e DDL-like** (`TRUNCATE`, `REFERENCES`, `TRIGGER`).
- RLS e grants independentes, `SECURITY DEFINER` apenas onde indispensável, com `search_path` fixo, invocação restrita e parâmetros não controláveis sem validação.
- Views `security_invoker` onde aplicável. Nenhuma policy baseada apenas em `TO authenticated` para dados de usuário.
- Auditoria de acesso com retenção e privacidade; índices e paginação no Admin. Medir consultas lentas antes de criar índices.
- Backup verificável antes de alterações, ensaio de rollback, compatibilidade com código antigo e novo, versão de schema e migrações aditivas em ordem.
- Nunca mover grupos de grants que possam afetar usuários ou automações sem teste de impacto.

**Gate R4:** relatório before/after de grants e functions, testes de papéis, migrações reconciliadas remoto↔repo, backup/restauração e ausência de regressão nas APIs existentes.

### R5 — Desligamento controlado da autenticação legada (P0 de transição)

Somente após R1-R4 completos para identidades, permissões e auditoria:
1. Confirmar **duas** contas corporativas com MFA e capacidade real de administração.
2. Fazer ensaio de revogação e recuperação do primeiro admin.
3. Ativar modo de observação para chamadas dependentes de `ADMIN_WALLETS`, `platform_admins` e `tier_cache.source='admin'`, sem capturar segredos.
4. Remover acesso administrativo via tier legado da decisão de autorização, com tests de negação; manter dados históricos.
5. Manter break-glass limitado e auditado, com expiração e procedimento offline.
6. Publicar migration/config segura, verificar login e comandos críticos; rollback de SSO sem reabrir privilégio universal.
7. Documentar fim da transição em `CURRENT-STATE`/ledger, somente depois das provas.

**Gate R5:** nenhum cliente pode entrar no Admin usando somente a carteira comercial; administrador legítimo não perde acesso; contas corporativas revogadas param imediatamente de realizar ações críticas.

---

## 5. Inventário de rotas e matriz obrigatória

Entregar um arquivo versionado `docs/ADMIN-API-AUTHORIZATION-MATRIX.md` gerado/validado contra os **66** endpoints atuais, com colunas:

`route | method | action_id | risk_class | authn | min_mfa | permission | data_class | read/write | source | audit_required | on_db_failure | rate_limit | tests`

Não usar lista escrita de memória. Testes de completude devem **falhar** se um novo `route.ts` aparecer sem permissão definida. Preferir rejeitar por padrão até a rota ser classificada.

Exemplos de verificação:
- `/admin/api/admins` GET: requer `identity.read` e sessão corporativa.
- `/admin/api/admins` POST: requer `identity.manage`/`roles.grant`, MFA recente, auditoria durável.
- `/admin/api/killswitch` GET: `security.read`; sinalizar `unavailable` no erro.
- `/admin/api/killswitch` POST: `security.killswitch.write`, MFA recente, ação atomicamente auditável.
- `/admin/api/finance` GET: `finance.read` com segregação de informação.
- `/admin/api/ai-circuit` POST (se existir): permissão explícita distinta de mero acesso ao painel.
- rotas `paper-reset`, `paper-repair`, `autopilot-liberacao`, `ledger/export`: classificar como sensíveis e exigir testes de consequências.

---

## 6. Contratos de dados e estados operacionais

### `OperationalMetric<T>` (proposta, não código exigido)

```ts
type Quality = 'verified' | 'measured' | 'estimated' | 'declared' | 'simulated';
type DataState = 'ok' | 'zero' | 'empty' | 'stale' | 'partial' | 'unavailable' | 'error';
interface OperationalMetric<T> {
  state: DataState;
  value: T | null;                // null = ausente/desconhecido, nunca 0 implícito
  quality: Quality;
  source: string;                 // provedor / tabela / ledger
  asOf: string | null;
  coverage?: { expected: number; observed: number };
  errorCode?: string;             // sem stack, PII ou segredo
  correlationId?: string;
}
```

Semântica:
- **ZERO:** fonte consultada com êxito e valor numérico realmente zero.
- **EMPTY:** fonte consultada com êxito, coleção de resultados vazia.
- **STALE:** último valor era válido, mas expirou seu frescor.
- **PARTIAL:** parte das fontes falhou; não somar como total completo.
- **UNAVAILABLE:** fonte necessária inacessível; não usar 0 e não marcar saudável.
- **DECLARED:** valor informado por cliente ou evento, sem verificação on-chain.
- **VERIFIED:** valor reconciliado com evidência de fonte oficial/on-chain conforme definições por produto.
- **SIMULATED:** paper/trading laboratory nunca entra em receita, usuários pagantes ou swap real.

### Incidentes e ações

`incident_id`, `severity`, `source`, `first_seen`, `last_seen`, `last_verified`, `ack_by`, `owner_role`, `affected_scope`, `state`, `resolution`, `links`, `evidence_quality`, `correlation_id`. Regras de alerta de severidade e deduplicação; não enviar notificações com dados privados sensíveis.

### Auditoria mínima

`event_id`, `occurred_at`, `actor_identity_id`, `actor_session_id`, `actor_role_at_time`, `action`, `target_type`, `target_reference_redacted`, `request_id`, `idempotency_key`, `before/after redacted`, `authz_decision`, `operation_outcome`, `failure_code`, `origin`, `evidence_ref`; append-only e com proteção de acesso.

---

## 7. Plano de testes e prova de segurança

**A. Autenticação/SSO:** Google Workspace permitido; Entra permitido; usuário externo, domínio falso, e-mail não verificado, MFA ausente, token expirado, sessão revogada, CSRF/state/PKCE inválidos, recuperação de conta, dois admins, mudança de carteira, sessão cliente existente inalterada.

**B. RBAC:** matriz cobrindo todos métodos e endpoints; superadmin→auditor e auditor→superadmin proibidos por exploração; criação e revogação em concorrência; permissões removidas surtindo efeito imediato na API; URL direta bypassando UI não funciona; abstenção/negação default.

**C. Integridade:** DB off e partial; kill-switch read 500; write 0 rows; log de auditoria indisponível; duplicação de comandos; replay; métricas nulas; `platform_events` pagination truncada; ledger do swap com status incierto; custo IA calculado com cache sem duplo desconto ou soma dupla.

**D. DB/ACL:** cada tabela nova em `public` recebe grants definidos; `anon`/`authenticated` incapazes de executar `TRUNCATE`/`REFERENCES`/`TRIGGER` quando não autorizado; RPC privado não executável por usuários sem privilégio; `service_role` mantido funcional onde necessário; Auth sem auto-admin.

**E. UX:** fluxo com 360px/768px/1440px; teclado e leitores; gráficas sem dados; loaders e erros; sem dados fictícios para esconder falhas; filtros e deep links; performance no número atual e simulação de cargas maiores.

**F. Regressão financeira:** não modificar Jupiter/0x/LiFi, W1/W3/W4, taxas, destinatários, assinaturas, nonces, locks e histórico; testes de swaps sem fundos para validação visual/contratos.

**G. CI:** lint, type-check, suíte automatizada, build, audit-gate, secret-scan; artefato `SHA` e resultados vinculados à branch. **Nenhum PASS sem teste correspondente.**

**H. Testes de implantação:** Preview isolado com credenciais fake/DB descartável ou ambiente segregado; servidor com duas identidades de teste, sem grants de produção; smoke tests somente leitura em produção após autorização; recuperação/rollback comprovados.

### Casos de aceitação de alto impacto (obrigatórios)

| ID | Cenário | Resultado obrigatório |
|---|---|---|
| ADM-001 | Admin sem sessão abre qualquer rota Admin | Rejeição; sem dados nem ação; evento apropriado. |
| ADM-002 | Usuário com tier `pilot` sem role Admin usa endpoint direto | Rejeição mesmo conectado à carteira. |
| ADM-003 | Role `auditor` tenta POST no kill switch | 403/negação equivalente; switch não muda. |
| ADM-004 | DB falha ao ler switch | `unavailable`/UNKNOWN; nunca “todos OFF” falso. |
| ADM-005 | DB aceita escrita de switch mas log auditável obrigatório falha | Comando sensível não é confirmado sem trilha; comportamento transacional documentado. |
| ADM-006 | Operação `declared` sem recibo on-chain | Não integra receita verificada. |
| ADM-007 | AI cache hit com tokens não cacheados e cacheados | Conta de custo sem duplicação e modelo correto. |
| ADM-008 | Conta SSO corporativa revogada tenta continuar | Nega novas ações sensíveis; teste de revogação. |
| ADM-009 | Último superadmin tenta remover próprio acesso | Nega sem bloquear recuperação; evento auditado. |
| ADM-010 | Anon tenta TRUNCATE em tabela operacional crítica | Negado; prova em role real. |
| ADM-011 | Um endpoint Admin novo surge sem registro de permissão | CI falha. |
| ADM-012 | Rollback de SSO falha | Break-glass de recuperação documentado e testado; não reabrir legado globalmente. |
| ADM-013 | 2 contas Google/Entra autenticadas antes de desligar legado | Prova da autenticação individual + MFA real. |
| ADM-014 | UI recebe `0`, `null` e `503` no Finance | Três representações distintas, sem falso sucesso. |

---

## 8. Sequência operacional proposta ao Claude

**Fase A (descoberta única, curta):** ler fontes, inventário gerado dos endpoints, atualizar baseline, resultados agregados Supabase, rotas prioritárias, gap atual vs projeto; documento `docs/ADMIN-COMMAND-CENTER-INVENTARIO.md`.

**Fase B (R0 em branch de implementação):** refatorar contratos de observabilidade, kill switches e audit logs com testes; entregar commits testáveis. Não tocar Auth, RBAC ou banco remoto nesta etapa.

**Fase C (R1/R2 em ambiente isolado):** autenticação corporativa e RBAC server-side com ambiente de teste, migration apenas local; preparar configuração manual de IdP e MFA para o proprietário; testes E2E com duas contas quando disponíveis. Não desativar legado.

**Fase D (R3 e AI Center):** reorganização visual e painéis prioritários utilizando fontes já existentes; zero refatoração de motor financeiro, ZION ou laboratório; testes UX, dados e custo.

**Fase E (R4):** scripts de análise SQL e migrations avaliadas uma a uma. Sem aplicação em produção sem backup, diff e autorização explícita. Cobertura de grants, functions e service-role.

**Fase F (R5):** migração de autorização e aposentadoria do legado somente após contas reais e recuperação validadas. Ensaio completo e autorização final.

**Retorno ideal do Claude:** implementar tudo que for independente, sem perguntar a cada arquivo. Relatar uma vez no final da rodada: SHA, commits, testes, Preview, migrações locais, checklist de decisões externas realmente pendentes e riscos. Se alguma etapa depender de MFA/IdP/produção, continuar outras frentes independentes e parar somente nesse ponto. Não abrir dezenas de subprojetos sem necessidade.

---

## 9. Métricas do projeto e NFRs

Objetivos propostos (não métricas atuais nem promessas):

- **Cobertura 100%** das 66 rotas Admin em matriz de autenticação/autorização e testes de negação.
- **0** operações administrativas de alto risco sem confirmação durável de autorização e trilha de auditoria, ou bloqueio explícito.
- **0** métricas `unavailable` ou `partial` mascaradas como zero ou saudável em superfícies prioritárias.
- **0** novos grants não intencionais de `TRUNCATE/REFERENCES/TRIGGER` para `anon/authenticated`.
- **100%** de receitas marcadas `verified` sustentadas por evidência e reconciliação; casos sem evidência permanecem `declared`.
- **100%** de registros de custo com modelo real, categoria cache separada, origem e timestamp conhecidos; valores estimados rotulados.
- **Tempo de detecção de falhas**: medir baseline, escolher SLO com dados reais; não inventar um SLA para cron que não dispara sempre.
- **Performance:** p50/p95 e consultas lentas por área; estabelecer metas depois do baseline. Não realizar polling agressivo em todos os painéis.
- **Acessibilidade:** operação por teclado, rótulos e contraste; responsividade sem overflow crítico.

---

## 10. Decisões pendentes que não podem ser inventadas

1. Organização real de Google Workspace e tenant Microsoft Entra; contas e domínios permitidos; custos de licenciamento.
2. Duas contas administrativas humanas independentes e método de recuperação seguro.
3. Método escolhido de MFA e o nível de garantia exigido por operação.
4. Envelopes de permissão `superadmin`, `security`, `finance`, `ops` e alçadas para ações financeiras.
5. Políticas de LGPD, retenção, exportação, geografia e resposta a incidentes.
6. Mudanças de grants no Supabase hospedado, migrations e qualquer transição de produção.
7. Política contratual de responsabilidade e ressarcimento (CAPS) permanece **separada e pós-lançamento da comunidade+Beta**; NÃO ativá-la dentro da reforma do Admin.

O Claude pode propor decisões com trade-offs e implementações parametrizadas com valores seguros. Não pode inventar credenciais, domínios corporativos ou comprometer acesso.

---

## 11. Fora do escopo / proteções de continuidade

- Não reconstruir a Z-SWAP do zero.
- Não refazer W1/W3/W4, Lighthouse/blockhash ou fluxos de swap.
- Não alterar preços de tiers, fees, contas de arrecadação, recompensas ou Founder Pass.
- Não reativar CEX Autopilot, DCA nem algoritmos financeiros.
- Não fazer deploy, merge em `main`, modificar variáveis reais ou aplicar migrations remotas sem autorização do proprietário.
- Não copiar dados de usuários para provedores LLM, nem usar IA para autorizar pagamentos/admin.
- Não introduzir novo SaaS pago ou custos recorrentes sem orçamento e escolha.
- Não apagar `admin_audit_log`, `platform_admins`, `tier_cache`, operações históricas ou evidências.
- Não chamar o projeto de “pronto” enquanto SSO/MFA/RBAC/ACL não tiverem sido testados no ambiente correto.

---

## 12. Entregáveis finais da missão

1. `docs/ADMIN-COMMAND-CENTER-INVENTARIO.md` — snapshot de estado e matriz de rotas com status rastreável.
2. `docs/ADMIN-API-AUTHORIZATION-MATRIX.md` — permission matrix rastreável ao código.
3. `docs/ADMIN-SSO-MFA-RBAC-DESIGN.md` — arquitetura, ameaça, transição e recovery, sem suposições de tenant.
4. `docs/ADMIN-OBSERVABILITY-TRUTH-CONTRACTS.md` — contratos de estados, proveniência e métricas.
5. `docs/ADMIN-SECURITY-DB-ACL.md` — inventário real de grants, functions, roles, impacto e migrations locais planejadas.
6. Commits focados com implementação R0 e módulos viáveis, testes, CI e Preview.
7. Manual de QA Admin com testes de 2 identidades e captura de evidência.
8. Quadro final `DONE / PARTIAL / BLOCKED` com justificativa objetiva e sem promessas vagas.
9. Plano de rollout/recovery preservando acesso proprietário e serviços financeiros.

---

## 13. Fontes consultadas — arquivos do repositório

- https://github.com/zetta-world/swap-z-app/blob/main/src/lib/admin/require.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/lib/auth/session.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/app/admin/api/killswitch/route.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/lib/admin/kill-switches.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/app/admin/api/finance/route.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/app/admin/api/admins/route.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/lib/admin/areas.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/lib/admin/modules.ts
- https://github.com/zetta-world/swap-z-app/blob/main/src/components/admin/panels/AiCostPanel.tsx
- https://github.com/zetta-world/swap-z-app/blob/main/docs/ADMIN-COMMAND-CENTER.md
- https://github.com/zetta-world/swap-z-app/blob/main/docs/PLANO-ADMIN-INTEL.md
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth

**Nota de integridade:** links `main` podem avançar após 25/10. Sempre comparar com o SHA de evidência deste documento e registrar diferenças.

---

## 14. Veredito executivo

A Z-SWAP já possui um Admin amplo. O gargalo não é quantidade de painéis, mas **identidade individual, autorização por tarefa, provas de integridade, mensagens honestas e organização para operação corporativa**. Começar por R0 e segregar o Admin da autenticação de carteira reduz riscos sem jogar fora anos de desenvolvimento. A nova camada de IA deve ser integrada às métricas existentes, e não recriada em paralelo.

**Autoridade operacional:** este é um plano. O Claude pode iniciar imediatamente implementação local e Preview isolado; somente o proprietário autoriza mudanças sensíveis na produção e no banco real. Não transformar este documento num comando para executar migrações por leitura literal.
