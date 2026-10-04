# FOUNDERS SALE — RUNBOOK OPERACIONAL · 🟡 PREPARADO (nada executado em produção)

> 04/10/2026, lane B. Procedimentos para quando a venda existir de verdade. **Hoje nada disto roda fora do ensaio
> local**: `NFT_REAL_SALE=OFF` · `MAINNET_MINT=OFF` · `PUBLIC_SALE=OFF`. Toda ação crítica de admin é de **dois
> passos** (`src/lib/founders-sale/admin.ts`): operador autorizado + motivo (≥ 10 caracteres) → frase exata → outro
> operador confirma dentro da validade; pedido velho (estado mudou) = `versao_desatualizada`; tudo vai para a trilha
> de evidência encadeada (`founders_sale_events`, append-only — 0071).

## 0. Pré-voo (antes de QUALQUER fase)

1. Configuração versionada sem erro (`validarConfig = []`) e **fingerprint publicado** (`fingerprintConfig`).
2. Pendências zeradas para o que a fase usa (`pendencias(cfg)`): horários (OD-NFT-08), país (OD-NFT-16), reserva com
   finalidade (OD-NFT-04), royalty % (OD-NFT-11), tesouraria (OD-NFT-22). **Pendência = não abre.**
3. `PRICE_STATUS=FINAL` só depois do pacote de validação de demanda PASS (OD-NFT-21) e decisão registrada no ledger.
4. Tesouraria verificada (§ 13) e programa de venda verificado no ensaio em devnet.

## 1. Lançamento (abrir inscrição → congelar → abrir allowlist)

| passo | ação | prova |
|---|---|---|
| 1 | `transicao abrir_inscricao` (só ≥ `inscricaoAbre`) | estado `APPLICATION_OPEN`; evento `transicao_autoritativa` |
| 2 | no fechamento: montar snapshot (`montarSnapshot`) | `allowlist_snapshot` + `merkle_root` + `proof_version` na trilha |
| 3 | `congelar_snapshot` (frase `CONGELAR SNAPSHOT V<n>`) | estado `ALLOWLIST_FROZEN`; snapshot imutável (trigger 0071); **publicar id + raiz** |
| 4 | 1 min antes da abertura: `congelarFase("allowlist")` | preço congelado com fingerprint; referência e instante registrados |
| 5 | `transicao abrir_allowlist` (só ≥ `allowlistAbre`, exige snapshot congelado) | `ALLOWLIST_SALE` |
| 6 | 1 min antes de `publicaAbre`: `congelarFase("publica")`; o relógio do servidor abre a pública (`tick`) | `PUBLIC_SALE` |

## 2. Pausa · 3. Retomada

- **Pausar:** `pausar` (frase `PAUSAR VENDA`, motivo obrigatório). Efeito: compras novas = `venda_fechada`;
  transações JÁ enviadas seguem e confirmam (verdade on-chain) — a reconciliação conta.
- **Retomar:** `retomar` (frase `RETOMAR VENDA`). Volta ao estado anterior à pausa. Se a data final passou durante a
  pausa, o relógio encerra (`ENDED`) — não há retomada depois do fim.

## 4. Esgotado

Automático: quando `available = 0` e `reserved = 0` em todos os tiers, o serviço chama `esgotar` e grava
`sold_out_reconciliation` (minted × paid_supply × reserved). Conferir contra o supply on-chain (§ 11). Pilot não
vende na pública: Pilot não vendido na allowlist **impede** o "esgotado" total — a venda termina por data (`ENDED`).

## 5. Pagamento/mint falhou

Recibo `failed` → reserva cancelada na hora, unidade volta ao estoque, usuário vê `TRANSACTION_FAILED` + "nada foi
mintado". Recibo ausente/corrompido = `PENDING` (nunca sucesso). Reserva que expira antes da confirmação e recebe
confirmação tardia = `RECONCILIATION_REQUIRED` → § 11.

## 6. Snapshot de preço errado

Preço congelado não muda. Se a referência estava errada: **pausar** → decidir (dono) entre manter a fase ou encerrá-la e
abrir nova fase com novo congelamento (nova versão/fingerprint publicados). Nunca editar o congelado. Compras feitas
continuam válidas pelo preço exibido.

## 7. Decisão de rollback de snapshot

Snapshot congelado **não** é editado nem apagado (trigger). Erro na lista = **pausar**, montar snapshot v+1, congelar
(dois operadores), publicar id/raiz novos, explicar publicamente. Provas do v antigo passam a falhar (`prova_invalida`).
Alocações já mintadas com o v antigo continuam válidas.

## 8. Degradação de provedor (RPC, preço, e-mail)

- Chain/RPC fora: `acompanhar` responde `PENDING`; compras novas = `cadeia_indisponivel` com a reserva liberada.
  Pausar se passar de alguns minutos.
- Fonte de preço fora: a fase não congela → não abre (`preco_indisponivel`). Não usar valor manual sem decisão do dono.
- E-mail fora: inscrição continua; verificação de e-mail espera (Early Access Fase 2 tem retry).

## 9. Carteira (provedor de wallet) fora

UI mostra `disconnected`/`connecting`. Nada a fazer no servidor; comunicar em canal oficial. Não estender a fase sem
decisão registrada.

## 10. Pico de demanda inesperado

O livro de reservas é serializado (prova: 500 concorrentes, OVERSOLD = 0). Rate limit por IP-HMAC do Early Access
continua. Não aumentar supply nem teto por carteira com a venda aberta (exige nova configuração = novo fingerprint).

## 11. Reconciliação de supply

Comparar: `progresso()` (minted/reserved/available) × supply on-chain do programa × eventos `mock_tx_lifecycle`
confirmados. Divergência = pausar e investigar; nunca "ajustar" número. `RECONCILIATION_REQUIRED` precisa de decisão
caso a caso (a verdade on-chain prevalece).

## 12. Encerramento pós-venda

O encerramento oficial (esgotado ou data final) fixa o início dos **36 meses** de premium (OD-NFT-14). Registrar o
instante na trilha; travar metadata (OD-NFT-13); publicar relatório: vendido por tier, não vendido (fica sem mint,
OD-NFT-09), reconciliação.

## 13. Verificação da tesouraria (antes de qualquer pagamento real)

`verificarTesouraria(cfg, observado)` (`src/lib/founders-sale/tesouraria.ts`): o operador lê da chain (devnet no
ensaio; depois a rede real **com autorização**) o endereço da multisig, a lista de donos, o limiar e o resultado de uma
transação simulada, e compara com a configuração. Só `OK` libera; `PENDING_*` ou `DIVERGENTE` bloqueiam. Publicar o
`fingerprintEndereco`. Hoje: **PENDING_OWNER** (signatários e política de conversão — OD-NFT-22).
