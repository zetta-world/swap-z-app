# FOUNDERS FINAL MICRO-DELTA CLOSURE

**Data:** 06/10/2026

**Base:** `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67`

**Candidato de código recertificado:** `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`

**Tree do candidato:** `835084a2ccb117e64a07376f9684d46196466c66`

**Status:** READY_FOR_INDEPENDENT_AUDIT

**Release/publicação:** não autorizados

## 1. EXECUTIVE VERDICT

Os findings AF-01 e AF-02 foram corrigidos no candidato exato `58bcf8e`.
A configuração da venda agora aceita somente o deadline de calendário igual a
`allowlistAbre + 14 dias`; o sold-out real continua sendo a única saída normal
antecipada. A copy pública em EN/PT/ES/ZH descreve o status Founder como
duradouro e associado ao passe, mantém Premium em 36 meses e deixa explícito
que a transferência não reinicia a janela.

O candidato passou testes direcionados, type-check, lint, suíte completa e
production build. A regeneração econômica foi determinística e não produziu
diff. Esta conclusão é implementer-reported e não substitui auditoria
independente, seleção de release candidate ou autorização de publicação.

## 2. BASE SHA

- Start HEAD: `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67`
- Start tree: `11cace84df18f4d8c8e9b72b31d9252bc8cea04a`
- Último código recertificado anterior: `8ef9bbe27ff1f74dd8d1f7f6e6f7abb180497150`
- Branch local: `founders-final-microdelta-20261006`, sem upstream.

## 3. FINAL CODE SHA

- SHA: `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`
- Tree: `835084a2ccb117e64a07376f9684d46196466c66`
- Commits funcionais:
  - `1ad14de` — janela exata de 14 dias;
  - `58bcf8e` — status duradouro associado ao passe.
- O commit documental posterior é control plane e não herda a recertificação
  do candidato.

## 4. SALE WINDOW FINDING

AF-01 foi confirmado: a validação anterior aceitava qualquer janela positiva
menor ou igual a 14 dias. Isso permitia, por exemplo, a configuração histórica
de 48 horas de allowlist mais sete dias de public sale. A regra comercial
fechada exige exatamente 14 dias desde `allowlistAbre`.

## 5. EXACT 14-DAY ENFORCEMENT

`validarConfiguracaoFounders` agora exige igualdade exata com
`duracaoMaximaVendaMs`, sem depender de timezone local. As regressões em UTC
provam:

| caso | resultado |
|---|---|
| 13d23h59m59.999s | REJECTED |
| 14d | ACCEPTED |
| 14d+1ms | REJECTED |
| 48h allowlist + 7 dias públicos | REJECTED |

O cenário local e a fixture ativa de readiness foram alinhados ao deadline
exato. Allowlist 48h, limites 1/1/1, limites cumulativos 2/2/1, Pilot na public
sale e unsold unminted não mudaram.

## 6. SOLD-OUT EARLY EXIT

A máquina de venda mantém duas condições distintas:

- `CALENDAR END`: exatamente no deadline configurado de 14 dias;
- `EARLY END`: somente quando todo o supply pago está realmente esgotado.

O teste valida que sold-out antes do deadline fecha a venda e que, sem
sold-out, ela permanece aberta em `deadline - 1ms` e fecha no deadline.
Nenhum fechamento administrativo antecipado foi adicionado.

## 7. FOUNDER STATUS COPY

AF-02 foi confirmado em metadados, pricing e catálogos de mensagens. A copy
foi normalizada para o conceito aprovado: status Founder duradouro associado
ao passe; os direitos acompanham o holder atual conforme a política de
ownership. Premium permanece temporário por exatamente 36 meses e a
transferência não reinicia a janela.

As guardas rejeitam promessas de Premium vitalício/permanente, benefícios
futuros ilimitados, acesso automático a produtos futuros e formulações que
possam sugerir status pessoal perpétuo independente do passe.

## 8. LANGUAGES

| idioma | formulação verificada | status |
|---|---|---|
| EN | durable Founder status attached to the pass | PASS |
| PT | status Founder duradouro associado ao passe | PASS |
| ES | estatus Founder duradero vinculado al pase | PASS |
| ZH | status duradouro explicitamente ligado ao passe | PASS |

Em todos os quatro idiomas, a FAQ também informa Premium de 36 meses e
transferência sem reinício da janela.

## 9. REGRESSION TESTS

- Sale rules: 1 arquivo / 9 testes PASS.
- Founder copy: 2 arquivos / 35 testes PASS.
- Escopo comercial relacionado: 17 arquivos / 252 testes PASS.
- Suíte completa: 314 arquivos / 4.672 testes PASS.

A primeira execução pré-candidato dos testes novos falhou em 3 de 102 casos:
duas fixtures não atendiam à precondição de snapshot do helper e uma regex PT
não admitia o artigo presente na copy. A evidência foi preservada; somente os
testes foram corrigidos antes do candidato. A execução seguinte passou
102/102 e o SHA candidato foi recertificado do zero.

## 10. FULL RECERTIFICATION

Ambiente: Node `v24.21.0`, npm `11.19.0`, imagem local pinada de testes.

| gate | resultado |
|---|---|
| targeted sale rules | PASS — 9/9 |
| targeted Founder copy | PASS — 35/35 |
| commercial related | PASS — 252/252 |
| type-check | PASS |
| lint | PASS — 0 erros / 145 avisos de baseline |
| full suite | PASS — 314/314 arquivos, 4.672/4.672 testes |
| production build | PASS |
| tracked source após recert | CLEAN |

Nenhuma stack preservada foi pausada ou alterada para obter os resultados.

## 11. ECONOMIC NON-REGRESSION

O modelo econômico foi regenerado no candidato e produziu zero diff.

- EXPECTED: US$ 262.948,76
- HEAVY: US$ 782.507,20
- STRESS: US$ 1.585.444,87
- `ECONOMIC_OUTPUT_CHANGED=NO`

Premissas, suporte, treinamento, service liability, capital policy, buffers,
referral, FX, AI, compute e DB não foram alterados.

## 12. OPEN RISKS

- Supply chain permanece em campanha separada: `npm audit --omit=dev`
  registrou 1 critical, 22 high e 37 moderate. Nenhuma dependência foi
  modificada ou aceita neste round.
- Preços seguem `PROVISIONAL_FOR_DEMAND_VALIDATION`.
- Publicação, jurídico, preço final e seleção de release candidate continuam
  fora deste micro-delta.
- A auditoria independente deste candidato ainda é obrigatória.

## 13. AUDITOR HANDOFF

Auditar o delta `8f1849e..58bcf8e`, confirmar a árvore `835084a`, verificar o
bundle e os manifests do pacote externo e repetir as provas de borda temporal,
copy multilíngue e não regressão comercial. O candidato não foi enviado,
mergeado, deployado ou aplicado a nenhum ambiente hospedado.
