# NFT Briefing — Z-SWAP Access Pass (estrutura oficial de 2 camadas)

> **Status:** decisão de modelo **TRAVADA** (2 camadas). Itens de produção
> (mint, supply, royalty %) ainda **aguardam decisões do founder** — ver
> §7 "Decisões em aberto".
> **Bloqueia:** `POLISH-PLAN.md` FASE 5.4 (coleção Metaplex Core + mint UI).
> **Quando 5.4 for ao ar:** virar `TIER_GATES_ENABLED=true` ativa toda a
> camada de gating já entregue (5.2/5.3).

---

## 0. Decisão travada (a regra-mãe)

> **Os benefícios Premium (Camada A) valem por 3 ANOS OU até a v3 da
> plataforma — o que vier primeiro. Os benefícios Founder (Camada B) são
> VITALÍCIOS (perpétuos, on-chain).**

Narrativa de uma linha:
> **"O premium é por 3 anos. O status é eterno."**

Isso resolve de vez a ambiguidade do "lifetime cap": o pass nunca promete
compute infinito (insustentável), mas promete **pertencimento eterno** (custo
zero). Após o período Premium, o holder cai para o tier **Free** (swap aberto +
5 análises/dia) — mas **mantém todos os benefícios Founder para sempre**.

---

## 1. Os tiers (1:1 com o código — `src/lib/tier/types.ts` + `gods.ts`)

| Tier (rank) | Deus / rune | **Supply** | Preço | Total se 100% | Desbloqueia (Camada A) |
|-------------|-------------|-----------|-------|---------------|------------------------|
| `free` (0)  | —           | ∞ | grátis | — | Swap aberto + 5 análises ZION/dia (SEMPRE grátis) |
| `pro` (1)   | FREYR ᚠ · PROSPERITY | **1.500** | 1.5 SOL | 2.250 SOL (~R$1,8M) | + ZION advisory + CEX autopilot |
| `trader` (2)| THOR ᚦ · THUNDER STRIKE | **500** | 4 SOL | 2.000 SOL (~R$1,6M) | + arb scanner + priority support |
| `pilot` (3) | ODIN ᚨ · ALLFATHER | **50** | 30 SOL | 1.500 SOL (~R$1,2M) | tudo, cap de uso mais alto |
| **TOTAL** | | **2.050 NFTs** | — | **5.750 SOL (~R$4,6M)** | |

Cards: `public/nft/{pro.jpg, trader.png, pilot.jpg}`.
**Lógica de escassez:** quanto mais alto o tier, mais raro. 50 Pilots = exclusividade
real (status + valor de revenda); 1.500 Pros = volume de comunidade.

Gates de feature já implementados (`FEATURE_TIER`):
`zionAdvisory→pro`, `cexAutopilot→pro`, `arbScanner→trader`, `prioritySupport→trader`.

**Tema da coleção — "Z-SWAP Access Pass NFT · Deuses Nórdicos":**
progressão **Prosperidade (Freyr) → Poder (Thor) → Onisciência (Odin)**.
Colecionar os 3 = "iniciação nórdica" (marketing orgânico de completismo).
Identidade visual: card vertical 3:4, obsidian preto + ouro/filigrana, header
"Z-SWAP · ACCESS PASS NFT", badge "LIMITED EDITION", 6 ícones de benefício,
footer "ZS-{TIER}-0001 · BUILT FOR THE FUTURE".

---

## 2. CAMADA A — Premium capado (3 anos OU v3)

Tudo que tem **custo recorrente real** para a operação. Por isso é **capado** no
tempo — não dá pra prometer tokens de IA infinitos sem queimar caixa.

| Benefício | Por que tem custo |
|-----------|-------------------|
| Análises ZION AI (Sonnet/Opus) | $$ tokens Anthropic |
| Autopilot CEX firing | RPC + execução |
| Feed cross-CEX arb em tempo real | compute + bandwidth |
| Suporte direto / white-glove | $$ tempo humano |
| Cap mensal alto de uso | soma de tokens |

→ **Após v3 ou 3 anos:** holder continua com tier **Free** (5 análises/dia,
swap aberto). Sem corte de acesso à plataforma — só ao compute premium.

---

## 3. CAMADA B — Founder eterno (custo operacional ZERO)

Tudo aqui custa **$0 ongoing**. Pode ser perpétuo sem queimar nada — é o que
transforma o pass de "assinatura" em "pertencimento".

| Benefício perpétuo | Custo p/ nós | Valor p/ holder |
|--------------------|--------------|------------------|
| Badge **"Z-SWAP Founder"** on-chain, visível em qualquer wallet check (Etherscan, Solscan…) | $0 (é o NFT existindo) | Status eterno, flex social |
| **Whitelist automática** em TODAS as coleções/produtos futuros do ecossistema Zettaword (token ZETTA, próximas NFTs) | $0 (check de elegibilidade) | Acesso garantido, FOMO eliminado |
| **Hall of Fame** perpétuo no `/about` — wallet listada como "Founding Member" | $0 (1 query) | Reconhecimento público eterno |
| **Founder rewards** do pool de royalty da coleção (ver §4 — framing legal) | $0 (vem do marketplace, não do caixa) | Recompensa de membro |
| **Voto em governança** quando lançar — peso por tier de NFT | $0 | Influência no roadmap |
| **Beta access** perpétuo — testa features novas antes de todos | $0 | Insider feeling |
| **Desconto em fees** on-chain se um dia cobrarmos (ex: 50% off swap fee) | opportunity cost mínimo | Economia real ao longo dos anos |
| **Rate limit elevado** nas APIs públicas (`/api/quote`, `/api/prices`, `/api/trending`) | $0 (limite numérico) | Útil p/ power users que constroem bots |
| **Tema "Founder"** exclusivo no app + ícone diferenciado no portfolio | $0 (CSS) | Diferenciação visual permanente |
| Acesso perpétuo às features sempre-grátis (`/pools`, `/explorer`, `/portfolio`, `/changelog`) **com badge Founder** | $0 | Visibilidade do status |

---

## 4. ⚠️ Framing legal CRÍTICO do royalty-share

O pool de royalty é o item de **maior risco regulatório** (teste de Howey nos
EUA / CVM no Brasil). A diferença está 100% no **enquadramento (framing)**:

**❌ NUNCA escrever:**
- "Profit share" · "Dividend" · "Investment return" · "Income from collection"

**✅ PODE escrever:**
- "Founder **rewards** from collection royalty pool"
- "Membership **benefit** funded by marketplace royalties"
- "Founder **distributions** from secondary trading fees"

**A sutileza que importa:** "rewards/distributions" para membros de um **clube
fechado** ≠ "dividend" para investidor. O dinheiro vem do **comprador
secundário pagando royalty no marketplace**, NÃO do nosso operacional. A
plataforma é apenas o **distribuidor** dos royalties da coleção — não promete
retorno, não usa caixa próprio, não posiciona o NFT como investimento.

> **Ação obrigatória antes do mint:** 2–3h de advogado cripto-BR (~R$
> 1.500–3.000) revisando **especificamente** este framing + os disclaimers de
> marketing. É seguro barato perto do risco de ser enquadrado como security.

---

## 5. Narrativa de marketing (texto-base aprovado)

> **Z-SWAP Access Pass NFT — 3 anos de poder, eternidade de pertencimento.**
>
> Por 3 anos ou até a v3 da plataforma, você desbloqueia ZION AI no modelo
> mais capaz do mercado, autopilot CEX, e cross-arb. Após esse período, seu
> pass mantém o que importa pra sempre: badge de Founder on-chain, whitelist
> automática em toda coleção futura do ecossistema Zettaword, participação nos
> royalties da coleção, voto em governança, e seu nome eternizado no Hall of
> Fame. **Você não compra acesso. Você se torna parte.**

---

## 6. Metadata do NFT (proposta de schema p/ o mint — Metaplex Core)

Os benefícios **Founder (Camada B)** devem ir como **atributos perpétuos** no
metadata JSON, para que qualquer ferramenta on-chain leia o status sem depender
do nosso backend. Proposta (exemplo para o tier `trader`):

```json
{
  "name": "Z-SWAP Access Pass — THOR (Trader)",
  "symbol": "ZSWAP",
  "description": "Founder Access Pass to Z-SWAP. 3 years of premium power, lifetime of belonging.",
  "image": "ipfs://<CID>/trader.png",
  "attributes": [
    { "trait_type": "Tier",            "value": "Trader" },
    { "trait_type": "Deity",           "value": "Thor" },
    { "trait_type": "Rune",            "value": "ᚦ" },
    { "trait_type": "Founder",         "value": "true" },
    { "trait_type": "Premium Window",  "value": "3 years or v3" },
    { "trait_type": "Founder Status",  "value": "Lifetime" },
    { "trait_type": "Governance Weight", "value": 2 },
    { "trait_type": "Whitelist",       "value": "All future Zettaword drops" },
    { "trait_type": "Hall of Fame",    "value": "true" }
  ],
  "properties": {
    "category": "image",
    "collection_tier_rank": 2
  }
}
```

> Nota: `Governance Weight` e `collection_tier_rank` espelham `TIER_RANK`
> (pro=1, trader=2, pilot=3). Manter sincronizado com `src/lib/tier/types.ts`.

---

## 7. Decisões em aberto (o que TRAVA o 5.4 — precisa de VOCÊ)

Estas escolhas não são código — são decisões de negócio que destravam o mint:

1. ✅ **Supply por tier** — **DECIDIDO: 1.500 Pro / 500 Trader / 50 Pilot** (2.050 total).
2. **Preço final** — confirmar 1.5 / 4 / 30 SOL ou ajustar.
3. **Royalty %** — quanto de royalty secundário (ex: 5%) e **qual fração** vira
   pool de Founder rewards vs. tesouraria.
4. **Peso de governança** — usar `TIER_RANK` (1/2/3) ou outra curva.
5. **Critério da v3** — definição objetiva de "v3 da plataforma" (marco público)
   para o gatilho dos 3-anos-OU-v3 não ser ambíguo.
6. **Utilidade extra do pass** (opcional) — algo além do já listado?
7. **Chain de mint** — Solana confirmada (Metaplex Core)?
8. **Jurisdição/geoblock** — quem pode comprar (liga com `P2` do plano + a
   revisão legal do §4).

---

## 8. Próximos passos (ordem de execução)

- [x] **Travar decisão final** — 2 camadas: Premium 3a/v3, Founder vitalício. ✅
- [x] **Oficializar em `docs/NFT-BRIEFING.md`** — este documento. ✅
- [ ] **Founder no metadata JSON** do mint (§6) — quando 5.4 for codar.
- [ ] **Responder §7** (decisões do founder) — destrava o 5.4.
- [ ] **Revisão legal do §4** (advogado cripto-BR) — antes de publicar marketing.
- [ ] **Codar 5.4** (coleção Metaplex Core + mint UI self-hosted).
- [ ] **Virar `TIER_GATES_ENABLED=true`** — ativa o gating já entregue.
- [ ] **5.5 (Mercado Pago PIX, trilho B)** — opcional, pós-NFT, BR-first.

---

## 9. Planos de LANÇAMENTO (Deuses) vs NORMAIS (Guerreiros)

Dois produtos distintos, duas páginas separadas:

| | **Lançamento — DEUSES** | **Normal — GUERREIROS** |
|---|---|---|
| Mecanismo | NFT one-time (3 anos premium) | Assinatura recorrente |
| Função | Capital de lançamento + comunidade + runway | Motor de receita perpétuo |
| Preço | 1.5 / 4 / 30 SOL (one-time) | **+30% vs o equivalente do NFT-holder** (mensal) |
| Tema | Deuses nórdicos (Freyr/Thor/Odin) | Guerreiros que servem aos deuses |
| Página | `/pricing` (lançamento, escassez) | página separada (padrão contínuo) |

**Por que +30%:** recompensa quem entra no lançamento ("você é um deus / Founder"),
e as assinaturas normais — de **maior margem** (mesmo custo de IA, +30% de receita) —
viram o motor que paga o salário do CEO a longo prazo.

**Mapa de nomes (tema nórdico mantido, hierarquia deuses > guerreiros):**

| | Lançamento (Deus) | Normal (Guerreiro) |
|---|---|---|
| Pro | **Freyr** ᚠ | **Drengr** (guerreiro de honra) |
| Trader | **Thor** ᚦ | **Berserkr** (guerreiro feroz) |
| Pilot | **Odin** ᚨ | **Einherjar** (escolhido de Valhalla que serve os deuses) |

Outros nomes da lore p/ usar: Úlfheðnar, Huscarl, Jarl, Víkingr.
Narrativa-âncora: *"Os deuses ergueram a plataforma. Os Einherjar a mantêm de pé."*

> ⚠️ **Gotcha técnico:** cobrança **recorrente em cripto tem fricção** (sem débito
> automático on-chain → renovação manual → churn). "Solana por enquanto" funciona,
> mas o trilho recorrente ideal é **PIX/Mercado Pago** (FASE 5.5) — suporta débito
> recorrente de verdade. Cripto = ótimo p/ o NFT one-time; friccionado p/ o mensal.

---

## 10. Economia do lançamento — runway e salário

**Captação no mint (por % de venda do supply 1.500/500/50):**

| Vendido | SOL | ≈ R$ |
|---------|-----|------|
| 100% | 5.750 | ~R$4,6M |
| 50% | 2.875 | ~R$2,3M |
| 30% | 1.725 | ~R$1,4M |

**Custo de 3 anos (estimado, híbrido):** ~R$25k/mês solo (c/ salário CEO R$15k) =
~R$900k; com equipe no ano 2-3 ≈ R$2,1M. IA no híbrido ~R$520k (realista).

> **Conclusão:** vender **~40-50% da coleção banca 3 ANOS de operação incluindo o
> salário do CEO — só com o mint**, antes de qualquer assinatura recorrente ou
> royalty secundário. O mint dá o **runway**; as assinaturas (guerreiros, +30%)
> são o **motor perpétuo**. Margem de IA no híbrido: Pro ~50% · Trader ~54% ·
> Pilot ~93% (ver `docs/PLANO-HIBRIDO-MULTI-MODEL.md`).

**Ressalvas:** margem de IA ≠ P&L completo (falta infra/mktg/equipe/jurídico);
receita em SOL vs custo em USD (risco de queda do SOL); custo/análise é estimativa
até medir 24h pós-recarga (11/07).
