# PLANO — FOUNDERS FINAL MICRO-DELTA CLOSURE

**Status:** HISTORICAL_EVIDENCE — executado; ver `FOUNDERS-FINAL-MICRODELTA-CLOSURE.md`
**Data:** 06/10/2026

**PHASE_BASE_SHA:** `8f1849eb28a61f1a5f8b477386c3ce0940bc5e67`

**Último código recertificado:** `8ef9bbe27ff1f74dd8d1f7f6e6f7abb180497150`

**Branch local:** `founders-final-microdelta-20261006`

**Publicação/deploy/produção:** proibidos neste round

## 1. Objetivo fechado

Corrigir somente AF-01 e AF-02 da auditoria independente:

1. exigir que `vendaFecha` seja exatamente `allowlistAbre + 14 dias`;
2. manter encerramento anterior somente quando o supply pago se esgotar de verdade;
3. substituir copy pública ambígua de status Founder permanente pela formulação duradoura associada ao passe, em EN/PT/ES/ZH;
4. travar as duas propriedades com regressões determinísticas;
5. provar que economia, preços, supply e demais regras da venda não mudaram.

## 2. Invariantes preservadas

- allowlist: 48 horas e teto 1 Pro / 1 Trader / 1 Pilot;
- teto cumulativo: 2 Pro / 2 Trader / 1 Pilot;
- compras da allowlist contam no total;
- Pilot remanescente segue para public sale;
- unsold permanece unminted;
- preços 149/399/1.990 continuam provisórios;
- Premium dura 36 meses e transferência não reinicia a janela;
- Founder status acompanha o holder atual do passe;
- nenhum arquivo econômico, migration, dependência ou caminho financeiro será alterado.

## 3. Implementação mínima

- alterar a validação temporal em `src/lib/founders-sale/config.ts` de teto máximo para igualdade exata;
- alinhar o cenário local e fixtures ativas à janela exata;
- adicionar casos 14d−1ms, 14d, 14d+1ms, 48h+7d, sold-out antecipado e deadline sem sold-out;
- alinhar somente copy pública Founders em pricing/preview/FAQ e metadados;
- ampliar guardas de copy sem varrer documentos históricos.

## 4. Verificação

Ordem obrigatória:

1. testes direcionados de regras da venda;
2. testes direcionados de copy e verdade comercial;
3. demais testes comerciais relacionados;
4. type-check;
5. lint;
6. suíte completa;
7. production build;
8. regeneração determinística do modelo econômico, exigindo zero diff.

As primeiras falhas ficam preservadas. Correções de executor não podem alterar o produto.

## 5. Saída

Criar `docs/FOUNDERS-FINAL-MICRODELTA-CLOSURE.md`, candidato local C1 recertificado no SHA exato, atestação C2 apenas documental e pacote externo `Z-SWAP-FOUNDERS-FINAL-MICRODELTA-AUDIT-20261006/`. O próximo passo é auditoria independente; não é release nem autorização de publicação.

## 6. Fechamento

Executado no candidato `58bcf8e359ec209d65f45006d0f71c17cf1a53a5`,
tree `835084a2ccb117e64a07376f9684d46196466c66`. Recertificação local
implementer-reported: alvo 17/252, suíte 314/4.672, type-check, lint e build
PASS; regeneração econômica sem diff. O plano não deve ser reexecutado. A
próxima ação é auditoria independente do pacote.
