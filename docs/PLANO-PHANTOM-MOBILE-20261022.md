# Phantom mobile: acompanhamento do PR449
Base cc79fc7886c2918a3cba2a44960cc67727365bfe. Relato do proprietário: dentro da Phantom, erro lighthouse_instrucao_nao_permitida, UI móvel e conexão/assinatura intermitentes.
Escopo: impedir requisições concorrentes, apresentação móvel do modal e diagnóstico estrutural da variante recusada, sem bytes assinados, valores, endereços ou segredos. Não ampliar allowlist sem variante observada. Sem mudança econômica, banco, credenciais ou runtime. Validar localmente e Preview; não declarar o swap real resolvido sem evidência.

Implementação: trava síncrona no handler de execução, botões desabilitados durante execução, modal dimensionado por dvh e valores sem truncamento; seleção da carteira commitada antes de connect, prioridade Installed e bloqueio de cliques concorrentes. Diagnóstico Lighthouse limitado a opcode/log/account-count/byte-length depois de verificar assinaturas. Não muda instruções aceitas. Retira Retry da recusa permanente.
Testes locais: 129 específicos PASS; typecheck PASS. Ainda sem validação visual em aparelho e sem código estrutural da variante real. O login assinado SIWS não foi alterado. Não declarar o incidente encerrado.
