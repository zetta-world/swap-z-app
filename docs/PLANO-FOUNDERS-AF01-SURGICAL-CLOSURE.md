# PLANO — FOUNDERS AF-01 SURGICAL CLOSURE

**Status:** IN_PROGRESS

**Data:** 07/10/2026

**PHASE_BASE_SHA:** `d08a1e3a221b5559630f53fb3318d538ee9c383f`

**Candidato reprovado preservado:** `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`

**Branch local:** `founders-af01-partial-schedule-fix-20261007`

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
