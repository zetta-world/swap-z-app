# PLANO — FOUNDERS AF-01 SURGICAL CLOSURE

**Status:** COMPLETE — EXACT_SHA_RECERT_PASS_IMPLEMENTER_REPORTED

**Data:** 07/10/2026

**PHASE_BASE_SHA:** `d08a1e3a221b5559630f53fb3318d538ee9c383f`

**Candidato reprovado preservado:** `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`

**Branch local:** `founders-af01-partial-schedule-fix-20261007`

**Candidato final:** `efdf6ee5a64d4f5491b806da6258706615b6ffec`

**Tree final:** `9021c273c1d2e790f3a09da25de8f230ba9ef46e`

## Objetivo

Fechar exclusivamente o finding independente `IA-AF01-001`: uma agenda com
`allowlistAbre` e `publicaAbre` configurados, mas `vendaFecha = null`, era
aceita e podia permanecer em venda pública além de 14 dias.

## Invariante

Há somente dois estados válidos para as três datas da venda:

1. pendente: `allowlistAbre`, `publicaAbre` e `vendaFecha` são todos nulos;
2. configurado: os três são não nulos, `publicaAbre = allowlistAbre + 48h` e
   `vendaFecha = allowlistAbre + 14d`.

As seis combinações parciais falham com `agenda_da_venda_incompleta`. O
serviço continua usando `validarConfig` como gate canônico e deve recusar a
construção com agenda parcial.

## Validação

- matriz 8/8 de nullability;
- repro exato do auditor, inclusive construção de `ServicoDaVenda`;
- regressões 14d−1ms / 14d / 14d+1ms, sold-out e copy AF-02;
- `git diff --check`, type-check, lint, suíte completa e build;
- regeneração econômica determinística sem diferença;
- package-lock e migrations inalterados.

## Limites

Sem mudanças de economia, suporte, passivo, preço, referral, supply, Pilot,
copy Founder, ZION, migration, dependência, supply chain, produção, Vercel,
Supabase hospedado, push, merge, deploy, venda ou dinheiro real.

## Resultado

Agenda `000` preservada; agenda `111` exige 48h/14d exatos; seis combinações
parciais rejeitadas; `ServicoDaVenda` falha fechado. Recertificação exata:
11/11 regras de venda, 254/254 domínio Founders, type-check PASS, lint 0/145,
suíte 314/4.674 PASS, build PASS e economia sem diff. Próxima etapa: auditoria
independente do SHA final; nenhuma publicação ou release foi autorizada.
