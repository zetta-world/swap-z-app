# FOUNDERS NFT — DECISÕES DO DONO EM ABERTO (P0 captação) · 🔴 aguardando o formulário

> **Revisão 2 — 04/10/2026** (substitui a revisão 1 de 04/10, 14 itens). Lane B, só docs.
> Fontes lidas: `NFT-BRIEFING.md`, `PLANO-FOUNDERS-NFT-SALE-READINESS.md`, `WHITELIST-FUNDRAISING-DISCOVERY.md` §0,
> `PLANO-EARLY-ACCESS.md`, `PLANO-MESTRE.md` (SUPERSEDED, só contexto), `DOCUMENT-AUTHORITY.md`, `src/lib/pricing/plans.ts`,
> `src/lib/tier/{types,fees,check}.ts`, `src/components/pricing/*`, `src/lib/i18n/messages.ts`, `src/lib/founders-sale/*`.
> Desenho: `FOUNDERS-NFT-SALE-DESIGN.md` · economia: `FOUNDERS-NFT-CAPITAL-MODEL.md` · funil: `FOUNDERS-NFT-LAUNCH-FUNNEL.md`.
> As recomendações são **consultivas** — nenhuma vale como aprovação. Nada será implementado antes do formulário.

## Já decidido — NÃO perguntar de novo

Modelo de 2 camadas (Premium 3 anos OU v3 · Founder vitalício) · os 3 tiers Freyr/Thor/Odin ↔ pro/trader/pilot ·
**supply 1.500 / 500 / 50** · benefícios premium por tier e cotas diárias · escada de taxa de swap (Free 100 bps, dono;
50/25/10) · lista de benefícios Founder da Camada B · regra de framing ("rewards", nunca "dividend") e exigência de
revisão jurídica antes do mint · narrativa do §5 · planos normais = +30% e mensais $7,90/$20,90/$159 · fundraising
separado do NFT (`fundraising_*`, discovery §0 G) · identidade visual da coleção. Detalhe e fonte de cada item:
`FOUNDERS-NFT-SALE-DESIGN.md` §1.

## Conflitos encontrados (não resolvidos em silêncio)

| tema | lado 1 | lado 2 | autoridade | vira decisão |
|---|---|---|---|---|
| preço | `plans.ts`: `usdTarget` "AUTHORITATIVE", USD-pegged (≈ $218/$580/$4.350) | `NFT-BRIEFING.md` §7.2: "confirmar 1.5/4/30 SOL" | código > briefing, mas o próprio código diz "CONFIRM at mint" — nenhum é final | OD-NFT-02 |
| royalty | copy ao vivo: "5% … distributed to holders" | briefing §7.3: % aberto; §4: revisão jurídica obrigatória | briefing (regra jurídica) | OD-NFT-11 |
| allowlist | copy: "Founder allocation is first-come" | plano SUPERSEDED: "allowlist 48h → público" | nenhum autoritativo | OD-NFT-06, 07 |
| data | copy: "Mint opens July 2026" (passou) | — | — | OD-NFT-08, 19 |
| governança | copy: "voice in … treasury governance" | briefing §7.4: peso aberto | briefing | OD-NFT-15 |
| chain | código: Solana/Helius/Metaplex | briefing §7.7: "Solana confirmada?" | — | OD-NFT-01 |

## Cartões de decisão

Cada opção traz: **op** = efeito operacional · **cap** = efeito na captação · **ux** · **seg** = segurança ·
**cx** = complexidade · **jur** = sensibilidade jurídica · **rev** = reversível depois do lançamento · **contra** = maior desvantagem.

### OD-NFT-01 — Chain e padrão do token
- **WHY:** define programa de venda, carteiras, endereço, prova Merkle e leitura do passe.
- **BLOCKS:** adaptadores reais, ensaio em devnet, metadata, verificação de carteira, tudo on-chain.
- **EVIDENCE:** `tier/check.ts` (Helius DAS + `ZSWAP_COLLECTION_ADDRESS`), `types.ts` ("minted on Solana"), briefing §6 (Metaplex Core), §7.7 (aberto).

| | A. Solana + Metaplex Core (programa de venda padrão) | B. EVM (ex.: Base) ERC-721 | C. as duas |
|---|---|---|---|
| op | reaproveita a leitura de tier já pronta | reescrever leitura de tier | dobrar tudo |
| cap | base Solana do produto (Jupiter, Phantom) | público EVM maior em NFT | dilui a liquidez |
| ux | taxas baixas, rápido | gás maior | confuso |
| seg | programa padrão auditado, sem contrato próprio | contrato próprio = auditoria | duas superfícies |
| cx | baixa | alta | muito alta |
| jur | neutra | neutra | neutra |
| rev | não (coleção nasce numa chain) | não | não |
| contra | dependência de marketplaces Solana | joga fora o que existe | custo e risco dobrados |

**RECOMMENDED_OPTION = A** · **REASON:** é o que o código, o briefing e o plano já assumem; zero contrato próprio.

### OD-NFT-02 — Modelo de preço e valores por tier
- **WHY:** é o que o comprador paga e o que define a captação.
- **BLOCKS:** configuração da venda, página de preço, modelo de capital final.
- **EVIDENCE:** conflito acima; cenários em `FOUNDERS-NFT-CAPITAL-MODEL.md` §3.

| | A. SOL fixo por fase (ex.: 1,5/4/30) | B. USD-pegged contínuo (oráculo no mint) | C. âncora em USD, SOL fixado no congelamento e válido na fase |
|---|---|---|---|
| op | nativo do programa de venda | atualização contínua de preço ou co-assinante do servidor | 1 atualização auditada por fase |
| cap | receita em USD oscila com o SOL | receita em USD estável | quase estável (risco só dentro da janela) |
| ux | claro ("1,5 SOL") | preço em SOL muda durante a venda | claro e fixo durante a fase |
| seg | simples | oráculo/servidor viram ponto de falha | simples |
| cx | baixa | alta (não nativo — **medir em devnet**) | baixa |
| jur | neutra | neutra | neutra |
| rev | sim entre fases | sim | sim entre fases |
| contra | SOL cair = captação menor | complexidade e risco operacional | exposição ao SOL durante a janela |

Valores: cenário A ($99/$299/$1.990), **B ($218/$580/$4.350)**, C ($349/$899/$6.900, ondas).
**RECOMMENDED_OPTION = C com os valores do cenário B** · **REASON:** mantém a intenção USD do código sem a
complexidade de oráculo; valores = referência já registrada no repo e coerentes com o +30% dos planos normais.

### OD-NFT-03 — Ativo de pagamento
- **WHY:** muda conversão, contabilidade e risco cambial. **BLOCKS:** programa de venda, recibo, reconciliação.
- **EVIDENCE:** `plans.ts` (liquidação em SOL); nada sobre stablecoin.

| | A. só SOL | B. só USDC | C. SOL ou USDC |
|---|---|---|---|
| op | um caminho | um caminho | dois caminhos, dois saldos |
| cap | todo holder Solana tem SOL | exige USDC na carteira | maior alcance |
| ux | simples | atrito para quem só tem SOL | escolha extra |
| seg | simples | conta de token + mint correto | mais superfície |
| cx | baixa | média | média-alta |
| jur | neutra | neutra | neutra |
| rev | sim | sim | sim |
| contra | volatilidade | menos compradores | complexidade |

**RECOMMENDED_OPTION = A** · **REASON:** menor superfície no lançamento; a volatilidade é tratada em OD-NFT-02 (C) e OD-NFT-10.

### OD-NFT-04 — Reserva fora da venda (time, parceiros, prêmios)
- **WHY:** define o supply pago e a transparência. **BLOCKS:** configuração, progresso "reservado", modelo de capital.
- **EVIDENCE:** nenhuma menção de reserva no repo; o painel já distingue mintado/reservado/disponível.

| | A. 0% | B. pequena e divulgada (ex.: Pro 30 / Trader 10 / Pilot 0 ≈ 2%) | C. 10% |
|---|---|---|---|
| op | nada a administrar | lista de destino pública | gestão de lote grande |
| cap | máximo | −2% | −10% |
| ux | — | neutra se divulgada | percepção de "insider" |
| seg | — | mint de reserva com a mesma auditoria | idem |
| cx | baixa | baixa | média |
| jur | baixa | baixa | média (percepção) |
| rev | não depois de vender tudo | parcial | parcial |
| contra | sem prêmios/parcerias | pequena perda de receita | dilui escassez |

**RECOMMENDED_OPTION = B** · **REASON:** permite parcerias e prêmios sem tocar o Pilot e com transparência total.

### OD-NFT-05 — Teto por carteira
- **WHY:** concentração e bots. **BLOCKS:** configuração das guardas, alocação na UI.
- **EVIDENCE:** `alocacao.ts` aplica teto; valor ausente.

| | A. allowlist 1 por tier; pública 2 (Pilot 1) | B. 1 por carteira no total | C. sem teto |
|---|---|---|---|
| op | duas regras | uma regra | nada |
| cap | bom | limita compradores multi-tier | máximo no curto prazo |
| ux | justo | restritivo | "baleia leva tudo" |
| seg | contém bots | contém bots | vulnerável |
| cx | baixa | baixa | baixa |
| jur | neutra | neutra | neutra |
| rev | não durante a fase | idem | idem |
| contra | sybil com várias carteiras | perde quem quer Pro+Trader | concentração |

**RECOMMENDED_OPTION = A** · **REASON:** equilíbrio entre distribuição e captação; Pilot (50) protegido.

### OD-NFT-06 — Política de elegibilidade da allowlist
- **WHY:** quem entra no snapshot. **BLOCKS:** snapshot, Merkle real, comunicação.
- **EVIDENCE:** Early Access (double opt-in, país, referral sem recompensa, `wallet_verified_at` sem fluxo); análise em `SALE-DESIGN` §6.

| | A. Early Access verificado (e-mail + carteira assinada + país permitido) | B. curadoria manual | C. híbrido A + lista curada pequena + Pilot só allowlist | D. ordem de chegada |
|---|---|---|---|---|
| op | automático e auditável | trabalhoso | pouco trabalho extra | trivial |
| cap | boa qualificação | pequena | boa | alta, baixa qualidade |
| ux | claro | opaco | claro | corrida |
| seg | sybil médio | baixo | médio | alto |
| cx | média (assinatura de carteira) | baixa | média | baixa |
| jur | baixa | baixa | baixa | baixa |
| rev | não após congelar | idem | idem | idem |
| contra | exclui quem não se inscreveu | favoritismo | — | bots |

**RECOMMENDED_OPTION = C** · **REASON:** usa o sistema já certificado, é auditável e acomoda apoiadores reais.

### OD-NFT-07 — Estrutura e duração das fases
- **WHY:** máquina de estados e comunicação. **BLOCKS:** configuração, contagem, copy.
- **EVIDENCE:** máquina de estados local; `SALE-DESIGN` §7.

| | A. só allowlist | B. allowlist (ex.: 48 h) → pública (até esgotar ou 14 dias), mesmo preço | C. só pública |
|---|---|---|---|
| op | simples | duas janelas | simples |
| cap | limitada ao snapshot | maior | depende de hype |
| ux | exclusivo | prioridade + chance para todos | corrida |
| seg | melhor | boa | pior (bots) |
| cx | baixa | média | baixa |
| jur | neutra | neutra | neutra |
| rev | sim antes de abrir | idem | idem |
| contra | sobra supply | duas comunicações | bots e concentração |

**RECOMMENDED_OPTION = B** · **REASON:** prioridade real a quem se qualificou sem deixar supply parado.

### OD-NFT-08 — Momento do lançamento
- **WHY:** data pública e contagem. **BLOCKS:** anúncio, contagem real.
- **EVIDENCE:** copy "July 2026" vencida; bloqueios externos: R-01 Vercel, jurídico, provedor de e-mail.

| | A. fixar data agora | B. data só depois dos gates (jurídico + Vercel + ensaio devnet), anunciada com ≥14 dias | C. lançamento-surpresa |
|---|---|---|---|
| op | risco de adiar em público | previsível | sem preparo de funil |
| cap | hype cedo | funil completo | baixa |
| ux | frustração se adiar | confiável | ruim |
| seg | pressão para pular etapas | etapas completas | — |
| cx | — | — | — |
| jur | arriscado sem revisão | adequado | arriscado |
| rev | sim, com custo de reputação | sim | — |
| contra | já aconteceu (julho) | sem data hoje | conversão baixa |

**RECOMMENDED_OPTION = B** · **REASON:** o repo já tem uma data pública vencida; repetir custa credibilidade.

### OD-NFT-09 — Supply não vendido
- **WHY:** promessa de escassez. **BLOCKS:** estado ENCERRADO, comunicação.
- **EVIDENCE:** nenhuma.

| | A. fica não mintado; teto vira máximo | B. nova onda futura com aviso, preço ≥ ao da venda | C. queimar/fechar a coleção |
|---|---|---|---|
| op | nada | outra operação | irreversível |
| cap | perde o resto | captação adicional depois | nenhuma |
| ux | honesto | aceitável se avisado antes | "escassez" |
| seg | — | — | — |
| cx | baixa | média | baixa |
| jur | neutra | neutra | neutra |
| rev | sim (pode virar B) | — | **não** |
| contra | receita deixada | pode irritar holders | fecha opções |

**RECOMMENDED_OPTION = A, com B possível só por nova decisão e aviso público** · **REASON:** honesto e reversível.

### OD-NFT-10 — Tesouraria
- **WHY:** para onde vai o dinheiro e quem controla. **BLOCKS:** qualquer pagamento real; verificação pública.
- **EVIDENCE:** plano SUPERSEDED: Phantom + Squads.

| | A. carteira única | B. multisig 2-de-3 (ex.: Squads) | C. B + política escrita de conversão parcial para stable |
|---|---|---|---|
| op | simples | 2 assinaturas por saída | idem + rotina |
| cap | — | — | protege valor em USD |
| ux | — | confiança pública | idem |
| seg | **ponto único de falha** | forte | forte |
| cx | baixa | baixa | média |
| jur | neutra | neutra | neutra (fiscal: contador) |
| rev | sim | sim | sim |
| contra | perda total se a chave vazar | logística de signatários | decisão de mercado recorrente |

**RECOMMENDED_OPTION = C** · **REASON:** dinheiro do mint fica protegido e a receita não depende do SOL.

### OD-NFT-11 — Royalty e "Founder rewards pool"
- **WHY:** a copy atual promete distribuição; o briefing exige revisão jurídica. **BLOCKS:** metadata, copy, marketing.
- **EVIDENCE:** conflito acima; `SALE-DESIGN` §5 C.

| | A. royalty 0% | B. royalty para a tesouraria, **sem** distribuição a holders | C. royalty com pool distribuído a holders |
|---|---|---|---|
| op | nada | recebimento | distribuição recorrente, contabilidade |
| cap | — | receita secundária (aplicação varia por marketplace) | igual a B, menos o pool |
| ux | — | neutro | atrativo |
| seg | — | — | alvo de wash trading |
| cx | baixa | baixa | alta |
| jur | baixa | baixa | **ALTA** (Howey/CVM) |
| rev | sim antes do mint | idem | difícil depois de prometido |
| contra | sem receita secundária | remove um benefício anunciado | risco regulatório |

**RECOMMENDED_OPTION = B** (percentual a definir; 5% é o número já citado) · **REASON:** mantém receita sem prometer
retorno; C só depois de parecer jurídico.

### OD-NFT-12 — Transferência: o que acompanha o NFT
- **WHY:** a promessa "status eterno" precisa dizer de quem. **BLOCKS:** metadata, regra de tier, Hall of Fame.
- **EVIDENCE:** `tier/check.ts` lê o **holder atual** — o premium já acompanha o NFT.

| | A. transferível; tudo acompanha o holder atual | B. intransferível (soulbound) | C. transferível; premium segue o holder, Hall of Fame registra o mintador original |
|---|---|---|---|
| op | já implementado | outro programa | lista histórica |
| cap | liquidez secundária aumenta a demanda | menor demanda | igual a A |
| ux | claro | restritivo | claro |
| seg | aluguel/empréstimo de passe | — | — |
| cx | baixa | média | baixa |
| jur | neutra | menor | neutra |
| rev | não após o mint | não | não |
| contra | uso compartilhado | sem mercado | duas noções de "Founder" |

**RECOMMENDED_OPTION = C** · **REASON:** bate com o código e preserva o reconhecimento de quem apoiou primeiro (opt-in).

### OD-NFT-13 — Revelação e mutabilidade do metadata
- **WHY:** confiança e operação. **BLOCKS:** metadata, upload de arte.
- **EVIDENCE:** arte fixa por tier (3 imagens); schema do briefing §6.

| | A. sem revelação; arte do tier visível; metadata travado ao fim da venda | B. revelação adiada | C. metadata mutável indefinidamente |
|---|---|---|---|
| op | simples | etapa extra | autoridade ativa para sempre |
| cap | neutro | hype | neutro |
| ux | transparente | expectativa | desconfiança |
| seg | autoridade revogada no fim | — | risco de alteração |
| cx | baixa | média | baixa |
| jur | neutra | neutra | neutra |
| rev | não após travar | — | sim |
| contra | sem "surpresa" | não faz sentido com 3 artes fixas | mina confiança |

**RECOMMENDED_OPTION = A** · **REASON:** a coleção tem arte fixa por tier; revelação não agrega.

### OD-NFT-14 — Janela premium e critério da "v3"
- **WHY:** sem critério objetivo, "3 anos OU v3" é ambíguo. **BLOCKS:** termos, regra de fim do tier, metadata.
- **EVIDENCE:** briefing §0, §7.5.

| | A. 3 anos a partir do mint de cada passe | B. 3 anos a partir do fim da venda (data única) | C. remover "OU v3" (só 3 anos) |
|---|---|---|---|
| op | prazo por NFT | um prazo só | mais simples |
| cap | neutro | neutro | pode valorizar o produto |
| ux | justo por comprador | fácil de entender | mais claro |
| seg | — | — | — |
| cx | média | baixa | baixa |
| jur | precisa definir v3 | precisa definir v3 | menor |
| rev | não após vender | idem | idem |
| contra | vários prazos | quem compra cedo/tarde = mesmo fim | muda texto aprovado (§5) |

Se mantiver "v3": definir como lançamento público nomeado "v3", anunciado com antecedência (ex.: ≥ 90 dias).
**RECOMMENDED_OPTION = B + definição de v3 com aviso prévio** · **REASON:** uma data, um gatilho público, sem ambiguidade.

### OD-NFT-15 — Escopo e peso da "governança"
- **WHY:** a copy promete "treasury governance". **BLOCKS:** copy, metadata (`Governance Weight`).
- **EVIDENCE:** briefing §7.4; `messages.ts`.

| | A. sem governança | B. enquetes de produto não vinculantes, peso = `TIER_RANK` | C. votação vinculante sobre tesouraria |
|---|---|---|---|
| op | nada | enquete periódica | estrutura de DAO |
| cap | remove um benefício | neutro | atrai, mas… |
| ux | — | participação real | expectativa alta |
| seg | — | sybil por compra (aceitável, é peso por passe) | ataque de governança |
| cx | baixa | baixa | alta |
| jur | baixa | baixa | **ALTA** |
| rev | — | sim | difícil |
| contra | perde engajamento | consultivo | risco societário/regulatório |

**RECOMMENDED_OPTION = B** · **REASON:** engajamento sem prometer direito sobre a tesouraria.

### OD-NFT-16 — Jurisdição, geoblock e KYC
- **WHY:** risco regulatório. **BLOCKS:** abertura pública, termos.
- **EVIDENCE:** briefing §7.8; Early Access coleta país autodeclarado.

| | A. todos, exceto sancionados | B. bloqueio por lista definida pelo advogado | C. KYC obrigatório |
|---|---|---|---|
| op | simples | lista + checagem | provedor de KYC |
| cap | máxima | levemente menor | muito menor |
| ux | simples | simples | atrito alto |
| seg | — | — | dados pessoais sensíveis |
| cx | baixa | baixa | alta |
| jur | maior risco | adequado | menor risco, custo de LGPD |
| rev | sim | sim | sim |
| contra | exposição | depende do parecer | conversão |

**RECOMMENDED_OPTION = B, sem KYC no v1 salvo exigência do advogado** · **REASON:** decisão jurídica, não de produto;
usa o país do Early Access + sinal de IP.

### OD-NFT-17 — Reembolso e cancelamento
- **WHY:** expectativa do comprador e passivo. **BLOCKS:** termos, FAQ.
- **EVIDENCE:** nenhuma.

| | A. venda final após confirmação on-chain | B. janela de reembolso (ex.: 7 dias) | C. reembolso só se o dono cancelar a venda |
|---|---|---|---|
| op | nada | processo manual on-chain | só em cancelamento |
| cap | estável | incerta | estável |
| ux | claro | protetor | razoável |
| seg | — | reembolso como vetor de fraude | — |
| cx | baixa | média | baixa |
| jur | verificar direito do consumidor BR | menor risco | médio |
| rev | sim antes de abrir | idem | idem |
| contra | percepção dura | capital não fica disponível | — |

**RECOMMENDED_OPTION = A + C, validado pelo advogado (direito de arrependimento)** · **REASON:** simples e honesto; o
advogado confirma a aplicabilidade do CDC.

### OD-NFT-18 — Conjunto de utilidades no lançamento
- **WHY:** o que é prometido no dia 1. **BLOCKS:** copy, prioridade de construção.
- **EVIDENCE:** `SALE-DESIGN` §5 (A/B/C).

| | A. só o disponível (grupo A) | B. A + grupo B como roadmap sem data | C. A + B + C |
|---|---|---|---|
| op | entrega garantida | backlog | promessas de longo prazo |
| cap | mais fraco no papel | forte | maior no curto prazo |
| ux | honesto | honesto se rotulado | expectativa alta |
| seg | — | — | wash trading (pool) |
| cx | baixa | média | alta |
| jur | baixa | baixa | **ALTA** (pool, tokens) |
| rev | sim | sim | difícil |
| contra | menos atrativo | — | risco regulatório |

**RECOMMENDED_OPTION = B** · **REASON:** vende o que existe, mostra o caminho, não promete retorno.

### OD-NFT-19 — Correção da copy ao vivo em conflito
- **WHY:** o código tem copy que contradiz decisões/regras ("July 2026", "first-come", "5% … distributed to holders",
  "treasury governance", "Future on-chain fee discount" — o desconto já existe via tier). **BLOCKS:** qualquer reabertura
  da produção e o marketing.
- **EVIDENCE:** `src/lib/i18n/messages.ts` (4 línguas).

| | A. neutralizar agora (sem data, sem "first-come", sem distribuição, "enquetes de produto") | B. esperar todas as decisões | C. esconder a seção de mint |
|---|---|---|---|
| op | um commit de copy (lane B; release exige novo C1) | nada | componente |
| cap | neutro | risco se a produção voltar com a copy | perde funil |
| ux | honesto | promessas vencidas | menos informação |
| seg | — | — | — |
| cx | baixa | — | baixa |
| jur | reduz risco | **mantém o risco** | reduz risco |
| rev | sim | sim | sim |
| contra | — | risco jurídico/reputacional | some do funil |

**RECOMMENDED_OPTION = A** · **REASON:** remove promessas não aprovadas sem perder a página.

## FORMULÁRIO DE RESPOSTA DO DONO

```
OD-NFT-01 — Em que chain/padrão a coleção será mintada?
Recommended: Solana + Metaplex Core, programa de venda padrão (sem contrato próprio)
Owner answer: __________

OD-NFT-02 — Qual modelo de preço e quais valores por tier (Pro / Trader / Pilot)?
Recommended: âncora em USD, SOL fixado no congelamento e válido na fase; $218 / $580 / $4.350
Owner answer: __________

OD-NFT-03 — Qual ativo de pagamento?
Recommended: só SOL no lançamento
Owner answer: __________

OD-NFT-04 — Haverá reserva fora da venda? Quanto por tier e para quê?
Recommended: pequena e divulgada — Pro 30 / Trader 10 / Pilot 0 (parcerias e prêmios)
Owner answer: __________

OD-NFT-05 — Qual o teto por carteira?
Recommended: allowlist 1 por tier; pública 2 (Pilot 1)
Owner answer: __________

OD-NFT-06 — Quem é elegível à allowlist?
Recommended: híbrido — Early Access verificado (e-mail + carteira assinada + país permitido) + lista curada pequena; Pilot só allowlist
Owner answer: __________

OD-NFT-07 — Quais fases e durações?
Recommended: allowlist 48 h → pública até esgotar ou 14 dias, mesmo preço
Owner answer: __________

OD-NFT-08 — Quando fixar a data do lançamento?
Recommended: só depois do jurídico + Vercel + ensaio em devnet; anunciar com ≥ 14 dias
Owner answer: __________

OD-NFT-09 — O que acontece com o supply não vendido?
Recommended: fica não mintado; nova onda só por nova decisão com aviso público e preço ≥ ao da venda
Owner answer: __________

OD-NFT-10 — Qual o modelo da tesouraria?
Recommended: multisig 2-de-3 + política escrita de conversão parcial para stable
Owner answer: __________

OD-NFT-11 — Royalty: qual % e para onde? Mantém o "Founder rewards pool"?
Recommended: royalty para a tesouraria, sem distribuição a holders até parecer jurídico (5% é o número já citado)
Owner answer: __________

OD-NFT-12 — O que acompanha o NFT quando ele é transferido?
Recommended: premium e status seguem o holder atual; Hall of Fame registra o mintador original (opt-in)
Owner answer: __________

OD-NFT-13 — Revelação e mutabilidade do metadata?
Recommended: sem revelação; arte do tier visível; metadata travado ao fim da venda
Owner answer: __________

OD-NFT-14 — Quando começa a janela premium de 3 anos e o que é a "v3"?
Recommended: 3 anos a partir do fim da venda; v3 = lançamento público nomeado "v3" anunciado com ≥ 90 dias
Owner answer: __________

OD-NFT-15 — O que é a "governança" do Founder?
Recommended: enquetes de produto não vinculantes, peso = tier (1/2/3); sem governança de tesouraria
Owner answer: __________

OD-NFT-16 — Jurisdição/geoblock/KYC?
Recommended: lista de bloqueio definida pelo advogado; sem KYC no v1 salvo exigência jurídica
Owner answer: __________

OD-NFT-17 — Política de reembolso/cancelamento?
Recommended: venda final após confirmação on-chain; reembolso só se a venda for cancelada; validar CDC com o advogado
Owner answer: __________

OD-NFT-18 — Quais utilidades são prometidas no lançamento?
Recommended: as disponíveis (premium por tier, desconto de taxa, badge) + as de produto como roadmap sem data; nada do grupo C
Owner answer: __________

OD-NFT-19 — Neutralizar agora a copy ao vivo em conflito?
Recommended: sim — sem data, sem "first-come", sem distribuição a holders, "enquetes de produto"
Owner answer: __________
```

**Ações externas (não são decisões de valor):** contratar o advogado cripto-BR (termos, framing, CDC, geoblock);
contador (tributos); R-01 Vercel; provedor de e-mail/DNS do Early Access; signatários da multisig.
