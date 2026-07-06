# Plano — MIDGARD: mapa-múndi de acessos + analytics detalhado

> **Origem:** pedido do CEO (03/07) após revisar todos os painéis: "um mapa
> mundi com um pontinho de onde vem cada acesso" + "acessos por dia, semana,
> mês, tudo bem detalhado". Nome do painel: **MIDGARD** (o mundo dos homens —
> onde os acessos acontecem). Status vivo.

| ID | Item | Status |
|----|------|--------|
| T1 | **Captura geo no beacon**: país/região/cidade/lat/lon dos headers `x-vercel-ip-*` no meta do `page_view`. SEM armazenar IP (LGPD-friendly: geo grosseiro nível cidade) | 🔴 |
| T2 | **Visitante pseudônimo (`cid`)**: hash truncado de IP+UA só pra contar ÚNICOS por dia/semana/mês. IP nunca persiste em claro | 🔴 |
| T3 | **Referrer + dispositivo**: Beacon envia `document.referrer`; UA vira classe (mobile/desktop) | 🔴 |
| T4 | **Rota `/admin/api/traffic`**: série diária 30d (views+únicos), semanal 12s, mensal 6m, por país, por cidade (lat/lon p/ o mapa), top páginas, referrers, dispositivo | 🔴 |
| T5 | **Painel MIDGARD** (categoria GROWTH): aba MAPA (mundo em dot-matrix + pontos de acesso pulsando), aba DIAS (barras diárias + tiles hoje/7d/30d + tabela semanal/mensal), aba ORIGEM (países, cidades, páginas, referrers, dispositivos) | 🔴 |
| T6 | **Mapa dot-matrix self-contained**: pontos de terra gerados offline (point-in-polygon sobre GeoJSON público) e EMBUTIDOS no repo — zero CDN, zero lib, respeita a CSP | 🔴 |

**Nota de privacidade:** geo em nível de cidade + hash pseudônimo, sem IP em
claro, sem cookie novo. Eventos antigos não têm geo — o mapa povoa daqui pra
frente.

**Ideias que o CEO pediu opinião (proposta, aguardando escolha):**
- 🔜 **UTM/campanha** no beacon (saber qual post/anúncio trouxe o acesso) — o
  complemento natural do MIDGARD pro marketing do launch; barato.
- 🔜 Painel **MINT/NFT** (vendas, holders, supply restante) — quando o launch abrir.
- 🔜 **MRR/assinaturas** — quando o PIX/SOL recorrente entrar.
- ⏸️ Cohort/retention — precisa de usuários recorrentes reais.
- ❌ Heatmaps/session-replay — overkill agora, peso de privacidade.
