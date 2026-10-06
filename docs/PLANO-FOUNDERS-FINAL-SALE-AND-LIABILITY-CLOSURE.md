# PLANO — FOUNDERS FINAL SALE + LIABILITY CLOSURE

**Data:** 06/10/2026  
**Status:** CURRENT_DEVELOPMENT  
**PHASE_BASE_SHA:** `30366d0e95bcf3222f47fb9ef955a2a1bf294096`  
**Branch local:** `founders-sale-rules-final-delta-20261006`  
**Publicação/deploy:** proibidos; esta fase é local e termina em auditoria independente.

## 1. Objetivo fechado

Executar apenas o delta determinado pela auditoria independente:

1. venda com allowlist de 48 horas, limite 1/1/1 nessa fase e teto cumulativo do evento 2/2/1;
2. todo Pilot não vendido na allowlist permanece à venda na fase pública;
3. encerramento por sold-out real ou 14 dias desde a abertura da allowlist, sem mint antecipado e sem extensão automática;
4. copy de Founder status limitada à propriedade duradoura do passe e aos direitos do holder atual, enquanto o Premium dura exatamente 36 meses;
5. eliminar a dupla contagem salarial do treinamento;
6. modelar a reserva dinâmica do passivo remanescente e reconciliá-la com a política de capital existente, sem somar a reserva novamente como custo.

## 2. Invariantes preservados

- supply pago `2000/750/100`, reserva `30/10/0` e preços provisórios `149/399/1990` não mudam;
- unused paid supply e unused reserve permanecem unminted;
- benefício, suporte, fees, redes, Pilot Workbench, staffing e referral conservam as decisões da L-044;
- nenhuma migration, dependência, package lock, integração hospedada, credencial real ou fluxo financeiro real muda;
- supply-chain permanece `OPEN — SEPARATE DISPOSITION CAMPAIGN`.

## 3. Implementação

### 3.1 Venda

- remover a exclusividade Pilot da fase allowlist;
- aplicar os tetos por tier sobre o histórico cumulativo da mesma carteira nas duas fases;
- expor a mesma regra em config, preview, página, FAQ, pricing e fatos do ZION;
- tornar 14 dias o prazo máximo do evento inteiro, contado da abertura da allowlist;
- acrescentar regressões para 1/1/1, 2/2/1, carry-over e Pilot remanescente.

### 3.2 Founder status

- substituir as quatro traduções da promessa ampla por: status duradouro do passe; direitos do status pertencem ao holder atual conforme a política de ownership;
- proteger public copy contra Premium vitalício e entitlement automático em produtos/benefícios futuros.

### 3.3 Economia e reserva

- folha cobre o tempo de treinamento; ramp cobre a perda de produtividade;
- a linha `training` conterá somente recruiting e custos extras de curso/material/instrutor/supervisão/certificação/ferramentas;
- separar custo front-loaded, recurring e variable;
- calcular passivo restante a partir de componentes ainda não incorridos, com dados reais substituindo premissas;
- apresentar buffers 1,10 / 1,25 / 1,50 e opção híbrida P90/uso observado;
- reconciliar gross proceeds, obrigações tributárias ainda não decididas, service liability reserve, emergency/runway e capital corporativo deployable sem ultrapassar 100% do caixa.

## 4. Validação

1. testes direcionados de Founders, copy e modelo;
2. regeneração determinística do modelo;
3. type-check;
4. lint;
5. suíte completa;
6. production build;
7. inspeção de integridade de migrations, package files e boundary de produção.

Toda primeira falha será preservada e investigada. Não haverá retry para fabricar PASS.

## 5. Entrega

- relatório `docs/FOUNDERS-FINAL-SALE-AND-LIABILITY-CLOSURE.md`;
- commits locais separados por assunto quando a dependência entre deltas permitir;
- pacote `Z-SWAP-FOUNDERS-FINAL-SALE-LIABILITY-AUDIT-20261006/` com bundle, patches, modelo, premissas, testes, manifesto, hashes e secret scan;
- transferência autorizada ao Google Drive com readback;
- nenhum push, merge, deploy ou alteração hospedada.
