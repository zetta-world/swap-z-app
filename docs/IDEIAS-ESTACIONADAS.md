# 🗂️ Ideias Estacionadas — Índice Central

> **Propósito:** um lugar único no `main` pra nenhuma ideia/plano se perder.
> Pensou em algo e não vai fazer agora? **Anota uma linha aqui.** Cada item
> aponta pro doc detalhado (se existir), o status, e o que o destrava.
>
> **Como usar:** quando bater uma ideia, adicione na seção certa. Quando for
> executar, abra o doc linkado. Atualizado por último: 2026-06-30.

**Status:** `💡 ideia solta` · `📋 planejado (tem doc)` · `🔒 bloqueado` · `📊 travado por dados` · `⏸️ deferido p/ escala`

---

## 1. Planos com documento completo

| Ideia | Doc | Status | O que destrava |
|-------|-----|--------|----------------|
| **Orquestração híbrida multi-modelo** (DeepSeek/Kimi/Grok baratos + Opus/GPT na decisão; OpenRouter; soberania de dado) | `docs/PLANO-HIBRIDO-MULTI-MODEL.md` (branch `feature/hybrid-ai-orchestrator`) | 📋 planejado | Founder fechar decisões §10; começar F1/F2 (infra+A/B, zero risco) quando quiser |
| **Coleção NFT + mint (FASE 5.4)** — 2 camadas (Premium 3a/v3 + Founder vitalício); supply DECIDIDO (1.500/500/50); planos lançamento (deuses) vs normais (guerreiros, +30%) | `docs/NFT-BRIEFING.md` | 🔒 bloqueado | Founder responder §7 restante (royalty %, critério de v3…) + revisão legal |
| **ZION olhar atrás + aprendizado** (Z7 calibração, Z9 Kelly) | `docs/PLANO-DE-ACAO-ZION.md` | 📊 travado por dados | Semanas de dados do flywheel (pós-11/07) |
| **Monetização trilho B — Mercado Pago PIX** | `docs/POLISH-PLAN.md` (5.5) | ⏸️ deferido | Pós-NFT, BR-first |

---

## 2. Ideias soltas (ainda sem doc próprio)

| Ideia | Contexto / por quê | Status | O que destrava |
|-------|--------------------|--------|----------------|
| **Mini data center no Paraguai** (modelo local, ~R$50k, energia Itaipu barata) | Verticalizar IA quando o volume justificar | ⏸️ deferido p/ escala | Volume alto + A/B provar que modelo aberto mantém o edge (NÃO comprar hardware antes disso) |
| **Gatear autopilot por REGIME** (agir só em RANGING/TRANSITIONING; evitar TRENDING_DOWN) | Flywheel mostrou: edge positivo em range, sangra shortando queda (0/4) | 📊 travado por dados | ~10-15 trades resolvidos por regime confirmarem o padrão; Market Brain (Z3) já detecta regime |
| **A/B de modelos no flywheel** (DeepSeek + Llama + Mistral vs Claude) | Medir custo E qualidade por modelo no mesmo dado | 💡 ideia solta (base já existe: Kimi A/B no commit `bee2e40`) | Chave OpenRouter (ou direto) — código já preparado |
| **Recalibrar preço dos planos pelo custo real de IA** | Garantir que o NFT (3 anos premium) cubra o custo de IA do tier sem prejuízo | 💡 ideia solta | Medir custo/análise real (24h de backtest após adicionar créditos; manual já é rastreado) |
| **Alerta de orçamento MENSAL de IA** (além do diário que já existe) | Avisar quando passar de $X/mês | 💡 ideia solta | Decidir o teto $/mês; ~30 min de código |
| **Execução avançada** (E2 trailing stop, E3 MEV protection no autopilot) | Já existem como peças soltas no código | ⏸️ deferido | Pós-11/07 (não mexer na execução antes de validar com dinheiro real) |
| **Roteamento por jurisdição + residência de dado** (provider pinning, ZDR) | Vira argumento de venda enterprise | 📋 dentro do plano híbrido §3 | Junto da F4 do plano híbrido |

---

## 3. Como adicionar uma ideia nova

1. É um plano grande? Cria um `docs/PLANO-XXX.md` e linka na **Seção 1**.
2. É uma ideia solta? Adiciona uma linha na **Seção 2** com: ideia · por quê · status · o que destrava.
3. Atualiza a data no topo.

> A regra: **se passou pela sua cabeça e vale a pena, vira uma linha aqui na hora.** Documentar barato hoje > tentar lembrar amanhã.
