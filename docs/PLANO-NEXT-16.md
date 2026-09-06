# PLANO — a migração do Next 14 → 16

> **Status:** 🟢 feita (06/09/2026). `next@14.2.35 → 16.3.4`, `react@18 → 19`,
> `eslint@8 → 9`. **O `next` saiu do `npm audit`** — os 21 advisories fecharam.

---

## 0. Por que fazer

`next@14.2.35` carrega **21 advisories** de segurança. A única correção é subir
de major — não há patch na linha 14. É a última das três frentes que o dono
listou como abertas, e a única em que *"os testes passaram"* **não é evidência
suficiente**: App Router muda comportamento sem quebrar compilação.

---

## 1. O que o levantamento achou (e o que ele DESMENTIU)

⚠️ **Eu superestimei o risco ao descrevê-lo.** O levantamento corrige três
coisas que eu tinha dito:

| eu disse | o que a medição mostra |
|---|---|
| "os `params` viraram assíncronos e o repo tem 30+ rotas" | **só 3 rotas dinâmicas**, e **2 já estão no formato assíncrono** (`Promise<...>` + `await params`). Falta **uma**: `pair/[chain]/[address]` |
| "`cookies()` vira assíncrono" | `auth/session.ts` **já faz `await cookies()`** — já era compatível |
| "o fim do cache padrão toca o `revalidate: 3600` das velas" | **errado**: `next: { revalidate: N }` explícito continua valendo. O que muda é o padrão de quem **não** anota |

### ⚠️ E o risco de cache que eu levantei também NÃO existe

Eu contei **53 fetches sem anotação de cache** e concluí que a mudança do padrão
(`force-cache` → *no-store*) multiplicaria chamadas a APIs com limite por IP —
o 429 que a fase 0 da bancada existe para evitar.

**O `grep` estava errado.** Ele excluía a anotação quando ela estava na MESMA
linha do `fetch(`, e neste repositório ela está quase sempre na linha seguinte.
Contando a chamada inteira: **71 anotados, 22 sem**. E os 22 são, um a um:

| o que são | por que não importam |
|---|---|
| `auth/client`, `tier/client`, `hooks/*` | fetch de **navegador** — o cache do Next nem participa |
| `ai/provider`, `limit/cow`, `tier/check`, `transak-server`, `autopilot-bridge`, `alert-test` | **POST** — o Next nunca cacheou |
| `api/jupiter.ts` | invólucro genérico; quem chama passa o `next: { revalidate: 5 }` |
| `defillama-yields`, `admin/api/funding` | **sem cache DE PROPÓSITO**, os dois com o motivo escrito — o funding tem cicatriz de 06/08, quando o botão devolveu medição de nove horas antes |

⚠️ **Então não há nada a anotar, e a etapa 1 sai do plano.** Fazer o trabalho
para casar com o meu próprio diagnóstico errado teria mexido em 22 arquivos sem
motivo — e teria enterrado as duas decisões deliberadas de NÃO cachear.

---

## 2. As etapas, em ordem, cada uma verificável sozinha

| # | etapa | como sei que deu certo |
|---|---|---|
| 1 | `next@15` + `react@19` + tipos | type-check, lint, 2537 testes, build |
| 2 | o `params` que falta virar `Promise` | type-check |
| 3 | `next@16` | idem, mais o `next lint` (removido no 16) → ESLint direto |
| 4 | **exercitar o preview à mão** | ⚠️ CI verde não basta — ver §3 |

⚠️ **15 antes de 16, e não direto.** Duas majors de uma vez tornam impossível
saber qual delas quebrou o quê — e o custo de descobrir isso depois é maior que
o de instalar duas vezes.

---

## 3. ⚠️ O que CI verde não prova

O App Router muda comportamento sem quebrar compilação. Estas três coisas
precisam de olho humano no preview, e nenhuma delas tem teste:

1. **A sessão** — cookie httpOnly, `getSession()` em rota e em página. Se ela
   quebrar, o cliente não perde uma tela: perde a carteira.
2. **Os 4 crons** — `CRON_SECRET`, `runtime = "nodejs"`, `maxDuration`. Um cron
   que passa a devolver 401 fica quieto, e "quieto" é o modo de falha que esta
   base já pagou caro.
3. **O shell da plataforma** — foi um import de tipo puro que derrubou o app
   inteiro em 24/08. Uma major de framework é a mesma classe de risco.

---

## 4. Como desfazer

⚠️ **Um `git revert` do merge basta**, e é por isso que esta migração vai num PR
só, sem nada mais junto: misturar trabalho de produto aqui tiraria a opção de
voltar sem perder o resto.


---

## 5. O que de fato aconteceu

| etapa | resultado |
|---|---|
| `next@15` + `react@19` | **25 erros, todos num arquivo só** — `@react-three/fiber@8` não suporta React 19. `fiber@9` resolveu os 25 |
| o `params` que faltava | `pair/[chain]/[address]` virou `Promise` + `await` |
| `next@16` | exigiu `eslint@9`, que exige **flat config**, e o Next 16 **removeu o `next lint`**. Os três se puxam |
| `npm audit` | ⚠️ **`next` não aparece mais.** Sobram 44, todas na pilha de carteira (Solana adapters, metamask, wagmi) — frente separada |

### ⚠️ Dois achados que não eram da migração

**1. `serverComponentsExternalPackages` mudou de nome e saiu de `experimental`.**
O build avisava, e aviso de config some no meio de 200 linhas de saída. Se
tivesse deixado de valer, o `ccxt` (3 MB, 100+ adaptadores) voltaria para dentro
do bundle do servidor.

**2. ⚠️ Um `<a href="/">` no Topbar.** O `eslint-config-next@16` passou a tratar
isso como erro, e com razão: `<a>` recarrega a página inteira e **derruba o
estado do cliente — carteira conectada, idioma, gaveta do ZION**. Virou `Link`.
Este achado sozinho já paga a migração.

### As 117 regras do React Compiler

O `eslint-config-next@16` liga como ERRO seis regras novas, com **117
ocorrências em código que está em produção há meses** — diagnóstico novo sobre
código velho, não regressão. Ficaram como **aviso**, com o porquê escrito em
`eslint.config.mjs` e a fila registrada lá. ⚠️ `set-state-in-effect` (70) e
`purity` (36) são as que de fato escondem defeito; merecem leva própria, com o
app exercitado à mão, e não de carona numa troca de framework.

### O `tsconfig.json` foi reescrito pelo próprio build

⚠️ `jsx: "preserve"` → **`"react-jsx"`**, mais `.next/dev/types` no `include`. O
Next 16 faz isso sozinho no primeiro build. Fica registrado porque é mudança de
como o `tsc` compila JSX — e `npm run type-check` é metade da nossa rede.

---

## 6. O que foi exercitado à MÃO (o que o CI não prova)

Servidor de produção subido local, `next start`:

| | |
|---|---|
| 9 páginas (`/`, `/laboratorio`, `/pricing`, `/plans`, `/pro`, `/settings`, `/dashboard`, `/zion`, `/pools`) | **200** |
| `/pair/ethereum/0xabc` — a rota do `params` assíncrono | **200** |
| `/api/bancada/*` sem cookie de sessão | **401** — recusa, não explode |
| os **4 crons** sem `CRON_SECRET` | **401** nos quatro — a auth sobreviveu |
| cabeçalhos de segurança | todos presentes, **inclusive o `Cross-Origin-Opener-Policy: same-origin-allow-popups`** sem o qual a carteira Coinbase morre (cicatriz de 19/08) |
| `/admin` sem sessão | **404**, como a casa exige — nunca 403 |
