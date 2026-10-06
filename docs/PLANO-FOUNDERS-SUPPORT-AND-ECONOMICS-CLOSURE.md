# PLANO — FOUNDERS SUPPORT AND ECONOMICS CLOSURE

**Status:** ACTIVE — implementação local, não release  
**Data:** 2026-10-06  
**Branch:** `founders-commercial-economics-closure-20261006`  
**PHASE_BASE_SHA:** `b464dd7fbec0941ffb26ab391a1783328dd876f9`  
**Último código previamente validado:** `7aa021d032a4ba706a9447663a8daf7e67431ca1`

## 1. Objetivo

Fechar a verdade comercial do Founders Pass em uma fonte canônica, impedir que
benefícios desabilitados, de roadmap ou ainda não confirmados sejam anunciados
como disponíveis, e recalcular a economia de 36 meses com uma operação de
suporte humano brasileira realista.

Esta fase não é release, não autoriza publicação da venda e não muda produção.

## 2. Verdade comercial congelada para esta fase

- supply pago: Pro 2.000, Trader 750, Pilot 100;
- reserva: Pro 30, Trader 10, Pilot 0;
- preços provisórios: US$ 149, US$ 399 e US$ 1.990;
- premium: 36 meses exatos desde o encerramento oficial;
- transferência não reinicia a janela; Founder acompanha o passe;
- CEX Autopilot: `IMPLEMENTED / DISABLED`;
- scanner de arbitragem: `A CONFIRMAR`;
- suporte prioritário: Trader e Pilot, fila assíncrona, sem SLA rígido,
  sem 24/7, concierge ou obrigação pessoal do CEO;
- automação avançada do Pilot: roadmap, sujeita a safety gates e certificação;
- redes atuais: Ethereum, Polygon, Arbitrum, Optimism, BNB Chain, Base,
  Avalanche e Solana; ZETTA Chain em roadmap;
- taxa da plataforma: EVM suportada, onde o mecanismo está ativo, Free 1%,
  Pro 0,5%, Trader 0,25%, Pilot 0,1%; Solana sem taxa de plataforma hoje;
- Pilot: 5.000 backtests padrão de estratégia própria por janela móvel de
  24 horas, até 3 ativos × 365 dias × candles de 4h; cargas maiores consomem
  proporcionalmente mais orçamento; modo mesa tem tratamento separado.

## 3. Estados canônicos de benefício

Todo benefício usará exatamente um estado:

1. `AVAILABLE_AT_LAUNCH`;
2. `IMPLEMENTED_DISABLED`;
3. `COMING_SOON_ROADMAP`;
4. `NOT_PART_OF_THE_OFFER`;
5. `A_CONFIRMAR`.

Seletores públicos nunca poderão promover os quatro últimos estados a
`AVAILABLE_AT_LAUNCH`.

## 4. Superfícies no escopo

- `src/lib/founders-commercial-truth.ts` como fonte canônica neutra, com
  compatibilidade no domínio isolado da venda;
- `/pricing`, inclusive cards, camada premium e FAQ;
- `/founders-pass`, inclusive cards, benefícios, onboarding e FAQ;
- fatos institucionais entregues ao ZION;
- testes de domínio, pricing, prévia, página Founders e ZION;
- modelo determinístico e relatório econômico.

## 5. Modelo econômico

O modelo separará COMPUTE, AI, DATABASE/CLOUD, SUPPORT L1/L2,
CEO/EXPERT ESCALATION, TRAINING, FIXED COST e OTHER OPS.

Serão calculados:

- staffing S1 Lean (2 pessoas + terceira por gatilho), S2 CEO Plan (3 desde o
  início) e S3 Mature (2 L1 + 1 L2/lead);
- custo CLT carregado, benefícios, ferramentas, treinamento, ramp-up,
  progressão salarial, férias/ausências e supervisão;
- deflexão do ZION em 30%, 50%, 70% e 85%;
- escalonamento ao CEO/especialista em 0,5%, 1%, 2% e 5%;
- cenários EXPECTED, HEAVY e STRESS por tier;
- referral em 0%, 10%, 15% e 20%;
- reserva de serviço baseada no passivo remanescente mais buffer prudencial.

Premissas legais ou fiscais serão cenários de planejamento, com fontes e
ressalvas explícitas; não serão apresentadas como parecer contábil ou jurídico.

## 6. Validação

Antes de entregar:

1. regressões direcionadas de verdade comercial;
2. testes direcionados das superfícies afetadas;
3. `npx tsc --noEmit`;
4. suíte completa se houver mudança de código;
5. regeneração determinística do modelo;
6. `git diff --check`;
7. secret scan do pacote;
8. verificação do Git bundle e de todos os SHA-256.

## 7. Saídas

- `docs/FOUNDERS-SUPPORT-AND-ECONOMICS-CLOSURE.md`;
- premissas e modelo reproduzível em `scripts/cost/`;
- tabela de verdade comercial derivada da fonte canônica;
- pacote externo `Z-SWAP-FOUNDERS-ECONOMICS-CLOSURE-AUDIT-20261006/`;
- commits locais, sem push, prontos para auditoria independente.

## 8. Limites

Sem produção, Vercel, Supabase hospedado, migrations hospedadas, push, deploy,
trade real, Autopilot real, Pilot real ou publicação da venda Founders.
