# Auditoria de perda de dinheiro — 30/07 a 01/08

Varredura de **tudo que faz a plataforma perder dinheiro** e **tudo que faz o
cliente perder dinheiro**. Motivada pelo compromisso registrado em
`PLANO-BARRA-DE-LANCAMENTO.md`: não colocar no mercado uma ferramenta que não
consegue ao menos não atrapalhar quem não pode perder US$100.

Um fio atravessa quase todos os achados abaixo, e vale mais que qualquer um
deles isolado:

> **A plataforma sabia o número antes de deixar o prejuízo acontecer.**
> Impacto de preço, honeypot, teto de sanduíche — em todos os casos o dado
> existia, estava calculado, e era usado só para *pintar a tela*. Informação que
> não muda a decisão não é proteção; é decoração com aparência de proteção, que
> é pior que nada, porque produz confiança sem produzir garantia.

Corolário que virou regra do repo: **ausência de verificação nunca renderiza
como segurança**. É o `inconclusivo ≠ aprovado` da bancada, aplicado ao usuário
final.

---

## Status

| # | Achado | Lado que perde | Status |
|---|--------|----------------|--------|
| 1 | Disjuntor de custo de IA desarmado na prática | plataforma | 🟢 corrigido |
| 2 | Impacto de preço só colorido, nunca bloqueante | cliente | 🟢 corrigido |
| 3 | `trades_today` do autopilot contado só no fim da execução | cliente | 🟢 corrigido |
| 4 | Selo de segurança do token era constante digitada à mão | cliente | 🟢 corrigido |
| 5 | Registro de tokens se declara lista de demo | cliente | 🔴 documentado, não corrigido |
| 6 | "Escudo MEV" e "modo privacidade" sem implementação | cliente | 🟢 corrigido |
| 7 | Sem teto de gasto por chamada de agregador | plataforma | 🟡 próximo |
| 8 | Bypass de tier/paywall | plataforma | ⏸️ não verificado |

---

## 6 · O escudo MEV era adesivo (01/08)

**O que existia.** Um botão de escudo **verde**, ligado por padrão, no card de
swap. Um chip no dashboard: *"Escudo MEV ativo"*. Um toggle nas configurações
descrito como:

> "Envio criptografado · anti-sandwich · mempool privado"

E, na página inicial, a linha *"Protegido contra MEV. Padrão institucional."*

**O que era verdade.** Nada disso. A flag `mevProtect` era lida por exatamente
dois lugares — os dois componentes que a **desenhavam**. Nenhuma linha do
caminho de execução a consultava:

- **EVM** — `sendTransactionAsync` entrega para a carteira do usuário, que
  transmite pelo RPC dela. Mempool pública, texto claro. O site nem participa da
  transmissão.
- **Solana** — `solConn.sendRawTransaction` pela nossa conexão, RPC público, sem
  bundle Jito.

Havia ainda um `privacyMode` prometendo *"logs criptografados · atraso aleatório
de execução · rotas ocultas"* — três funcionalidades, zero implementação.

**Por que é pior que o achado #4.** O selo do token era um número sem lastro.
Este era uma **afirmação nomeada** de proteção. Um usuário que acredita estar
atrás de mempool privada escolhe slippage mais larga do que escolheria sabendo a
verdade — e slippage larga é exatamente o que o sanduíche explora. A mentira não
era passiva: **empurrava o usuário na direção do prejuízo que dizia evitar.**

**O que ficou no lugar** (`src/lib/swap/mev-guard.ts`):

O lucro de um sanduíche é limitado pela tolerância de slippage — o atacante
empurra o preço até exatamente o `minOut` assinado e embolsa a diferença. Logo o
teto do roubo é `notional × slippage`, um número calculável **antes** da
assinatura. É isso que a interface passou a mostrar, em dólar:

> ⚠ Sua tolerância de 3,00% deixa até **$30,00** desta troca ao alcance de quem
> estiver lendo a mempool. Reduzir a tolerância reduz esse teto na mesma
> proporção.

Mais três decisões:

- **A rede decide se o ataque é possível.** Base, Arbitrum e Optimism ordenam por
  sequenciador e não têm mempool pública: sanduíche de terceiro não é viável, e
  ali o aviso **nunca** aparece. Gritar lobo onde não há lobo treina o usuário a
  ignorar o aviso onde há. Rede desconhecida assume o pior caso.
- **Não bloqueia.** Slippage larga às vezes é necessária — token volátil, pool
  rasa. O `impact-guard` já barra o catastrófico; barrar aqui seria paternalismo.
- **`privateRelayActive()` retorna `false`, com teste em cima.** Enquanto for
  `false`, nenhuma tela pode afirmar "mempool privado" sem que alguém tenha de
  alterar a função — e o teste que a acompanha.

O toggle deixou de ser verde. Verde comunica *"você está protegido"*, e o usuário
não está: ele está **informado**, que é outra coisa. O `privacyMode` foi removido
inteiro — não havia nada honesto em que transformá-lo.

**O que continua faltando (dívida real, não corrigida).** Proteção de verdade.
Em EVM ela depende do RPC da carteira e o site não tem como forçar — por isso a
tela agora **instrui** (Flashbots Protect, MEV Blocker) em vez de fingir. Em
Solana somos nós que transmitimos, então bundle Jito **é** implementável e não
está implementado. Enquanto não estiver, a defesa que funciona é tolerância curta.

---

## 5 · Registro de tokens (30/07) — aberto

`src/lib/tokens.ts` traz 36 tokens e um comentário que se autodenuncia:

> *"Curated default token list for the demo. In production, this is fetched from
> CoinGecko / TrustWallet token lists"*

Nunca foi feito. Os endereços nunca foram validados contra fonte externa. O
`token-safety` novo não cobre isso: ele checa se o token **é golpe**, não se é o
token **certo**. Um endereço errado ali manda dinheiro para o contrato errado com
todos os selos verdes.

---

## Próximos

7. **Teto de gasto por chamada de agregador** — sem limite de custo em 0x/LiFi.
8. **Bypass de tier/paywall** — não verificado.
