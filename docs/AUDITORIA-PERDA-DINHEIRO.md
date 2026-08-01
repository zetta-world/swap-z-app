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
| 7 | Teto de gasto: 3 furos (ver abaixo) | plataforma | 🟢 corrigido |
| 8 | Plano/paywall: matriz declarada e não aplicada | ambos | 🟢 corrigido |

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

## 7 · Teto de gasto (01/08)

A hipótese de entrada estava **errada** e vale registrar: eu esperava encontrar
`/api/quote` sem teto nenhum. Não é o caso — o pentest de 28/07 já tinha posto
limite por IP **e** um teto global por minuto. O que a varredura achou foram
três outros furos, dois deles mais graves que o suposto.

**7a · O maior gastador não tinha gate.** O `/api/zion` — o caminho voltado ao
usuário, LLM por chamada — era o único consumidor de token sem kill-switch. O
disjuntor de custo podia pausar as sete mesas internas e o gasto seguir correndo
pela porta da frente. Agora existe `pause_zion`, e o `/api/zion` também ganhou
**teto diário próprio** (`ZION_DAILY_MAX`, padrão 20 mil chamadas/dia): o
disjuntor do watchdog é reativo — mede as últimas 24h e corta na conferência
seguinte —, e entre uma conferência e outra cabe uma conta inteira.

**7b · A lista do disjuntor estava incompleta pela terceira vez.** Mesmo depois
do conserto de 30/07 ela era digitada à mão dentro do watchdog, e faltavam
`pause_agent_a`, `pause_radar` e `pause_sniper`.

A causa não era distração — era **a mesma verdade escrita em lugares
diferentes**. Três bugs saíram dessa duplicação: (1) `pause_oracle` e
`pause_arbiter2` existiam no cron mas não apareciam no painel, mesas que só se
apagavam por deploy; (2) o disjuntor pausando só uma chave já desligada; (3) a
lista incompleta de agora.

A correção é estrutural, não pontual: `src/lib/admin/gate-keys.ts` — módulo
**puro**, sem import de servidor, para que o painel (client), o cron e o
watchdog derivem todos da mesma fonte. A classificação `GATE_SPENDS_TOKENS` mora
ao lado da definição do gate; a lista de corte é derivada dela; o `Record` é
total, então **gate novo sem classificação não compila**; e `gates.test.ts` cobra
a decisão explícita. O painel passou a exibir em vermelho qualquer gate sem
cartão, em vez de escondê-lo.

Nota sobre o que **não** entra no corte: as mesas mecânicas (RATATOSKR,
JÖRMUNGANDR, VÖLUNDR, FREYJA, ULLR, paper). Desligá-las não economizaria nada e
calaria o **grupo de controle** que dá sentido à comparação com as mesas de IA —
o experimento perderia o eixo justo exatamente quando o dinheiro aperta, que é
quando ele mais importa.

**7c · O teto do `/api/quote` era de disponibilidade, não de conta.** 3000/min
são 4,32 **milhões** de chamadas por dia, e uma enchente que fique logo abaixo do
limite nunca o dispara — ela só factura, indefinidamente. Um teto de conta
precisa de janela do tamanho da conta: `QUOTE_DAILY_MAX`, padrão 250 mil/dia.

Os três novos tetos **falham abertos** se o banco estiver fora. Uma proteção que
derruba o produto quando ela própria falha não é proteção.

---

## 8 · Plano e paywall (01/08)

`FEATURE_TIER` se descreve, no próprio comentário, como *"the single source of
truth for which gate a surface sits behind. UI and API both read from here"*.
A UI lia. A API não.

**8a · Três das quatro entradas nunca eram verificadas no servidor.** Só
`zionAdvisory` tinha um `if`. `cexAutopilot: "pro"` não era consultado por
`/api/cex/order` nem por `/api/autopilot/session`; o controle existia apenas no
`TierGate`, componente de **cliente** que **esconde a interface**.

Esconder botão não é controle de acesso. Um `curl` na rota entregava igual — e a
rota nem precisava ser descoberta, porque o código dela vai no bundle.

**8b · A cota diária não existia.** `TIER_DAILY_ANALYSES` (free 5 · pro 10 ·
trader 25 · pilot 30) trazia escrito *"Source of truth for the ENFORCEMENT
LAYER"*. A camada de aplicação nunca foi construída: **nada contava nada**. O
assinante do plano mais barato consumia sem limite o recurso mais caro da
plataforma — exatamente a conta que a assinatura deveria pagar. Com receita de
assinatura e taxa de no máximo 0,5%, o plano **é** o produto.

**8c · O furo mais sério era CONTRA O CLIENTE.** A página de preços anuncia, em
quatro idiomas, *"Free — 5 / day (ZION)"*. `TIER_DAILY_ANALYSES` concorda:
`free: 5`. Mas o gate exigia `"pro"`, então o usuário Free recebia **402: zero
análises, não cinco**.

Duas fontes diziam cinco, uma dizia nenhuma — e a que dizia nenhuma era a que
valia. Prometer na vitrine e negar na porta é o tipo de defeito que teste nenhum
pega, porque **cada lado, isolado, está coerente**. Só a comparação entre eles
denuncia.

Corrigido na direção da promessa publicada: quem separa os planos no ZION é a
**cota**, não o portão. O portão continua exigindo sessão — cota por carteira sem
carteira não vincula ninguém, e seria o mesmo que não ter cota.

**O que ficou** (`src/lib/tier/enforce.ts`):

- `checkFeatureTier(feature)` — mesma matriz que desenha a UI decide a resposta
  HTTP. Superfície nova fica protegida por **declarar a chave**, não por alguém
  lembrar de escrever o `if`.
- `consumeAnalysisQuota(wallet, tier)` — cota por **carteira** e por **dia**.
  Nunca por IP: por IP fura trocando de rede e ainda pune um escritório atrás de
  um NAT.
- Recusas com semântica correta: `401` sem sessão (o problema é entrar), `402`
  plano insuficiente (o problema é pagar), `429 + Retry-After` cota esgotada —
  cobrar upgrade de quem já pagou e só usou o dia seria vender duas vezes.
- Falha **aberta** se o banco cair, como os tetos de gasto.
- `ZionDrawer` deixou de digitar `"pro"` e passou a ler a matriz — senão a
  interface seguiria trancando o Free depois de o servidor liberá-lo.
- Teste travando `PLAN_TIERS[].dailyAnalyses` à `TIER_DAILY_ANALYSES`: se a
  vitrine e a porta divergirem de novo, o CI reprova.

⚠️ **Mudança de comportamento em produção.** O autopilot CEX agora **recusa de
verdade** abaixo de `pro` (`POST` de armar e de ordem; desarmar e ler estado
seguem abertos — trancar a saída de um autopilot já armado transformaria um
problema de cobrança em risco de dinheiro do usuário). Vale o mesmo interruptor
de sempre: `TIER_GATES_ENABLED=false` abre tudo.

**Ainda aberto:** `arbScanner: "trader"` e `prioritySupport: "trader"` não
correspondem a nenhuma superfície no código — são entradas mortas na matriz. O
feed de arbitragem cross-CEX é vendido no card do plano Trader e hoje entra pelo
`op=arbitrage` do ZION, sob a regra do ZION. Decidir se ele deve exigir `trader`
é decisão de produto, não de código.

---

## Próximos

A fila de perda de dinheiro está fechada. O que sobra é dívida conhecida:
o registro de tokens (#5) e a proteção MEV real em Solana (bundle Jito, #6).
