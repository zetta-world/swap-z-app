# Plano — Redesign "A Hird" (planos mensais) + nomenclatura nórdica

> **Origem:** CEO achou "Planos · Lançamento / Planos · Mensal" preguiçoso e a
> página dos mensais sem o capricho do resto do projeto. Decisões do CEO:
> free = **Thrall**; coletivo dos mensais = nome da mitologia nórdica.
> **Gerado:** 2026-07-03. Status vivo.

## Nomenclatura (canônica na mitologia)

| Conceito | Nome | Por quê |
|----------|------|---------|
| Planos de lançamento (NFT, deuses) | **O Panteão** | Freyr · Thor · Odin — os deuses |
| Planos mensais (recorrentes) | **A Hird** (hirð) | o bando de guerreiros JURAMENTADOS que serve a um senhor — exatamente "os que servem aos deuses" |
| Free | **Thrall** | a classe servil da Rígsþula (Thrall → Karl → Jarl); serve sem juramento, sem custo |

## Entregas

| ID | Item | Status |
|----|------|--------|
| H1 | Nav 4 idiomas: `nav.pricing` → O Panteão (badge LIMITADO/gold) · `nav.plans` → A Hird (badge MENSAL/cyan) | 🟢 |
| H2 | `plans.ts`: runa do guerreiro (ᛞ Drengr · ᛒ Berserkr · ᛖ Einherjar) + brasão do deus servido (`/tiers/*.png`) | 🟢 |
| H3 | Card do guerreiro v2: medalhão hero (runa grande + aura no accent + selo com o BRASÃO real do deus), moldura gradiente da família do PricingCard, Berserkr destacado ("MAIS ESCOLHIDO") | 🟢 |
| H4 | Banner do Panteão v2: os 3 brasões reais + copy + link (em vez de ícone de coroa + texto) | 🟢 |
| H5 | Card THRALL no lugar da caixa "Free" genérica | 🟢 runa ᚦ + "todo guerreiro começa em algum lugar" |
| H6 | Header da página: eyebrow "A HIRD · JURAMENTADOS AOS DEUSES" + título novo | 🟢 |
| H7 | Metadata das páginas `/plans` e `/pricing` atualizadas | 🟢 |
| H8 | **Fase B** — artes dos guerreiros | 🟢 **CONCLUÍDA 03/07**: CEO gerou os 4 retratos circulares (Drengr/Berserkr/Einherjar/Thrall), instalados em `public/warriors/` com circle-fit crop e ligados via `avatar` (medalhões) + card do Thrall |

**Preços (decidido pelo CEO em 03/07):** âncoras limpas **$7.90 / $20.90 / $159** — campo `monthlyUsd` autoritativo em `plans.ts` (a fórmula /36×1.3 vira só baseline p/ tiers futuros).

## H8 — Prompts para as artes dos guerreiros (Fase B)

**Formato decidido (03/07): RETRATO CIRCULAR estilo foto de perfil** para o
medalhão do card (campo `avatar` em `plans.ts` já suporta — troca instantânea).
Spec: **1:1 (1024×1024)**, busto centralizado ocupando ~70%, tudo importante
dentro do círculo central (a borda vira crop), SEM texto/moldura (o CSS já põe
o anel + aura), fundo escuro com aura na cor do tier. Salvar em
`public/warriors/{drengr,berserkr,einherjar}.jpg`.

1. **DRENGR:** "Circular profile portrait, head and shoulders bust of a noble
   Norse warrior of honor, braided beard, round shield on his back, calm
   disciplined gaze, golden and amber palette, soft golden aura radiating
   behind him, subtle ᚠ rune glow on his pauldron, dark background, centered
   composition safe for circle crop, no text, no frame, dark fantasy realism,
   1:1"
2. **BERSERKR:** "Circular profile portrait, head and shoulders bust of a
   fierce Norse berserker wrapped in bear pelt hood, war paint, teeth bared in
   battle cry, violet lightning crackling around him, purple and gold palette,
   storm aura behind him, subtle ᚦ rune glow on his chest, dark background,
   centered composition safe for circle crop, no text, no frame, dark fantasy
   realism, 1:1"
3. **EINHERJAR:** "Circular profile portrait, head and shoulders bust of an
   ethereal chosen warrior of Valhalla, translucent glowing armor, spectral
   light rising from his shoulders like wings, a black raven perched beside
   his head, prismatic cyan-violet-gold palette, cosmic aura behind him,
   subtle ᛖ rune glow on his gorget, dark background, centered composition
   safe for circle crop, no text, no frame, dark fantasy realism, 1:1"
4. **(bônus) THRALL:** "Circular profile portrait, head and shoulders bust of
   a humble young Norse farmhand in rough wool tunic, determined hopeful gaze,
   muted grey and iron palette with a faint cold glow, subtle ᚦ rune on a
   leather cord necklace, dark background, centered composition safe for
   circle crop, no text, no frame, dark fantasy realism, 1:1"

Antigo formato "card completo 3:4" descartado — gerava arte de NFT card, não
de medalhão (feedback do CEO).

1. **DRENGR (serve Freyr — dourado/âmbar):** "Ornate fantasy trading card, golden
   Norse warrior of honor DRENGR kneeling with round shield and axe, amber and
   gold palette, wheat and prosperity runes (ᚠ Fehu motifs), dark cosmic
   background with golden constellation lines, ornamental gold frame with runic
   engravings, title DRENGR — HONOR WARRIOR at bottom, Z-SWAP header, 3:4"
2. **BERSERKR (serve Thor — violeta/tempestade):** "Ornate fantasy trading card,
   fierce Norse berserker mid-battle-cry wrapped in bear pelt, crackling purple
   lightning echoing Mjölnir, violet and gold palette, ᚦ Thurisaz motifs, dark
   storm background, ornamental gold frame with runes, title BERSERKR — FIERCE
   WARRIOR, Z-SWAP header, 3:4"
3. **EINHERJAR (serve Odin — prismático/etéreo):** "Ornate fantasy trading card,
   ethereal chosen warrior of Valhalla ascending with spectral wings of light,
   prismatic cyan-violet-gold palette, two ravens circling, ᛖ and ᚨ rune motifs,
   cosmic starfield, ornamental gold frame, title EINHERJAR — CHOSEN OF VALHALLA,
   Z-SWAP header, 3:4"

Quando gerar: salvar em `public/warriors/{drengr,berserkr,einherjar}.jpg` e me
avisar — o slot do medalhão vira hero de arte com troca de arquivo.
