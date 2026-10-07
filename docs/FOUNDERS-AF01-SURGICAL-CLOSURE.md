# FOUNDERS AF-01 SURGICAL CLOSURE

## 1. AUDIT FAILURE RECEIVED

A auditoria independente reprovou o candidato histórico
`58bcf8e359ec209d65f45006d0f71c17cf1a53a5` no finding `IA-AF01-001`.
Uma agenda com `allowlistAbre` e `publicaAbre` preenchidos, mas
`vendaFecha = null`, passava por `validarConfig` e podia representar uma
public sale sem deadline. O SHA reprovado e sua evidência foram preservados.

## 2. ROOT CAUSE

As relações de 48 horas e 14 dias só eram verificadas quando os dois operandos
da respectiva relação estavam presentes. Não existia uma invariante anterior
que distinguisse agenda totalmente pendente de agenda parcialmente preenchida.
O `null` removia a validação do deadline em vez de invalidar a configuração.

## 3. OLD BEHAVIOR

`allowlistAbre != null`, `publicaAbre = allowlistAbre + 48h` e
`vendaFecha = null` não produziam erro temporal. Como `ServicoDaVenda` usa
`validarConfig` como gate canônico, a ausência dessa validação também permitia
a construção do serviço com a agenda parcial.

## 4. NEW INVARIANT

As três datas operacionais da venda têm somente dois estados válidos:

1. `000`: todas nulas, venda ainda não configurada;
2. `111`: todas presentes, sujeitas a `publicaAbre = allowlistAbre + 48h` e
   `vendaFecha = allowlistAbre + 14d`.

As outras seis combinações falham fechadas com o erro estável
`agenda_da_venda_incompleta`. Datas ausentes não são inferidas.

## 5. PENDING ALL-NULL STATE

O estado `000` permanece válido. Ele representa a fase anterior à definição
da agenda e não abre allowlist nem public sale.

## 6. CONFIGURED ALL-NON-NULL STATE

O estado `111` somente é válido quando a abertura pública ocorre exatamente em
+48 horas e o deadline exatamente em +14 dias, ambos medidos desde
`allowlistAbre`.

## 7. PARTIAL MATRIX

O teste parametrizado cobre as oito combinações de nullability. `000` e `111`
não recebem erro de incompletude; `001`, `010`, `011`, `100`, `101` e `110`
são rejeitadas. O caso adversarial `110`, com deadline nulo, também é testado
diretamente no gate de domínio.

## 8. EXACT 14-DAY REGRESSION

- 14 dias menos 1 ms: rejeitado;
- 14 dias exatos: aceito;
- 14 dias mais 1 ms: rejeitado;
- 48h de allowlist mais 7 dias públicos: rejeitado;
- abertura pública deslocada em 1 ms: rejeitada;
- sold-out real antes do deadline: permitido;
- sem sold-out: `PUBLIC_SALE` até deadline−1 ms e `ENDED` no deadline.

## 9. SERVICE DOMAIN REGRESSION

`ServicoDaVenda` continua delegando a uma única fonte de validação. A
construção via `montarEnsaio` com agenda `110` lança
`config_invalida:agenda_da_venda_incompleta`, portanto o objeto não chega a
operar nem pode representar uma venda pública válida 30 dias depois.

## 10. HYGIENE FIX

As cinco linhas de trailing whitespace reportadas no plano do micro-delta já
estavam corrigidas no ancestral docs-only `d08a1e3`. O candidato final também
removeu quatro hard breaks com espaços no novo plano. `git diff --check` entre
o candidato reprovado e o novo candidato passou sem saída.

## 11. ENVIRONMENT FINDINGS

A primeira execução direcionada nem iniciou os testes: um bind read-only
impediu o mount interno do executor Docker (`FAIL_ENVIRONMENT`, preservado).
Depois da correção exclusiva do executor, os testes passaram sem mudança de
produto. `npm ci` passou na primeira tentativa online do candidato final.

O build teve duas execuções interrompidas por reboot do host e duas execuções
encerradas com `137` por limites de memória do container. Esses resultados
foram preservados. Após autorização do dono, as quatro stacks locais foram
paradas temporariamente, sem remoção, e o mesmo `npm run build` passou em Node
24 com contenção de CPU/RAM e swap. SSH, Tailscale, rede, Docker e ZION
permaneceram ativos. Nenhuma configuração de produto ou de build foi alterada.

## 12. COMPLETE RECERTIFICATION

Recertificação exata do candidato
`efdf6ee5a64d4f5491b806da6258706615b6ffec`, tree
`9021c273c1d2e790f3a09da25de8f230ba9ef46e`, em Node `v24.21.0` e npm
`11.19.0`:

- `npm ci`: PASS, lockfile idêntico;
- sale rules: 1 arquivo / 11 testes PASS;
- domínio Founders: 17 arquivos / 254 testes PASS;
- type-check: PASS;
- lint: 0 erros / 145 avisos;
- suíte completa: 314 arquivos / 4.674 testes PASS;
- production build: PASS;
- regeneração econômica: PASS, quatro hashes idênticos e diff vazio.

O resultado é `EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED`, ainda sujeito a
auditoria independente. Não é certificação independente, release, publicação
ou autorização de deploy.

## 13. NON-REGRESSION

`package.json`, `package-lock.json`, migrations, modelo econômico, copy
Founder AF-02 e demais arquivos do domínio Founders permaneceram inalterados.
As regras de allowlist 1/1/1, teto cumulativo 2/2/1, Pilot na public sale,
sold-out real e Premium de 36 meses passaram nas regressões existentes.

Supply chain permanece em campanha separada: nenhuma dependência foi
atualizada nem a medição foi tratada como resolvida.

## 14. AUDITOR HANDOFF

- candidato reprovado preservado: `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`;
- novo candidato: `efdf6ee5a64d4f5491b806da6258706615b6ffec`;
- evidência: `zswap-local/evidence/founders-af01-surgical-20261007T093209Z/`;
- pacote: `Z-SWAP-FOUNDERS-AF01-SURGICAL-AUDIT-20261007/`;
- branch local sem upstream: `founders-af01-partial-schedule-fix-20261007`;
- `RELEASE_CANDIDATE=NONE`;
- produção, Vercel, Supabase hospedado, push, merge, deploy, venda e dinheiro
  real: intocados.
