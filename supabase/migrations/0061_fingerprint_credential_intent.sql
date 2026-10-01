-- ═══════════════════════════════════════════════════════════════════════
-- A120 — FINGERPRINT DA CREDENCIAL NO INTENT (ROUND 4 CIRÚRGICO).
--
-- ⚠️⚠️ O QUE ESTA COLUNA FECHA. O recovery por intentId reconciliava um
-- intent manual com QUALQUER credencial apresentada no body — o intentId
-- sozinho (um uuid que aparece em resposta, log e ticket de suporte) era a
-- única "autorização" para mutar o livro alheio com uma leitura feita com a
-- chave do ATACANTE. A partir desta migration, a ordem MANUAL REAL nasce com
-- `credential_fingerprint = HMAC_SHA256(chave_do_servidor, exchange + NUL +
-- apiKey)`, e o recovery confere a credencial apresentada CONTRA a impressão
-- gravada ANTES de tocar na venue (ver `src/lib/cex/fingerprint.ts` e o gate
-- em `/api/cex/order/status`).
--
-- ⚠️ NULLABLE DE PROPÓSITO, e os dois nascimentos nulos FECHAM no recovery:
--   · históricos (intents gravados antes desta coluna) — `recovery_not_bound`;
--   · autopilot/DCA — a credencial deles vive no cofre e o recovery deles é
--     pela SESSÃO (`use_a_sessao`), nunca por este caminho.
-- Não existe terceiro caso: ordem manual real cuja env de HMAC falte não
-- nasce (a rota responde 500 ANTES do executor).
--
-- Sem `security definer`, sem função, sem GRANT: uma coluna lida/escrita
-- apenas pela service_role. Sem ACL nova, portanto.
--
-- ─────────────────────────────────────────────────────────────────────
-- A120-H (ROUND 5) — A COLUNA DEIXA DE SER CONVENÇÃO E VIRA REGRA DE BANCO.
--
-- Até aqui o vínculo era garantido só pelo código (a rota calcula, o
-- executor grava). As duas CHECKs abaixo fecham o banco contra o caminho
-- que o código não vê (um insert manual de manutenção, um script de
-- suporte):
--
--   1. `cex_intent_manual_real_tem_fingerprint` — ordem MANUAL REAL
--      (`origin = 'manual'`, o literal que `/api/cex/order` grava — ver o
--      `origin: ehAutopilot ? "autopilot_browser" : "manual"` da rota) e
--      NÃO simulada não pode nascer — nem ser modificada para ficar — sem
--      `credential_fingerprint`. Autopilot/DCA/simulado seguem NULL de
--      propósito (credencial no cofre, recovery pela sessão).
--   2. `cex_intent_fingerprint_formato` — quando presente, a impressão é
--      EXATAMENTE o HMAC-SHA256 hex minúsculo (64 chars de [0-9a-f]). Um
--      fingerprint malformado seria um vínculo que nunca confere.
--
-- ⚠️ POR QUE `NOT VALID` NAS DUAS. Uma CHECK criada já VALID revalida a
-- tabela inteira no momento do ADD — e os intents HISTÓRICOS manuais reais
-- (gravados antes da coluna existir) têm fingerprint NULL por definição;
-- eles fecham no recovery com `recovery_not_bound` por desenho, e
-- revalidá-los falharia a migration sobre dados legítimos. Com NOT VALID:
--   · as linhas existentes NÃO são revalidadas (o histórico fica intacto);
--   · TODO INSERT e TODO UPDATE posteriores são conferidos na hora —
--     a regra vale para tudo que nasce ou muda depois dela.
-- Não é brecha: é exatamente a semântica pedida — o passado fecha no
-- recovery, o futuro fecha no banco.
--
-- ⚠️ LIMITAÇÃO DECLARADA — NÃO É WRITE-ONCE NO BANCO. Nenhuma das CHECKs
-- impede UPDATE que troque um fingerprint válido por outro válido: o banco
-- não impõe imutabilidade da coluna (um trigger para isso seria excesso
-- numa coluna que só a service_role escreve). A imutabilidade é garantida
-- por CONVENÇÃO VERIFICADA: `types.ts` não expõe o campo no `Update` da
-- tabela e uma guarda estrutural de teste proíbe qualquer `.update()` com
-- `credential_fingerprint` em `src/` — o campo nasce no insert e nunca
-- mais é escrito.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.cex_execution_intents
  add column if not exists credential_fingerprint text;

comment on column public.cex_execution_intents.credential_fingerprint is
  'A120: HMAC-SHA256 hex de (exchange_canonica + NUL + apiKey) sob '
  'CEX_RECOVERY_HMAC_KEY, gravado na criação da ordem MANUAL REAL. '
  'O recovery por intentId confere a credencial do body contra esta impressao '
  'antes de qualquer leitura na venue (null -> recovery_not_bound; divergente '
  '-> credential_mismatch). NULL em intents historicos e em autopilot/DCA '
  '(credencial no cofre, recovery pela sessao). NUNCA exposta em resposta, '
  'log ou evento; NUNCA atualizada depois do insert.';

-- A120-H: ordem manual REAL sem fingerprint NÃO NASCE (e não vira isso por
-- update). NOT VALID de propósito — ver o cabeçalho: o histórico não é
-- revalidado; todo insert/update posterior é conferido.
alter table public.cex_execution_intents
  add constraint cex_intent_manual_real_tem_fingerprint
  check (not (origin = 'manual' and simulated = false)
         or credential_fingerprint is not null) not valid;

-- A120-H: quando presente, a impressão é o HMAC-SHA256 hex minúsculo — 64
-- caracteres de [0-9a-f], nem mais nem menos. NULL segue permitido
-- (histórico, autopilot/DCA, simulado).
alter table public.cex_execution_intents
  add constraint cex_intent_fingerprint_formato
  check (credential_fingerprint is null
         or credential_fingerprint ~ '^[0-9a-f]{64}$') not valid;
