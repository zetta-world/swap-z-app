# Compatibilidade Phantom/Lighthouse
Status: CURRENT_DEVELOPMENT. Base: bc6f67acbe6f3f0391ea998cb9a645a15fa7659b (PR448).
Escopo: transmissão Solana e vínculo de cotação; sem alterações econômicas, migrations, sessões ou Admin.
Plano antes do código: reproduzir recusa; comparar mensagem original autenticada pelo HMAC com a mensagem assinada; permitir somente sufixo de asserções Lighthouse validadas, preservando instruções originais, contas/permissões, pagador, blockhash e ALTs. Sem novo endpoint emissor de vínculo. Snapshots em memória, nunca logs/histórico. Testes adversariais e gates no SHA exato, PR/CI/Preview sem fundos; promoção depende de autorização final.
Fonte upstream inspecionada: Jac0xb/lighthouse commit 4c579479c98635e419b1b167f08be02a71604a71. ID exato L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95. MemoryWrite/MemoryClose não são asserções e serão recusadas.
Evidência do caso informado: Program ID recusado. Não contém os bytes pré/pós-assinatura nem discriminador, logo origem Phantom vs Jupiter e variante real ainda NÃO comprovadas. Testes sintéticos não serão apresentados como captura do caso real.

## Implementação e limites verificáveis
- Lighthouse: AccountInfo (5/6) e TokenAccount (9/10), logs Borsh 0–2, uma conta, até 16 assertivas por instrução e 8 instruções adicionais. Demais variantes recusadas, inclusive MemoryWrite/Close e logs com CPI.
- Mensagem original enviada como evidência: só ganha autoridade após SHA-256 igual ao hash autenticado pelo HMAC existente. Sem novo emissor de vínculo.
- Comparação preserva pagador, blockhash, instruções originais (programa, contas ordenadas, bytes), privilégios e referências ALT exatas. Só aceita chave nova do programa Lighthouse readonly/nonsigner e sufixo de asserções em contas originais. Programa via ALT continua recusado.
- Todas as assinaturas continuam verificadas; transmissão e reserva W3-C permanecem no servidor. Reassinatura com outra asserção continua concorrendo pela mesma cotação/trava. Não há bytes assinados nos logs/histórico.
- Telemetria após validação registra apenas origem estrutural (`na_cotacao`/`apos_cotacao`) e discriminadores. Não atribui a alteração à Phantom sem evidência.

## Validação local antes do commit
- npm ci offline: PASS após duas falhas de rede registradas. Recuperação de quatro tarballs por IPv4 com SRI verificado contra o lockfile. Nenhuma dependência alterada.
- Base bc6f67a: fixture sintética reproduziu `programa_nao_permitido` e, separadamente, `vinculo_mensagem_diferente`.
- Testes específicos: 119 PASS; suíte completa anterior à adição do último teste: 5094 PASS / 342 arquivos. CI deve validar a suíte final no SHA exato.
- Typecheck PASS; lint 0 erros / 144 avisos. Audit-gate PASS, critical=0/high=25/moderate=40, exceção R-03 mantida, não corrigida.
- Varredura dos arquivos alterados por padrões de tokens/chaves privadas e revisão do diff: nenhum segredo identificado. Não equivale a varredura histórica integral.
- Build será verificado no Preview do SHA exato, preservando recursos do host de 4 GB. Produção não autorizada nesta etapa.
- Evidências locais: zswap-local/evidence/phantom-lighthouse-20261021/.

## Bloqueio de promoção
Não há captura pré/pós da tentativa real nem discriminador observado. A compatibilidade comprovada é a do subconjunto documentado em fixtures sintéticas, não a reprodução da Phantom Android real. Não declarar o incidente resolvido nem solicitar promoção enquanto faltar essa evidência e os gates finais. PR deve permanecer em draft até então. Nenhum swap real iniciado.
