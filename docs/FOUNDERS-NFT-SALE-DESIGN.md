# FOUNDERS NFT SALE — DESIGN (P0 captação) · 🟡 decisões do dono aplicadas (04/10) — preço provisório

> **Criado em:** 04/10/2026, lane B (`pre-vercel-forward-20261003T234200Z`, sobre `5792584`). **Só docs.**
> Nada aqui é configuração de produto, data, preço ou política aprovada. As recomendações são **consultivas**.
> Decisões abertas e formulário: `docs/FOUNDERS-NFT-OWNER-DECISIONS.md`. Economia: `docs/FOUNDERS-NFT-CAPITAL-MODEL.md`.
> Funil/métricas/backlog: `docs/FOUNDERS-NFT-LAUNCH-FUNNEL.md`.
> Invariantes: `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF`.
> **Revisão 2 (04/10/2026):** aplica as decisões do dono — janela premium = **36 meses do encerramento oficial da venda**
> (expiração por versão/"v3" **removida**), supply pago **2.000 / 750 / 100**, preços **provisórios** $149 / $399 / $1.990
> (âncora USD, pagamento SOL, snapshot-e-congela por fase). Status de cada OD: `FOUNDERS-NFT-OWNER-DECISIONS.md` (rev. 3).

## 0. Moldura obrigatória: venda de PRODUTO, não captação de investimento

"Geração de capital" é o objetivo **interno** do projeto. Para o comprador, o Founders Pass é um **produto**
(acesso premium por tempo limitado + status de membro), nunca um investimento. Isto já está decidido em fontes
autoritativas e o desenho inteiro obedece:

- `docs/NFT-BRIEFING.md` §4 — nunca "profit share / dividend / investment return"; revisão jurídica **antes do mint**.
- `docs/WHITELIST-FUNDRAISING-DISCOVERY.md` §0 **G** — *fundraising* (`fundraising_*`) é outro sistema, com instrumento
  jurídico próprio, e **não** existe; §5.4 rejeita `/founders` para investidor ("confundiria comprador de NFT com
  investidor — risco regulatório").
- `docs/PLANO-MESTRE.md` (SUPERSEDED, só visão) — "NFT como access pass / comunidade (utility), NÃO cash-grab".

Consequência prática: nenhuma página, e-mail ou métrica pública fala em retorno, valorização, rendimento ou "uso dos
recursos" como promessa ao comprador.

## 1. Visão Founders já existente (recuperada do repositório)

Ordem de autoridade usada (`docs/DOCUMENT-AUTHORITY.md`): código vigente > `NFT-BRIEFING.md` (SUPPORTING_REFERENCE,
"reconferir no código") > `PLANO-MESTRE.md` (SUPERSEDED). `WHITELIST-FUNDRAISING-DISCOVERY.md` §0 é autoritativo para
early access/fundraising.

| item | estado | o que diz | fonte |
|---|---|---|---|
| propósito | **DECIDED** (atualizado 04/10) | Access Pass: **36 meses** de premium contados do encerramento oficial da venda + status Founder permanente (segue a política de transferência, OD-NFT-12); depois do prazo o holder cai para Free e mantém o Founder. Nenhuma versão/"v3" encurta o prazo | OD-NFT-14 (dono, 04/10) — substitui "3 anos OU v3" de `NFT-BRIEFING.md` §0 |
| público-alvo | **PARTIALLY_DECIDED** | usuários de cripto/DeFi BR-first que querem o premium do Z-SWAP (ZION, autopilot, arb) e o status de fundador; perfil de comprador por tier não detalhado | `NFT-BRIEFING.md` §1–§3, §9 |
| papel no Z-SWAP | **DECIDED** | o NFT É o plano de lançamento ("Deuses"); os planos normais recorrentes ("Guerreiros") custam +30% | `NFT-BRIEFING.md` §9 · `src/lib/pricing/plans.ts` (`NORMAL_PREMIUM = 1.3`, mensal $7,90/$20,90/$159) |
| supply pago | **DECIDED para a proposta comercial** (04/10) | **2.000 Pro · 750 Trader · 100 Pilot = 2.850** (substitui 1.500/500/50); reserva fora da venda segue OD-NFT-04 e **não** entra aqui | decisão do dono 04/10 (`FOUNDERS-NFT-OWNER-DECISIONS.md`) — o código (`plans.ts`) ainda tem 1.500/500/50 |
| estrutura da coleção | **DECIDED** | 3 tiers ↔ `pro/trader/pilot` (`TIER_RANK` 1/2/3); arte fixa por tier (`public/nft/{pro.jpg,trader.png,pilot.jpg}`), card 3:4 obsidiana/ouro, "LIMITED EDITION", serial `ZS-{TIER}-0001` | `NFT-BRIEFING.md` §1 · `src/lib/tier/types.ts` |
| benefícios premium (Camada A) por tier | **DECIDED + IMPLEMENTED_FOUNDATION** | `zionAdvisory→pro`, `cexAutopilot→pro`, `arbScanner→trader`, `prioritySupport→trader`; cotas diárias por tier | `NFT-BRIEFING.md` §1 · `src/lib/tier/*` (`FEATURE_TIER`, `TIER_DAILY_ANALYSES`) |
| taxa de swap por tier | **DECIDED + IMPLEMENTED** | Free 100 bps (teto do dono) · Pro 50 · Trader 25 · Pilot 10; ligada em `/api/quote` (EVM; Solana hoje sem taxa — `MOTIVOS_SOLANA_SEM_TAXA`) | `src/lib/tier/fees.ts` · `src/app/api/quote/route.ts` |
| leitura do passe | **IMPLEMENTED_FOUNDATION** | tier derivado do NFT pela Helius DAS (`getAssetsByOwner` + `ZSWAP_COLLECTION_ADDRESS`); sem coleção configurada = sem passe | `src/lib/tier/check.ts` |
| benefícios Founder (Camada B) | **DECIDED (lista)** / implementação parcial | badge on-chain, whitelist automática em coleções futuras, Hall of Fame, Founder rewards (royalty), voto, beta perpétuo, desconto de taxa, rate limit maior, tema Founder, features grátis com badge | `NFT-BRIEFING.md` §3 · `src/components/pricing/FounderBenefits.tsx` |
| framing jurídico | **DECIDED (regra)** / revisão **pendente** | "rewards", nunca "dividend"; advogado cripto-BR antes do mint | `NFT-BRIEFING.md` §4 |
| narrativa | **DECIDED**, com ajuste | "poder por 36 meses, pertencimento permanente" (o texto do §5 que cita "v3" foi neutralizado) | `NFT-BRIEFING.md` §5 + OD-NFT-14 |
| metadata | **PARTIALLY_DECIDED** | schema proposto (Metaplex Core, atributos Founder perpétuos); `Governance Weight` = `TIER_RANK` só como proposta | `NFT-BRIEFING.md` §6 |
| chain | **APPROVED** (04/10) | Solana + Metaplex Core, programa de venda padrão, sem contrato próprio | OD-NFT-01 |
| preço | **PARTIALLY_APPROVED** (04/10) | **$149 / $399 / $1.990 — PROVISIONAL_FOR_DEMAND_VALIDATION**; âncora USD, pagamento SOL, referência SOL/USD fotografada antes de cada fase e preço em SOL congelado na fase (fonte da referência não decidida); o código ainda tem 218/580/4.350 | OD-NFT-02 |
| moeda | **APPROVED** (04/10) | só SOL no lançamento | OD-NFT-03 |
| royalty | **PARTIALLY_APPROVED** (04/10) | royalty para a **tesouraria**; **nenhuma** distribuição de royalty/receita a holders; % não definido. A copy antiga ("5% … distributed to holders") está em correção (OD-NFT-19) | OD-NFT-11 |
| allowlist / whitelist | **PARTIALLY_APPROVED** (04/10) | híbrido em princípio: Early Access verificado + lista curada pequena; Pilot só allowlist; país segue a política jurídica; "first-come" sai da copy | OD-NFT-06, 19 |
| relação com o Early Access | **UNRESOLVED** (fundação existe) | Early Access Fases 1–2 certificadas, não deployadas, gate fechado; guarda carteira declarada, `wallet_verified_at` (sem fluxo de verificação), referral sem recompensa | `PLANO-EARLY-ACCESS.md` · `0068/0069` |
| fases da venda | **UNRESOLVED** | — | — |
| data | **APPROVED (regra)** | nenhuma data até jurídico + Vercel + ensaio em devnet; anúncio com ≥ 14 dias; "July 2026" sai da copy | OD-NFT-08, 19 |
| tesouraria | **APPROVED (modelo)** | multisig 2-de-3 + política escrita de conversão parcial para stable; signatários e números abertos | OD-NFT-10, 22 |
| experiência atual | **IMPLEMENTED_FOUNDATION** | `/pricing` com 3 artes, `FounderBenefits`, FAQ, `MintModal` = waitlist **só em localStorage** (ilusória, não alterar — decisão F) | `PricingView.tsx` · discovery §0 F, §5.2 |
| fundações técnicas da venda | **IMPLEMENTED_FOUNDATION (local, lane B)** | máquina de estados, snapshot de allowlist, Merkle com hash injetado, livro de alocação sem oversell, mint falso, ciclo de tx, relógio do servidor, 14 estados de UI, admin local de 2 passos, evidência encadeada, telemetria sem PII, painel acessível 4 línguas | `src/lib/founders-sale/*` · `src/components/founders/*` · `PLANO-FOUNDERS-NFT-SALE-READINESS.md` |
| modelo de segurança | **IMPLEMENTED_FOUNDATION (local)** | oversell impossível por fila, idempotência, frase de confirmação, segundo operador, snapshot congelado antes de abrir, "confirmada só com id de tx", isolamento sem rota | idem |
| captação de investidor (equity/convertível) | **DEFERRED** (fora deste trabalho) | `fundraising_*` reservado, depende de instrumento jurídico | discovery §0 G |
| PIX recorrente | **DEFERRED** | trilho B pós-NFT | `NFT-BRIEFING.md` §8 (5.5) |

**Copy ao vivo em conflito** (no código; produção está fora do ar, 402): "Mint opens July 2026", "first-come",
"5% … distributed to holders", "treasury governance", "3 years or until platform v3". Correção **aprovada** (OD-NFT-19);
texto novo nas 4 línguas em `FOUNDERS-NFT-COPY-CORRECTION.md`; **aplicação pendente** — está em código de produto
(`messages.ts`), fora de uma rodada só-docs.

## 5. Utilidade Founder — o que a plataforma consegue sustentar

Legenda: TS = TECHNICALLY_SUPPORTED · IR = IMPLEMENTATION_REQUIRED · OC = ONGOING_COST · AR = ABUSE_RISK ·
LS = LEGAL_SENSITIVITY · REC = RECOMMENDED.

### A. Disponível ou quase

| utilidade | TS | IR | OC | AR | LS | REC |
|---|---|---|---|---|---|---|
| Premium da Camada A pelo tier do passe (ZION advisory, autopilot CEX, arb scanner, suporte) por 36 meses do encerramento da venda | sim (`tier/check.ts`, gates) | configurar coleção + `ZSWAP_COLLECTION_ADDRESS` + fim do prazo (36 meses, OD-NFT-14) | **real**: tokens de IA, RPC (limitado pelas cotas diárias por tier) | média: empréstimo/aluguel do NFT entre carteiras (cache de tier) | baixa | **SIM** (núcleo do produto) |
| Taxa de swap reduzida (100 → 50/25/10 bps) | sim, EVM (`fees.ts`, `/api/quote`) | nenhuma no EVM; Solana hoje não cobra | receita de taxa abdicada | baixa (holder operando para terceiros) | baixa (é desconto) | **SIM** — e corrigir a copy "Future on-chain fee discount": o desconto já existe via tier |
| Badge Founder on-chain (o próprio NFT) | sim (Metaplex Core) | atributos no metadata | zero | baixa | baixa | **SIM** |
| Cotas diárias maiores de análise | sim (`TIER_DAILY_ANALYSES`) | nenhuma | IA | baixa | baixa | **SIM** (parte da Camada A) |

### B. Exige trabalho de produto

| utilidade | TS | IR | OC | AR | LS | REC |
|---|---|---|---|---|---|---|
| Badge/ícone Founder no app e tema Founder | parcial (tier no cliente) | UI + CSS | zero | baixa | baixa | SIM (barato) |
| Hall of Fame no `/about` | não | lista **opt-in** de holders (carteira é dado pseudônimo) | baixo | baixa | média (privacidade) | SIM, só opt-in |
| Rate limit maior nas APIs públicas | parcial (`rate_limits`) | limite por tier | baixo | média (revenda de acesso) | baixa | SIM, depois do lançamento |
| Beta perpétuo | parcial (gates por tier) | flags por tier | baixo | baixa | baixa | SIM |
| Suporte prioritário (Trader+) | não (sem canal/processo) | canal + SLA interno | **humano** | baixa | baixa | SIM, sem SLA prometido |
| Comunidade privada token-gated | não | provedor externo (bot de verificação de holder) | baixo | média | baixa | SIM, depois |
| Enquetes de produto (não vinculantes) | não | enquete por holder | baixo | média (sybil por compra) | **média** — nunca "governança de tesouraria" nem direito societário | SIM, só como consulta de roadmap |
| Prioridade no Early Access de produtos futuros | parcial (Early Access existe) | marca de holder no fluxo | zero | baixa | baixa | SIM |

### C. Futuro / condicional

| utilidade | TS | IR | OC | AR | LS | REC |
|---|---|---|---|---|---|---|
| "Whitelist automática em coleções futuras do ecossistema" (já DECIDIDA no briefing §3) | não (coleções futuras não existem) | snapshot de holders no momento de cada coleção | zero | baixa | baixa–média | manter, redigida como **elegibilidade a allowlist**, sem promessa de preço/quantidade |
| Founder rewards pool (distribuição de royalty a holders) | — | — | — | — | **ALTA** | **NÃO — decidido pelo dono (OD-NFT-11, 04/10): royalty vai para a tesouraria e nada é distribuído a holders** |
| Alocação em eventos/tokens futuros (ex.: ZETTA) | não | — | — | alta | **ALTA** | NÃO prometer |
| Acesso a eventos de lançamento | não | logística | variável | baixa | baixa | opcional |

**Nunca prometer:** lucro, valorização, renda passiva, yield, participação em receita, preço de token futuro, liquidez
secundária. A copy atual "distributed to holders" e "treasury governance" fere esta regra até haver revisão jurídica.

## 6. Política de allowlist — modelos (produto, não implementação)

Escala: ●●● bom · ●● médio · ● fraco (para "risco", ●●● = risco alto).

| modelo | justiça | risco sybil/bot | qualidade de conversão | qualidade de comunidade | carga administrativa | auditabilidade | valor de marketing |
|---|---|---|---|---|---|---|---|
| Seleção manual de apoiadores fundadores | ● | ● | ●●● | ●●● | ●●● (alta) | ●● | ● |
| Participação na comunidade (tarefas, presença) | ●● | ●●● | ●● | ●● | ●●● | ● | ●●● |
| **Early Access verificado** (email double opt-in + carteira assinada + país permitido) | ●●● | ●● | ●●● | ●● | ● (baixa) | ●●● | ●● |
| Contribuição (bug report, conteúdo) | ●● | ●● | ●● | ●●● | ●●● | ●● | ●● |
| Referral | ● | ●●● | ●● | ● | ●● | ●● | ●●● |
| Inscrição por ordem de chegada | ●● | ●●● | ● | ● | ● | ●●● | ●● |
| Allowlist por tier (Pilot por convite, Pro/Trader abertos) | ●● | ●● | ●●● | ●●● | ●● | ●● | ●● |
| **Híbrido** | ●●● | ●● | ●●● | ●●● | ●● | ●●● | ●●● |

**Recomendação (consultiva):** híbrido = (1) **Early Access verificado** como trilho principal — o sistema já existe e
é auditável (eventos, consentimento, double opt-in) — + **verificação de carteira por assinatura** (falta construir) +
(2) **lista curada pequena** de apoiadores fundadores, registrada com motivo no log do admin, + (3) **Pilot (50) só por
allowlist**. Referral **só como sinal**, nunca como critério (o Early Access já marca `sinal_mesmo_ip` e carteira
repetida). Snapshot congelado com identidade publicada antes de abrir (fundação pronta). Aprovação: OD-NFT-06.

## 7. Fases da venda (produto)

Casa com a máquina de estados já implementada (`rascunho → agendada → allowlist_aberta → publica_aberta →
esgotada/encerrada`, `pausada`, `cancelada`). Nenhuma data.

| fase | objetivo | quem participa | alocação | preço | início | fim | não vendido | proteção | estado de UI |
|---|---|---|---|---|---|---|---|---|---|
| 1. ANÚNCIO | explicar o produto e abrir o funil | todos | — | em USD, provisório até a validação de demanda (OD-NFT-02, 21) | aprovação jurídica + copy aprovada | abertura do registro | — | sem coleta fora do Early Access | COMING_SOON |
| 2. REGISTRO NA ALLOWLIST | qualificar carteiras | inscritos do Early Access + lista curada | — | — | gate do Early Access aberto | data de corte anunciada | — | double opt-in, assinatura de carteira, rate limit, país | ALLOWLIST_CHECK / NOT_ELIGIBLE |
| 3. CONGELAMENTO | tornar a lista imutável e auditável | operadores (2 passos) | snapshot + raiz Merkle publicados | — | fim do registro | publicação da identidade do snapshot | — | frase + segundo operador, evidência encadeada | SALE_NOT_STARTED + contagem |
| 4. JANELA ALLOWLIST (garantida) | dar prioridade real a quem se qualificou | carteiras do snapshot | **teto por carteira** (OD-NFT-05), Pilot só aqui | fixo da fase | horário anunciado | horário anunciado ou esgotado | passa para a fase 5 (se houver) | prova Merkle, teto, idempotência, pausa | ELIGIBLE / SALE_ACTIVE / tx |
| 5. PÚBLICA (opcional, OD-NFT-07) | completar o supply | qualquer carteira de país permitido | teto por carteira | **mesmo** preço (sem leilão) | fim da fase 4 | esgotado ou data final | fica **não mintado** (OD-NFT-09) | teto, bot tax/limite por bloco, pausa | SALE_ACTIVE |
| 6. ESGOTADO / ENCERRADO | fechar com reconciliação | — | — | — | supply = 0 ou data | — | — | reconciliação vendido × on-chain (evidência `sold_out_reconciliation`) | SOLD_OUT / ENDED |
| 7. PÓS-VENDA | ativar o acesso | holders | — | — | confirmação on-chain | — | — | tier só com NFT confirmado na carteira | TRANSACTION_CONFIRMED → app |

Fase "alocação garantida para fundadores/time" **não** foi incluída: depende de OD-NFT-04 (reserva).

## 8. Experiência de lançamento — hierarquia de informação recomendada

Tom: monumental, institucional, escasso, tecnológico, crível. Mesma identidade do app (obsidiana, ouro/violeta, Syne/
DM Mono, cards dos deuses). Nada de confete, contagem falsa, "últimas unidades" fabricadas.

1. **Hero** — a coleção dos três deuses (arte real), uma linha de tese ("36 meses de premium. Status Founder permanente."), estado atual da venda (um dos 14 estados) e **um** CTA coerente com o estado.
2. **Contagem** — só com horário do servidor; sem horário → "Data não anunciada".
3. **Coleção e supply** — 3 cards (supply fixo por tier, mintado / reservado / disponível reais; percentual só quando
   há dados).
4. **Tese Founder** — o que é o passe (produto), Camada A × Camada B, o que acontece depois dos 36 meses (sem gatilho por versão).
5. **Utilidades** — só A (+ B marcadas "em construção", sem data). Nada de C como promessa.
6. **Elegibilidade da carteira** — conectar → "elegível / não elegível / verificando" + prova.
7. **Alocação** — alocação, usado, restante, por tier.
8. **Preço** — em USD (âncora) e o preço em SOL **congelado da fase**, com a referência SOL/USD e o instante do snapshot; nada de preço mudando durante a fase (OD-NFT-02/03).
9. **CTA de mint** — habilitado só em ELIGIBLE/SALE_ACTIVE; motivo visível quando desabilitado.
10. **Progresso** — números on-chain reconciliados.
11. **Estado da transação** — preparando → assinatura → pendente → confirmada (**só com id de transação**) / falhou.
12. **Esgotado** — fato, data, link para o marketplace secundário sem prometer liquidez.
13. **FAQ** — inclui "isto não é investimento".
14. **Divulgação de risco** — volatilidade do SOL, irreversibilidade, sem retorno, jurisdições, revisão jurídica.
15. **Confiança/segurança** — endereço da coleção/programa, tesouraria (multisig) e identidade do snapshot verificáveis;
    chain errada bloqueia o CTA.
16. **Confirmação pós-compra** — passe, tier ativado, como usar o app, como entrar na comunidade.

O painel local `FoundersSalePanel` cobre 2, 3, 6, 7, 9, 10, 11 (14 estados, 4 línguas, a11y 41/41).

## 11. Segurança e confiança — o que a venda real terá de provar

| requisito | fundação local | o que falta | decisão de produto envolvida |
|---|---|---|---|
| sem oversell | `alocacao.ts` (fila, teto de supply) | provar no programa on-chain (guarda de supply/`itemsAvailable`) | OD-NFT-01 |
| sem dupla alocação / replay / duplo envio | idempotência por chave, `mint-falso.ts` | guarda de limite por carteira on-chain | OD-NFT-05 |
| integridade de snapshot/Merkle | `allowlist.ts`, `merkle.ts` (hash injetado) | hash da chain escolhida (ex.: keccak/sha256 conforme o programa) | OD-NFT-01, 06 |
| alocação determinística | snapshot ordenado, id = sha256 canônico | — | — |
| sucesso só após confirmação on-chain | `visao.ts` (CONFIRMED só com id), `ciclo-tx.ts` | leitura de confirmação/finalidade da chain | OD-NFT-01 |
| pausa | `admin.ts` (2 passos) + `pausada` | pausa também no programa on-chain | quem são os operadores |
| auditoria de ação admin | `admin_audit` na cadeia de evidência | persistência hospedada | — |
| fingerprint da configuração | `impressaoConfig` | publicar o fingerprint antes de abrir | — |
| verificação do contrato/programa | — | usar programa padrão auditado (ex.: Metaplex Core + Candy Machine) em vez de contrato próprio | OD-NFT-01 |
| verificação da tesouraria | — | destino do pagamento travado na configuração e conferido por fingerprint | OD-NFT-10 |
| detecção de chain / rede errada | — | bloquear o CTA fora da rede certa | OD-NFT-01 |
| reconciliação de esgotado | evidência `sold_out_reconciliation` | ler supply on-chain | — |

**Preço por fase (decidido 04/10: snapshot-e-congela):** antes de cada fase, fotografar a referência SOL/USD e fixar o
preço em SOL da fase — nativo das guardas de pagamento em SOL de um programa de venda padrão (uma atualização
auditada de configuração por fase, com fingerprint). A fonte da referência **não** está decidida; o ensaio em devnet
mede a operação. O preço USD-pegged contínuo do plano antigo **não** é o comportamento aprovado.
