# Z-SWAP — Orders Public Truth Micro-Closure

Data de referência: 08/10/2026  
Finding: `IA-PUBLIC-ORDERS-001`  
Start HEAD: `56241b2833a41f988dd7dd3108d1e8d6595ffa92`  
Base code SHA: `fd68c4f663ced81c3e040367c62697e473b5d542`  
Final code SHA: `2e50b1d0c04108586066d24c8c3bdde880f01e8f`  
Final code tree: `f414c9fad97494addce2e911f307f20eb48e12af`

## 1. Independent finding

A auditoria independente confirmou que `Orders` deve permanecer `PARTIAL`, mas encontrou copy pública incompatível com essa classificação. A página dizia que as estratégias superavam Jupiter e Matcha e que o ZION executava quando as condições fossem atingidas. Nenhuma dessas afirmações possuía prova de produto ou benchmark auditado.

O finding era bloqueador de publicação. O escopo deste round foi exclusivamente copy, fonte pública de verdade, regressões e recertificação. Nenhuma capacidade de execução foi adicionada.

## 2. Old public claim

A copy anterior comunicava os conceitos “beat Jupiter and Matcha” e “ZION watches the market continuously and executes when your rules are met”, com equivalentes em PT, ES e ZH. Esses conceitos excediam o fluxo real, no qual o plano é salvo e o usuário inicia a execução quando decide prosseguir.

Referências factuais a Jupiter como agregador ou integração não foram removidas. Somente a comparação de superioridade sem benchmark foi retirada.

## 3. Actual behavior

O comportamento certificado é:

- o usuário cria e salva um plano de ordem condicional;
- a Z-SWAP pode monitorar gatilhos suportados e emitir alertas;
- o plano salvo não é executado de forma autônoma;
- o usuário confirma explicitamente a execução;
- uma transação on-chain exige assinatura da wallet;
- `Orders` permanece `PARTIAL`.

O round não implementou cron, assinatura no servidor, wallet delegada, execução em background, DCA real, Pilot Automation ou qualquer transação sem ação explícita do usuário.

## 4. Corrected public wording

A abertura de Orders agora vende a utilidade real: criar e salvar planos condicionais, acompanhar gatilhos suportados e receber alertas. A mesma copy declara, de forma positiva, que a Z-SWAP não executa o plano salvo, que o usuário confirma a execução e que a wallet assina a transação on-chain.

Rótulos da interface também foram alinhados: “Saved plans”, “Save the plan, confirm later”, “Save plan” e equivalentes. A tela continua explicando o disparo manual, o carregamento do par no swap card e a confirmação posterior.

## 5. EN / PT / ES / ZH parity

Os quatro catálogos comunicam as mesmas invariantes:

| Idioma | Plano salvo | Sem execução autônoma | Confirmação explícita | Assinatura da wallet |
|---|---|---|---|---|
| EN | PASS | PASS | PASS | PASS |
| PT | PASS | PASS | PASS | PASS |
| ES | PASS | PASS | PASS | PASS |
| ZH | PASS | PASS | PASS | PASS |

A certificação de browser renderizou os quatro idiomas em `390×844`, além de EN em `1440×900`, sem overflow ou erro de página.

## 6. Forbidden claims

As regressões rejeitam, por idioma:

- execução automática ou autônoma de planos Orders;
- execução sem confirmação explícita;
- promessa de que o ZION executa quando as regras são atingidas;
- superioridade sobre Jupiter;
- superioridade sobre Matcha.

Os testes positivos exigem simultaneamente confirmação do usuário, assinatura da wallet e status `PARTIAL`. Isso evita corrigir o finding apenas apagando texto.

## 7. Regression test

Foi adicionado `src/components/orders/orders-public-truth.test.ts`, com 13 casos. O arquivo valida a fonte pública, o catálogo inteiro de Orders nos quatro idiomas, conceitos proibidos e os três sinais positivos obrigatórios.

Resultados no SHA exato:

- regressão nova: 1 arquivo, 13 testes, PASS;
- Orders funcional: 3 arquivos, 35 testes, PASS;
- public claims: 3 arquivos, 24 testes, PASS;
- i18n: 2 arquivos, 17 testes, PASS;
- public truth: 3 arquivos, 12 testes, PASS;
- Founders targeted: 7 arquivos, 86 testes, PASS;
- conjunto targeted consolidado: 15 arquivos, 160 testes, PASS.

A full suite final passou com 321 arquivos e 4.715 testes. A primeira execução preservada teve três falhas de executor: dois testes Git não conseguiam acessar o common gitdir montado e um teste de complexidade foi estrangulado por quota artificial de CPU. Os três passaram juntos depois de corrigir somente o executor, e a suíte integral seguinte passou sem alteração de código.

## 8. Browser validation

O browser harness final executou 41 verificações e terminou com zero falhas:

- `/orders` retornou HTTP 200 em EN, PT, ES e ZH;
- a copy renderizada contém a fronteira não autônoma, confirmação explícita e assinatura da wallet;
- o claim Jupiter/Matcha está ausente;
- mobile `390×844` e desktop `1440×900` não têm overflow;
- a Sales Page mantém `Orders = PARTIAL`;
- o FAQ mantém 59 perguntas no idioma verificado;
- não houve page errors.

As primeiras duas execuções do harness foram preservadas. A primeira procurava controles de idioma que existem na Sales Page, mas não na rota Orders. A segunda leu ES/ZH antes do término da hidratação sob CPU reduzida; as próprias capturas já mostravam a tradução correta. O harness final espera a frase traduzida antes da asserção.

## 9. Package-lock unchanged

`package.json` não mudou. `package-lock.json` não mudou e mantém SHA-256:

`5d5d05c7d12c3a3905d82f8ee4347c629d6a5acf612483d4f05334c828638816`

O `npm ci` no worktree limpo do SHA exato foi executado uma vez e falhou por `ECONNRESET`, exit 152. A falha é classificada como `FAIL_ENVIRONMENT_NETWORK`; não houve retry. Os demais gates Node 24 usaram, somente para leitura, o snapshot completo de `node_modules` do candidato anterior com o mesmo lockfile.

## 10. Founders non-regression

Os testes Founders passaram e nenhuma regra foi alterada: allowlist 48h, limites 1/1/1, limites cumulativos 2/2/1, Pilot na public sale, janela exata de 14 dias, sold-out real, não vendidos unminted, Founder status duradouro associado ao passe, Premium de 36 meses, transferência sem reinício, data indefinida, supply final indefinido e preços provisórios ocultos.

O modelo econômico determinístico regenerou com os mesmos hashes e diff zero. Migrations permaneceram sem alteração.

## 11. Supply-chain non-regression

O audit atual de produção (`npm audit --omit=dev --json`) confirmou:

- critical: 0;
- high: 20;
- moderate: 37;
- low: 0.

O grafo e o lockfile não mudaram. Este micro-delta não reabre a disposição de Supply Chain.

## 12. Resource-safe execution notes

Todos os processos pesados foram sequenciais, com `nice`, `ionice`, um worker de teste e limites de cgroup. ZION, SSH, Tailscale, NetworkManager e as stacks preservadas não foram parados ou alterados.

Duas tentativas de build foram interrompidas deliberadamente pelo executor quando a RAM disponível caiu abaixo do limiar seguro. Ambas ficaram registradas como `FAIL_ENVIRONMENT_RESOURCE_PRESSURE`; não houve OOM, reboot ou kill de serviço. O build final usou 2 CPUs, 1 GiB de RAM física, 3 GiB totais com swap e heap de 1.792 MB. Ele concluiu compilação, TypeScript e geração estática com exit 0. O host terminou com 1,6 GiB de memória disponível e 1,9 GiB de swap livre.

Resultados finais:

- typecheck: PASS; a primeira tentativa com heap artificial de 1.200 MB foi preservada como OOM do executor;
- lint: PASS, 0 errors, 145 warnings preexistentes;
- full suite: PASS, 321/321 arquivos e 4.715/4.715 testes;
- production build: PASS;
- `git diff --check`: PASS;
- serviços protegidos: active/unchanged.

## 13. Auditor handoff

O code candidate deste micro-delta é `2e50b1d0c04108586066d24c8c3bdde880f01e8f`. A classificação pública permanece `Orders = PARTIAL`. Os claims de execução autônoma e superioridade sobre Jupiter/Matcha foram removidos em EN/PT/ES/ZH, e regressões impedem sua reintrodução.

Limitações preservadas para o auditor:

- o `npm ci` limpo falhou por `ECONNRESET` e não foi repetido;
- o audit de produção conserva 20 high e 37 moderate do round separado, sem regressão;
- o lint conserva 145 warnings preexistentes;
- primeiras falhas ambientais/de harness permanecem no pacote, acompanhadas pelas execuções corrigidas.

Nenhuma mudança foi feita em produção, Vercel, Supabase hospedado, preço, supply, sale date, economics, dependencies, Next.js, ZION Community ou automação.
