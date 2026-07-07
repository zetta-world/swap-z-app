# Desktop — diagnóstico e correção (06-07/07)

> **Origem:** CEO viu "tela mobile esticada" no modo desktop do navegador do
> celular e pediu otimização com backup prévio e cuidado máximo.
> **Backup:** branch `backup-pre-desktop-20260706` (= main `cb8aca8`).

## O que a investigação revelou (com screenshots reais via Chromium headless)

1. **O layout desktop JÁ EXISTIA e é completo**: sidebar persistente 248px,
   topbar com busca/modos/ZION/wallet, home em grid 12 colunas
   (Constellation | Swap | Top Movers), páginas com max-width generosas.
2. **MAS estava QUEBRADO em produção**: a classe `.god-card` (tema dos deuses,
   `globals.css:886`) define `position: relative` e, por ordem no cascade,
   atropelava o `fixed` da sidebar. A sidebar entrava no FLUXO com ~1280px de
   altura e empurrava topbar+conteúdo pra fora da tela — usuário de PC via um
   VAZIO preto até rolar. Ninguém notou porque os testes eram todos no celular.
3. **O "modo desktop" do navegador móvel usa viewport ~980px**, abaixo do
   breakpoint `lg` (1024px) — por isso mostra o layout mobile esticado. Isso é
   comportamento correto/padrão; a experiência real de PC (≥1024px) é a rica.

## Correção aplicada
- `Sidebar.tsx`: `fixed` → `!fixed` (important) — imune ao override do
  `.god-card`. Blast radius zero (só a sidebar combina god-card + fixed).
- Verificação visual em 1440×900: home (grid 3 colunas ok), /plans (3 cards
  dos guerreiros lado a lado), /pricing — todas íntegras. Mobile intocado
  (mudança só afeta `lg:`+ por construção).

## Ferramenta nova
- `playwright-core` (devDependency) + Chromium do ambiente: screenshots de
  verificação visual antes de subir mudanças de UI. Usar sempre em mexidas de
  layout.

## Próximas fases (opcionais, decidir com o CEO vendo o desktop REAL)
- ⏸️ F2: polimento por página no desktop (densidade do Pro Terminal, admin em
  2 colunas largas, etc.) — só depois do CEO navegar no PC real e apontar.
- ⏸️ F3: atalhos de teclado desktop-first (⌘K já existe).
