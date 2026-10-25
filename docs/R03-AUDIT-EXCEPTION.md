# R-03 → R-04 — EXCEÇÃO ESTREITA E TEMPORÁRIA DO `npm audit` · 🟡 R-04 EM USO · revisão obrigatória antes do RC

## R-04 (zod) — EM USO desde 25/10/2026 · R-03 RETIRADA

> **Decisão do dono (25/10/2026, conversa da fase PHANTOM-LIGHTHOUSE-V2):** "Aprovo a R-04". Contexto: a recert do
> candidato `17f7eb3` reprovou no portão por alertas NOVOS em dependências que a fase não tocou. O dono escolheu
> corrigir antes do deploy: `next` 16.3.8 → 16.4.3 (fecha os dois CRÍTICOS de RCE e o alto de DoS); o que sobrou é
> esta exceção. **Isto NÃO desliga o `npm audit` e NÃO afirma que a vulnerabilidade foi corrigida.**

| campo | valor |
|---|---|
| advisory | `zod` **GHSA-mrhx-c7xc-m3w5** (npm source **1243066**), severidade **high**, faixa `<4.6.6` (memória ao validar coleções grandes com restrição) |
| correção upstream | só `zod` ≥ 4.6.6 — major para quem depende de zod 3 (toda a linha 3.x está na faixa) |
| cadeia aceita | **17** pacotes high, registrados item a item em `scripts/release/audit-exceptions.json` |
| caminhos | `viem`/`abitype` · `wagmi` → `@wagmi/connectors` → reown/walletconnect/coinbase/porto (navegador) · `@vercel/functions` → `@vercel/oidc` → `@vercel/cli-config` (servidor, zod 4.1.11) · `eslint-config-next` → `eslint-plugin-react-hooks` (só lint, fora da cadeia do audit) · `@anthropic-ai/sdk`: zod é peer OPCIONAL, usado só em `helpers/zod`, que o app não importa |
| uso direto no app | **nenhum** (`grep` em `src/` e `scripts/`: nenhum import de zod) |
| pendente antes do RC | a cópia `zod` 4.4.3 sob `@wagmi/connectors` (via porto, `^4.1.5`) pode ir a 4.6.7 sem major; se for, a lista de nós da cadeia muda e a exceção é revista |
| lockfile na criação | `package-lock.json` sha256 `75f6bd2b…9af8` |
| prova | `src/lib/release/audit-gate.test.ts` (bloco R-04, fixture `fixtures/npm-audit-r04-20261025.json` = `npm audit --json` real desse lock) |

**Por que é aceitável por ora:** o ataque exige que entrada controlada pelo atacante chegue a um schema zod com
coleção restrita dentro dessas bibliotecas; o app não valida entrada de usuário com zod. Avaliação de alcance, não
prova formal — por isso é TEMPORÁRIA, revista antes de cada RC, e migrar para zod 4 é fase própria.

**R-03 retirada:** o registro npm deixou de reportar o advisory do `braces` (1240992). O `braces` 3.0.3 **continua
instalado** (via `tailwindcss`); isto é "não reportado", NÃO "corrigido". O portão exige cadeia idêntica, então a
R-03 não podia ficar. Conteúdo congelado em `src/lib/release/fixtures/audit-exceptions-r03-20261007.json`; um teste
garante que o relatório antigo do braces reprova contra a exceção viva.

---

## Histórico: R-03 (braces) — 04/10 a 25/10/2026 · RETIRADA


> **Decisão do dono (04/10/2026):** `R03_DECISION=TEMPORARY_NARROW_CI_EXCEPTION`. O Tailwind v4 **não** é adotado
> para R-03 (spike: remediação PARTIAL, ~98 arquivos, CSS +51%/+16% gzip, 21/30 capturas mudaram; branch
> `spike-tailwind-v4-20261004T113734Z` HEAD `7776436`, relatório `docs/R03-TAILWIND-V4-SPIKE.md` naquele branch,
> evidência `zswap-local/evidence/spike-tailwind-v4-20261004T113734Z/` — preservados, não mesclados).
> **Isto NÃO desliga o `npm audit` e NÃO afirma que a vulnerabilidade foi corrigida.**

## O que está sendo aceito, exatamente

| campo | valor |
|---|---|
| advisory | `braces` **GHSA-vfj7-8cjw-p6xm** (npm source **1240992**), severidade **high**, faixa `<=3.0.3` (DoS por padrão aninhado) |
| correção upstream | **não existe** (3.0.3 é a última versão) |
| cadeia aceita | **25** pacotes high, todos descendentes desse único advisory, com os mesmos nós em `node_modules` e as mesmas vias — registrada item a item em `scripts/release/audit-exceptions.json` |
| raízes diretas | `tailwindcss@3.4.19` (build, dev) · `eslint-config-next` (lint, dev) · `@solana/wallet-adapter-react` → `@solana-mobile/*` → `react-native` → `metro`/`jest-haste-map` → `micromatch` (**produção**) |
| lockfile na criação | `package-lock.json` sha256 `8e9b5227…` (o mesmo certificado desde `0d21874`) |

**Por que é aceitável por ora:** `braces` só expande globs de ferramenta (watcher do Tailwind, glob do lint,
bundler/teste do React Native empacotado no adaptador móvel). O app web não passa entrada de usuário a `braces`.
Isso é avaliação de alcance, não prova formal; por isso a exceção é temporária e revista antes do RC.

## O portão (`scripts/release/audit-gate.mjs` + `lib/audit-gate.mjs`, CI bloqueante)

| condição | resultado |
|---|---|
| relatório idêntico à cadeia registrada, sem critical | **passa**, com aviso `EXCECAO_EM_USO … NÃO corrigida … revisão OBRIGATÓRIA antes da seleção de RC` |
| qualquer **CRITICAL** (inclusive o próprio braces virar critical) | **falha** (`CRITICAL`) |
| qualquer advisory **HIGH novo** | **falha** (`NOVO_HIGH`) |
| advisory registrado com faixa/severidade/URL diferente | **falha** (`ADVISORY_MUDOU`) |
| **deriva da cadeia**: pacote novo, caminho novo até braces, pacote que saiu, `isDirect` mudou | **falha** (`DERIVA_CADEIA`) — inclusive quando a cadeia *encolhe*: a exceção tem de ser revista, não presumida |
| relatório ilegível / sem rede / formato ≠ v2 | **falha fechada** (`RELATORIO_INVALIDO`) |
| exceção sem `status: TEMPORARIA` / `revisar_antes_do_rc: true` / decisão | **falha** |
| moderate/low | fora do portão (mesmo nível de antes) |

Prova (04/10): audit real da lane B → **passa** (exit 0); audit real do spike v4 (cadeia mudou) → **falha** com
`DERIVA_CADEIA` (exit 1); relatório offline → **falha**. Testes: `src/lib/release/audit-gate.test.ts` (fixture =
`npm audit --json` real da lane B). Determinismo: o CI continua em `npm ci` com o lock; o portão compara a
cadeia, que muda se o lock mudar a árvore até `braces`.

**Correção de registro (L-033):** o passo antigo era `npm audit --audit-level=high` com
`continue-on-error: true` — ele ficava vermelho, mas **não** reprovava o job. "O CI do C1/C2 falharia hoje" estava
impreciso: falharia o passo, não o job. O portão novo é **mais estrito** que o antigo (critical e high novos
passam a bloquear).

## Revisão obrigatória (antes de qualquer seleção de RC)

1. rodar `npm audit --json` + o portão no SHA candidato;
2. verificar se existe correção upstream (`braces`, `micromatch`, `@solana-mobile/*`, `eslint-config-next`);
3. o dono reafirma a exceção (com nova data) ou a remove;
4. registrar no ledger.

**Escopo:** só lane B (`pre-vercel-forward-20261003T234200Z`). A lane de release congelada (`d896ce2`) mantém o passo
antigo; levar este portão ao release exige novo C1 + recert (decisão do dono).
