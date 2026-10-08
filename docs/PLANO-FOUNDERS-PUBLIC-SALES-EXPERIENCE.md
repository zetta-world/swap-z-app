# PLANO — FOUNDERS PUBLIC SALES EXPERIENCE

Data de referência: 07/10/2026  
Branch: `founders-public-sales-page-20261007`  
Base: `dd04b7b66ac025c04a0ee4347adcdd8e5ce3b1f4`

## Objetivo

Transformar `/founders-pass` em uma experiência pública completa e verificável para explicar a Z-SWAP, seus produtos, planos, Founder Pass, regras de venda, riscos e decisões ainda pendentes. A rota continuará sem compra, mint ou checkout ativos.

## Fontes

A página deriva dados operacionais de `chains.ts`, `tier/types.ts`, `tier/fees.ts`, `pricing/plans.ts`, `founders-commercial-truth.ts` e `founders-sale/config.ts`. Copy localizada e FAQ vivem em um módulo público próprio, com testes que conferem esses fatos contra as fontes operacionais.

## Entregas

1. Fonte pública tipada e localizada, sem informação privada.
2. Página mobile-first em `/founders-pass`, com hero, produtos, Founder Pass, tiers, comparação, mecânica da venda, segurança, riscos e FAQ pesquisável.
3. Metadados SEO, OpenGraph, Twitter e JSON-LD sustentados pelo conteúdo público.
4. Telemetria de interação sem texto de busca, carteira ou outra PII, usando o beacon existente.
5. Regressões de claims, consistência, i18n, FAQ, navegação e non-regression Founders.
6. Documentos públicos, decisões abertas e relatório de fechamento.
7. Recertificação no SHA exato, screenshots responsivos e pacote de auditoria verificável.

## Restrições

- Data da venda e supply final permanecem indefinidos.
- Preços Founders continuam provisórios e ocultos na superfície pública.
- Nenhuma compra, mint, checkout, deployment, migration, alteração hospedada ou push.
- Nenhuma mudança em economics, fees, cotas, limites de venda, ownership, dependências ou Supply Chain.
- ZION Community não será alterado.

## Gates

1. Testes direcionados da página, FAQ, i18n, claims, consistência e telemetria.
2. Type-check, lint, suite completa e build de produção.
3. Founders non-regression, economics sem diff, Supply Chain sem mudança, package-lock e migrations intactos.
4. Validação visual em 390×844, 412×915, 768×1024 e 1440×900.
5. Secret scan, bundle, manifestos e readback do pacote transferido.
