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
